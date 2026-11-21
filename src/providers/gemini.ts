import { randomUUID } from 'node:crypto';
import type { ChatMessage, StreamChunk, ToolCall } from '../types/index.js';
import { describeHttpError, describeStreamError } from './errors.js';
import { sseData } from './stream.js';
import { type ChatOptions, readUsage } from './types.js';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name?: string; response: Record<string, unknown> };
}

export function geminiHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { 'x-goog-api-key': apiKey } : {};
}

function geminiHistory(messages: ChatMessage[]) {
  const contents: Array<{ role: string; parts: GeminiPart[] }> = [];
  const nativeIds = new Map<string, string>();
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      if (!message.toolName) continue;
      const part: GeminiPart = {
        functionResponse: {
          id: message.toolCallId ? nativeIds.get(message.toolCallId) : undefined,
          name: message.toolName,
          response: message.error ? { error: message.error } : { result: message.content },
        },
      };
      if (contents.at(-1)?.parts[0]?.functionResponse) contents.at(-1)?.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
      continue;
    }
    const role = message.role === 'assistant' ? 'model' : 'user';
    const raw = message.toolCalls?.find((call) => Array.isArray(call.providerData))?.providerData;
    if (Array.isArray(raw)) {
      const recorded = raw as GeminiPart[];
      const signedCalls = recorded.filter((part) => part.functionCall?.name);
      for (const [index, tool] of (message.toolCalls ?? []).entries()) {
        const id = signedCalls[index]?.functionCall?.id;
        if (id) nativeIds.set(tool.id, id);
      }
      contents.push({ role, parts: recorded });
      continue;
    }
    const parts: GeminiPart[] = message.content ? [{ text: message.content }] : [];
    for (const { mediaType, data } of message.images ?? []) parts.push({ inlineData: { mimeType: mediaType, data } });
    for (const call of message.toolCalls ?? []) {
      parts.push({ functionCall: { name: call.name, args: JSON.parse(call.arguments) } });
    }
    if (parts.length) contents.push({ role, parts });
  }
  return contents;
}

function thinkingConfig(model: string, options: ChatOptions): Record<string, unknown> | undefined {
  if (options.thinkingEnabled === undefined) return undefined;
  const id = model.replace(/^models\//, '');
  const effort = options.thinkingEffort ?? 'High';
  if (/^gemini-[34](?:[.-]|$)/.test(id)) {
    const canUseMinimal = /^gemini-(?:3-flash|3\.[156]-flash)/.test(id);
    const hasTwoLevels = /^gemini-3-pro/.test(id);
    const canUseXHigh = /^gemini-4-(neon|hydrogen)/.test(id);
    const requested = effort === 'XHigh' && !canUseXHigh ? 'high' : effort.toLowerCase();
    const level = !options.thinkingEnabled
      ? canUseMinimal ? 'minimal' : 'low'
      : hasTwoLevels && requested === 'medium' ? 'high' : requested;
    return { includeThoughts: options.thinkingEnabled, thinkingLevel: level.toUpperCase() };
  }
  if (/^gemini-2\.5-(flash|pro)/.test(id)) {
    const budgets = { Low: 1024, Medium: 4096, High: 8192, XHigh: 16000 };
    const budget = options.thinkingEnabled ? budgets[effort] : /^gemini-2\.5-pro/.test(id) ? 128 : 0;
    return { includeThoughts: options.thinkingEnabled, thinkingBudget: budget };
  }
  return undefined;
}

export class GeminiClient {
  public static async *streamChat(
    apiKey: string | undefined,
    messages: ChatMessage[],
    model: string,
    options: ChatOptions = {},
    baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  ): AsyncGenerator<StreamChunk> {
    try {
      const url = baseUrl + '/models/' + encodeURIComponent(model.replace(/^models\//, '')) + ':streamGenerateContent?alt=sse';
      const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
      const images = messages.flatMap((message) => message.images ?? []);
      if (images.some(({ mediaType }) => mediaType === 'image/gif')) {
        yield { error: 'Gemini does not accept GIF images as chat attachments. Send a PNG, JPEG, or WebP instead.' };
        return;
      }
      const body = JSON.stringify({
        contents: geminiHistory(messages),
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        generationConfig: {
          temperature: /^gemini-[34]/.test(model.replace(/^models\//, '')) ? undefined : options.temperature,
          maxOutputTokens: options.maxTokens,
          thinkingConfig: thinkingConfig(model, options),
        },
        tools: options.tools?.length ? [{ functionDeclarations: options.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.inputSchema,
        })) }] : undefined,
      });
      if (images.length && Buffer.byteLength(body) > 20_000_000) {
        yield { error: 'Gemini inline images and prompt must fit within a 20 MB request. Resize or remove images and try again.' };
        return;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...geminiHeaders(apiKey) },
        signal: options.signal,
        redirect: 'error',
        body,
      });
      if (!response.ok) {
        yield { error: await describeHttpError('Gemini', response, apiKey) };
        return;
      }
      if (!response.body) {
        yield { error: 'Gemini returned no response stream.' };
        return;
      }

      const parts: GeminiPart[] = [];
      const toolCalls: ToolCall[] = [];
      let stopReason: string | undefined;
      let metrics: Record<string, number> = {};
      for await (const data of sseData(response.body)) {
        if (!data || data === '[DONE]') continue;
        const event = JSON.parse(data);
        if (event.error || event.promptFeedback?.blockReason) {
          yield {
            error: describeStreamError('Gemini', event.error?.message ?? event.promptFeedback?.blockReason, apiKey),
          };
          return;
        }
        if (event.usageMetadata) metrics = { ...metrics, ...event.usageMetadata };
        const candidate = event.candidates?.[0];
        stopReason = candidate?.finishReason ?? stopReason;
        for (const part of (candidate?.content?.parts ?? []) as GeminiPart[]) {
          parts.push(part);
          if (part.text) yield part.thought ? { reasoning: part.text } : { text: part.text };
          if (part.functionCall?.name && options.tools?.length) {
            const call = {
              id: part.functionCall.id ?? randomUUID(),
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args ?? {}),
            };
            toolCalls.push(call);
          }
        }
      }
      const reportedOutput = typeof metrics.candidatesTokenCount === 'number'
        ? metrics.candidatesTokenCount + (metrics.thoughtsTokenCount ?? 0)
        : undefined;
      const usage = readUsage(metrics.promptTokenCount, reportedOutput, metrics.totalTokenCount);
      if (stopReason && stopReason !== 'STOP' && stopReason !== 'MAX_TOKENS') {
        yield { error: describeStreamError('Gemini', stopReason, apiKey), usage };
        return;
      }
      if (stopReason !== 'STOP') toolCalls.length = 0;
      if (!parts.some((part) => part.text) && !toolCalls.length) {
        yield { error: 'Gemini returned an empty chat response.', usage };
        return;
      }
      if (toolCalls.length) toolCalls[0].providerData = parts;
      yield { isDone: true, usage, toolCalls: toolCalls.length ? toolCalls : undefined };
    } catch (error) {
      options.signal?.throwIfAborted();
      yield { error: describeStreamError('Gemini', error, apiKey) };
    }
  }
}
