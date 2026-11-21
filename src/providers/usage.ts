import type { ProviderUsage } from '../types/index.js';

export interface TokenRates {
  input: number;
  output: number;
  cachedInput?: number;
}

// Public standard token rates in USD per million, https://console.groq.com/docs/models
// Account-specific rates can override these from Settings.
const groqRates = new Map<string, TokenRates>([
  ['openai/gpt-oss-120b', { input: 0.15, output: 0.60 }],
  ['openai/gpt-oss-20b', { input: 0.075, output: 0.30 }],
  ['openai/gpt-oss-safeguard-20b', { input: 0.075, output: 0.30 }],
  ['meta-llama/llama-prompt-guard-2-22m', { input: 0.03, output: 0.03 }],
  ['meta-llama/llama-prompt-guard-2-86m', { input: 0.04, output: 0.04 }],
  ['qwen/qwen3.8-27b', { input: 0.8, output: 4 }],
]);

export function modelRateKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

export function defaultModelRates(provider: string, model: string, endpoint?: string, at = new Date()): TokenRates | undefined {
  if (provider === 'deepseek') {
    const configured = process.env.DEEPSEEK_BASE_URL ?? endpoint;
    if (configured && !/^https:\/\/api\.deepseek\.com(?:\/v1)?\/*$/i.test(configured)) return;
    // Published UTC windows. Holidays and account discounts can change the final charge.
    const hour = at.getUTCHours();
    const weekday = at.getUTCDay();
    const factor = weekday >= 1 && weekday <= 5 && (hour >= 1 && hour < 4 || hour >= 6 && hour < 10) ? 2 : 1;
    if (['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(model)) {
      return { input: 0.15 * factor, output: 0.6 * factor, cachedInput: 0.003 * factor };
    }
    if (model === 'deepseek-v4-pro') return { input: 0.66 * factor, output: 1.98 * factor, cachedInput: 0.022 * factor };
    return;
  }
  if (provider !== 'groq') return undefined;
  const configured = process.env.GROQ_BASE_URL ?? endpoint;
  return !configured || configured.replace(/\/+$/, '') === 'https://api.groq.com/openai/v1' ? groqRates.get(model) : undefined;
}

export function mergeUsage(total: ProviderUsage, usage?: ProviderUsage): void {
  if (!usage) return;
  for (const key of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'totalTokens', 'costUsd', 'estimatedCostUsd', 'unpricedRequests'] as const) {
    const amount = usage[key];
    if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) {
      total[key] = (total[key] ?? 0) + amount;
    }
  }
}

export function pricedUsage(usage: ProviderUsage | undefined, rates?: TokenRates): ProviderUsage {
  if (usage?.costUsd !== undefined) return usage;
  if (usage?.inputTokens !== undefined && usage.outputTokens !== undefined
    && rates && Number.isFinite(rates.input) && Number.isFinite(rates.output) && rates.input >= 0 && rates.output >= 0) {
    const cached = Math.min(usage.inputTokens, usage.cachedInputTokens ?? 0);
    const estimatedCostUsd = ((usage.inputTokens - cached) * rates.input + cached * (rates.cachedInput ?? rates.input)
      + usage.outputTokens * rates.output) / 1e6;
    if (Number.isFinite(estimatedCostUsd)) return { ...usage, estimatedCostUsd };
  }
  return { ...usage, unpricedRequests: 1 };
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const smallUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 3 });

export function costSummary(...usages: Array<ProviderUsage | undefined>): { label: string; value: string; unpriced: number } {
  const merged: ProviderUsage = {};
  for (const usage of usages) mergeUsage(merged, usage);
  const estimate = merged.estimatedCostUsd !== undefined;
  const label = estimate ? 'Est. cost' : 'API cost';
  const unpriced = merged.unpricedRequests ?? 0;
  if (merged.costUsd === undefined && !estimate) return { label, value: 'Unavailable', unpriced };
  const amount = (merged.costUsd ?? 0) + (merged.estimatedCostUsd ?? 0);
  const value = amount > 0 && amount < 0.01 ? amount < 1e-6 ? '<$0.000001' : smallUsd.format(amount) : usd.format(amount);
  return { label, value, unpriced };
}
