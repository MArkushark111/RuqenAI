import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage, ToolCall } from '../src/types/index.js';
import { compatibleHistory } from '../src/providers/openaiCompat.js';
import { MISSING_TOOL_RESULT, sanitizeToolHistory } from '../src/providers/toolHistory.js';

let nextId = 0;
function message(role: ChatMessage['role'], content: string, extras: Partial<ChatMessage> = {}): ChatMessage {
  nextId++;
  return { id: `m${nextId}`, role, content, timestamp: nextId, ...extras };
}
function call(id: string): ToolCall {
  return { id, name: 'read_file', arguments: '{"path":"src/index.ts"}' };
}
function result(id: string, content = 'file contents'): ChatMessage {
  return message('tool', content, { toolCallId: id, toolName: 'read_file' });
}
function assistant(calls: ToolCall[]): ChatMessage {
  return message('assistant', '', { toolCalls: calls, reasoningContent: 'Kimi reasoning trace' });
}
function assertCompletePairs(entries: Array<Record<string, unknown>>): void {
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (entry.role !== 'assistant' || !Array.isArray(entry.tool_calls) || !entry.tool_calls.length) continue;
    const expected = (entry.tool_calls as ToolCall[]).map((item) => item.id).sort();
    const actual: string[] = [];
    for (let cursor = index + 1; cursor < entries.length && entries[cursor]!.role === 'tool'; cursor++) {
      actual.push(String(entries[cursor]!.tool_call_id));
    }
    assert.deepEqual(actual.sort(), expected, `assistant entry ${index} has unanswered tool_call_ids`);
  }
}

test('complete parallel tool pairs pass through unchanged', () => {
  const history = [
    message('system', 'system prompt'),
    message('user', 'read three files'),
    assistant([call('read_file:39'), call('read_file:40'), call('read_file:41')]),
    result('read_file:39'),
    result('read_file:40'),
    result('read_file:41'),
  ];
  assert.deepEqual(sanitizeToolHistory(history), history);
});

test('a partial parallel batch gets explicit fallback responses for the missing ids', () => {
  const safe = sanitizeToolHistory([
    assistant([call('read_file:39'), call('read_file:40'), call('read_file:41')]),
    result('read_file:39'),
    result('read_file:41'),
  ]);
  assert.deepEqual(safe.map((entry) => entry.role), ['assistant', 'tool', 'tool', 'tool']);
  assert.deepEqual(safe.slice(1).map((entry) => entry.toolCallId), ['read_file:39', 'read_file:40', 'read_file:41']);
  assert.match(safe[2]!.content, /not recorded/);
  assert.equal(safe[2]!.content, MISSING_TOOL_RESULT);
  assert.equal(safe[0]!.toolCalls?.length, 3);
  assert.equal(safe[0]!.reasoningContent, 'Kimi reasoning trace');
});

test('an entirely unanswered turn keeps its tool_calls and reasoning instead of being stripped', () => {
  const safe = sanitizeToolHistory([assistant([call('read_file:39'), call('read_file:40'), call('read_file:41')])]);
  assert.equal(safe.length, 4);
  assert.equal(safe[0]!.toolCalls?.length, 3);
  assert.equal(safe[0]!.reasoningContent, 'Kimi reasoning trace');
  assert.deepEqual(safe.slice(1).map((entry) => entry.toolCallId), ['read_file:39', 'read_file:40', 'read_file:41']);
});

test('orphaned and duplicate tool results are dropped', () => {
  const safe = sanitizeToolHistory([
    result('orphan'),
    assistant([call('read_file:39')]),
    result('read_file:39', 'first'),
    result('read_file:39', 'duplicate'),
  ]);
  assert.deepEqual(safe.map((entry) => entry.role), ['assistant', 'tool']);
  assert.equal(safe[1]!.content, 'first');
});

test('tool results separated by compaction or trimming are moved next to their call', () => {
  const safe = sanitizeToolHistory([
    result('read_file:39', 'early result'),
    message('user', 'compaction stub'),
    assistant([call('read_file:39'), call('read_file:40')]),
    result('read_file:40', 'late result'),
  ]);
  assert.deepEqual(safe.map((entry) => entry.role), ['user', 'assistant', 'tool', 'tool']);
  assert.equal(safe[2]!.content, 'early result');
  assert.equal(safe[3]!.content, 'late result');
});

test('sanitizing twice produces the same history', () => {
  const history = [
    assistant([call('read_file:39'), call('read_file:40')]),
    result('read_file:39'),
  ];
  const once = sanitizeToolHistory(history);
  assert.deepEqual(sanitizeToolHistory(once), once);
});

test('Moonshot payload echoes reasoning_content and never sends orphaned tool_call_ids', () => {
  const entries = compatibleHistory('moonshot', [
    message('user', 'go'),
    assistant([call('read_file:39'), call('read_file:40'), call('read_file:41')]),
    result('read_file:39'),
  ], 'https://api.moonshot.ai/v1');
  assert.equal(entries[1]!.reasoning_content, 'Kimi reasoning trace');
  assert.equal((entries[1]!.tool_calls as ToolCall[]).length, 3);
  assertCompletePairs(entries);
});

test('tool images never split a parallel tool-response group', () => {
  const entries = compatibleHistory('moonshot', [
    assistant([call('read_file:39'), call('read_file:40')]),
    { ...result('read_file:39'), images: [{ mediaType: 'image/png', data: 'AAAA' }] },
    result('read_file:40'),
  ], 'https://api.moonshot.ai/v1');
  assert.deepEqual(entries.map((entry) => entry.role), ['assistant', 'tool', 'tool', 'user']);
  assertCompletePairs(entries);
});

test('custom Moonshot endpoints also keep reasoning_content', () => {
  const entries = compatibleHistory('custom', [assistant([call('read_file:39')])], 'https://api.moonshot.ai/v1');
  assert.equal(entries[0]!.reasoning_content, 'Kimi reasoning trace');
  assertCompletePairs(entries);
});

test('unrelated providers do not receive a reasoning_content field', () => {
  const entries = compatibleHistory('openai', [assistant([call('read_file:39')])], 'https://api.openai.com/v1');
  assert.equal(entries[0]!.reasoning_content, undefined);
  assertCompletePairs(entries);
});

test('empty tool_call arrays never reach DeepSeek as tool_calls: []', () => {
  const history = [
    message('user', 'go'),
    message('assistant', 'no tools needed', { toolCalls: [], reasoningContent: 'Kimi reasoning trace' }),
  ];
  assert.equal(sanitizeToolHistory(history)[1]!.toolCalls, undefined);
  const entries = compatibleHistory('deepseek', history, 'https://api.deepseek.com/v1');
  assert.equal(Object.hasOwn(entries[1]!, 'tool_calls'), false);
  assert.equal(entries[1]!.reasoning_content, 'Kimi reasoning trace');
});
