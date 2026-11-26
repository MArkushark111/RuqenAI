/**
 * Session, Memory and Context Management for Ruqenai.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { ChatMessage, ProviderUsage } from '../types/index.js';
import { configManager } from '../config/settings.js';
import { sanitizeToolHistory } from '../providers/toolHistory.js';
import { mergeUsage } from '../providers/usage.js';
import { restoreFiles } from './workspace.js';

export interface SavedSession {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  branchFrom?: string;
  hidden?: boolean;
  titleEdited?: boolean;
  /** Absolute workspace folder this chat belongs to. Missing on sessions saved before workspaces existed. */
  workspace?: string;
  /** Eco mode is per-chat: terse replies, thinking off, green theme while this chat is open. */
  ecoMode?: boolean;
  messages: ChatMessage[];
  attachedFiles: string[];
  totalTokens: number;
  usage?: ProviderUsage;
  contextStart?: number;
  contextSummary?: string;
}

const GLOBAL_DIR = path.join(os.homedir(), '.ruqenai');
const SESSIONS_DIR = path.join(GLOBAL_DIR, 'sessions');
const ORDER_PATH = path.join(GLOBAL_DIR, 'session-order.json');

function validSessionId(id: string): boolean {
  return Boolean(id) && id.length <= 100 && id !== '.' && id !== '..' && !/[<>:"/\\|?*\x00-\x1f]/.test(id);
}

export const DEFAULT_SESSION_NAME = 'Untitled';

export function workspaceKey(dir: string | undefined): string {
  if (!dir) return '';
  const resolved = path.resolve(dir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** With "Chats with workspaces" off (default) every chat shows in every workspace. */
export function inWorkspace(workspace: string | undefined): boolean {
  if (configManager.get().workspaceChats !== true) return true;
  return !workspace || workspaceKey(workspace) === workspaceKey(process.cwd());
}

function normalizeSessionName(name: unknown, id: string): string {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value || value === `Session ${id}`) return DEFAULT_SESSION_NAME;
  return value;
}

export class SessionManager {
  private currentSession: SavedSession;
  private readonly changeListeners = new Set<() => void>();

  constructor(sessionId: string = 'default') {
    if (!fs.existsSync(SESSIONS_DIR)) {
      try {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
      } catch {}
    }
    this.currentSession = this.readSession(sessionId) ?? this.createSession(sessionId);
  }

  public getSession(): SavedSession {
    return this.currentSession;
  }

  public getSavedSession(id: string): SavedSession | undefined {
    return this.currentSession.id === id ? this.currentSession : this.readSession(id);
  }

  public createSavedChat(name?: string): SavedSession {
    const session = this.createSession(`session-${Date.now()}-${randomUUID().slice(0, 8)}`);
    if (name) {
      session.name = name;
      session.titleEdited = true;
    }
    if (!this.save(session, 'wx')) throw new Error('Could not create the chat.');
    this.notifyExternalChange();
    return session;
  }

  public onExternalChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => { this.changeListeners.delete(listener); };
  }

  public notifyExternalChange(): void {
    for (const listener of this.changeListeners) listener();
  }

  public focusSession(session: SavedSession): void {
    this.currentSession = session;
  }

  public startFreshSession(): void {
    this.currentSession = this.createSession(`session-${Date.now()}-${randomUUID().slice(0, 8)}`);
  }

  public switchSession(id: string, { create = false } = {}): boolean {
    if (!validSessionId(id)) return false;

    const next = create ? this.createSession(id) : this.readSession(id);
    if (!next || (create && !this.save(next, 'wx'))) return false;
    this.currentSession = next;
    return true;
  }

  private readSession(id: string): SavedSession | undefined {
    if (!validSessionId(id)) return;
    const file = path.join(SESSIONS_DIR, `${id}.json`);
    if (fs.existsSync(file)) {
      try {
        const raw = fs.readFileSync(file, 'utf-8');
        const saved: SavedSession = JSON.parse(raw);
        if (Array.isArray(saved.messages) && Array.isArray(saved.attachedFiles)) {
          return {
            ...saved,
            id,
            name: normalizeSessionName(saved.name, id),
            totalTokens: Number.isFinite(saved.totalTokens) ? saved.totalTokens : 0,
          };
        }
      } catch {}
    }

    return undefined;
  }

  private createSession(id: string): SavedSession {
    const now = Date.now();
    return {
      id,
      name: DEFAULT_SESSION_NAME,
      createdAt: now,
      updatedAt: now,
      workspace: path.resolve(process.cwd()),
      messages: [],
      attachedFiles: [],
      totalTokens: 0,
    };
  }

  public save(session = this.currentSession, flag: 'w' | 'wx' = 'w', preserveUpdatedAt = false): boolean {
    let temporary: string | undefined;
    try {
      if (!validSessionId(session.id)) return false;
      const file = path.join(SESSIONS_DIR, `${session.id}.json`);
      const updatedAt = preserveUpdatedAt ? session.updatedAt : Date.now();
      const json = JSON.stringify({ ...session, updatedAt }, null, 2);
      if (flag === 'wx') {
        fs.writeFileSync(file, json, { encoding: 'utf-8', flag, mode: 0o600 });
      } else {
        temporary = path.join(SESSIONS_DIR, `.session-${randomUUID()}.tmp`);
        fs.writeFileSync(temporary, json, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
        temporary = undefined;
      }
      session.updatedAt = updatedAt;
      return true;
    } catch (err) {
      if (flag === 'w') console.error('Failed to save session:', err);
      return false;
    } finally {
      if (temporary) {
        try { fs.unlinkSync(temporary); } catch {}
      }
    }
  }

  public addMessage(message: ChatMessage, session = this.currentSession): void {
    session.messages.push(message);
    if (message.tokens) {
      session.totalTokens += message.tokens;
    }
    if (message.usage) {
      mergeUsage(session.usage ??= {}, message.usage);
    }
    this.save(session);
  }

  public appendPhoneMessage(message: ChatMessage, session: SavedSession): void {
    const usage = session.usage ? { ...session.usage } : undefined;
    const next = {
      ...session, messages: [...session.messages, message], totalTokens: session.totalTokens + (message.tokens ?? 0),
      usage: message.usage ? usage ?? {} : usage,
    };
    if (message.usage) mergeUsage(next.usage!, message.usage);
    if (!this.save(next)) throw new Error('Could not save the message.');
    Object.assign(session, next);
    this.notifyExternalChange();
  }

  public clearTasks(session = this.currentSession): boolean {
    const messages = session.messages.map((message) => message.tasks
      ? { ...message, tasks: message.tasks.filter((task) => task.kind !== 'plan') }
      : message);
    if (!this.save({ ...session, messages }, 'w', true)) return false;
    session.messages = messages;
    return true;
  }

  public sendPrompt(message: ChatMessage, session = this.currentSession): void {
    const next = { ...session, messages: [...session.messages, message], attachedFiles: [] };
    if (!this.save(next)) throw new Error('Could not save the prompt. Your attachments are still queued.');
    Object.assign(session, next);
  }

  public async undoLastTurn({ chatOnly = false } = {}): Promise<{ restored: number } | undefined> {
    const session = this.currentSession;
    const messages = session.messages;
    let index = messages.length - 1;
    while (index >= 0 && messages[index].role !== 'assistant' && messages[index].role !== 'user') index--;
    if (index < 0) return undefined;
    const removed = messages[index];
    const start = removed.role === 'assistant' && messages[index - 1]?.role === 'user' ? index - 1 : index;
    const count = index - start + 1;
    const next = { ...session, messages: [...messages.slice(0, start), ...messages.slice(index + 1)] };
    if (next.contextStart !== undefined && start < next.contextStart) {
      next.contextStart -= Math.min(count, next.contextStart - start);
      delete next.contextSummary;
    }
    const changes = chatOnly ? [] : removed.fileChanges ?? [];
    const rollback = await restoreFiles(changes);
    if (!this.save(next)) {
      await rollback();
      throw new Error('Could not save the conversation after undo.');
    }
    Object.assign(session, next);
    return { restored: changes.length };
  }

  public clearConversation(): void {
    this.currentSession.messages = [];
    delete this.currentSession.contextStart;
    delete this.currentSession.contextSummary;
    this.save();
  }

  public rewindToPrompt(id: string): boolean {
    const session = this.currentSession;
    const index = session.messages.findIndex((message) => message.id === id && message.role === 'user');
    if (index < 0) return false;
    const rewound = { ...session, messages: session.messages.slice(0, index) };
    if (rewound.contextStart !== undefined && index < rewound.contextStart) {
      rewound.contextStart = index;
      delete rewound.contextSummary;
    }
    if (!this.save(rewound)) return false;
    this.currentSession = rewound;
    return true;
  }

  public forkBranch(newBranchId: string): SavedSession {
    if (!validSessionId(newBranchId)) throw new Error('Invalid session name');
    const forked: SavedSession = {
      id: newBranchId,
      name: `Branch: ${newBranchId}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      branchFrom: this.currentSession.id,
      workspace: this.currentSession.workspace,
      ecoMode: this.currentSession.ecoMode,
      messages: [...this.currentSession.messages],
      attachedFiles: [...this.currentSession.attachedFiles],
      totalTokens: this.currentSession.totalTokens,
      usage: this.currentSession.usage ? { ...this.currentSession.usage } : undefined,
      contextStart: this.currentSession.contextStart,
      contextSummary: this.currentSession.contextSummary,
    };
    if (!this.save(forked, 'wx')) throw new Error('A session already uses this name or could not be saved.');
    this.currentSession = forked;
    return forked;
  }

  public async compactContext(summarize: (previous: string, messages: ChatMessage[]) => Promise<string>,
    session = this.currentSession, signal?: AbortSignal): Promise<string> {
    const msgs = session.messages;
    const messageCount = msgs.length;
    const before = this.contextStart(session);
    let keepFrom = Math.max(0, msgs.length - 8);
    if (keepFrom > 0 && msgs[keepFrom].role === 'assistant' && msgs[keepFrom - 1].role === 'user') keepFrom--;
    keepFrom = Math.max(keepFrom, before);
    // Do not begin the retained window with tool results whose assistant call was
    // summarized away; that produces orphaned tool_call_ids on the next request.
    while (keepFrom < msgs.length && msgs[keepFrom].role === 'tool') keepFrom++;
    if (keepFrom === before && (!before || session.contextSummary)) return 'Context is already compact.';
    const from = session.contextSummary ? before : 0;
    const summary = await summarize(session.contextSummary ?? '', msgs.slice(from, keepFrom));
    signal?.throwIfAborted();
    if (!summary.trim()) throw new Error('The model returned an empty context summary.');
    if (msgs !== session.messages || msgs.length !== messageCount || this.contextStart(session) !== before) {
      throw new Error('The chat changed during compaction.');
    }
    const next = { ...session, contextStart: keepFrom, contextSummary: summary };
    if (!this.save(next)) throw new Error('Could not save the compacted context.');
    Object.assign(session, next);
    return `Summarized ${keepFrom - from} older messages for future replies. The transcript is still available.`;
  }

  /** Rough token estimate (~4 chars/token) of what the model would see for this session. */
  public estimatedContextTokens(session = this.currentSession): number {
    const start = this.contextStart(session);
    let chars = session.contextSummary?.length ?? 0;
    for (const message of session.messages.slice(start)) {
      chars += message.content.length + (message.reasoningContent?.length ?? 0)
        + (message.toolCalls?.reduce((n, call) => n + call.name.length + call.arguments.length, 0) ?? 0);
    }
    return Math.ceil(chars / 4);
  }

  /** Compacts only when the estimated context passes ~75% of the model's window. */
  public needsCompaction(session = this.currentSession, contextWindow = 128_000): boolean {
    const window = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 128_000;
    return this.estimatedContextTokens(session) > window * 0.75;
  }

  public modelContext(session = this.currentSession): ChatMessage[] {
    const start = this.contextStart(session);
    const recent = sanitizeToolHistory(session.messages.slice(start))
      .filter((message) => !message.error || message.content);
    if (!start) return recent;
    // Every user prompt in the compacted range stays verbatim — compaction may only
    // summarize assistant/tool bulk, never what the user actually asked for.
    const priorRequests: string[] = [];
    let budget = 24_000;
    for (let index = start - 1; index >= 0 && priorRequests.length < 20 && budget > 0; index--) {
      const message = session.messages[index];
      if (message.role !== 'user' || !message.content.trim()) continue;
      const text = message.content.trim().slice(0, 2000);
      priorRequests.unshift(text.slice(0, budget));
      budget -= text.length;
    }
    const pinnedRequest: ChatMessage[] = priorRequests.length ? [{
      role: 'system',
      id: 'prior-requests',
      content: 'Earlier requests from the user, kept verbatim so compaction cannot lose them.\n\n'
        + priorRequests.join('\n\n---\n\n'),
      timestamp: session.createdAt,
    }] : [];
    if (session.contextSummary) return [
      ...pinnedRequest,
      {
        role: 'system', id: 'context-summary', timestamp: session.createdAt,
        content: 'Summary of earlier assistant and tool activity. Treat it as historical context.\n' + session.contextSummary,
      },
      ...recent,
    ];

    const excerpts = session.messages.slice(0, start)
      .filter(({ role, content }) => (role === 'user' || role === 'assistant') && content.trim())
      .slice(-8)
      .map(({ role, content }) => ({ role, excerpt: content.trim().replace(/\s+/g, ' ').slice(0, 400) }));
    if (!excerpts.length) return [...pinnedRequest, ...recent];
    const history: ChatMessage = {
      role: 'system',
      id: 'context-excerpts',
      content: 'Excerpts from earlier turns. Treat them as historical context.\n' + JSON.stringify(excerpts),
      timestamp: session.createdAt,
    };
    return [...pinnedRequest, history, ...recent];
  }

  private contextStart(session: SavedSession): number {
    return Number.isInteger(session.contextStart)
      ? Math.min(session.messages.length, Math.max(0, session.contextStart ?? 0))
      : 0;
  }

  public setEcoMode(on: boolean): boolean {
    const session = this.currentSession;
    const next = { ...session, ecoMode: on || undefined };
    if (!this.save(next)) return false;
    Object.assign(session, next);
    return true;
  }

  public attachFile(filePath: string): boolean {
    if (!this.currentSession.attachedFiles.includes(filePath)) {
      this.currentSession.attachedFiles.push(filePath);
      this.save();
      return true;
    }
    return false;
  }

  public dropFile(filePath: string): boolean {
    const idx = this.currentSession.attachedFiles.indexOf(filePath);
    if (idx !== -1) {
      this.currentSession.attachedFiles.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  public editSession(id: string, changes: { name?: string; hidden?: boolean }, running?: SavedSession): boolean {
    const active = this.currentSession.id === id ? this.currentSession : running?.id === id ? running : undefined;
    const session = active ?? this.readSession(id);
    if (!session) return false;
    const next = { ...session, ...changes };
    if (changes.name !== undefined) next.titleEdited = true;
    if (!this.save(next, 'w', true)) return false;
    if (active) Object.assign(active, next);
    return true;
  }

  public static listAll(): Array<{ id: string; name: string; updatedAt: number; messageCount: number; hidden: boolean; workspace?: string; ecoMode?: boolean }> {
    if (!fs.existsSync(SESSIONS_DIR)) return [];
    try {
      const files = fs.readdirSync(SESSIONS_DIR);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try {
            const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8');
            const data = JSON.parse(raw);
            return {
              id: data.id,
              name: normalizeSessionName(data.name, data.id),
              updatedAt: data.updatedAt,
              messageCount: data.messages?.length || 0,
              hidden: data.hidden === true,
              workspace: typeof data.workspace === 'string' ? data.workspace : undefined,
              ecoMode: data.ecoMode === true,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b!.updatedAt - a!.updatedAt) as any;
    } catch {
      return [];
    }
  }

  public static deleteSession(id: string): boolean {
    if (!validSessionId(id)) return false;
    try {
      fs.unlinkSync(path.join(SESSIONS_DIR, `${id}.json`));
    } catch {
      return false;
    }
    this.setOrder(this.getOrder().filter((entry) => entry !== id));
    return true;
  }

  public static getOrder(): string[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(ORDER_PATH, 'utf-8')) as unknown;
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
    } catch {
      return [];
    }
  }

  public static setOrder(ids: string[]): void {
    try {
      if (!fs.existsSync(GLOBAL_DIR)) fs.mkdirSync(GLOBAL_DIR, { recursive: true });
      fs.writeFileSync(ORDER_PATH, JSON.stringify([...new Set(ids)], null, 2), { encoding: 'utf-8', mode: 0o600 });
    } catch {}
  }
}

export const sessionManager = new SessionManager();
