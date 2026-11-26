import type { ChatMessage, ProviderMetadata, StreamChunk, ToolCall } from '../types/index.js';
import { describeHttpError, describeStreamError } from './errors.js';
import { observeRateLimit, parseRateLimit } from './rateLimit.js';
import { compatibleTools, sseData } from './stream.js';
import { sanitizeToolHistory } from './toolHistory.js';
import { type ChatOptions, readUsage } from './types.js';

interface ToolDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

export function compatibleHeaders(providerId: string, apiKey?: string): Record<string, string> {
  if (!apiKey) return {};
  return providerId === 'azure-openai' ? { 'api-key': apiKey } : { Authorization: 'Bearer ' + apiKey };
}

/** Kimi and DeepSeek thinking models expect their reasoning echoed back in history. */
function usesReasoningContent(providerId: string, baseUrl: string): boolean {
  const id = providerId.toLowerCase();
  return id === 'moonshot' || id === 'kimi' || id === 'deepseek'
    || /api\.moonshot\.ai|moonshot\.cn|\/kimi(?:[-/.]|$)/i.test(baseUrl);
}

export function compatibleHistory(providerId: string, messages: ChatMessage[], baseUrl = '') {
  const reasoningField = usesReasoningContent(providerId, baseUrl);
  const history: Array<Record<string, unknown>> = [];
  const deferredImages: Array<Record<string, unknown>> = [];
  const flushImages = () => {
    if (deferredImages.length) history.push(...deferredImages.splice(0));
  };
  // Last line of defence: no provider ever sees an assistant tool_calls turn without
  // a matching tool response for each id, regardless of how the history was assembled.
  for (const message of sanitizeToolHistory(messages)) {
    if (message.role !== 'tool') flushImages();
    const imageParts = (message.images ?? []).map(({ mediaType, data }) =>
      ({ type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } }));
    const entry: Record<string, unknown> = {
      role: message.role,
      content: message.images?.length ? [
        { type: 'text', text: message.content },
        ...imageParts,
      ] : message.content || (message.toolCalls?.length ? null : ''),
      tool_call_id: message.role === 'tool' ? message.toolCallId : undefined,
      reasoning_content: reasoningField && message.role === 'assistant' && message.reasoningContent
        ? message.reasoningContent
        : undefined,
    };
    // DeepSeek rejects `tool_calls: []` (minimum length 1). Omit the field entirely when empty.
    if (message.toolCalls?.length) {
      entry.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      }));
    }
    if (message.role === 'tool' && imageParts.length) {
      entry.content = message.content;
      // Images are a separate user entry; deferring it keeps every tool response
      // directly next to its siblings until the whole group has been emitted.
      deferredImages.push({
        role: 'user',
        content: [{ type: 'text', text: '[Image attached to the tool result]' }, ...imageParts],
      });
    }
    history.push(entry);
  }
  flushImages();
  return history;
}

function buildPayload(providerId: string, model: string, messages: ChatMessage[], options: ChatOptions, baseUrl = '') {
  const payload: Record<string, unknown> = { model, messages: compatibleHistory(providerId, messages, baseUrl), stream: true };
  const openAi = ['openai', 'azure-openai'].includes(providerId);
  const reasoningModel = /^(?:o[134](?:-|$)|gpt-5(?:[.-]|$))/.test(model);
  const effort = (options.thinkingEffort ?? 'High').toLowerCase();
  if (openAi || providerId === 'groq') payload.stream_options = { include_usage: true };
  if (providerId === 'openrouter') payload.usage = { include: true };
  if (openAi && reasoningModel) {
    const canDisable = /^gpt-5\.[1-9]/.test(model);
    const canUseXHigh = /^gpt-5\.[2-9]/.test(model);
    payload.reasoning_effort = options.thinkingEnabled === false
      ? (canDisable ? 'none' : /^gpt-5(?:-|$)/.test(model) ? 'minimal' : 'low')
      : (effort === 'xhigh' && !canUseXHigh ? 'high' : effort);
  } else {
    if (options.temperature !== undefined) payload.temperature = options.temperature;
    if (providerId === 'deepseek' && /^deepseek-(flash|chat|reasoner|v4)/.test(model) && options.thinkingEnabled !== undefined) {
      payload.thinking = { type: options.thinkingEnabled ? 'enabled' : 'disabled' };
      if (options.thinkingEnabled) payload.reasoning_effort = effort === 'xhigh' ? 'max' : effort === 'low' ? 'low' : 'high';
    }
    if (providerId === 'nvidia' && model === 'nvidia/nemotron-3-super-120b-a12b' && options.thinkingEnabled !== undefined) {
      payload.reasoning_effort = options.thinkingEnabled ? effort === 'low' ? 'low' : 'high' : 'none';
    }
    if (providerId === 'nvidia' && model.startsWith('nvidia/') && typeof payload.temperature === 'number') {
      payload.temperature = Math.min(payload.temperature, 1);
    }
  }
  if (options.maxTokens) payload[openAi ? 'max_completion_tokens' : 'max_tokens'] = options.maxTokens;
  // Sonar is a web answer endpoint; its chat protocol does not accept local tools.
  if (providerId !== 'perplexity' && options.tools?.length) payload.tools = compatibleTools(options.tools);
  return payload;
}

function applyToolDeltas(calls: Map<number, ToolCall>, deltas: ToolDelta[]): void {
  deltas.forEach((delta, position) => {
    const index = delta.index ?? position;
    const call = calls.get(index) ?? { id: '', name: '', arguments: '' };
    if (delta.id) call.id = delta.id;
    if (delta.function?.name) call.name += delta.function.name;
    if (delta.function?.arguments) call.arguments += delta.function.arguments;
    calls.set(index, call);
  });
}

function responseText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) =>
    part?.type === 'text' && typeof part.text === 'string' ? part.text : '',
  ).join('') || undefined;
}

function responseUsage(providerId: string, raw?: {
  prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown; cost_usd?: unknown; cost?: unknown;
  prompt_cache_hit_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown };
}): StreamChunk['usage'] {
  if (!raw) return;
  return readUsage(raw.prompt_tokens, raw.completion_tokens, raw.total_tokens,
    raw.cost_usd ?? (providerId === 'openrouter' ? raw.cost : undefined),
    raw.prompt_cache_hit_tokens ?? raw.prompt_tokens_details?.cached_tokens);
}

export class OpenAICompatClient {
  public static async *streamChat(
    provider: ProviderMetadata,
    apiKey: string | undefined,
    baseUrl: string,
    messages: ChatMessage[],
    model: string,
    options: ChatOptions = {},
  ): AsyncGenerator<StreamChunk> {
    try {
      const response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...compatibleHeaders(provider.id, apiKey) },
        signal: options.signal,
        redirect: 'error',
        body: JSON.stringify(buildPayload(provider.id, model, messages, options, baseUrl)),
      });
      if (!response.ok) {
        const detail = await describeHttpError(provider.name, response, apiKey);
        if (response.status === 429) {
          observeRateLimit(provider.id, parseRateLimit(detail, response.headers.get('retry-after')));
        }
        yield { error: detail };
        return;
      }
      if (response.headers.get('content-type')?.includes('application/json')) {
        const event = await response.json();
        const reply = event.choices?.[0]?.message;
        if (event.error || !reply) {
          yield { error: describeStreamError(provider.name, event.error?.message ?? event.error ?? 'No chat response was returned.', apiKey) };
          return;
        }
        const calls = new Map<number, ToolCall>();
        if (Array.isArray(reply.tool_calls) && options.tools?.length) applyToolDeltas(calls, reply.tool_calls);
        const toolCalls = [...calls.values()].filter((call) => call.id && call.name);
        const text = responseText(reply.content);
        if (!text && !reply.reasoning_content && !reply.reasoning && !toolCalls.length) {
          yield { error: describeStreamError(provider.name, 'The chat reply was empty.', apiKey) };
          return;
        }
        yield { text, reasoning: reply.reasoning_content ?? reply.reasoning, usage: responseUsage(provider.id, event.usage),
          toolCalls: toolCalls.length ? toolCalls : undefined, isDone: true, finishReason: reply.finish_reason };
        return;
      }
      if (!response.body) {
        yield { error: provider.name + ' returned no response stream.' };
        return;
      }

      const toolCalls = new Map<number, ToolCall>();
      let finishReason: string | undefined;
      let ended = false;
      let hasContent = false;
      for await (const data of sseData(response.body)) {
        if (data === '[DONE]') {
          ended = true;
          break;
        }
        if (!data) continue;
        const event = JSON.parse(data);
        if (event.error) {
          yield { error: describeStreamError(provider.name, event.error.message ?? event.error, apiKey) };
          return;
        }

        const rawUsage = event.usage || event.x_groq?.usage
          ? { ...event.x_groq?.usage, ...event.usage }
          : undefined;
        const usage = responseUsage(provider.id, rawUsage);
        const choice = event.choices?.[0];
        const delta = choice?.delta;
        const text = responseText(delta?.content);
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (text || reasoning) hasContent = true;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (delta?.tool_calls && options.tools?.length) applyToolDeltas(toolCalls, delta.tool_calls);
        if (text || reasoning || usage) yield { text, reasoning, usage };
      }

      if (!ended && !finishReason) {
        yield { error: provider.name + ' response ended before completion.' };
        return;
      }
      const calls = [...toolCalls.entries()].sort(([left], [right]) => left - right)
        .map(([, call]) => call)
        .filter((call) => call.id && call.name);
      const complete = finishReason === 'tool_calls' || finishReason === 'stop' || (ended && !finishReason);
      if (!hasContent && (!complete || !calls.length)) {
        yield { error: provider.name + ' returned an empty chat response' + (finishReason ? ' (' + finishReason + ').' : '.') };
        return;
      }
      yield { isDone: true, finishReason, toolCalls: complete && calls.length ? calls : undefined };
    } catch (error) {
      options.signal?.throwIfAborted();
      yield { error: describeStreamError(provider.name, error, apiKey) };
    }
  }
}
