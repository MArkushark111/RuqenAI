/**
 * Core type definitions for Ruqenai CLI.
 */

export type ProviderCategory =
  | 'Local & Edge'
  | 'Frontier & General LLM'
  | 'Chinese Frontier LLM'
  | 'Fast Cloud Inference'
  | 'Image Generation'
  | 'Video Generation'
  | 'Voice, Audio & Music'
  | 'Vector DB & Embeddings'
  | 'Vision & Enterprise AI';

export type ModelCapability =
  | 'text'
  | 'code'
  | 'reasoning'
  | 'vision'
  | 'audio'
  | 'image'
  | 'video'
  | 'embedding'
  | 'function_calling';

export type ThinkingEffort = 'Low' | 'Medium' | 'High' | 'XHigh';

export type PermissionMode = 'ask' | 'approve' | 'full';

export interface ModelMetadata {
  id: string;
  name: string;
  providerId: string;
  capabilities: ModelCapability[];
  contextWindow: number;
  supportsThinking?: boolean;
  chatSupport?: 'supported' | 'unsupported' | 'unknown';
  isDefault?: boolean;
  description?: string;
}

export interface ProviderUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  estimatedCostUsd?: number;
  unpricedRequests?: number;
}

export interface ProviderMetadata {
  id: string;
  name: string;
  category: ProviderCategory;
  description: string;
  envKey: string;
  defaultBaseUrl: string;
  popularModels: ModelMetadata[];
  website?: string;
  isLocal?: boolean;
  isFree?: boolean;
  requiresKey?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  attachmentNames?: string[];
  images?: Array<{ mediaType: string; data: string }>;
  reasoningContent?: string;
  segments?: readonly TranscriptSegment[];
  note?: string;
  error?: string;
  timestamp: number;
  tokens?: number;
  usage?: ProviderUsage;
  durationMs?: number;
  tasks?: TaskItem[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export type TranscriptSegment =
  | { kind: 'reasoning'; id: string; text: string; durationMs?: number }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; taskId: string };

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  providerData?: unknown;
}

export interface TaskItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'denied';
  kind: 'plan' | 'tool';
  tool?: string;
  detail?: string;
  durationMs?: number;
  changes?: { added: number; removed: number };
  exitCode?: number;
}

export interface StreamChunk {
  text?: string;
  reasoning?: string;
  error?: string;
  toolCalls?: ToolCall[];
  isDone?: boolean;
  usage?: ProviderUsage;
  tokensUsed?: number;
  costEstimate?: number;
}

export interface SubagentProfile {
  name: string;
  role: string;
  icon: string;
  color: string;
  systemPrompt: string;
  capabilities: string[];
  readOnly?: boolean;
}

export interface SkillDefinition {
  name: string;
  description: string;
  version: string;
  author: string;
  instructions: string;
  tags?: string[];
  filePath?: string;
}
