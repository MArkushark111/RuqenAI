/**
 * Provider catalog and model examples. Connection support is tracked separately.
 */

import { ProviderMetadata } from '../types/index.js';
import { providerConnection, type ProviderConnection } from './protocols.js';

export const PROVIDERS_CATALOG: Record<string, ProviderMetadata> = {
  custom: {
    id: 'custom',
    name: 'Custom endpoint',
    category: 'Local & Edge',
    description: 'A configured OpenAI-compatible API, such as LM Studio or vLLM.',
    envKey: 'CUSTOM_API_KEY',
    defaultBaseUrl: '',
    requiresKey: false,
    popularModels: [],
  },
  // ---------------- LOCAL & EDGE ----------------
  ollama: {
    id: 'ollama',
    name: 'Ollama Local',
    category: 'Local & Edge',
    description: 'Local LLM inference runner with auto-detected installed models.',
    envKey: 'OLLAMA_HOST',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    website: 'https://ollama.ai',
    isLocal: true,
    isFree: true,
    requiresKey: false,
    popularModels: [
      { id: 'llama3.2', name: 'Llama 3.2 3B', providerId: 'ollama', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
      { id: 'llama3.3:70b', name: 'Llama 3.3 70B', providerId: 'ollama', capabilities: ['text', 'code', 'reasoning'], contextWindow: 128000 },
      { id: 'deepseek-r1:latest', name: 'DeepSeek-R1 (Local)', providerId: 'ollama', capabilities: ['text', 'code', 'reasoning'], contextWindow: 128000, supportsThinking: true },
      { id: 'qwen2.5-coder:latest', name: 'Qwen 2.5 Coder', providerId: 'ollama', capabilities: ['text', 'code'], contextWindow: 128000 },
      { id: 'mistral:latest', name: 'Mistral 7B', providerId: 'ollama', capabilities: ['text', 'code'], contextWindow: 32000 },
      { id: 'phi3:latest', name: 'Phi-3 Mini', providerId: 'ollama', capabilities: ['text', 'code'], contextWindow: 128000 },
    ],
  },

  // ---------------- FRONTIER & GENERAL LLM ----------------
  openai: {
    id: 'openai',
    name: 'OpenAI',
    category: 'Frontier & General LLM',
    description: 'Pioneering frontier models GPT-4o, o1, o3-mini.',
    envKey: 'OPENAI_API_KEY',
    defaultBaseUrl: 'https://api.openai.com/v1',
    website: 'https://openai.com',
    popularModels: [
      { id: 'gpt-4o', name: 'GPT-4o', providerId: 'openai', capabilities: ['text', 'code', 'vision', 'function_calling'], contextWindow: 128000, isDefault: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', providerId: 'openai', capabilities: ['text', 'code', 'function_calling'], contextWindow: 128000 },
      { id: 'o3-mini', name: 'o3-mini (Reasoning)', providerId: 'openai', capabilities: ['text', 'code', 'reasoning'], contextWindow: 200000, supportsThinking: true },
      { id: 'o1', name: 'o1 (Reasoning)', providerId: 'openai', capabilities: ['text', 'code', 'reasoning'], contextWindow: 200000, supportsThinking: true },
    ],
  },

  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    category: 'Frontier & General LLM',
    description: 'Claude 3.7 Sonnet hybrid reasoning and coding intelligence.',
    envKey: 'ANTHROPIC_API_KEY',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    website: 'https://anthropic.com',
    popularModels: [
      { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet (Hybrid Thinking)', providerId: 'anthropic', capabilities: ['text', 'code', 'reasoning', 'vision'], contextWindow: 200000, supportsThinking: true, isDefault: true },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', providerId: 'anthropic', capabilities: ['text', 'code', 'vision'], contextWindow: 200000 },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', providerId: 'anthropic', capabilities: ['text', 'code'], contextWindow: 200000 },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', providerId: 'anthropic', capabilities: ['text', 'code'], contextWindow: 200000 },
    ],
  },

  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    category: 'Frontier & General LLM',
    description: 'Multimodal flagship AI models Gemini 2.5 Pro and 2.0 Flash Thinking.',
    envKey: 'GEMINI_API_KEY',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    website: 'https://ai.google.dev',
    popularModels: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', providerId: 'gemini', capabilities: ['text', 'code', 'reasoning', 'vision'], contextWindow: 2000000, supportsThinking: true, isDefault: true },
      { id: 'gemini-2.0-flash-thinking-exp', name: 'Gemini 2.0 Flash Thinking', providerId: 'gemini', capabilities: ['text', 'code', 'reasoning'], contextWindow: 1000000, supportsThinking: true },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', providerId: 'gemini', capabilities: ['text', 'code', 'vision'], contextWindow: 1000000 },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', providerId: 'gemini', capabilities: ['text', 'code', 'vision'], contextWindow: 2000000 },
    ],
  },

  'google-cloud-ai': {
    id: 'google-cloud-ai',
    name: 'Google Cloud AI (Vertex)',
    category: 'Frontier & General LLM',
    description: 'Enterprise Vertex AI with model garden and compliance controls.',
    envKey: 'GOOGLE_CLOUD_ACCESS_TOKEN',
    defaultBaseUrl: '',
    website: 'https://cloud.google.com/vertex-ai',
    popularModels: [
      { id: 'vertex-gemini-1.5-pro', name: 'Vertex Gemini 1.5 Pro', providerId: 'google-cloud-ai', capabilities: ['text', 'code', 'vision'], contextWindow: 2000000, isDefault: true },
    ],
  },

  'azure-openai': {
    id: 'azure-openai',
    name: 'Microsoft Azure OpenAI',
    category: 'Frontier & General LLM',
    description: 'Enterprise private deployments of OpenAI GPT and o-series models.',
    envKey: 'AZURE_OPENAI_API_KEY',
    defaultBaseUrl: '',
    website: 'https://azure.microsoft.com',
    popularModels: [
      { id: 'gpt-4o-azure', name: 'Azure GPT-4o', providerId: 'azure-openai', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  bedrock: {
    id: 'bedrock',
    name: 'Amazon Bedrock',
    category: 'Frontier & General LLM',
    description: 'AWS fully managed access to Claude, Llama, Titan, and Mistral.',
    envKey: 'AWS_BEARER_TOKEN_BEDROCK',
    defaultBaseUrl: '',
    website: 'https://aws.amazon.com/bedrock',
    popularModels: [
      { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', name: 'Bedrock Claude 3.5 Sonnet v2', providerId: 'bedrock', capabilities: ['text', 'code'], contextWindow: 200000, isDefault: true },
    ],
  },

  cohere: {
    id: 'cohere',
    name: 'Cohere',
    category: 'Frontier & General LLM',
    description: 'Enterprise RAG and reasoning with Command R+ and Embed.',
    envKey: 'COHERE_API_KEY',
    defaultBaseUrl: 'https://api.cohere.ai/compatibility/v1',
    website: 'https://cohere.com',
    popularModels: [
      { id: 'command-r-plus-08-2024', name: 'Command R+ 08-2024', providerId: 'cohere', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    category: 'Frontier & General LLM',
    description: 'European frontier models Mistral Large 2, Codestral, and Pixtral.',
    envKey: 'MISTRAL_API_KEY',
    defaultBaseUrl: 'https://api.mistral.ai/openai/v1',
    website: 'https://mistral.ai',
    popularModels: [
      { id: 'mistral-large-latest', name: 'Mistral Large 2', providerId: 'mistral', capabilities: ['text', 'code', 'reasoning'], contextWindow: 128000, isDefault: true },
      { id: 'codestral-latest', name: 'Codestral 2501', providerId: 'mistral', capabilities: ['code'], contextWindow: 256000 },
    ],
  },

  meta: {
    id: 'meta',
    name: 'Meta AI',
    category: 'Frontier & General LLM',
    description: 'Open source foundation intelligence with Llama 3.3 and Llama Vision.',
    envKey: 'META_API_KEY',
    defaultBaseUrl: 'https://api.llama-api.com',
    website: 'https://llama.meta.com',
    popularModels: [
      { id: 'llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', providerId: 'meta', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  xai: {
    id: 'xai',
    name: 'xAI',
    category: 'Frontier & General LLM',
    description: 'Grok-2 and Grok-3 real-time knowledge intelligence.',
    envKey: 'XAI_API_KEY',
    defaultBaseUrl: 'https://api.x.ai/v1',
    website: 'https://x.ai',
    popularModels: [
      { id: 'grok-2-latest', name: 'Grok-2', providerId: 'xai', capabilities: ['text', 'code', 'vision'], contextWindow: 131072, isDefault: true },
    ],
  },

  perplexity: {
    id: 'perplexity',
    name: 'Perplexity AI',
    category: 'Frontier & General LLM',
    description: 'Live web-grounded search and deep research with Sonar Reasoning.',
    envKey: 'PERPLEXITY_API_KEY',
    defaultBaseUrl: 'https://api.perplexity.ai',
    website: 'https://perplexity.ai',
    popularModels: [
      { id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro', providerId: 'perplexity', capabilities: ['text', 'reasoning'], contextWindow: 128000, supportsThinking: true, isDefault: true },
      { id: 'sonar-pro', name: 'Sonar Pro', providerId: 'perplexity', capabilities: ['text'], contextWindow: 200000 },
    ],
  },

  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'Frontier & General LLM',
    description: 'DeepSeek Flash and Pro models for chat, coding, and reasoning.',
    envKey: 'DEEPSEEK_API_KEY',
    defaultBaseUrl: 'https://api.deepseek.com',
    website: 'https://deepseek.com',
    popularModels: [
      { id: 'deepseek-flash', name: 'DeepSeek Flash', providerId: 'deepseek', capabilities: ['text', 'code', 'reasoning', 'vision'], contextWindow: 1_000_000, supportsThinking: true, isDefault: true },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', providerId: 'deepseek', capabilities: ['text', 'code', 'reasoning'], contextWindow: 1_000_000, supportsThinking: true },
    ],
  },

  ai21: {
    id: 'ai21',
    name: 'AI21 Labs',
    category: 'Frontier & General LLM',
    description: 'Mamba-Transformer SSM hybrid architecture with Jamba 1.5.',
    envKey: 'AI21_API_KEY',
    defaultBaseUrl: 'https://api.ai21.com/studio/v1',
    website: 'https://ai21.com',
    popularModels: [
      { id: 'jamba-1.5-large', name: 'Jamba 1.5 Large', providerId: 'ai21', capabilities: ['text', 'code'], contextWindow: 256000, isDefault: true },
    ],
  },

  'aleph-alpha': {
    id: 'aleph-alpha',
    name: 'Aleph Alpha',
    category: 'Frontier & General LLM',
    description: 'European sovereign AI and transparent enterprise intelligence.',
    envKey: 'ALEPH_ALPHA_API_KEY',
    defaultBaseUrl: 'https://api.aleph-alpha.com',
    website: 'https://aleph-alpha.com',
    popularModels: [
      { id: 'luminous-supreme', name: 'Luminous Supreme', providerId: 'aleph-alpha', capabilities: ['text'], contextWindow: 32000, isDefault: true },
    ],
  },

  writer: {
    id: 'writer',
    name: 'Writer',
    category: 'Frontier & General LLM',
    description: 'Enterprise full-stack generative AI with Palmyra models.',
    envKey: 'WRITER_API_KEY',
    defaultBaseUrl: 'https://api.writer.com/v1',
    website: 'https://writer.com',
    popularModels: [
      { id: 'palmyra-x-004', name: 'Palmyra X 004', providerId: 'writer', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  reka: {
    id: 'reka',
    name: 'Reka AI',
    category: 'Frontier & General LLM',
    description: 'Native multimodal frontier models processing text, image, audio, video.',
    envKey: 'REKA_API_KEY',
    defaultBaseUrl: 'https://api.reka.ai/v1',
    website: 'https://reka.ai',
    popularModels: [
      { id: 'reka-core-20240501', name: 'Reka Core', providerId: 'reka', capabilities: ['text', 'vision', 'audio', 'video'], contextWindow: 128000, isDefault: true },
    ],
  },

  inflection: {
    id: 'inflection',
    name: 'Inflection AI',
    category: 'Frontier & General LLM',
    description: 'Conversational and empathetic intelligence (Pi / Inflection 2.5).',
    envKey: 'INFLECTION_API_KEY',
    defaultBaseUrl: 'https://api.inflection.ai/v1',
    website: 'https://inflection.ai',
    popularModels: [
      { id: 'inflection-2.5', name: 'Inflection 2.5', providerId: 'inflection', capabilities: ['text'], contextWindow: 32000, isDefault: true },
    ],
  },

  // ---------------- FAST INFERENCE & CLOUD AGGREGATORS ----------------
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    category: 'Fast Cloud Inference',
    description: 'Hosted NVIDIA Build chat and reasoning models.',
    envKey: 'NVIDIA_API_KEY',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    website: 'https://build.nvidia.com/',
    popularModels: [
      { id: 'nvidia/nemotron-3-super-120b-a12b', name: 'Nemotron 3 Super', providerId: 'nvidia', capabilities: ['text', 'code', 'reasoning', 'function_calling'], contextWindow: 1_000_000, supportsThinking: true, isDefault: true },
      { id: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', name: 'Llama Nemotron Super 49B', providerId: 'nvidia', capabilities: ['text', 'code', 'reasoning', 'function_calling'], contextWindow: 131072, supportsThinking: true },
    ],
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    category: 'Fast Cloud Inference',
    description: 'LPU Inference Engine delivering ultra-fast 500+ tokens/sec.',
    envKey: 'GROQ_API_KEY',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    website: 'https://groq.com',
    popularModels: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', providerId: 'groq', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
      { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill 70B', providerId: 'groq', capabilities: ['text', 'reasoning'], contextWindow: 128000, supportsThinking: true },
    ],
  },

  together: {
    id: 'together',
    name: 'Together AI',
    category: 'Fast Cloud Inference',
    description: 'High-performance open-source model cloud and fine-tuning.',
    envKey: 'TOGETHER_API_KEY',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    website: 'https://together.ai',
    popularModels: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo', providerId: 'together', capabilities: ['text', 'code'], contextWindow: 131072, isDefault: true },
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek-R1 (Together)', providerId: 'together', capabilities: ['text', 'reasoning'], contextWindow: 128000, supportsThinking: true },
    ],
  },

  fireworks: {
    id: 'fireworks',
    name: 'Fireworks AI',
    category: 'Fast Cloud Inference',
    description: 'Ultra-fast compound AI system and production serving platform.',
    envKey: 'FIREWORKS_API_KEY',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    website: 'https://fireworks.ai',
    popularModels: [
      { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Llama 3.3 70B Instruct', providerId: 'fireworks', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
      { id: 'accounts/fireworks/models/deepseek-r1', name: 'DeepSeek-R1', providerId: 'fireworks', capabilities: ['text', 'reasoning'], contextWindow: 128000, supportsThinking: true },
    ],
  },

  anyscale: {
    id: 'anyscale',
    name: 'Anyscale',
    category: 'Fast Cloud Inference',
    description: 'Ray-powered distributed AI workloads and scalable endpoints.',
    envKey: 'ANYSCALE_API_KEY',
    defaultBaseUrl: 'https://api.endpoints.anyscale.com/v1',
    website: 'https://anyscale.com',
    popularModels: [
      { id: 'meta-llama/Meta-Llama-3-70B-Instruct', name: 'Llama 3 70B', providerId: 'anyscale', capabilities: ['text', 'code'], contextWindow: 8192, isDefault: true },
    ],
  },

  deepinfra: {
    id: 'deepinfra',
    name: 'DeepInfra',
    category: 'Fast Cloud Inference',
    description: 'Pay-per-token serverless inference for cutting-edge open source models.',
    envKey: 'DEEPINFRA_API_KEY',
    defaultBaseUrl: 'https://api.deepinfra.com/v1/openai',
    website: 'https://deepinfra.com',
    popularModels: [
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek-R1', providerId: 'deepinfra', capabilities: ['text', 'reasoning'], contextWindow: 128000, supportsThinking: true, isDefault: true },
      { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', providerId: 'deepinfra', capabilities: ['text', 'code'], contextWindow: 128000 },
    ],
  },

  lepton: {
    id: 'lepton',
    name: 'Lepton AI',
    category: 'Fast Cloud Inference',
    description: 'Developer-first serverless cloud for LLMs and custom AI runtimes.',
    envKey: 'LEPTON_API_KEY',
    defaultBaseUrl: 'https://api.lepton.ai/v1',
    website: 'https://lepton.ai',
    popularModels: [
      { id: 'llama3-3-70b', name: 'Llama 3.3 70B', providerId: 'lepton', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  siliconflow: {
    id: 'siliconflow',
    name: 'SiliconFlow',
    category: 'Fast Cloud Inference',
    description: 'Ultra-low latency inference cloud serving DeepSeek, Qwen, and FLUX.',
    envKey: 'SILICONFLOW_API_KEY',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    website: 'https://siliconflow.cn',
    popularModels: [
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek-R1 (SiliconFlow)', providerId: 'siliconflow', capabilities: ['text', 'reasoning'], contextWindow: 64000, supportsThinking: true, isDefault: true },
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek-V3', providerId: 'siliconflow', capabilities: ['text', 'code'], contextWindow: 64000 },
    ],
  },

  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'Fast Cloud Inference',
    description: 'Unified router gateway to 300+ models with automatic fallback and best pricing.',
    envKey: 'OPENROUTER_API_KEY',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    website: 'https://openrouter.ai',
    popularModels: [
      { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet (OpenRouter)', providerId: 'openrouter', capabilities: ['text', 'code', 'reasoning'], contextWindow: 200000, supportsThinking: true, isDefault: true },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek-R1 (OpenRouter)', providerId: 'openrouter', capabilities: ['text', 'reasoning'], contextWindow: 128000, supportsThinking: true },
      { id: 'openai/gpt-4o', name: 'GPT-4o (OpenRouter)', providerId: 'openrouter', capabilities: ['text', 'code'], contextWindow: 128000 },
      { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free)', providerId: 'openrouter', capabilities: ['text', 'code'], contextWindow: 1000000 },
    ],
  },

  litellm: {
    id: 'litellm',
    name: 'LiteLLM',
    category: 'Fast Cloud Inference',
    description: 'Proxy & gateway to call 100+ LLMs using OpenAI standard format.',
    envKey: 'LITELLM_API_KEY',
    defaultBaseUrl: 'http://localhost:4000',
    website: 'https://litellm.ai',
    popularModels: [
      { id: 'gpt-4o', name: 'LiteLLM Proxy GPT-4o', providerId: 'litellm', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  portkey: {
    id: 'portkey',
    name: 'Portkey',
    category: 'Fast Cloud Inference',
    description: 'Production AI gateway, load balancer, guardrails, and caching.',
    envKey: 'PORTKEY_API_KEY',
    defaultBaseUrl: 'https://api.portkey.ai/v1',
    website: 'https://portkey.ai',
    popularModels: [
      { id: '@portkey/default', name: 'Portkey Virtual Gateway', providerId: 'portkey', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  martian: {
    id: 'martian',
    name: 'Martian',
    category: 'Fast Cloud Inference',
    description: 'Dynamic model router directing queries to the best LLM per prompt.',
    envKey: 'MARTIAN_API_KEY',
    defaultBaseUrl: 'https://api.withmartian.com/v1',
    website: 'https://withmartian.com',
    popularModels: [
      { id: 'router/general', name: 'Martian Model Router', providerId: 'martian', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  unify: {
    id: 'unify',
    name: 'Unify',
    category: 'Fast Cloud Inference',
    description: 'Smart LLM routing based on real-time cost, latency, and quality benchmarks.',
    envKey: 'UNIFY_API_KEY',
    defaultBaseUrl: 'https://api.unify.ai/v0',
    website: 'https://unify.ai',
    popularModels: [
      { id: 'llama-3.3-70b-chat@fireworks-ai', name: 'Llama 3.3 70B via Unify', providerId: 'unify', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  octoai: {
    id: 'octoai',
    name: 'OctoAI',
    category: 'Fast Cloud Inference',
    description: 'Accelerated compute platform for generative text, images, and embeddings.',
    envKey: 'OCTOAI_API_KEY',
    defaultBaseUrl: 'https://text.octoai.run/v1',
    website: 'https://octoai.cloud',
    popularModels: [
      { id: 'meta-llama-3-70b-instruct', name: 'Octo Llama 3 70B', providerId: 'octoai', capabilities: ['text'], contextWindow: 8192, isDefault: true },
    ],
  },

  baseten: {
    id: 'baseten',
    name: 'Baseten',
    category: 'Fast Cloud Inference',
    description: 'Machine learning infrastructure to deploy custom models at scale with Truss.',
    envKey: 'BASETEN_API_KEY',
    defaultBaseUrl: '',
    website: 'https://baseten.co',
    popularModels: [
      { id: 'custom-model', name: 'Baseten Model Endpoint', providerId: 'baseten', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  modal: {
    id: 'modal',
    name: 'Modal',
    category: 'Fast Cloud Inference',
    description: 'Serverless GPU cloud running Python containers with instant cold starts.',
    envKey: 'MODAL_TOKEN_ID',
    defaultBaseUrl: 'https://api.modal.com',
    website: 'https://modal.com',
    popularModels: [
      { id: 'modal-endpoint', name: 'Modal GPU App', providerId: 'modal', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  runpod: {
    id: 'runpod',
    name: 'RunPod',
    category: 'Fast Cloud Inference',
    description: 'Globally distributed cloud GPUs, serverless endpoints, and vLLM pods.',
    envKey: 'RUNPOD_API_KEY',
    defaultBaseUrl: '',
    website: 'https://runpod.io',
    popularModels: [
      { id: 'runpod-vllm', name: 'RunPod vLLM Endpoint', providerId: 'runpod', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  banana: {
    id: 'banana',
    name: 'Banana',
    category: 'Fast Cloud Inference',
    description: 'Serverless GPU inference specialized for custom machine learning models.',
    envKey: 'BANANA_API_KEY',
    defaultBaseUrl: 'https://api.banana.dev',
    website: 'https://banana.dev',
    popularModels: [
      { id: 'banana-model', name: 'Banana Serverless', providerId: 'banana', capabilities: ['text'], contextWindow: 32000, isDefault: true },
    ],
  },

  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    category: 'Fast Cloud Inference',
    description: 'Open source community hub with Inference API and dedicated Endpoints.',
    envKey: 'HF_TOKEN',
    defaultBaseUrl: 'https://router.huggingface.co/v1',
    website: 'https://huggingface.co',
    popularModels: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'HF Llama 3.3 70B', providerId: 'huggingface', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  replicate: {
    id: 'replicate',
    name: 'Replicate',
    category: 'Fast Cloud Inference',
    description: 'Run open-source machine learning models with a simple cloud API.',
    envKey: 'REPLICATE_API_TOKEN',
    defaultBaseUrl: 'https://api.replicate.com/v1',
    website: 'https://replicate.com',
    popularModels: [
      { id: 'meta/meta-llama-3-70b-instruct', name: 'Replicate Llama 3 70B', providerId: 'replicate', capabilities: ['text', 'code'], contextWindow: 8192, isDefault: true },
    ],
  },

  fal: {
    id: 'fal',
    name: 'Fal.ai',
    category: 'Fast Cloud Inference',
    description: 'Generative media platform delivering ultra-fast FLUX image & video inference.',
    envKey: 'FAL_KEY',
    defaultBaseUrl: 'https://queue.fal.run',
    website: 'https://fal.ai',
    popularModels: [
      { id: 'fal-ai/flux/dev', name: 'FLUX.1 Dev', providerId: 'fal', capabilities: ['image'], contextWindow: 0, isDefault: true },
    ],
  },

  // ---------------- CHINESE FRONTIER LLMS ----------------
  '01-ai': {
    id: '01-ai',
    name: '01.AI',
    category: 'Chinese Frontier LLM',
    description: "Dr. Kai-Fu Lee's AI lab developing the Yi and Yi-Lightning series.",
    envKey: 'YI_API_KEY',
    defaultBaseUrl: 'https://api.01.ai/v1',
    website: 'https://01.ai',
    popularModels: [
      { id: 'yi-lightning', name: 'Yi-Lightning', providerId: '01-ai', capabilities: ['text', 'code'], contextWindow: 16384, isDefault: true },
    ],
  },

  baichuan: {
    id: 'baichuan',
    name: 'Baichuan',
    category: 'Chinese Frontier LLM',
    description: 'Enterprise reasoning and Chinese medical/domain intelligence.',
    envKey: 'BAICHUAN_API_KEY',
    defaultBaseUrl: 'https://api.baichuan-ai.com/v1',
    website: 'https://baichuan-ai.com',
    popularModels: [
      { id: 'Baichuan4', name: 'Baichuan 4', providerId: 'baichuan', capabilities: ['text', 'code'], contextWindow: 32768, isDefault: true },
    ],
  },

  zhipu: {
    id: 'zhipu',
    name: 'Zhipu AI (GLM)',
    category: 'Chinese Frontier LLM',
    description: 'Tsinghua Knowledge Engineering Group spinoff with GLM-4-Plus.',
    envKey: 'ZHIPU_API_KEY',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    website: 'https://zhipuai.cn',
    popularModels: [
      { id: 'glm-4-plus', name: 'GLM-4 Plus', providerId: 'zhipu', capabilities: ['text', 'code', 'reasoning'], contextWindow: 128000, isDefault: true },
    ],
  },

  moonshot: {
    id: 'moonshot',
    name: 'Moonshot AI (Kimi)',
    category: 'Chinese Frontier LLM',
    description: 'Kimi pioneer in long-context 2-million token processing.',
    envKey: 'MOONSHOT_API_KEY',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    website: 'https://moonshot.cn',
    popularModels: [
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 128k', providerId: 'moonshot', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  qwen: {
    id: 'qwen',
    name: 'Alibaba Cloud Qwen (DashScope)',
    category: 'Chinese Frontier LLM',
    description: 'Alibaba Qwen 2.5 flagship models with industry-leading coding benchmarks.',
    envKey: 'DASHSCOPE_API_KEY',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    website: 'https://dashscope.aliyun.com',
    popularModels: [
      { id: 'qwen-max', name: 'Qwen Max', providerId: 'qwen', capabilities: ['text', 'code', 'reasoning'], contextWindow: 32000, isDefault: true },
      { id: 'qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B', providerId: 'qwen', capabilities: ['code'], contextWindow: 128000 },
    ],
  },

  'baidu-ernie': {
    id: 'baidu-ernie',
    name: 'Baidu Ernie',
    category: 'Chinese Frontier LLM',
    description: "Baidu's foundation model Ernie Bot 4.0 with deep enterprise knowledge.",
    envKey: 'ERNIE_API_KEY',
    defaultBaseUrl: 'https://qianfan.baidubce.com/v2',
    website: 'https://wenxin.baidu.com',
    popularModels: [
      { id: 'ernie-4.0-turbo-8k', name: 'Ernie 4.0 Turbo', providerId: 'baidu-ernie', capabilities: ['text', 'code'], contextWindow: 8192, isDefault: true },
    ],
  },

  'tencent-hunyuan': {
    id: 'tencent-hunyuan',
    name: 'Tencent Hunyuan',
    category: 'Chinese Frontier LLM',
    description: 'Tencent MoE foundation model with advanced Chinese nuance.',
    envKey: 'HUNYUAN_API_KEY',
    defaultBaseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    website: 'https://hunyuan.tencent.com',
    popularModels: [
      { id: 'hunyuan-pro', name: 'Hunyuan Pro', providerId: 'tencent-hunyuan', capabilities: ['text', 'code'], contextWindow: 32000, isDefault: true },
    ],
  },

  'bytedance-doubao': {
    id: 'bytedance-doubao',
    name: 'ByteDance Doubao',
    category: 'Chinese Frontier LLM',
    description: 'ByteDance Volcengine high-concurrency model powering TikTok ecosystem.',
    envKey: 'ARK_API_KEY',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    website: 'https://www.volcengine.com',
    popularModels: [
      { id: 'doubao-pro-128k', name: 'Doubao Pro 128k', providerId: 'bytedance-doubao', capabilities: ['text', 'code'], contextWindow: 128000, isDefault: true },
    ],
  },

  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    category: 'Chinese Frontier LLM',
    description: 'AGI startup behind abab6.5s LLM and Hailuo Video generation.',
    envKey: 'MINIMAX_API_KEY',
    defaultBaseUrl: 'https://api.minimax.io/v1',
    website: 'https://minimax.io',
    popularModels: [
      { id: 'abab6.5s-chat', name: 'MiniMax abab 6.5s', providerId: 'minimax', capabilities: ['text', 'code'], contextWindow: 245760, isDefault: true },
    ],
  },

  stepfun: {
    id: 'stepfun',
    name: 'StepFun',
    category: 'Chinese Frontier LLM',
    description: 'Multimodal foundation models Step-1V and trillion-parameter Step-2.',
    envKey: 'STEPFUN_API_KEY',
    defaultBaseUrl: 'https://api.stepfun.com/v1',
    website: 'https://stepfun.com',
    popularModels: [
      { id: 'step-2-16k', name: 'Step-2 16k', providerId: 'stepfun', capabilities: ['text', 'code'], contextWindow: 16384, isDefault: true },
    ],
  },

  // ---------------- CREATIVE, IMAGE & VIDEO ----------------
  stability: {
    id: 'stability',
    name: 'Stability AI',
    category: 'Image Generation',
    description: 'Stable Diffusion 3.5, SDXL, and Stable Video Diffusion.',
    envKey: 'STABILITY_API_KEY',
    defaultBaseUrl: 'https://api.stability.ai/v2beta',
    website: 'https://stability.ai',
    popularModels: [{ id: 'sd3.5-large', name: 'Stable Diffusion 3.5 Large', providerId: 'stability', capabilities: ['image'], contextWindow: 0, isDefault: true }],
  },

  midjourney: {
    id: 'midjourney',
    name: 'Midjourney',
    category: 'Image Generation',
    description: 'Gold standard artistic realism and photorealistic image generation.',
    envKey: 'MIDJOURNEY_API_KEY',
    defaultBaseUrl: 'https://api.midjourney.com/v1',
    website: 'https://midjourney.com',
    popularModels: [{ id: 'mj-v6.1', name: 'Midjourney v6.1', providerId: 'midjourney', capabilities: ['image'], contextWindow: 0, isDefault: true }],
  },

  bfl: {
    id: 'bfl',
    name: 'Black Forest Labs',
    category: 'Image Generation',
    description: 'Creators of FLUX.1 [dev], FLUX.1 [schnell], and FLUX.1 [pro].',
    envKey: 'BFL_API_KEY',
    defaultBaseUrl: 'https://api.bfl.ml/v1',
    website: 'https://blackforestlabs.ai',
    popularModels: [{ id: 'flux-pro-1.1', name: 'FLUX 1.1 Pro', providerId: 'bfl', capabilities: ['image'], contextWindow: 0, isDefault: true }],
  },

  ideogram: {
    id: 'ideogram',
    name: 'Ideogram',
    category: 'Image Generation',
    description: 'Supreme typography and text rendering inside generated images.',
    envKey: 'IDEOGRAM_API_KEY',
    defaultBaseUrl: 'https://api.ideogram.ai/v1',
    website: 'https://ideogram.ai',
    popularModels: [{ id: 'ideogram-v2', name: 'Ideogram v2', providerId: 'ideogram', capabilities: ['image'], contextWindow: 0, isDefault: true }],
  },

  recraft: {
    id: 'recraft',
    name: 'Recraft',
    category: 'Image Generation',
    description: 'Design-centric AI generating vector graphics (SVG) and 3D assets.',
    envKey: 'RECRAFT_API_KEY',
    defaultBaseUrl: 'https://external.api.recraft.ai/v1',
    website: 'https://recraft.ai',
    popularModels: [{ id: 'recraft-v3', name: 'Recraft v3', providerId: 'recraft', capabilities: ['image'], contextWindow: 0, isDefault: true }],
  },

  leonardo: {
    id: 'leonardo',
    name: 'Leonardo.ai',
    category: 'Image Generation',
    description: 'Canva-owned production art platform with Phoenix engine.',
    envKey: 'LEONARDO_API_KEY',
    defaultBaseUrl: 'https://cloud.leonardo.ai/api/rest/v1',
    website: 'https://leonardo.ai',
    popularModels: [{ id: 'phoenix-v1', name: 'Leonardo Phoenix', providerId: 'leonardo', capabilities: ['image'], contextWindow: 0, isDefault: true }],
  },

  runway: {
    id: 'runway',
    name: 'Runway',
    category: 'Video Generation',
    description: 'Cinematic generative video with Gen-3 Alpha and camera motion controls.',
    envKey: 'RUNWAY_API_KEY',
    defaultBaseUrl: 'https://api.runwayml.com/v1',
    website: 'https://runwayml.com',
    popularModels: [{ id: 'gen3a_turbo', name: 'Gen-3 Alpha Turbo', providerId: 'runway', capabilities: ['video'], contextWindow: 0, isDefault: true }],
  },

  pika: {
    id: 'pika',
    name: 'Pika',
    category: 'Video Generation',
    description: 'Pika 2.0 with special effects, scene swaps, and physics control.',
    envKey: 'PIKA_API_KEY',
    defaultBaseUrl: 'https://api.pika.art/v1',
    website: 'https://pika.art',
    popularModels: [{ id: 'pika-2.0', name: 'Pika 2.0', providerId: 'pika', capabilities: ['video'], contextWindow: 0, isDefault: true }],
  },

  luma: {
    id: 'luma',
    name: 'Luma AI',
    category: 'Video Generation',
    description: 'Dream Machine high-fidelity camera motion and 3D scenes.',
    envKey: 'LUMA_API_KEY',
    defaultBaseUrl: 'https://api.lumalabs.ai/dream-machine/v1',
    website: 'https://lumalabs.ai',
    popularModels: [{ id: 'dream-machine-1.5', name: 'Dream Machine 1.5', providerId: 'luma', capabilities: ['video'], contextWindow: 0, isDefault: true }],
  },

  kling: {
    id: 'kling',
    name: 'Kling AI',
    category: 'Video Generation',
    description: '1080p realistic physics text-to-video generation.',
    envKey: 'KLING_API_KEY',
    defaultBaseUrl: 'https://api.klingai.com/v1',
    website: 'https://klingai.com',
    popularModels: [{ id: 'kling-v1.5-pro', name: 'Kling 1.5 Pro', providerId: 'kling', capabilities: ['video'], contextWindow: 0, isDefault: true }],
  },

  hailuo: {
    id: 'hailuo',
    name: 'Hailuo AI (MiniMax)',
    category: 'Video Generation',
    description: 'MiniMax Video-01 with cinematic lighting and realistic character movement.',
    envKey: 'HAILUO_API_KEY',
    defaultBaseUrl: 'https://api.minimax.chat/v1/video',
    website: 'https://hailuoai.video',
    popularModels: [{ id: 'video-01', name: 'Hailuo Video-01', providerId: 'hailuo', capabilities: ['video'], contextWindow: 0, isDefault: true }],
  },

  sora: {
    id: 'sora',
    name: 'Sora (OpenAI)',
    category: 'Video Generation',
    description: "OpenAI's world simulator text-to-video diffusion model.",
    envKey: 'OPENAI_API_KEY',
    defaultBaseUrl: 'https://api.openai.com/v1/video',
    website: 'https://openai.com/sora',
    popularModels: [{ id: 'sora-1.0', name: 'Sora 1.0', providerId: 'sora', capabilities: ['video'], contextWindow: 0, isDefault: true }],
  },

  heygen: {
    id: 'heygen',
    name: 'HeyGen',
    category: 'Video Generation',
    description: 'AI video avatar generation, voice cloning, and multilingual translation.',
    envKey: 'HEYGEN_API_KEY',
    defaultBaseUrl: 'https://api.heygen.com/v2',
    website: 'https://heygen.com',
    popularModels: [{ id: 'interactive-avatar-v2', name: 'HeyGen Interactive Avatar', providerId: 'heygen', capabilities: ['video'], contextWindow: 0, isDefault: true }],
  },

  synthesia: {
    id: 'synthesia',
    name: 'Synthesia',
    category: 'Video Generation',
    description: 'Enterprise AI video presenter creation without cameras or studios.',
    envKey: 'SYNTHESIA_API_KEY',
    defaultBaseUrl: 'https://api.synthesia.io/v2',
    website: 'https://synthesia.io',
    popularModels: [{ id: 'synthesia-expressive', name: 'Synthesia Expressive', providerId: 'synthesia', capabilities: ['video'], contextWindow: 0, isDefault: true }],
  },

  'd-id': {
    id: 'd-id',
    name: 'D-ID',
    category: 'Video Generation',
    description: 'Digital Humans and speaking photo animation with real-time streaming.',
    envKey: 'DID_API_KEY',
    defaultBaseUrl: 'https://api.d-id.com',
    website: 'https://d-id.com',
    popularModels: [{ id: 'talks', name: 'D-ID Realtime Talk', providerId: 'd-id', capabilities: ['video'], contextWindow: 0, isDefault: true }],
  },

  // ---------------- AUDIO, VOICE & MUSIC ----------------
  elevenlabs: {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    category: 'Voice, Audio & Music',
    description: 'Industry leader in hyper-realistic text-to-speech and voice cloning.',
    envKey: 'ELEVENLABS_API_KEY',
    defaultBaseUrl: 'https://api.elevenlabs.io/v1',
    website: 'https://elevenlabs.io',
    popularModels: [{ id: 'eleven_multilingual_v2', name: 'Multilingual v2', providerId: 'elevenlabs', capabilities: ['audio'], contextWindow: 0, isDefault: true }],
  },

  playht: {
    id: 'playht',
    name: 'PlayHT',
    category: 'Voice, Audio & Music',
    description: 'Conversational audio streaming with PlayDialog and Play3.0-mini.',
    envKey: 'PLAYHT_API_KEY',
    defaultBaseUrl: 'https://api.play.ht/api/v2',
    website: 'https://play.ht',
    popularModels: [{ id: 'Play3.0-mini', name: 'Play 3.0 Mini', providerId: 'playht', capabilities: ['audio'], contextWindow: 0, isDefault: true }],
  },

  deepgram: {
    id: 'deepgram',
    name: 'Deepgram',
    category: 'Voice, Audio & Music',
    description: 'Ultra-fast speech-to-text with Nova-2 and real-time audio intelligence.',
    envKey: 'DEEPGRAM_API_KEY',
    defaultBaseUrl: 'https://api.deepgram.com/v1',
    website: 'https://deepgram.com',
    popularModels: [{ id: 'nova-2', name: 'Nova-2 Speech-to-Text', providerId: 'deepgram', capabilities: ['audio'], contextWindow: 0, isDefault: true }],
  },

  assemblyai: {
    id: 'assemblyai',
    name: 'AssemblyAI',
    category: 'Voice, Audio & Music',
    description: 'Speech-to-text with Speech Understanding, LeMUR, and auto-summarization.',
    envKey: 'ASSEMBLYAI_API_KEY',
    defaultBaseUrl: 'https://api.assemblyai.com/v2',
    website: 'https://assemblyai.com',
    popularModels: [{ id: 'conformer-2', name: 'Conformer-2', providerId: 'assemblyai', capabilities: ['audio'], contextWindow: 0, isDefault: true }],
  },

  'rev-ai': {
    id: 'rev-ai',
    name: 'Rev AI',
    category: 'Voice, Audio & Music',
    description: 'Enterprise speech-to-text, human-in-the-loop transcriptions, and diarization.',
    envKey: 'REVAI_API_KEY',
    defaultBaseUrl: 'https://api.rev.ai/speechtotext/v1',
    website: 'https://rev.ai',
    popularModels: [{ id: 'rev-asr', name: 'Rev ASR v2', providerId: 'rev-ai', capabilities: ['audio'], contextWindow: 0, isDefault: true }],
  },

  whisper: {
    id: 'whisper',
    name: 'Whisper',
    category: 'Voice, Audio & Music',
    description: 'OpenAI robust multi-language speech transcription and translation.',
    envKey: 'OPENAI_API_KEY',
    defaultBaseUrl: 'https://api.openai.com/v1/audio',
    website: 'https://openai.com/research/whisper',
    popularModels: [{ id: 'whisper-1', name: 'Whisper Large v3', providerId: 'whisper', capabilities: ['audio'], contextWindow: 0, isDefault: true }],
  },

  suno: {
    id: 'suno',
    name: 'Suno',
    category: 'Voice, Audio & Music',
    description: 'Full-song generative music with vocals, instrumentation, and lyrics.',
    envKey: 'SUNO_API_KEY',
    defaultBaseUrl: 'https://api.suno.ai/v1',
    website: 'https://suno.com',
    popularModels: [{ id: 'chirp-v3.5', name: 'Suno v3.5', providerId: 'suno', capabilities: ['audio'], contextWindow: 0, isDefault: true }],
  },

  udio: {
    id: 'udio',
    name: 'Udio',
    category: 'Voice, Audio & Music',
    description: 'High-fidelity music generation with granular musical control.',
    envKey: 'UDIO_API_KEY',
    defaultBaseUrl: 'https://api.udio.com/v1',
    website: 'https://udio.com',
    popularModels: [{ id: 'udio-130', name: 'Udio 130', providerId: 'udio', capabilities: ['audio'], contextWindow: 0, isDefault: true }],
  },

  // ---------------- VECTOR DATABASES & EMBEDDINGS ----------------
  pinecone: {
    id: 'pinecone',
    name: 'Pinecone',
    category: 'Vector DB & Embeddings',
    description: 'Managed serverless vector database for production AI search and RAG.',
    envKey: 'PINECONE_API_KEY',
    defaultBaseUrl: 'https://api.pinecone.io',
    website: 'https://pinecone.io',
    popularModels: [{ id: 'pinecone-serverless', name: 'Pinecone Serverless Index', providerId: 'pinecone', capabilities: ['embedding'], contextWindow: 0, isDefault: true }],
  },

  weaviate: {
    id: 'weaviate',
    name: 'Weaviate',
    category: 'Vector DB & Embeddings',
    description: 'Open-source AI-native vector database with hybrid keyword & semantic search.',
    envKey: 'WEAVIATE_API_KEY',
    defaultBaseUrl: 'https://your-cluster.weaviate.network',
    website: 'https://weaviate.io',
    popularModels: [{ id: 'weaviate-cloud', name: 'Weaviate Cloud', providerId: 'weaviate', capabilities: ['embedding'], contextWindow: 0, isDefault: true }],
  },

  qdrant: {
    id: 'qdrant',
    name: 'Qdrant',
    category: 'Vector DB & Embeddings',
    description: 'Rust-based high-performance vector search engine with payload filtering.',
    envKey: 'QDRANT_API_KEY',
    defaultBaseUrl: 'http://localhost:6333',
    website: 'https://qdrant.tech',
    popularModels: [{ id: 'qdrant-collection', name: 'Qdrant Vector Collection', providerId: 'qdrant', capabilities: ['embedding'], contextWindow: 0, isDefault: true }],
  },

  milvus: {
    id: 'milvus',
    name: 'Milvus',
    category: 'Vector DB & Embeddings',
    description: 'Cloud-native vector database engineered for billion-scale similarity search.',
    envKey: 'MILVUS_API_KEY',
    defaultBaseUrl: 'http://localhost:19530',
    website: 'https://milvus.io',
    popularModels: [{ id: 'milvus-index', name: 'Milvus HNSW Index', providerId: 'milvus', capabilities: ['embedding'], contextWindow: 0, isDefault: true }],
  },

  chroma: {
    id: 'chroma',
    name: 'Chroma',
    category: 'Vector DB & Embeddings',
    description: 'Lightweight open-source embedding database for local AI applications.',
    envKey: 'CHROMA_API_KEY',
    defaultBaseUrl: 'http://localhost:8000',
    website: 'https://trychroma.com',
    isLocal: true,
    requiresKey: false,
    popularModels: [{ id: 'chroma-default', name: 'Chroma Local Collection', providerId: 'chroma', capabilities: ['embedding'], contextWindow: 0, isDefault: true }],
  },

  zilliz: {
    id: 'zilliz',
    name: 'Zilliz',
    category: 'Vector DB & Embeddings',
    description: 'Fully managed Milvus on AWS, GCP, and Azure with deep optimizations.',
    envKey: 'ZILLIZ_API_KEY',
    defaultBaseUrl: 'https://controller.cloud.zilliz.com',
    website: 'https://zilliz.com',
    popularModels: [{ id: 'zilliz-cloud', name: 'Zilliz Cloud Managed', providerId: 'zilliz', capabilities: ['embedding'], contextWindow: 0, isDefault: true }],
  },

  voyage: {
    id: 'voyage',
    name: 'Voyage AI',
    category: 'Vector DB & Embeddings',
    description: 'State-of-the-art embedding and reranking models created by Stanford researchers.',
    envKey: 'VOYAGE_API_KEY',
    defaultBaseUrl: 'https://api.voyageai.com/v1',
    website: 'https://voyageai.com',
    popularModels: [{ id: 'voyage-3', name: 'Voyage 3 Embedding', providerId: 'voyage', capabilities: ['embedding'], contextWindow: 32000, isDefault: true }],
  },

  jina: {
    id: 'jina',
    name: 'Jina AI',
    category: 'Vector DB & Embeddings',
    description: '8k context multilingual embeddings, Reader API, and search foundation models.',
    envKey: 'JINA_API_KEY',
    defaultBaseUrl: 'https://api.jina.ai/v1',
    website: 'https://jina.ai',
    popularModels: [{ id: 'jina-embeddings-v3', name: 'Jina Embeddings v3', providerId: 'jina', capabilities: ['embedding'], contextWindow: 8192, isDefault: true }],
  },

  nomic: {
    id: 'nomic',
    name: 'Nomic',
    category: 'Vector DB & Embeddings',
    description: 'Fully auditable open-weights embedding models with Atlas visual explorer.',
    envKey: 'NOMIC_API_KEY',
    defaultBaseUrl: 'https://api-inference.nomic.ai/v1',
    website: 'https://nomic.ai',
    popularModels: [{ id: 'nomic-embed-text-v1.5', name: 'Nomic Embed Text v1.5', providerId: 'nomic', capabilities: ['embedding'], contextWindow: 8192, isDefault: true }],
  },

  // ---------------- VISION & ENTERPRISE AI ----------------
  clarifai: {
    id: 'clarifai',
    name: 'Clarifai',
    category: 'Vision & Enterprise AI',
    description: 'Full-lifecycle AI platform for computer vision, NLP, and multimodal AI.',
    envKey: 'CLARIFAI_PAT',
    defaultBaseUrl: 'https://api.clarifai.com/v2',
    website: 'https://clarifai.com',
    popularModels: [{ id: 'general-image-recognition', name: 'Clarifai General Vision', providerId: 'clarifai', capabilities: ['vision'], contextWindow: 0, isDefault: true }],
  },

  roboflow: {
    id: 'roboflow',
    name: 'Roboflow',
    category: 'Vision & Enterprise AI',
    description: 'Computer vision development platform for object detection, segmentation, and YOLO.',
    envKey: 'ROBOFLOW_API_KEY',
    defaultBaseUrl: 'https://detect.roboflow.com',
    website: 'https://roboflow.com',
    popularModels: [{ id: 'roboflow-universe-model', name: 'Roboflow Universe Detection', providerId: 'roboflow', capabilities: ['vision'], contextWindow: 0, isDefault: true }],
  },

  'landing-ai': {
    id: 'landing-ai',
    name: 'Landing AI',
    category: 'Vision & Enterprise AI',
    description: "Dr. Andrew Ng's Visual Prompting and industrial computer vision platform.",
    envKey: 'LANDING_API_KEY',
    defaultBaseUrl: 'https://api.landing.ai/v1',
    website: 'https://landing.ai',
    popularModels: [{ id: 'landinglens-visual-prompting', name: 'LandingLens Visual Prompting', providerId: 'landing-ai', capabilities: ['vision'], contextWindow: 0, isDefault: true }],
  },

  scale: {
    id: 'scale',
    name: 'Scale AI',
    category: 'Vision & Enterprise AI',
    description: 'Data foundry, RLHF, and enterprise GenAI application platform.',
    envKey: 'SCALE_API_KEY',
    defaultBaseUrl: 'https://api.scale.com/v1',
    website: 'https://scale.com',
    popularModels: [{ id: 'scale-genai-engine', name: 'Scale GenAI Engine', providerId: 'scale', capabilities: ['text', 'vision'], contextWindow: 0, isDefault: true }],
  },

  snorkel: {
    id: 'snorkel',
    name: 'Snorkel AI',
    category: 'Vision & Enterprise AI',
    description: 'Programmatic data labeling and domain-specific LLM fine-tuning.',
    envKey: 'SNORKEL_API_KEY',
    defaultBaseUrl: 'https://api.snorkel.ai/v1',
    website: 'https://snorkel.ai',
    popularModels: [{ id: 'snorkel-flow-engine', name: 'Snorkel Flow Data Engine', providerId: 'snorkel', capabilities: ['text'], contextWindow: 0, isDefault: true }],
  },

  labelbox: {
    id: 'labelbox',
    name: 'Labelbox',
    category: 'Vision & Enterprise AI',
    description: 'Training data platform for human evaluation, RLHF, and multimodal data labeling.',
    envKey: 'LABELBOX_API_KEY',
    defaultBaseUrl: 'https://api.labelbox.com/v1',
    website: 'https://labelbox.com',
    popularModels: [{ id: 'labelbox-align', name: 'Labelbox Model Evaluation', providerId: 'labelbox', capabilities: ['text', 'vision'], contextWindow: 0, isDefault: true }],
  },
};

export class ProviderCatalog {
  public static get(id: string): ProviderMetadata | undefined {
    const normalized = id.toLowerCase();
    return Object.hasOwn(PROVIDERS_CATALOG, normalized) ? PROVIDERS_CATALOG[normalized] : undefined;
  }

  public static connection(id: string): ProviderConnection {
    return providerConnection(id.toLowerCase());
  }

  public static setupHint(id: string): string | undefined {
    switch (id.toLowerCase()) {
      case 'azure-openai':
        return 'Enter the Azure resource URL and key. Use the deployment name as the model ID.';
      case 'bedrock':
        return 'Use the Bedrock Mantle /v1 or Runtime /openai/v1 base URL and a Bedrock bearer API key.';
      case 'google-cloud-ai':
        return 'Use the Vertex OpenAI-compatible endpoint URL and an OAuth access token.';
      case 'baseten':
        return 'Use a Baseten OpenAI-compatible model or deployment base URL.';
      case 'runpod':
        return 'Use your RunPod vLLM endpoint base URL ending in /openai/v1.';
      case 'custom':
        return 'Enter the OpenAI-compatible base URL. A key is optional for local services.';
      default:
        return undefined;
    }
  }

  public static all(): ProviderMetadata[] {
    return Object.values(PROVIDERS_CATALOG);
  }

  public static count(): number {
    return Object.keys(PROVIDERS_CATALOG).length;
  }

  public static search(query: string): ProviderMetadata[] {
    const q = query.toLowerCase();
    return Object.values(PROVIDERS_CATALOG).filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.popularModels.some((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    );
  }
}
