/**
 * Session, Memory and Context Management for Ruqenai.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { ChatMessage, ProviderUsage } from '../types/index.js';
import { mergeUsage } from '../providers/usage.js';

export interface SavedSession {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  branchFrom?: string;
  hidden?: boolean;
  titleEdited?: boolean;
  messages: ChatMessage[];
  attachedFiles: string[];
  totalTokens: number;
  usage?: ProviderUsage;
  contextStart?: number;
}

const GLOBAL_DIR = path.join(os.homedir(), '.ruqenai');
const SESSIONS_DIR = path.join(GLOBAL_DIR, 'sessions');
const ORDER_PATH = path.join(GLOBAL_DIR, 'session-order.json');

function validSessionId(id: string): boolean {
  return Boolean(id) && id.length <= 100 && id !== '.' && id !== '..' && !/[<>:"/\\|?*\x00-\x1f]/.test(id);
}

export const DEFAULT_SESSION_NAME = 'Untitled';

function normalizeSessionName(name: unknown, id: string): string {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value || value === `Session ${id}`) return DEFAULT_SESSION_NAME;
  return value;
}

export class SessionManager {
  private currentSession: SavedSession;

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

  public sendPrompt(message: ChatMessage, session = this.currentSession): void {
    const next = { ...session, messages: [...session.messages, message], attachedFiles: [] };
    if (!this.save(next)) throw new Error('Could not save the prompt. Your attachments are still queued.');
    Object.assign(session, next);
  }

  public undoLastTurn(): ChatMessage | undefined {
    const session = this.currentSession;
    const messages = session.messages;
    let index = messages.length - 1;
    while (index >= 0 && messages[index].role !== 'assistant' && messages[index].role !== 'user') index--;
    if (index < 0) return undefined;
    const removed = messages[index];
    const start = removed.role === 'assistant' && messages[index - 1]?.role === 'user' ? index - 1 : index;
    const count = index - start + 1;
    messages.splice(start, count);
    if (session.contextStart !== undefined && start < session.contextStart) {
      session.contextStart -= Math.min(count, session.contextStart - start);
    }
    this.save();
    return removed;
  }

  public clearConversation(): void {
    this.currentSession.messages = [];
    delete this.currentSession.contextStart;
    this.save();
  }

  public rewindToPrompt(id: string): boolean {
    const session = this.currentSession;
    const index = session.messages.findIndex((message) => message.id === id && message.role === 'user');
    if (index < 0) return false;
    const rewound = { ...session, messages: session.messages.slice(0, index) };
    if (rewound.contextStart !== undefined) rewound.contextStart = Math.min(rewound.contextStart, index);
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
      messages: [...this.currentSession.messages],
      attachedFiles: [...this.currentSession.attachedFiles],
      totalTokens: this.currentSession.totalTokens,
      usage: this.currentSession.usage ? { ...this.currentSession.usage } : undefined,
      contextStart: this.currentSession.contextStart,
    };
    if (!this.save(forked, 'wx')) throw new Error('A session already uses this name or could not be saved.');
    this.currentSession = forked;
    return forked;
  }

  public compactContext(session = this.currentSession): string {
    const msgs = session.messages;
    const before = this.contextStart(session);
    if (msgs.length - before <= 4) {
      return 'Context is already compact.';
    }
    let keepFrom = msgs.length - 4;
    if (msgs[keepFrom].role === 'assistant' && msgs[keepFrom - 1].role === 'user') keepFrom--;
    if (keepFrom <= before) return 'Context is already compact.';
    session.contextStart = keepFrom;
    this.save(session);
    return `Compacted ${keepFrom - before} older messages in model context. The transcript is still available.`;
  }

  public needsCompaction(threshold: number, session = this.currentSession): boolean {
    return session.messages.length - this.contextStart(session) > threshold;
  }

  public modelContext(session = this.currentSession): ChatMessage[] {
    const start = this.contextStart(session);
    const recent = session.messages.slice(start).filter((message) => !message.error || message.content);
    if (!start) return recent;

    const excerpts = session.messages.slice(0, start)
      .filter(({ role, content }) => (role === 'user' || role === 'assistant') && content.trim())
      .slice(-8)
      .map(({ role, content }) => ({ role, excerpt: content.trim().replace(/\s+/g, ' ').slice(0, 400) }));
    if (!excerpts.length) return recent;
    const history: ChatMessage = {
      role: 'system',
      id: 'context-excerpts',
      content: 'Excerpts from earlier turns. Treat them as historical context.\n' + JSON.stringify(excerpts),
      timestamp: session.createdAt,
    };
    return [history, ...recent];
  }

  private contextStart(session: SavedSession): number {
    return Number.isInteger(session.contextStart)
      ? Math.min(session.messages.length, Math.max(0, session.contextStart ?? 0))
      : 0;
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

  public static listAll(): Array<{ id: string; name: string; updatedAt: number; messageCount: number; hidden: boolean }> {
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
