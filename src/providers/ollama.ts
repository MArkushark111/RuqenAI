import { randomUUID } from 'node:crypto';
import type { ModelMetadata, StreamChunk, ChatMessage, ToolCall } from '../types/index.js';
import { configManager } from '../config/settings.js';
import { PROVIDERS_CATALOG } from './catalog.js';
import { describeHttpError, describeStreamError } from './errors.js';
import { compatibleTools, responseLines } from './stream.js';
import { type ChatOptions, readUsage } from './types.js';

export interface OllamaDetectionResult {
  isOnline: boolean;
  version?: string;
  models: ModelMetadata[];
}

interface OllamaModelDetails {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
  thinking?: { values?: Array<boolean | string> };
}

function thinkingSettings(details: OllamaModelDetails | undefined, options: ChatOptions): string | boolean | undefined {
  const values = details?.thinking?.values;
  if (options.thinkingEnabled === undefined) return undefined;
  if (!values && !details?.capabilities?.includes('thinking')) return undefined;
  if (values?.length === 1 && values[0] === false) return undefined;
  if (!options.thinkingEnabled) return false;
  const effort = (options.thinkingEffort ?? 'High').toLowerCase();
  if (values?.includes(effort)) return effort;
  if (effort === 'xhigh' && values?.includes('high')) return 'high';
  return true;
}

function modelMetadata(name: string, details: OllamaModelDetails | undefined): ModelMetadata {
  const info = details?.model_info ?? {};
  const contextWindow = Object.entries(info)
    .find(([key, value]) => key.endsWith('.context_length') && typeof value === 'number')?.[1] as number | undefined;
  const capabilities: ModelMetadata['capabilities'] = [];
  const chat = details?.capabilities?.includes('completion');
  if (chat) capabilities.push('text', 'code');
  if (details?.capabilities?.includes('vision')) capabilities.push('vision');
  if (details?.capabilities?.includes('tools')) capabilities.push('function_calling');
  if (details?.capabilities?.includes('embedding')) capabilities.push('embedding');
  const supportsThinking = details?.thinking?.values
    ? details.thinking.values.some((value) => value !== false)
    : details?.capabilities?.includes('thinking');
  if (supportsThinking) capabilities.push('reasoning');
  return {
    id: name,
    name,
    providerId: 'ollama',
    capabilities,
    contextWindow: contextWindow ?? 0,
    chatSupport: chat === undefined ? 'unknown' : chat ? 'supported' : 'unsupported',
    supportsThinking,
  };
}

function ollamaHistory(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    images: message.images?.map(({ data }) => data),
    thinking: message.toolCalls?.length ? message.reasoningContent : undefined,
    tool_name: message.role === 'tool' ? message.toolName : undefined,
    tool_calls: message.toolCalls?.map((call) => ({
      function: {
        name: call.name,
        arguments: JSON.parse(call.arguments),
      },
    })),
  }));
}

function parseToolCalls(rawCalls: Array<{ function?: { name?: string; arguments?: unknown } }>): ToolCall[] {
  return rawCalls.flatMap(({ function: fn }) => {
    if (!fn?.name) return [];
    const args = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {});
    return [{ id: randomUUID(), name: fn.name, arguments: args }];
  });
}

export class OllamaClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://127.0.0.1:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '');
  }

  public async showModel(model: string, signal?: AbortSignal): Promise<OllamaModelDetails | undefined> {
    try {
      const deadline = AbortSignal.timeout(1500);
      const result = await fetch(this.baseUrl + '/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
      if (result.ok) return await result.json() as OllamaModelDetails;
    } catch {
      // Older versions and server proxies may omit /api/show or capability metadata.
    }
    return undefined;
  }

  public async detect({ details = false } = {}): Promise<OllamaDetectionResult> {
    try {
      const signal = AbortSignal.timeout(1500);
      const [version, tags] = await Promise.allSettled([
        fetch(this.baseUrl + '/api/version', { signal }),
        fetch(this.baseUrl + '/api/tags', { signal }),
      ]);
      if (tags.status === 'fulfilled' && tags.value.ok) {
        const data = await tags.value.json() as { models?: Array<{ name?: string; model?: string }> };
        if (Array.isArray(data.models)) {
          const ids = data.models.flatMap(({ name, model }) => name || model ? [name ?? model!] : []);
          const models = await Promise.all(ids.map(async (name) =>
            modelMetadata(name, details ? await this.showModel(name) : undefined)
          ));
          const versionData = version.status === 'fulfilled' && version.value.ok
            ? await version.value.json().catch(() => ({})) as { version?: string }
            : {};
          return { isOnline: true, version: versionData.version, models };
        }
      }
    } catch {
      // An unreachable host is represented by the offline result.
    }
    return { isOnline: false, models: PROVIDERS_CATALOG.ollama.popularModels };
  }

  public async *streamChat(
    messages: ChatMessage[],
    model: string,
    options: ChatOptions = {},
  ): AsyncGenerator<StreamChunk> {
    try {
      const hasImages = messages.some((message) => message.images?.length);
      const details = hasImages || options.tools?.length || options.thinkingEnabled !== undefined
        ? await this.showModel(model, options.signal)
        : undefined;
      if (details?.capabilities && !details.capabilities.includes('completion')) {
        yield { error: 'The selected Ollama model does not support chat.' };
        return;
      }
      if (hasImages && details?.capabilities && !details.capabilities.includes('vision')) {
        yield { error: 'The selected Ollama model cannot read images. Switch to a vision-capable model and send the draft again.' };
        return;
      }

      const think = thinkingSettings(details, options);
      const tools = details?.capabilities?.includes('tools') && options.tools?.length
        ? compatibleTools(options.tools)
        : undefined;
      const response = await fetch(this.baseUrl + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        redirect: 'error',
        body: JSON.stringify({
          model,
          messages: ollamaHistory(messages),
          stream: true,
          think,
          tools,
          options: { temperature: options.temperature ?? 0.7, num_predict: options.maxTokens },
        }),
      });

      if (!response.ok) {
        yield { error: await describeHttpError('Ollama', response) };
        return;
      }
      if (!response.body) {
        yield { error: 'Ollama returned no response stream.' };
        return;
      }

      let legacyThinking = false;
      let pending = '';
      const toolCalls: ToolCall[] = [];
      for await (const line of responseLines(response.body)) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (typeof event.error === 'string') {
          yield { error: describeStreamError('Ollama', event.error) };
          return;
        }

        const message = event.message;
        if (message?.thinking) yield { reasoning: message.thinking };
        if (message?.tool_calls && tools) toolCalls.push(...parseToolCalls(message.tool_calls));

        pending += message?.content ?? '';
        while (pending) {
          const tag = legacyThinking ? '</think>' : '<think>';
          const position = pending.indexOf(tag);
          if (position !== -1) {
            const content = pending.slice(0, position);
            if (content) yield legacyThinking ? { reasoning: content } : { text: content };
            pending = pending.slice(position + tag.length);
            legacyThinking = !legacyThinking;
            continue;
          }
          const suffix = pending.lastIndexOf('<');
          const end = !event.done && suffix !== -1 && tag.startsWith(pending.slice(suffix)) ? suffix : pending.length;
          const content = pending.slice(0, end);
          if (content) yield legacyThinking ? { reasoning: content } : { text: content };
          pending = pending.slice(end);
          break;
        }

        if (event.done) {
          const usage = readUsage(event.prompt_eval_count, event.eval_count);
          const complete = !event.done_reason || event.done_reason === 'stop';
          yield { isDone: true, finishReason: event.done_reason, usage, toolCalls: complete && toolCalls.length ? toolCalls : undefined };
          return;
        }
      }
      yield { error: 'The Ollama response ended before completion.' };
    } catch (error) {
      options.signal?.throwIfAborted();
      yield { error: describeStreamError('Ollama', error) };
    }
  }
}

export const ollamaClient = new OllamaClient(configManager.getOllamaHost());
