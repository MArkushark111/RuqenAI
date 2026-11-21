export type ProviderConnection = 'native' | 'compatible' | 'endpoint' | 'catalog';

// Verified chat routes. A catalog record alone is never an endpoint authorization.
const compatible = new Set([
  'openai', 'cohere', 'mistral', 'xai', 'perplexity', 'deepseek',
  'groq', 'together', 'fireworks', 'deepinfra', 'siliconflow',
  'openrouter', 'litellm', 'huggingface', 'zhipu', 'moonshot', 'qwen',
  'bytedance-doubao', 'minimax', 'stepfun', 'baidu-ernie', 'ai21', 'nvidia',
]);
const native = new Set(['ollama', 'anthropic', 'gemini']);
const endpointRequired = new Set(['azure-openai', 'bedrock', 'google-cloud-ai', 'baseten', 'runpod', 'custom']);

export function providerConnection(id: string): ProviderConnection {
  if (native.has(id)) return 'native';
  if (compatible.has(id)) return 'compatible';
  if (endpointRequired.has(id)) return 'endpoint';
  return 'catalog';
}

export function normalizeEndpoint(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Enter an absolute http:// or https:// endpoint URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Enter an HTTP endpoint without credentials, a query string, or a fragment.');
  }
  return url.href.replace(/\/+$/, '');
}
