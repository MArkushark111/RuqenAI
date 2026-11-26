import { configManager } from '../config/settings.js';
import { KeyStore } from '../config/keystore.js';
import type { ChatMessage, ModelMetadata, ProviderMetadata, StreamChunk } from '../types/index.js';
import { AnthropicClient, anthropicHeaders } from './anthropic.js';
import { ProviderCatalog } from './catalog.js';
import { describeHttpError, describeStreamError } from './errors.js';
import { GeminiClient, geminiHeaders } from './gemini.js';
import { modelReferenceRows } from './modelReferences.js';
import { OllamaClient } from './ollama.js';
import { OpenAICompatClient, compatibleHeaders } from './openaiCompat.js';
import { withRateLimit } from './rateLimit.js';
import { normalizeEndpoint } from './protocols.js';
import { sanitizeToolHistory } from './toolHistory.js';
import type { ChatOptions } from './types.js';

export interface ProviderModels {
  provider?: ProviderMetadata;
  status: 'live' | 'catalog' | 'unavailable';
  models: ModelMetadata[];
  detail?: string;
  credentialVerified?: boolean;
}

export interface ProviderCandidate {
  apiKey?: string;
  endpoint?: string;
}

interface Connection {
  provider: ProviderMetadata;
  endpoint: string;
  apiKey?: string;
}

type ModelRecord = Record<string, unknown> & {
  architecture?: { output_modalities?: string[]; input_modalities?: string[] };
  input_modalities?: string[];
  output_modalities?: string[];
  supported_parameters?: string[];
  supportedGenerationMethods?: string[];
  endpoints?: string[];
};

function knownNonChat(id: string): boolean {
  return /(^|[\/_-])(embedding|embed|rerank|whisper|tts|moderation|dall-e|audio|realtime|transcribe|imagen|veo|chirp|sora)([\/_.:-]|$)/i.test(id)
    || /^(?:gpt-image|computer-use|babbage|davinci)/i.test(id)
    || /(?:-image(?:-|$)|-tts(?:-|$))/i.test(id);
}

function modelFromRecord(raw: ModelRecord, provider: ProviderMetadata, defaultConnection: boolean): ModelMetadata | undefined {
  if (typeof raw !== 'object' || !raw) return undefined;
  const identifier = raw.id ?? raw.model ?? raw.name;
  if (typeof identifier !== 'string' || !identifier) return undefined;
  const id = provider.id === 'gemini' ? identifier.replace(/^models\//, '') : identifier;
  const known = provider.popularModels.find((model) => model.id === id);
  let supported: boolean | undefined;
  if (knownNonChat(id)) supported = false;
  else if (Array.isArray(raw.output_modalities)) supported = raw.output_modalities.includes('text');
  else if (raw.architecture?.output_modalities) supported = raw.architecture.output_modalities.includes('text');
  else if (raw.supportedGenerationMethods) supported = raw.supportedGenerationMethods.includes('generateContent');
  else if (raw.endpoints) supported = raw.endpoints.includes('chat');
  else if (typeof raw.type === 'string') {
    if (raw.type.toLowerCase() === 'chat') supported = true;
    if (/embedding|rerank|speech|image|video/.test(raw.type.toLowerCase())) supported = false;
  }
  if (supported === undefined && defaultConnection) {
    if (provider.id === 'anthropic' || provider.id === 'siliconflow' || provider.id === 'huggingface') supported = true;
    if (provider.id === 'openai' && /^(gpt-|o[134](?:-|$))/.test(id)) supported = true;
    if (known?.capabilities.some((item) => item === 'text' || item === 'code')) supported = true;
  }

  const capabilities = [...(known?.capabilities ?? [])];
  if (supported && !capabilities.includes('text')) capabilities.push('text', 'code');
  if ((raw.architecture?.input_modalities ?? raw.input_modalities)?.includes('image') && !capabilities.includes('vision')) capabilities.push('vision');
  if (raw.supported_parameters?.includes('tools') && !capabilities.includes('function_calling')) capabilities.push('function_calling');
  const supportsThinking = raw.supported_parameters
    ? raw.supported_parameters.some((parameter) => parameter === 'reasoning' || parameter === 'reasoning_effort')
    : known?.supportsThinking ?? (
      (provider.id === 'openai' && /^(o[134](?:-|$)|gpt-5)/.test(id))
      || (provider.id === 'anthropic' && /claude-(3-7-sonnet|(?:opus|sonnet|haiku)-4|fable|mythos)/.test(id))
      || (provider.id === 'gemini' && /^gemini-(2\.5|[34])/.test(id))
      || (provider.id === 'deepseek' && /^deepseek-(reasoner|v4|flash|chat)/.test(id))
      || undefined
    );
  if (supportsThinking && !capabilities.includes('reasoning')) capabilities.push('reasoning');
  const context = raw.context_length ?? raw.context_window ?? raw.inputTokenLimit ?? raw.max_input_tokens;
  const name = raw.display_name ?? raw.displayName ?? (raw.id && raw.name) ?? known?.name;
  const created = raw.created ?? raw.created_at ?? raw.createdAt;
  const timestamp = typeof created === 'number' ? (created < 1e12 ? created * 1000 : created)
    : typeof created === 'string' ? Date.parse(created) : NaN;
  return {
    id, name: typeof name === 'string' ? name : id, providerId: provider.id,
    capabilities, contextWindow: typeof context === 'number' ? context : (known?.contextWindow ?? 0),
    chatSupport: supported === undefined ? 'unknown' : supported ? 'supported' : 'unsupported',
    supportsThinking,
    releasedAt: Number.isFinite(timestamp) ? timestamp : undefined,
    deprecated: raw.is_deprecated === true || raw.deprecated === true || raw.status === 'deprecated',
  };
}

function catalogModels(provider: ProviderMetadata): ModelMetadata[] {
  const runnable = ProviderCatalog.connection(provider.id) !== 'catalog';
  return provider.popularModels.map((model) => ({
    ...model,
    chatSupport: runnable && model.capabilities.some((item) => item === 'text' || item === 'code')
      ? 'unknown'
      : 'unsupported',
  }));
}

function mergeKnownModels(provider: ProviderMetadata, models: ModelMetadata[], includeReferences = true): ModelMetadata[] {
  const byId = new Map(models.map((model) => [model.id.toLowerCase(), model]));
  for (const known of catalogModels(provider)) {
    const key = known.id.toLowerCase();
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, known);
      continue;
    }
    byId.set(key, {
      ...known,
      ...existing,
      name: existing.name && existing.name !== existing.id ? existing.name : known.name,
      supportsThinking: existing.supportsThinking ?? known.supportsThinking,
      capabilities: existing.capabilities.length ? existing.capabilities : known.capabilities,
      contextWindow: existing.contextWindow || known.contextWindow,
      chatSupport: existing.chatSupport === 'unsupported' && known.chatSupport !== 'unsupported'
        ? known.chatSupport
        : existing.chatSupport,
      deprecated: existing.deprecated ?? known.deprecated,
    });
  }
  if (includeReferences) {
    for (const [id, label, status] of modelReferenceRows(provider.id, new Set(byId.keys()))) {
      byId.set(id.toLowerCase(), {
        id,
        name: label,
        providerId: provider.id,
        capabilities: ['text', 'code'],
        contextWindow: 0,
        chatSupport: ProviderCatalog.connection(provider.id) === 'catalog' ? 'unsupported' : 'unknown',
        deprecated: /retired|legacy|alias/i.test(status ?? ''),
      });
    }
  }
  return [...byId.values()];
}

function optionalKey(provider: ProviderMetadata): boolean {
  return provider.id === 'ollama' || provider.id === 'litellm' || provider.requiresKey === false;
}

function endpointFromEnvironment(provider: ProviderMetadata): string | undefined {
  const envName = provider.id.replace(/-/g, '_').toUpperCase() + '_BASE_URL';
  return process.env[envName] ?? (provider.id === 'azure-openai' ? process.env.AZURE_OPENAI_ENDPOINT : undefined);
}

function configuredEndpoint(provider: ProviderMetadata, candidate?: string): string {
  if (provider.id === 'ollama') return normalizeEndpoint(candidate ?? configManager.getOllamaHost());
  const endpoints = configManager.get().customEndpoints;
  const saved = Object.hasOwn(endpoints, provider.id) ? endpoints[provider.id] : undefined;
  const raw = candidate ?? endpointFromEnvironment(provider) ?? saved ?? provider.defaultBaseUrl;
  if (!raw) throw new Error(ProviderCatalog.setupHint(provider.id) ?? 'Configure a base URL for an OpenAI-compatible deployment.');
  const endpoint = normalizeEndpoint(raw);
  if (provider.id === 'azure-openai' && new URL(endpoint).pathname === '/') return endpoint + '/openai/v1';
  return endpoint;
}

function resolveConnection(provider: ProviderMetadata, candidate: ProviderCandidate): Connection {
  const endpoint = configuredEndpoint(provider, candidate.endpoint);
  if (provider.id === 'ollama') return { provider, endpoint };
  if (candidate.apiKey !== undefined) return { provider, endpoint, apiKey: candidate.apiKey };
  if (candidate.endpoint !== undefined) {
    let configured: string | undefined;
    try { configured = configuredEndpoint(provider); } catch {}
    if (configured !== endpoint) return { provider, endpoint };
  }
  const apiKey = endpoint === provider.defaultBaseUrl || endpointFromEnvironment(provider)
    ? KeyStore.getKey(provider.id)
    : configManager.getSavedApiKey(provider.id);
  return { provider, endpoint, apiKey };
}

function listLocation(connection: Connection): string | undefined {
  const { provider: { id, defaultBaseUrl }, endpoint } = connection;
  if (id === 'google-cloud-ai') return undefined;
  if (id === 'bedrock' && new URL(endpoint).hostname.startsWith('bedrock-runtime.')) return undefined;
  if (endpoint !== defaultBaseUrl) return endpoint + '/models';
  if (id === 'cohere') return 'https://api.cohere.com/v1/models';
  if (id === 'gemini') return endpoint + '/models?pageSize=1000';
  if (id === 'fireworks') return 'https://api.fireworks.ai/v1/accounts/fireworks/models?pageSize=100';
  if (id === 'mistral') return 'https://api.mistral.ai/v1/models';
  if (id === 'siliconflow') return endpoint + '/models?type=text&sub_type=chat';
  return endpoint + '/models';
}

function connectionHeaders(connection: Connection): Record<string, string> {
  const { provider, apiKey } = connection;
  if (provider.id === 'anthropic') return anthropicHeaders(apiKey);
  if (provider.id === 'gemini') return geminiHeaders(apiKey);
  return compatibleHeaders(provider.id, apiKey);
}

function providerInfo(provider: ProviderMetadata, status: ProviderModels['status'], detail: string): ProviderModels {
  return { provider, status, models: mergeKnownModels(provider, []), detail };
}

async function fetchLiveModels(connection: Connection, location: string): Promise<{ models: ModelMetadata[]; detail?: string }> {
  const { provider, endpoint, apiKey } = connection;
  const signal = AbortSignal.timeout(12_000);
  const models = new Map<string, ModelMetadata>();
  const pages = new Set<string>();
  let next: string | undefined = location;
  let detail: string | undefined;
  const first = new URL(location);
  while (next && !pages.has(next) && pages.size < 100) {
    pages.add(next);
    try {
      const response = await fetch(next, {
        headers: connectionHeaders(connection),
        signal,
        redirect: 'error',
      });
      if (!response.ok) throw new Error(await describeHttpError(provider.name, response, apiKey));
      const data: { data?: ModelRecord[]; models?: ModelRecord[]; has_more?: boolean; last_id?: string; nextPageToken?: string; next_page_token?: string; next?: string } = await response.json();
      const records = Array.isArray(data) ? data : data.data ?? data.models;
      if (!Array.isArray(records)) throw new Error('The endpoint did not return a model list.');
      for (const record of records) {
        const model = modelFromRecord(record, provider, endpoint === provider.defaultBaseUrl);
        if (model) models.set(model.id, model);
      }
      const url = new URL(location);
      if (typeof data.nextPageToken === 'string' && data.nextPageToken) url.searchParams.set('pageToken', data.nextPageToken);
      else if (typeof data.next_page_token === 'string' && data.next_page_token) url.searchParams.set('page_token', data.next_page_token);
      else if (data.has_more && typeof data.last_id === 'string' && data.last_id) url.searchParams.set('after_id', data.last_id);
      else if (typeof data.next === 'string' && data.next) {
        const link = new URL(data.next, url);
        if (link.origin !== first.origin || link.pathname !== first.pathname || link.username || link.password || link.hash) {
          throw new Error('The next model page points outside the configured model endpoint.');
        }
        url.search = link.search;
      } else {
        next = undefined;
        if (data.has_more) detail = 'Partial model list. The provider did not specify a next page.';
        break;
      }
      next = url.href;
    } catch (error) {
      if (!models.size) throw error;
      detail = 'Partial model list. ' + describeStreamError(provider.name, error, apiKey);
      next = undefined;
    }
  }
  if (next) detail ??= 'Partial model list. Pagination did not finish.';
  return { models: [...models.values()].sort((left, right) => left.id.localeCompare(right.id)), detail };
}

export class ProviderManager {
  public static hasChatConnection(provider: ProviderMetadata): boolean {
    if (configManager.get().disconnectedProviders.includes(provider.id)
      || ProviderCatalog.connection(provider.id) === 'catalog') return false;
    try {
      const connection = resolveConnection(provider, {});
      return Boolean(connection.apiKey || optionalKey(provider));
    } catch {
      return false;
    }
  }

  public static async *streamChat(
    providerId: string, model: string, messages: ChatMessage[], options: ChatOptions = {},
  ): AsyncGenerator<StreamChunk> {
    messages = sanitizeToolHistory(messages);
    const provider = ProviderCatalog.get(providerId);
    if (!provider) {
      yield { error: 'Select a known provider or configure the Custom endpoint.' };
      return;
    }
    if (ProviderCatalog.connection(provider.id) === 'catalog') {
      yield { error: provider.name + ' has a catalog entry. Use a supported chat provider or configure its OpenAI-compatible gateway as Custom.' };
      return;
    }

    let connection: Connection;
    try {
      connection = resolveConnection(provider, {});
    } catch (error) {
      yield { error: error instanceof Error ? error.message : 'The provider endpoint is invalid.' };
      return;
    }
    const { apiKey, endpoint } = connection;
    if (!apiKey && !optionalKey(provider)) {
      yield { error: 'Configure ' + provider.name + ' with /provider ' + provider.id + ' or set ' + provider.envKey + '.' };
      return;
    }
    if (knownNonChat(model) && provider.id !== 'ollama') {
      yield { error: 'The selected model does not expose a coding chat endpoint.' };
      return;
    }
    if (provider.id === 'ollama') {
      yield* withRateLimit(provider.id, options.signal, new OllamaClient(endpoint).streamChat(messages, model, options));
      return;
    }
    if (provider.id === 'anthropic') {
      yield* withRateLimit(provider.id, options.signal, AnthropicClient.streamChat(apiKey, messages, model, options, endpoint));
      return;
    }
    if (provider.id === 'gemini') {
      yield* withRateLimit(provider.id, options.signal, GeminiClient.streamChat(apiKey, messages, model, options, endpoint));
      return;
    }
    yield* withRateLimit(provider.id, options.signal, OpenAICompatClient.streamChat(provider, apiKey, endpoint, messages, model, options));
  }

  public static async discoverModels(providerId: string, candidate: ProviderCandidate = {}): Promise<ProviderModels> {
    const provider = ProviderCatalog.get(providerId);
    if (!provider) return { status: 'unavailable', models: [], detail: 'Unknown provider.' };
    if (ProviderCatalog.connection(provider.id) === 'catalog') {
      return providerInfo(provider, 'catalog', 'Catalog reference. Ruqenai has no native chat adapter for this service.');
    }

    let connection: Connection;
    try {
      connection = resolveConnection(provider, candidate);
    } catch (error) {
      return providerInfo(provider, 'catalog', error instanceof Error ? error.message : 'The provider endpoint is invalid.');
    }

    if (provider.id === 'ollama') {
      const result = await new OllamaClient(connection.endpoint).detect({ details: true });
      return result.isOnline
        ? { provider, status: 'live', models: result.models, detail: result.models.length ? undefined : 'Ollama is online. No models are installed.' }
        : providerInfo(provider, 'unavailable', 'Ollama is offline or its model list could not be loaded.');
    }

    const { apiKey } = connection;
    if (!apiKey && !optionalKey(provider)) {
      return providerInfo(provider, 'catalog', 'Set ' + provider.envKey + ' or configure this provider to load its live models.');
    }
    const location = listLocation(connection);
    if (!location) {
      return providerInfo(provider, 'catalog', 'This chat route has no verified model-list endpoint. Enter your exact model or deployment ID to use it.');
    }
    try {
      const { models, detail } = await fetchLiveModels(connection, location);
      if (provider.id === 'zai' && models.length === 0) {
        return providerInfo(provider, 'catalog', 'Z.ai returned an empty model list. Catalog entries require access on your account.');
      }
      return { provider, status: 'live', models: mergeKnownModels(provider, models), detail };
    } catch (error) {
      return providerInfo(provider, 'catalog', describeStreamError(provider.name, error, apiKey));
    }
  }

  public static async checkProvider(providerId: string, candidate: ProviderCandidate = {}): Promise<ProviderModels> {
    const result = await this.discoverModels(providerId, candidate);
    if (!result.provider || result.status !== 'live' || result.provider.id === 'ollama') return result;
    if (result.detail) return result;
    const { provider, endpoint, apiKey } = resolveConnection(result.provider, candidate);
    if (!apiKey) return { ...result, detail: 'The endpoint returned a live model list without a key.' };

    if (provider.id === 'openrouter' && endpoint === provider.defaultBaseUrl) {
      try {
        const response = await fetch(endpoint + '/key', {
          headers: connectionHeaders({ provider, endpoint, apiKey }),
          signal: AbortSignal.timeout(4500),
          redirect: 'error',
        });
        if (!response.ok) throw new Error(await describeHttpError(provider.name, response, apiKey));
        return { ...result, credentialVerified: true, detail: 'OpenRouter verified the API key and returned a live model list.' };
      } catch (error) {
        return { ...result, credentialVerified: false, detail: describeStreamError(provider.name, error, apiKey) };
      }
    }
    const verifiesKey = endpoint === provider.defaultBaseUrl && [
      'openai', 'anthropic', 'gemini', 'cohere', 'groq', 'deepseek',
    ].includes(provider.id);
    return {
      ...result,
      credentialVerified: verifiesKey || undefined,
      detail: verifiesKey ? 'The provider accepted the key and returned a live model list.'
        : 'The endpoint returned a live model list. Key and chat access may depend on the deployment.',
    };
  }

  public static async getAvailableModels(providerId: string): Promise<ModelMetadata[]> {
    return (await this.discoverModels(providerId)).models;
  }
}
