import type { ChatMessage, StreamChunk, ToolCall } from '../types/index.js';
import { describeHttpError, describeStreamError } from './errors.js';
import { sseData } from './stream.js';
import { type ChatOptions, readUsage } from './types.js';

type ContentBlock = Record<string, unknown> & { type: string };

export function anthropicHeaders(apiKey?: string): Record<string, string> {
  return { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' };
}

function anthropicHistory(messages: ChatMessage[]) {
  return messages.flatMap((message) => {
    if (message.role === 'system') return [];
    if (message.role === 'tool') {
      const content: unknown = message.images?.length
        ? [
            { type: 'text', text: message.content },
            ...message.images.map(({ mediaType, data }) =>
              ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })),
          ]
        : message.content;
      return [{
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content,
          is_error: Boolean(message.error),
        }] as ContentBlock[],
      }];
    }

    const recorded = message.toolCalls?.find((call) => Array.isArray(call.providerData))?.providerData;
    if (Array.isArray(recorded)) {
      return [{ role: message.role, content: recorded as ContentBlock[] }];
    }

    const content: ContentBlock[] = [];
    if (message.content) content.push({ type: 'text', text: message.content });
    for (const { mediaType, data } of message.images ?? []) {
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
    }
    for (const call of message.toolCalls ?? []) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: JSON.parse(call.arguments) });
    }
    return content.length ? [{ role: message.role, content }] : [];
  });
}

function requestThinking(model: string, options: ChatOptions) {
  const adaptive = /^claude-(opus|sonnet)-4-[6-9](?:-|$)/.test(model);
  const alwaysAdaptive = /^claude-(fable|mythos|opus-5|sonnet-5)/.test(model);
  const extended = /^claude-(3-7-sonnet|(?:opus|sonnet|haiku)-4(?:-[015])?)(?:-|$)/.test(model);
  const maxTokens = options.maxTokens ?? 8192;
  if (options.thinkingEnabled === false && !alwaysAdaptive) {
    return {
      max_tokens: maxTokens,
      thinking: adaptive ? { type: 'disabled' } : undefined,
      temperature: adaptive ? undefined : options.temperature,
    };
  }
  const effort = (options.thinkingEffort ?? 'High').toLowerCase();
  if (adaptive || alwaysAdaptive) {
    return {
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort: options.thinkingEnabled === false ? 'low' : effort === 'xhigh' ? 'high' : effort },
    };
  }
  if (extended && options.thinkingEnabled && maxTokens > 1024) {
    const budgets = { Low: 1024, Medium: 2048, High: 4096, XHigh: 8192 };
    return {
      max_tokens: maxTokens,
      thinking: { type: 'enabled', budget_tokens: Math.min(maxTokens - 1, budgets[options.thinkingEffort ?? 'High']) },
    };
  }
  return { max_tokens: maxTokens, temperature: options.temperature };
}

export class AnthropicClient {
  public static async *streamChat(
    apiKey: string | undefined,
    messages: ChatMessage[],
    model: string,
    options: ChatOptions = {},
    baseUrl = 'https://api.anthropic.com/v1',
  ): AsyncGenerator<StreamChunk> {
    try {
      if (messages.some((message) => message.images?.some((image) => image.data.length > 10_000_000))) {
        yield { error: 'Anthropic requires each encoded image to be at most 10 MB. Resize the image and send it again.' };
        return;
      }
      const response = await fetch(baseUrl + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...anthropicHeaders(apiKey) },
        signal: options.signal,
        redirect: 'error',
        body: JSON.stringify({
          model,
          messages: anthropicHistory(messages),
          system: messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n') || undefined,
          ...requestThinking(model, options),
          stream: true,
          tools: options.tools?.length ? options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
          })) : undefined,
        }),
      });
      if (!response.ok) {
        yield { error: await describeHttpError('Anthropic', response, apiKey) };
        return;
      }
      if (!response.body) {
        yield { error: 'Anthropic returned no response stream.' };
        return;
      }

      const blocks = new Map<number, ContentBlock>();
      const inputs = new Map<number, string>();
      let metrics: Record<string, number> = {};
      let stopReason: string | undefined;
      for await (const data of sseData(response.body)) {
        if (!data) continue;
        const event = JSON.parse(data);
        if (event.type === 'error') {
          yield { error: describeStreamError('Anthropic', event.error?.message, apiKey) };
          return;
        }
        if (event.type === 'message_start') metrics = event.message?.usage ?? {};
        if (event.type === 'content_block_start' && event.content_block) {
          blocks.set(event.index, event.content_block);
          if (event.content_block.text) yield { text: event.content_block.text };
          if (event.content_block.thinking) yield { reasoning: event.content_block.thinking };
        }
        if (event.type === 'content_block_delta') {
          const block = blocks.get(event.index);
          if (!block) continue;
          const delta = event.delta;
          if (delta?.type === 'text_delta') {
            block.text = String(block.text ?? '') + delta.text;
            if (delta.text) yield { text: delta.text };
          } else if (delta?.type === 'thinking_delta') {
            block.thinking = String(block.thinking ?? '') + delta.thinking;
            if (delta.thinking) yield { reasoning: delta.thinking };
          } else if (delta?.type === 'signature_delta') {
            block.signature = String(block.signature ?? '') + delta.signature;
          } else if (delta?.type === 'input_json_delta') {
            inputs.set(event.index, (inputs.get(event.index) ?? '') + delta.partial_json);
          }
        }
        if (event.type === 'message_delta') {
          metrics = { ...metrics, ...event.usage };
          stopReason = event.delta?.stop_reason ?? stopReason;
        }

        if (event.type === 'message_stop') {
          const toolCalls: ToolCall[] = [];
          const ordered = [...blocks.entries()].sort(([left], [right]) => left - right);
          if (stopReason === 'tool_use' && options.tools?.length) {
            for (const [index, block] of ordered) {
              if (block.type !== 'tool_use' || typeof block.id !== 'string' || typeof block.name !== 'string') continue;
              const partial = inputs.get(index);
              if (partial) block.input = JSON.parse(partial);
              toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
            }
            if (toolCalls.length) toolCalls[0].providerData = ordered.map(([, block]) => block);
          }
          const inputTokens = typeof metrics.input_tokens === 'number'
            ? metrics.input_tokens + (metrics.cache_creation_input_tokens ?? 0) + (metrics.cache_read_input_tokens ?? 0)
            : undefined;
          yield {
            isDone: true,
            finishReason: stopReason,
            usage: readUsage(inputTokens, metrics.output_tokens),
            toolCalls: toolCalls.length ? toolCalls : undefined,
          };
          return;
        }
      }
      yield { error: 'The Anthropic response ended before completion.' };
    } catch (error) {
      options.signal?.throwIfAborted();
      yield { error: describeStreamError('Anthropic', error, apiKey) };
    }
  }
}
