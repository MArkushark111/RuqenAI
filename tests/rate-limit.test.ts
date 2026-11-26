import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isRateLimitError,
  observeRateLimit,
  parseRateLimit,
  rateLimitDelayMs,
  rateLimitIntervalMs,
  rateLimitWaitMs,
  waitForSlot,
} from '../src/providers/rateLimit.js';

const kimiError = 'moonshotai (kimi) returned HTTP 429. Your account org-abc123 request reached organization max RPM: 3, please try again after 1 seconds';

test('parses the Moonshot 429 body and ignores the misleading one-second hint', () => {
  const info = parseRateLimit(kimiError);
  assert.equal(info.rpm, 3);
  assert.equal(info.retryAfterMs, 1000);
  assert.equal(isRateLimitError(kimiError), true);
  assert.ok(rateLimitDelayMs(info) >= 20_000, 'must wait for the real 3 RPM window');
});

test('parses Retry-After headers and other rate-limit wordings', () => {
  assert.equal(parseRateLimit('Rate limit exceeded', '2').retryAfterMs, 2000);
  assert.equal(parseRateLimit('slow down, 12 requests per minute').rpm, 12);
  assert.equal(parseRateLimit('Too Many Requests').rpm, undefined);
});

test('learns a quota once and keeps spacing subsequent requests', () => {
  const key = 'moonshot-test';
  const info = parseRateLimit(kimiError);
  assert.equal(observeRateLimit(key, info), true);
  const interval = rateLimitIntervalMs(key);
  assert.equal(interval, 21_500);
  assert.equal(observeRateLimit(key, info), false, 'learning the same limit twice is a no-op');
  assert.equal(rateLimitIntervalMs(key), interval);
});

test('caps absurd provider retry-after values at one minute', () => {
  const key = 'moonshot-cap-test';
  const info = parseRateLimit('HTTP 429', '1924');
  assert.equal(info.retryAfterMs, 1_924_000);
  assert.equal(rateLimitDelayMs(info), 60_000);
  observeRateLimit(key, info);
  assert.ok(rateLimitWaitMs(key) <= 60_000);
});

test('reports the real pending wait so the retry notice is accurate', async () => {
  const key = 'moonshot-wait-test';
  observeRateLimit(key, parseRateLimit('organization max RPM: 3'));
  await waitForSlot(key);
  assert.ok(rateLimitWaitMs(key) > 20_000);
});
