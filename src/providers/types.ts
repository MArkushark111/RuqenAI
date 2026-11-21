import type { ProviderUsage, ThinkingEffort, ToolDefinition } from '../types/index.js';

export interface ChatOptions {
  temperature?: number;
  thinkingEnabled?: boolean;
  thinkingEffort?: ThinkingEffort;
  maxTokens?: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

function metric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function readUsage(input: unknown, output: unknown, total?: unknown, cost?: unknown, cached?: unknown): ProviderUsage | undefined {
  const inputTokens = metric(input);
  const outputTokens = metric(output);
  const totalTokens = metric(total) ?? (
    inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined
  );
  const costUsd = metric(cost);
  const reported: ProviderUsage = {};
  const cachedInputTokens = metric(cached);
  if (inputTokens !== undefined) reported.inputTokens = inputTokens;
  if (outputTokens !== undefined) reported.outputTokens = outputTokens;
  if (totalTokens !== undefined) reported.totalTokens = totalTokens;
  if (costUsd !== undefined) reported.costUsd = costUsd;
  if (cachedInputTokens !== undefined) reported.cachedInputTokens = cachedInputTokens;
  return Object.keys(reported).length ? reported : undefined;
}
