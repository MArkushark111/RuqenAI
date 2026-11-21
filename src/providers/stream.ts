import type { ToolDefinition } from '../types/index.js';

export async function* responseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        ended = true;
        buffer += decoder.decode();
        if (buffer.trim()) yield buffer.trimEnd();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) yield line.trimEnd();
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  for await (const line of responseLines(body)) {
    if (line.startsWith('data:')) yield line.slice(5).trimStart();
  }
}

export function compatibleTools(tools: ToolDefinition[]) {
  return tools.map(({ name, description, inputSchema }) => ({
    type: 'function',
    function: { name, description, parameters: inputSchema },
  }));
}
