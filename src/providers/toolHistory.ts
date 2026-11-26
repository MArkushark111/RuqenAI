import type { ChatMessage, ToolCall } from '../types/index.js';

/** Sent as a tool result when the real result was lost before the request reached the provider. */
export const MISSING_TOOL_RESULT = 'Error: the result for this tool call was not recorded before the request was sent. '
  + 'Do not assume it succeeded; repeat the action if it is still needed.';

function validCalls(message: ChatMessage): ToolCall[] {
  return (message.toolCalls ?? []).filter((call): call is ToolCall => Boolean(call && typeof call.id === 'string' && call.id.length > 0));
}

/**
 * Guarantees that every assistant message containing `tool_calls` is immediately followed
 * by exactly one `role: "tool"` message for each of its `tool_call_id`s.
 *
 * Context compaction, live history trimming, aborts, and tool exceptions can all separate
 * or drop a tool result. OpenAI-compatible providers (Moonshot/Kimi in particular) reject
 * the whole request when even one call is left unanswered, so repair the sequence at the
 * last moment before serialization. The function is pure and idempotent: running it twice
 * produces the same history, and injected fallbacks are reused instead of duplicated.
 *
 * The assistant message itself is never stripped, which keeps `reasoningContent` available
 * to thinking models such as Kimi on multi-step tool turns.
 */
export function sanitizeToolHistory(messages: ChatMessage[]): ChatMessage[] {
  // First usable response for each id, wherever it appears in the transcript.
  const responses = new Map<string, ChatMessage>();
  const requested = new Set<string>();
  for (const message of messages) {
    if (message.role === 'tool' && message.toolCallId && !responses.has(message.toolCallId)) {
      responses.set(message.toolCallId, message);
    } else if (message.role === 'assistant') {
      for (const call of validCalls(message)) requested.add(call.id);
    }
  }

  const consumed = new Set<string>();
  const result: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === 'tool') continue;
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const calls = validCalls(message);
      if (!calls.length) {
        // Malformed calls (no ids) must never reach the provider as `tool_calls: []`.
        result.push({ ...message, toolCalls: undefined });
        continue;
      }
      result.push(calls.length === message.toolCalls.length ? message : { ...message, toolCalls: calls });
      // Emit each response directly after its call, in call order. Results stranded by
      // trimming or compaction are reused here instead of being duplicated or dropped.
      for (const call of calls) {
        const response = requested.has(call.id) && !consumed.has(call.id) ? responses.get(call.id) : undefined;
        if (response) {
          result.push(response);
          consumed.add(call.id);
        } else {
          result.push({
            id: `missing-tool-result:${message.id}:${call.id}`,
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: MISSING_TOOL_RESULT,
            timestamp: message.timestamp,
          });
        }
      }
      continue;
    }
    // An empty `toolCalls` array serializes to `tool_calls: []`, which DeepSeek
    // and other strict providers reject. Keep the assistant turn, drop the field.
    result.push(message.role === 'assistant' && message.toolCalls && !message.toolCalls.length
      ? { ...message, toolCalls: undefined } : message);
  }
  return result;
}
