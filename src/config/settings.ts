/**
 * Global and workspace configuration manager for Ruqenai.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { parse as parseEnv } from 'dotenv';
import { ThinkingEffort, PermissionMode } from '../types/index.js';
import { normalizeEndpoint } from '../providers/protocols.js';
import type { TokenRates } from '../providers/usage.js';

export interface RuqenaiConfig {
  activeProvider: string;
  activeModel: string;
  modelExplicit?: boolean;
  thinkingEnabled: boolean;
  thinkingEffort: ThinkingEffort;
  temperature: number;
  maxTokens?: number;
  ultracodeMode: boolean;
  permissionMode: PermissionMode;
  ollamaHost: string;
  ollamaAutoDetect: boolean;
  theme: string;
  animationsEnabled: boolean;
  autoCompact: boolean;
  compactThreshold: number;
  deleteChatsOnClose?: boolean;
  /** On: chats are filtered per workspace folder. Off (default): every chat shows in every workspace. */
  workspaceChats?: boolean;
  /** ASCII hero scene on an empty chat. Off shows a plain background instead. */
  homeSceneEnabled?: boolean;
  /** Absolute path to a custom new-chat background image. */
  homeBackground?: string | null;
  /** Selected desktop backdrop, or 'rotate' to cycle scenes. */
  homeScene?: string;
  darkDotsColored?: boolean;
  chatBackgroundVisible?: boolean;
  chatBackgroundOpacity?: number;
  homeSuggestionsVisible?: boolean;
  /** User-authored CSS applied to the whole app. */
  customCss?: string;
  customEndpoints: Record<string, string>;
  modelRates: Record<string, TokenRates>;
  disconnectedProviders: string[];
  approvedCommands: string[];
  approvedPaths: string[];
  approvedMcpActions: string[];
}

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.ruqenai');
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, 'config.json');
const KEY_ENV_PATH = path.join(GLOBAL_CONFIG_DIR, '.env');
const WORKSPACE_CONFIG_FILE = 'ruqenai.json';

const DEFAULT_CONFIG: RuqenaiConfig = {
  activeProvider: 'ollama',
  activeModel: 'llama3.2',
  thinkingEnabled: true,
  thinkingEffort: 'High',
  temperature: 0.7,
  ultracodeMode: false,
  permissionMode: 'ask',
  ollamaHost: 'http://127.0.0.1:11434',
  ollamaAutoDetect: true,
  theme: 'dark',
  animationsEnabled: true,
  autoCompact: true,
  compactThreshold: 28,
  deleteChatsOnClose: false,
  workspaceChats: false,
  homeSceneEnabled: true,
  homeBackground: null,
  homeScene: 'rotate',
  customCss: '',
  customEndpoints: {},
  modelRates: {},
  disconnectedProviders: [],
  approvedCommands: ['ls', 'dir', 'git status', 'git diff', 'pwd'],
  approvedPaths: [],
  approvedMcpActions: [],
};

function keyVariable(providerId: string): string {
  return providerId.replace(/-/g, '_').toUpperCase() + '_API_KEY';
}

function writePrivateFile(destination: string, text: string): boolean {
  const temporary = () => path.join(path.dirname(destination), '.ruqenai-' + randomUUID() + '.tmp');
  const atomic = () => {
    const temp = temporary();
    try {
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temp, text, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, destination);
    } finally {
      try { fs.unlinkSync(temp); } catch {}
    }
  };
  try {
    // Windows AV/indexers occasionally lock the target; retry once, then fall back to a direct write.
    try {
      atomic();
    } catch {
      atomic();
    }
    return true;
  } catch {
    try {
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, text, { encoding: 'utf-8', mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }
}

function readKeyEnv(): Record<string, string> {
  try {
    return parseEnv(fs.readFileSync(KEY_ENV_PATH, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function writeKeyEnv(values: Record<string, string>): boolean {
  const lines = [];
  for (const [name, value] of Object.entries(values)) {
    if (!/^[\w.-]+$/.test(name)) return false;
    const line = ["'", '"', '\`', ''].map((quote) => `${name}=${quote}${value}${quote}`)
      .find((candidate) => {
        const parsed = parseEnv(candidate);
        return parsed[name] === value && Object.keys(parsed).length === 1;
      });
    if (line === undefined) return false;
    lines.push(line);
  }
  return writePrivateFile(KEY_ENV_PATH, '# Local Ruqenai credentials\n' + lines.join('\n') + '\n');
}

class ConfigManager {
  private config: RuqenaiConfig;
  private legacyKeys: Record<string, unknown> = {};
  private loadedGlobal: Partial<RuqenaiConfig> = {};

  constructor() {
    this.config = this.loadConfig();
    this.migrateLegacyKeys();
  }

  public get(): RuqenaiConfig {
    return this.config;
  }

  public update(patch: Partial<RuqenaiConfig>, { rememberModel = true } = {}): RuqenaiConfig {
    const modelExplicit = patch.activeModel !== undefined ? rememberModel : this.config.modelExplicit;
    this.config = { ...this.config, ...patch, modelExplicit };
    this.saveGlobal();
    // Keep the workspace ruqenai.json in sync so a stale workspace file can never
    // silently override a setting the user just changed.
    this.saveWorkspace();
    return this.config;
  }

  /** Re-read global + current workspace config after the working directory changes. */
  public reloadWorkspace(): void {
    this.config = this.loadConfig();
  }

  public hasSelectedModel(): boolean {
    return this.config.modelExplicit === true;
  }

  private loadConfig(): RuqenaiConfig {
    if (!fs.existsSync(GLOBAL_CONFIG_DIR)) {
      try {
        fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
      } catch {}
    }

    let loaded: Partial<RuqenaiConfig> = {};

    // 1. Load global file
    if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
      try {
        const raw = fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf-8');
        const { apiKeys, ...settings } = JSON.parse(raw);
        loaded = settings;
        this.loadedGlobal = settings;
        if (apiKeys && typeof apiKeys === 'object' && !Array.isArray(apiKeys)) this.legacyKeys = apiKeys;
      } catch {}
    }

    // 2. Load workspace file from the current working directory (follows /cd and /workspace).
    const wsPath = path.join(process.cwd(), WORKSPACE_CONFIG_FILE);
    if (fs.existsSync(wsPath)) {
      try {
        const raw = fs.readFileSync(wsPath, 'utf-8');
        const { apiKeys, customEndpoints, disconnectedProviders, ollamaHost, permissionMode,
          approvedCommands, approvedPaths, approvedMcpActions, ...workspace } = JSON.parse(raw);
        loaded = { ...loaded, ...workspace };
      } catch {}
    }

    const { showFileTree: _legacyFileTree, ...settings } = loaded as Partial<RuqenaiConfig> & { showFileTree?: boolean };
    const merged: RuqenaiConfig = {
      ...DEFAULT_CONFIG,
      ...settings,
      approvedMcpActions: Array.isArray(loaded.approvedMcpActions) ? loaded.approvedMcpActions : [],
      modelRates: { ...(loaded.modelRates || {}) },
      modelExplicit: loaded.modelExplicit ?? (
        loaded.activeModel !== undefined &&
        (loaded.activeModel !== DEFAULT_CONFIG.activeModel || loaded.activeProvider !== DEFAULT_CONFIG.activeProvider)
      ),
    };

    if (merged.disconnectedProviders.includes(merged.activeProvider)) {
      return { ...merged, activeProvider: 'ollama', activeModel: DEFAULT_CONFIG.activeModel, modelExplicit: false };
    }
    return merged;
  }

  private migrateLegacyKeys(): void {
    if (!Object.keys(this.legacyKeys).length) return;
    try {
      const values = readKeyEnv();
      const remaining: Record<string, unknown> = {};
      for (const [id, value] of Object.entries(this.legacyKeys)) {
        if (typeof value !== 'string' || !/^[a-z0-9_-]+$/i.test(id) || /[\r\n]/.test(value)) {
          remaining[id] = value;
          continue;
        }
        values[keyVariable(id)] ??= value;
      }
      if (!writeKeyEnv(values)) return;
      this.legacyKeys = remaining;
      const stored = Object.keys(remaining).length ? { ...this.loadedGlobal, apiKeys: remaining } : this.loadedGlobal;
      writePrivateFile(GLOBAL_CONFIG_PATH, JSON.stringify(stored, null, 2));
    } catch {
      // The previous JSON remains readable if the dotenv file cannot be opened or written.
    }
  }

  public saveGlobal(config = this.config): boolean {
    const stored = Object.keys(this.legacyKeys).length ? { ...config, apiKeys: this.legacyKeys } : config;
    return writePrivateFile(GLOBAL_CONFIG_PATH, JSON.stringify(stored, null, 2));
  }

  private saveConnection(config: RuqenaiConfig, providerId: string, key: string | null | undefined): boolean {
    if (key === undefined) return this.saveGlobal(config);
    if (Object.hasOwn(this.legacyKeys, providerId)) return false;
    try {
      const previous = readKeyEnv();
      const next = { ...previous };
      const variable = keyVariable(providerId);
      if (key === null) delete next[variable];
      else next[variable] = key;
      if (!writeKeyEnv(next)) return false;
      if (this.saveGlobal(config)) return true;
      writeKeyEnv(previous);
    } catch {}
    return false;
  }

  public saveWorkspace(): boolean {
    try {
      const wsPath = path.join(process.cwd(), WORKSPACE_CONFIG_FILE);
      const { customEndpoints, disconnectedProviders, ollamaHost, permissionMode,
        approvedCommands, approvedPaths, approvedMcpActions, ...workspace } = this.config;
      fs.writeFileSync(wsPath, JSON.stringify(workspace, null, 2), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  public getApiKey(providerId: string, envKey?: string): string | undefined {
    const p = providerId.toLowerCase();
    const envCandidate = keyVariable(p);
    return (envKey ? process.env[envKey] : undefined) || process.env[envCandidate] || this.getSavedApiKey(p);
  }

  public getSavedApiKey(providerId: string): string | undefined {
    const id = providerId.toLowerCase();
    try {
      const key = readKeyEnv()[keyVariable(id)];
      if (key !== undefined) return key || undefined;
    } catch {}
    const legacy = this.legacyKeys[id];
    return typeof legacy === 'string' ? legacy : undefined;
  }

  public setApiKey(providerId: string, key: string): void {
    this.saveProviderConnection(providerId, { apiKey: key });
  }

  public removeApiKey(providerId: string): void {
    const id = providerId.toLowerCase();
    const previous = this.config;
    const next = { ...previous };
    if (id !== 'ollama') {
      next.disconnectedProviders = [...new Set([...previous.disconnectedProviders, id])];
      if (next.activeProvider === id) {
        next.activeProvider = 'ollama';
        next.activeModel = DEFAULT_CONFIG.activeModel;
        next.modelExplicit = false;
      }
    }
    if (!this.saveConnection(next, id, null)) {
      throw new Error('The saved API key could not be removed.');
    }
    this.config = next;
  }

  public getOllamaHost(): string {
    return process.env.OLLAMA_HOST || this.config.ollamaHost;
  }

  public setEndpoint(providerId: string, endpoint: string): void {
    this.saveProviderConnection(providerId, { endpoint });
  }

  public saveProviderConnection(providerId: string, { apiKey, endpoint }: { apiKey?: string; endpoint?: string }): void {
    const id = providerId.toLowerCase();
    const key = apiKey?.trim();
    if (apiKey !== undefined && (!key || /[\r\n]/.test(key))) throw new Error('Enter a single API key.');
    const url = endpoint === undefined ? undefined : endpoint.trim() ? normalizeEndpoint(endpoint.trim()) : '';
    const previous = this.config;
    const next = { ...previous };
    next.disconnectedProviders = previous.disconnectedProviders.filter((provider) => provider !== id);
    if (url !== undefined && id === 'ollama') next.ollamaHost = url || DEFAULT_CONFIG.ollamaHost;
    else if (url !== undefined) {
      if (url !== (previous.customEndpoints[id] ?? '') && this.getSavedApiKey(id) && !key) {
        throw new Error('Enter the API key for the changed endpoint before saving.');
      }
      next.customEndpoints = { ...previous.customEndpoints };
      if (url) next.customEndpoints[id] = url;
      else delete next.customEndpoints[id];
    }
    if (!this.saveConnection(next, id, key)) {
      throw new Error('The provider settings could not be saved.');
    }
    this.config = next;
  }
}

export const configManager = new ConfigManager();
