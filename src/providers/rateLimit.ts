/**
 * Adaptive request pacing for chat providers.
 *
 * Some accounts (most notably Kimi / Moonshot's free tier) allow only a few
 * requests per minute across the whole organisation. Their HTTP 429 body says
 * "try again after 1 second", which is misleading: with a 3 RPM quota the next
 * slot only opens after ~20 seconds. Ruqenai therefore reads the real quota
 * from the error, remembers it for the rest of the session, and spaces later
 * requests automatically so the agent loop stops tripping over the limit.
 */

import type { StreamChunk } from '../types/index.js';

export interface RateLimitInfo {
  /** Requests-per-minute quota reported by the provider, when present. */
  rpm?: number;
  /** Time the provider asked us to wait, in milliseconds. */
  retryAfterMs?: number;
}

interface Throttle {
  minIntervalMs: number;
  lastRequestAt: number;
  blockedUntil: number;
}

const throttles = new Map<string, Throttle>();
const queues = new Map<string, Promise<unknown>>();

// A provider can ask for a very long cool-down (Kimi has sent 1924s). Sitting
// silently for half an hour is worse than surfacing the error, so never wait
// longer than this for a single retry or for pacing.
const MAX_RETRY_WAIT_MS = 60_000;

function throttleFor(key: string): Throttle {
  let state = throttles.get(key);
  if (!state) {
    state = { minIntervalMs: 0, lastRequestAt: 0, blockedUntil: 0 };
    throttles.set(key, state);
  }
  return state;
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new Error('Cancelled')); return; }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function positiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Parse the common 429 shapes: "max RPM: 3", "3 requests/minute", "try again after 1 seconds". */
export function parseRateLimit(detail?: string | null, retryAfter?: string | null): RateLimitInfo {
  const text = detail ?? '';
  let rpm: number | undefined;
  const patterns = [
    /RPM\s*:\s*(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*RPM\b/i,
    /(\d+(?:\.\d+)?)\s*requests?\s*(?:\/|per\s+)min(?:ute)?/i,
  ];
  for (const pattern of patterns) {
    rpm = positiveNumber(pattern.exec(text)?.[1]);
    if (rpm !== undefined) break;
  }

  let retryAfterMs: number | undefined;
  if (retryAfter) {
    const seconds = positiveNumber(retryAfter.trim());
    if (seconds !== undefined) retryAfterMs = seconds * 1000;
    else {
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) retryAfterMs = Math.max(0, date - Date.now());
    }
  }
  if (retryAfterMs === undefined) {
    const millis = /try again after\s+(\d+(?:\.\d+)?)\s*(?:ms|milliseconds?)\b/i.exec(text);
    const seconds = /try again after\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i.exec(text);
    if (millis) retryAfterMs = positiveNumber(millis[1]);
    else if (seconds) retryAfterMs = positiveNumber(seconds[1])! * 1000;
  }

  return { rpm, retryAfterMs };
}

export function isRateLimitError(detail?: string | null): boolean {
  return /\b429\b|rate.?limit|too many requests|\bRPM\b/i.test(detail ?? '');
}

/** How long to wait before retrying a throttled request. */
export function rateLimitDelayMs(info: RateLimitInfo): number {
  const fromRetryAfter = info.retryAfterMs !== undefined ? info.retryAfterMs + 500 : 0;
  // 60s / RPM with a little slack: the provider counts requests in a sliding window.
  const fromRpm = info.rpm !== undefined ? Math.ceil(60_000 / info.rpm) + 1_500 : 0;
  return Math.min(MAX_RETRY_WAIT_MS, Math.max(fromRetryAfter, fromRpm));
}

/** The spacing currently applied to a provider, in milliseconds. */
export function rateLimitIntervalMs(key: string): number {
  return throttleFor(key).minIntervalMs;
}

/** How long the next request to this provider would wait before being sent. */
export function rateLimitWaitMs(key: string): number {
  const state = throttleFor(key);
  const now = Date.now();
  return Math.min(MAX_RETRY_WAIT_MS, Math.max(0, state.blockedUntil - now, state.lastRequestAt + state.minIntervalMs - now));
}

/** Learn a limit from a failed request. Returns true when the pacing actually increased. */
export function observeRateLimit(key: string, info: RateLimitInfo): boolean {
  const state = throttleFor(key);
  const before = state.minIntervalMs;
  if (info.rpm !== undefined) {
    const interval = Math.min(MAX_RETRY_WAIT_MS, Math.ceil(60_000 / info.rpm) + 1_500);
    state.minIntervalMs = Math.max(state.minIntervalMs, interval);
  }
  if (info.retryAfterMs !== undefined) {
    const until = Math.min(Date.now() + info.retryAfterMs, Date.now() + MAX_RETRY_WAIT_MS);
    state.blockedUntil = Math.max(state.blockedUntil, until);
  }
  return state.minIntervalMs > before;
}

/** Wait until the provider's pacing allows another request, then claim the slot. */
export async function waitForSlot(key: string, signal?: AbortSignal): Promise<void> {
  const state = throttleFor(key);
  const previous = queues.get(key) ?? Promise.resolve();
  const entry = previous.then(async () => {
    if (signal?.aborted) throw signal.reason ?? new Error('Cancelled');
    const now = Date.now();
    const wait = Math.max(
      state.blockedUntil - now,
      state.lastRequestAt + state.minIntervalMs - now,
    );
    if (wait > 0) await sleepAbortable(wait, signal);
    state.lastRequestAt = Date.now();
  });
  // A cancelled request must not poison the queue for later requests.
  queues.set(key, entry.catch(() => undefined));
  return entry;
}

/** Wrap a provider stream so every chat request is paced and every 429 is learned. */
export async function* withRateLimit(
  key: string,
  signal: AbortSignal | undefined,
  source: AsyncGenerator<StreamChunk>,
): AsyncGenerator<StreamChunk> {
  await waitForSlot(key, signal);
  for await (const chunk of source) {
    if (chunk.error && isRateLimitError(chunk.error)) {
      observeRateLimit(key, parseRateLimit(chunk.error));
    }
    yield chunk;
  }
}
