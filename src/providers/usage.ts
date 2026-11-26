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

// Public standard token rates in USD per million, https://docs.z.ai/guides/overview/pricing
// Shared by the international Z.ai API and the China-region BigModel catalog.
const glmRates = new Map<string, TokenRates>([
  ['glm-5.3', { input: 1.4, cachedInput: 0.26, output: 4.4 }],
  ['glm-5.3-flash', { input: 0.15, cachedInput: 0.03, output: 0.5 }],
  ['glm-5.3-flashx', { input: 0.37, cachedInput: 0.075, output: 1.25 }],
  ['glm-5.3-flashx-legal', { input: 0.37, cachedInput: 0.075, output: 1.25 }],
  ['glm-5.2', { input: 1.4, cachedInput: 0.26, output: 4.4 }],
  ['glm-5.1', { input: 1.4, cachedInput: 0.26, output: 4.4 }],
  ['glm-5', { input: 1, cachedInput: 0.2, output: 3.2 }],
  ['glm-4.7', { input: 0.6, cachedInput: 0.11, output: 2.2 }],
  ['glm-4.7-flash', { input: 0, output: 0 }],
  ['glm-4.7-flashx', { input: 0.07, cachedInput: 0.01, output: 0.4 }],
  ['glm-4.6', { input: 0.6, cachedInput: 0.11, output: 2.2 }],
  ['glm-4.5', { input: 0.6, cachedInput: 0.11, output: 2.2 }],
  ['glm-4.5-flash', { input: 0, output: 0 }],
  // BigModel-only catalog entry; CNY list price (~¥5/1M) converted to USD.
  ['glm-4-plus', { input: 0.75, output: 0.75 }],
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
    // Legacy chat/reasoner IDs are still served and billed flat (no peak windows).
    if (model === 'deepseek-chat' || model === 'deepseek-reasoner') {
      return { input: 0.28, output: 0.42, cachedInput: 0.028 };
    }
    if (['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(model)) {
      return { input: 0.15 * factor, output: 0.6 * factor, cachedInput: 0.003 * factor };
    }
    if (model === 'deepseek-v4-pro') return { input: 0.66 * factor, output: 1.98 * factor, cachedInput: 0.022 * factor };
    return;
  }
  if (provider === 'zai' || provider === 'zhipu') {
    const configured = process.env[provider.toUpperCase() + '_BASE_URL'] ?? endpoint;
    const official = provider === 'zai' ? 'https://api.z.ai/api/paas/v4' : 'https://open.bigmodel.cn/api/paas/v4';
    if (configured && configured.replace(/\/+$/, '') !== official) return;
    return glmRates.get(model.trim().toLowerCase());
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
  const input = usage?.inputTokens, output = usage?.outputTokens, total = usage?.totalTokens;
  const billableInput = input ?? (total !== undefined && output !== undefined && total >= output ? total - output : undefined);
  const billableOutput = output ?? (total !== undefined && input !== undefined && total >= input ? total - input : undefined);
  if (billableInput !== undefined && billableOutput !== undefined
    && rates && Number.isFinite(rates.input) && Number.isFinite(rates.output) && rates.input >= 0 && rates.output >= 0) {
    const cached = Math.min(billableInput, usage?.cachedInputTokens ?? 0);
    const estimatedCostUsd = ((billableInput - cached) * rates.input + cached * (rates.cachedInput ?? rates.input)
      + billableOutput * rates.output) / 1e6;
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
