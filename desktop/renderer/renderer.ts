// Ruqenai desktop renderer — a native chat surface driving the headless agent.
//
// Layout: an icon rail, a collapsible ledger of projects and their chats, one
// column of conversation, and an optional inspector for the current session.
//
// Motion only explains a change: the model selector blooms out of the chip that
// summoned it, folds slide open, the composer drops to the dock when a chat
// starts, and the hero runs an ASCII scene.

import { mount } from 'ascii.rest';
import * as alpineDawn from 'ascii.rest/pieces/alpine-dawn';
import * as auroraFjord from 'ascii.rest/pieces/aurora-fjord';
import * as nightCoast from 'ascii.rest/pieces/night-coast';
import * as tokyoRain from 'ascii.rest/pieces/tokyo-rain';
import * as earthrise from 'ascii.rest/pieces/earthrise';
import { applyBrand, brandFor, brandTile } from './brand';
import { icon } from './icons';
import { esc, renderMarkdown } from './markdown';
import { highlightCode } from './highlight';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  costUsd?: number;
  estimatedCostUsd?: number;
}

interface ChatMeta {
  id: string;
  name: string;
  updatedAt: number;
  messageCount: number;
  project: string | null;
  active: boolean;
}

interface TaskItem {
  id: string;
  kind: 'plan' | 'tool';
  title?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'denied';
  tool?: string;
  detail?: string;
  durationMs?: number;
  changes?: { added: number; removed: number };
  diff?: string;
  exitCode?: number;
  output?: string;
  shellLog?: { command?: string; cwd?: string; stdout?: string; stderr?: string };
  subagent?: unknown;
}

interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  reasoningContent?: string;
  tasks?: TaskItem[];
  error?: string;
  durationMs?: number;
  usage?: Usage;
  tokens?: number;
}

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  tasks?: TaskItem[];
  error?: string;
  durationMs?: number;
  usage?: Usage;
  done: boolean;
}

interface ModelOption {
  id: string;
  name: string;
  ctx?: number;
}

interface ModelGroup {
  id: string;
  name: string;
  models: ModelOption[];
}

interface ModelList {
  active: { provider: string; model: string };
  groups: ModelGroup[];
}

interface ProviderRow {
  id: string;
  name: string;
  category: string;
  description: string;
  website: string | null;
  requiresKey: boolean;
  isLocal: boolean;
  connected: boolean;
  hasKey: boolean;
  endpoint: string;
  defaultBaseUrl: string;
  modelCount: number;
  models: string[];
  connection: 'native' | 'compatible' | 'endpoint' | 'catalog';
}

interface EffortState {
  effort: string;
  levels: string[];
}

interface InitPayload {
  config: { mode?: string; provider?: string; model?: string; effort?: string; levels?: string[] };
  projects: string[];
  activeProject: string | null;
  chats: ChatMeta[];
  platform?: string;
}

interface Api {
  init(): Promise<InitPayload>;
  updateState(): Promise<DesktopUpdate>;
  checkUpdate(): Promise<DesktopUpdate>;
  installUpdate(): Promise<void>;
  getConfig(): Promise<{ mode?: string; provider?: string; model?: string; effort?: string; defaultEffort?: string; levels?: string[] }>;
  setMode(mode: string): Promise<void>;
  setEffort(level: string): Promise<EffortState>;
  listExtensions(): Promise<Record<'skills' | 'mcp' | 'plugins', Array<{ name: string; description?: string; removable: boolean }>>>;
  removeExtension(kind: string, name: string): Promise<{ ok: boolean; error?: string }>;
  previewArtifact(sessionId: string, filePath: string): Promise<{ name: string; kind: 'image' | 'text' | 'binary'; content: string }>;
  suggestMentions(
    token: string,
    root?: string,
  ): Promise<{ extensions: MentionItem[]; files: MentionItem[] }>;
  gitInfo(root?: string): Promise<{ isRepo: boolean; branch: string | null; name: string }>;
  listModels(): Promise<ModelList>;
  setModel(provider: string, model: string): Promise<boolean>;
  createChat(projectPath?: string): Promise<{ id: string; name: string; project: string }>;
  openChat(id: string): Promise<{ id: string; name: string; project: string | null; messages: ChatMessage[] }>;
  sendPrompt(sessionId: string, prompt: string): Promise<boolean>;
  stop(): Promise<boolean>;
  clearTasks(id: string): Promise<boolean>;
  homeGet(): Promise<HomeBg>;
  homePick(): Promise<{ ok: boolean }>;
  homeClear(): Promise<void>;
  homeSetScene(enabled: boolean): Promise<void>;
  homeSetSceneName(scene: string): Promise<void>;
  homeSetDisplay(value: Partial<Pick<HomeBg, 'darkDotsColored' | 'chatVisible' | 'chatOpacity' | 'suggestionsVisible'>>): Promise<void>;
  setCustomCss(css: string): Promise<void>;
  deleteChat(id: string): Promise<boolean>;
  renameChat(id: string, name: string): Promise<boolean>;
  listChats(): Promise<ChatMeta[]>;
  attachPick(): Promise<string[]>;
    attachFile(sessionId: string, filePath: string): Promise<boolean>;
    attachRaw(sessionId: string, payload: { name: string; data: string }): Promise<boolean>;
    attachList(sessionId: string): Promise<Array<{ name: string; path: string; preview?: string }>>;
    attachRemove(sessionId: string, filePath: string): Promise<boolean>;
    pathForFile(file: File): string;
  listProjects(): Promise<string[]>;
  addProject(): Promise<string | null>;
  setActiveProject(p: string): Promise<boolean>;
  removeProject(p: string): Promise<boolean>;
  listProviders(): Promise<ProviderRow[]>;
  connectProvider(id: string, payload: { apiKey?: string; endpoint?: string }): Promise<{ ok: boolean; error?: string }>;
  disconnectProvider(id: string): Promise<{ ok: boolean; error?: string }>;
  setTitlebarTone?(theme: string): void;
  answerQuestion(answer: string | undefined): void;
  answerPermission(requestId: string, allowed: boolean, alwaysAllow: boolean): void;
  onEvent(cb: (e: unknown) => void): () => void;
}

const api = (window as unknown as { ruqenai: Api }).ruqenai;

interface DesktopUpdate {
  status: string;
  installed: string;
  version?: string;
  progress?: number;
  error?: string;
}

const updateCard = document.createElement('section');
updateCard.id = 'desktop-update';
updateCard.hidden = true;
updateCard.setAttribute('aria-live', 'polite');
document.body.append(updateCard);
const installScreen = document.createElement('div');
installScreen.id = 'update-installing';
installScreen.hidden = true;
installScreen.innerHTML = '<div class="install-orb"><span class="install-arc" aria-hidden="true"></span><span>Installing update</span></div>';
document.body.append(installScreen);
function paintDesktopUpdate(update: DesktopUpdate): void {
  updateCard.hidden = update.status === 'idle' || update.status === 'current' ||
    (update.status === 'error' && !updateCard.dataset.manual);
  if (updateCard.hidden) return;
  const ready = update.status === 'ready';
  updateCard.innerHTML = `<div><strong>${ready ? 'Update ready' : update.status === 'downloading' ? 'Downloading update' : update.status === 'error' ? 'Update check failed' : 'Checking for updates'}</strong>
    <p>${esc(update.status === 'error' ? update.error ?? 'Try again later.' : update.version ? 'Version ' + update.version : 'Installed ' + update.installed)}</p></div>
    ${update.status === 'downloading' ? `<div class="update-progress"><progress max="100" value="${update.progress ?? 0}" aria-label="Download progress"></progress><span>${update.progress ?? 0}%</span></div>` : ''}
    ${ready ? '<button id="install-desktop-update">Install</button>' : update.status === 'error' ? '<button id="retry-desktop-update">Retry</button>' : ''}
    <button id="dismiss-desktop-update" aria-label="Dismiss update notification">×</button>`;
  updateCard.querySelector('#dismiss-desktop-update')?.addEventListener('click', () => { updateCard.hidden = true; });
  updateCard.querySelector('#retry-desktop-update')?.addEventListener('click', () => void api.checkUpdate().then(paintDesktopUpdate));
  updateCard.querySelector('#install-desktop-update')?.addEventListener('click', async () => {
    installScreen.hidden = false;
    document.body.classList.add('installing');
    await new Promise((resolve) => window.setTimeout(resolve, 420));
    try { await api.installUpdate(); }
    catch (error) {
      installScreen.hidden = true;
      document.body.classList.remove('installing');
      paintDesktopUpdate({ ...update, status: 'error', error: String(error) });
    }
  });
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string): T[] =>
  Array.from(document.querySelectorAll<T>(sel));

const appEl = $('#app');
const thread = $('#thread');
const emptyState = $('#empty-state');
const chatTitle = $('#chat-title');
const chatContext = $('#chat-context');
const promptEl = $('#prompt') as HTMLTextAreaElement;
const sendBtn = $('#send-btn') as HTMLButtonElement;
const stopBtn = $('#stop-btn') as HTMLButtonElement;
const busyPill = $('#busy-pill');
const modelChip = $('#model-chip') as HTMLButtonElement;
const effortChip = $('#effort-chip') as HTMLButtonElement;
const effortName = $('#effort-name');
const chipMark = $('#chip-mark');
const chipName = $('#chip-name');
const overlay = $('#overlay');
const sheetEl = $('#model-sheet');
const modalEl = $('#providers-modal');
const scroller = $('#scroller');
const modeSeg = $('#mode-seg');
const segPill = modeSeg.querySelector('.seg-pill') as HTMLElement;
const panelScroll = $('#panel-scroll');
const projectsList = $('#projects-list');
const chatsList = $('#chats-list');
const ctxMenu = $('#ctx-menu');
const inspectBody = $('#inspect-body');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentSessionId: string | null = null;
let currentChatName = '';
let currentMessages: ChatMessage[] = [];
let liveTasks: TaskItem[] = [];

const todos = $('#todos');
const todosHead = $('#todos .todos-head');
const todosList = $('#todos-list');
const todosMeta = $('#todos .todos-meta');
const todosClear = $('#todos .todos-clear') as HTMLButtonElement;
let clearingTodos = false;

function setTodosOpen(open: boolean): void {
  todos.classList.toggle('open', open);
  todosList.hidden = !open;
  todosHead.setAttribute('aria-expanded', String(open));
}

function renderTodos(): void {
  const tasks = liveTasks.filter((task) => task.kind === 'plan');
  todos.classList.toggle('hidden', !tasks.length);
  if (!tasks.length) {
    setTodosOpen(false);
    todosList.replaceChildren();
    return;
  }
  const done = tasks.filter((task) => task.status === 'completed').length;
  const summary = `${done} of ${tasks.length} done`;
  if (todosMeta.textContent !== summary) todosMeta.textContent = summary;
  const scrollTop = todosList.scrollTop;
  todosList.innerHTML = tasks
    .map((task) => {
      const status = task.status ?? 'pending';
      const glyph =
        status === 'in_progress'
          ? '<span class="ring" aria-hidden="true"></span>'
          : '<span class="todo-dot" aria-hidden="true"></span>';
      const cls = status === 'completed' ? ' done' : status === 'in_progress' ? ' running' : '';
      return '<div class="todo-row' + cls + '">' + glyph +
        '<span class="todo-status">' + (cls === ' done' ? 'Done' : cls === ' running' ? 'In progress' : 'Pending') +
        '</span><span>' + esc(task.title ?? task.tool ?? 'Step') + '</span></div>';
    })
    .join('');
  todosList.scrollTop = scrollTop;
  todosClear.disabled = busy || clearingTodos;
  todosClear.title = busy ? 'Available after the current reply' : 'Clear to-dos';
}

todosHead.onclick = () => setTodosOpen(todosList.hidden);
todosClear.innerHTML = icon('trash');
todosClear.onclick = async () => {
  const id = currentSessionId;
  if (!id || busy || clearingTodos) return;
  clearingTodos = true;
  todosClear.disabled = true;
  try {
    if (!await api.clearTasks(id)) throw new Error('Could not clear to-dos.');
    if (currentSessionId !== id) return;
    currentMessages = currentMessages.map((message) => message.tasks
      ? { ...message, tasks: message.tasks.filter((task) => task.kind !== 'plan') }
      : message);
    liveTasks = liveTasks.filter((task) => task.kind !== 'plan');
    promptEl.focus({ preventScroll: true });
  } catch {
    if (currentSessionId === id) todosMeta.textContent = 'Could not clear to-dos';
  } finally {
    clearingTodos = false;
    if (currentSessionId === id) {
      todosClear.disabled = busy;
      if (!liveTasks.some((task) => task.kind === 'plan')) renderTodos();
    }
  }
};
let activeProject: string | null = null;
let activeModelLabel = '';
let busy = false;
let streaming: StreamState | null = null;
let models: ModelList | null = null;
let providerCache: ProviderRow[] = [];
let provState: { rows: ProviderRow[]; selected: string | null; filter: string } | null = null;
let effort: EffortState = { effort: 'High', levels: ['Off', 'Low', 'Medium', 'High', 'XHigh', 'UltraCode'] };
let chatsCache: ChatMeta[] = [];
let renamingId: string | null = null;
let filterText = '';

interface Segment {
  root: HTMLElement;
  fold: HTMLElement | null;
  text: HTMLElement | null;
}

interface StreamState {
  el: HTMLElement;
  segmentsHost: HTMLElement;
  reasoning: HTMLElement;
  reasoningBody: HTMLElement;
  meta: HTMLElement;
  msg: Msg;
  segments: Segment[];
  current: Segment;
}

const THEME_KEY = 'ruqenai.theme';
const PANEL_KEY = 'ruqenai.panel';
const PIN_KEY = 'ruqenai.pinned';
const OPEN_KEY = 'ruqenai.projects-open';

const pinned = new Set<string>(readJSON<string[]>(PIN_KEY, []));
const openProjects = new Set<string>(readJSON<string[]>(OPEN_KEY, []));

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — not worth breaking the UI over */
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ctxLabel = (n?: number): string =>
  !n ? '' : n >= 1_000_000 ? `${Math.round((n / 1_000_000) * 10) / 10}M` : `${Math.round(n / 1000)}k`;

const projectName = (p: string): string => {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

function timeLabel(ms?: number): string {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function money(usd: number): string {
  if (!usd) return '—';
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

let jumpRefresh: (() => void) | null = null;

/** True when the viewport is parked at (or very near) the newest message. */
function atBottom(): boolean {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
}

/**
 * Keep the view anchored to the newest message. Pass `false` while a reply is
 * streaming so reading back through history is not yanked away every frame.
 */
function scrollBottom(force = true): void {
  if (!force && !atBottom()) {
    jumpRefresh?.();
    return;
  }
  scroller.scrollTo({ top: scroller.scrollHeight });
  jumpRefresh?.();
}

function isUntitled(name: string): boolean {
  const n = (name || '').trim().toLowerCase();
  return !n || n === 'untitled' || n === 'new chat';
}

/** First line of the prompt, trimmed to something that fits a sidebar row. */
function titleFromPrompt(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? 'Untitled';
  const clean = line.replace(/^[#>*\-+\s]+/, '').replace(/\s+/g, ' ');
  return clean.length > 48 ? clean.slice(0, 46).trimEnd() + '…' : clean;
}

// ---------------------------------------------------------------------------
// Fold: the one disclosure used for thinking and for action stacks
// ---------------------------------------------------------------------------

function fold(headHtml: string, bodyHtml: string, extra = '', open = false): HTMLElement {
  const el = document.createElement('div');
  el.className = `fold ${extra}`.trim() + (open ? ' open' : '');
  el.innerHTML =
    `<button class="fold-head" type="button" aria-expanded="${open}">${headHtml}<span class="chev" aria-hidden="true">${icon('chevron')}</span></button>` +
    `<div class="fold-body"><div class="fold-inner">${bodyHtml}</div></div>`;
  const head = el.querySelector('.fold-head') as HTMLElement;
  head.addEventListener('click', () => {
    const next = !el.classList.contains('open');
    el.classList.toggle('open', next);
    head.setAttribute('aria-expanded', String(next));
  });
  return el;
}

function statusGlyph(t: TaskItem): string {
  switch (t.status) {
    case 'completed':
      return '✓';
    case 'in_progress':
      return t.tool === 'run_shell' ? '&gt;<span class="terminal-cursor">█</span>' : '▸';
    case 'failed':
      return '✕';
    case 'denied':
      return '⊘';
    default:
      return '·';
  }
}

function rowClass(t: TaskItem): string {
  if (t.status === 'completed') return 'done';
  if (t.status === 'failed' || t.status === 'denied') return 'failed';
  if (t.status === 'in_progress') return 'running';
  return '';
}

function taskOutputHtml(t: TaskItem): string {
  const log = t.shellLog;
  if (log) {
    const lines: string[] = [];
    if (log.command) lines.push(`$ ${log.command}`);
    if (log.stdout && log.stdout.trim()) lines.push(log.stdout.trim());
    if (log.stderr && log.stderr.trim()) lines.push(log.stderr.trim());
    if (lines.length) {
      return `<pre class="act-pre code"><code>${highlightCode(lines.join('\n'), 'shell')}</code></pre>`;
    }
  }
  if (t.diff && t.diff.trim()) {
    return `<pre class="act-pre code diff"><code>${highlightCode(t.diff.trim(), 'diff')}</code></pre>`;
  }
  const text = (t.output ?? t.detail ?? '').trim();
  if (text) {
    const lang = /^[\{\[]/.test(text) ? 'json' : /^<[?!]/.test(text) ? 'xml' : 'plaintext';
    return `<pre class="act-pre code"><code>${highlightCode(text, lang)}</code></pre>`;
  }
  return '';
}

function actionRows(tasks: TaskItem[]): string {
  const rows: string[] = [];
  const seen = new Set<string>();
  for (const t of tasks) {
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    const title = t.kind === 'tool' ? t.tool || t.title || '' : t.title || '';
    const command = (t.shellLog?.command || t.detail || '').replace(/\s+/g, ' ').trim();
    if (!title && !command) continue;
    const cmd =
      command && command !== title
        ? `<span class="act-cmd" title="${esc(command)}">${esc(command)}</span>`
        : '';
    const label = title
      ? `<span class="act-label" title="${esc(title)}">${esc(title)}</span>`
      : '';
    const delta = t.changes
      ? `<span class="act-delta"><b class="add">+${t.changes.added}</b><b class="del">−${t.changes.removed}</b></span>`
      : '';
    const body = taskOutputHtml(t);
    const imageInProgress = t.status === 'in_progress' && /(?:image|illustrat|render|draw|\.png|\.jpe?g|\.webp)/i.test(`${t.title ?? ''} ${t.detail ?? ''} ${t.tool ?? ''}`);
    if (imageInProgress) {
      rows.push(`<div class="creative-progress" role="status"><pre aria-hidden="true">·······················\n·  ░░░░▒▒▒▓▓▒▒░░░░  ·\n·  ░░▒▓▓▓██▓▓▒░░  ·\n·······················</pre><span class="shimmer">Generating image</span></div>`);
    }
    if (!body) {
      rows.push(
        `<div class="act-row ${rowClass(t)}"><span class="act-glyph">${statusGlyph(t)}</span>${label}${cmd}${delta}</div>`,
      );
      continue;
    }
    rows.push(
      `<div class="act ${rowClass(t)}">` +
        `<button class="act-row" type="button" aria-expanded="false"><span class="act-glyph">${statusGlyph(t)}</span>${label}${cmd}${delta}<span class="act-caret" aria-hidden="true"></span></button>` +
        `<div class="act-detail"><div class="act-detail-in">${body}</div></div>` +
        `</div>`,
    );
  }
  return rows.join('');
}

function foldHeadLabel(tasks: TaskItem[]): string {
  const n = tasks.filter((t) => t.id).length;
  const running = tasks.find((t) => t.status === 'in_progress');
  const noun = `${n} action${n === 1 ? '' : 's'}`;
  return running
    ? `<span class="fold-mark spinning" aria-hidden="true"></span><span class="fold-title shimmer">${esc(running.tool || running.title || 'Working')}</span><span class="fold-meta">${noun}</span>`
    : `<span class="fold-mark done" aria-hidden="true">${icon('check')}</span><span class="fold-title">${noun}</span>`;
}

function actionFold(tasks: TaskItem[], open = false): HTMLElement {
  const actions = tasks.filter((task) => task.kind !== 'plan');
  const el = fold(foldHeadLabel(actions), actionRows(actions), 'acts', open);
  // A reply that used no tools shows nothing at all — not an empty "0 actions" bar.
  if (!actions.length) el.hidden = true;
  return el;
}

function thinkingFold(text: string, open = false, live = false): HTMLElement {
  return fold(
    `<span class="fold-title${live ? ' shimmer' : ''}">Thinking</span>`,
    `<div class="thinking-body prose">${renderMarkdown(text)}</div>`,
    'thinking',
    open,
  );
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function makeMsgEl(msg: Msg): HTMLElement {
  const el = document.createElement('div');
  el.className = 'msg ' + msg.role;
  el.innerHTML = '<div class="bubble"></div>';
  return el;
}

function fillMsg(el: HTMLElement, msg: Msg): void {
  const bubble = el.querySelector('.bubble') as HTMLElement | null;
  if (!bubble) return;
  bubble.innerHTML = '';
  if (msg.role === 'user') {
    bubble.innerHTML = `<div class="user-bubble">${esc(msg.content)}</div>`;
    return;
  }
  if (msg.reasoning) bubble.appendChild(thinkingFold(msg.reasoning));
  if (msg.tasks && msg.tasks.length) bubble.appendChild(actionFold(msg.tasks));
  if (msg.tasks && msg.tasks.length) {
    const files = msg.tasks.filter((task) => task.status === 'completed' &&
      ['write_file', 'edit_file', 'attach_file'].includes(task.tool ?? '') && task.detail && /\.[a-z0-9]{1,8}$/i.test(task.detail));
    if (files.length) {
      const cards = document.createElement('div');
      cards.className = 'artifact-list';
      const seen = new Set<string>();
      for (const task of files) {
        const filePath = task.detail ?? '';
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        const name = filePath.split(/[\\/]/).pop() ?? filePath;
        const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : 'FILE';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'artifact-card';
        button.innerHTML = `<span class="artifact-icon">${esc(ext.slice(0, 5))}</span><span class="artifact-info"><strong>${esc(name)}</strong><small>Created file · Preview</small></span><span class="artifact-arrow">↗</span>`;
        button.onclick = () => void openArtifactPreview(filePath, name);
        cards.appendChild(button);
      }
      bubble.appendChild(cards);
    }
  }
  const body = document.createElement('div');
  body.className = 'assistant-body prose';
  body.innerHTML = renderMarkdown(msg.content) || (msg.done ? '' : '<span class="muted">…</span>');
  bubble.appendChild(body);
  if (msg.error) {
    const err = document.createElement('div');
    err.className = 'err';
    err.textContent = msg.error;
    bubble.appendChild(err);
  }
  const took = timeLabel(msg.durationMs);
  if (took) {
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = took;
    bubble.appendChild(meta);
  }
}

async function openArtifactPreview(filePath: string, name: string): Promise<void> {
  if (!currentSessionId) return;
  const layer = document.createElement('div');
  layer.className = 'attach-preview';
  layer.innerHTML = `<div class="attach-preview-card artifact-preview" role="dialog" aria-label="Preview ${esc(name)}"><div class="attach-preview-head"><span>${esc(name)}</span><button type="button" class="attach-preview-x" aria-label="Close">×</button></div><div class="artifact-preview-body"><span class="shimmer">Preparing preview</span></div></div>`;
  document.body.append(layer);
  const close = () => layer.remove();
  layer.querySelector('.attach-preview-x')?.addEventListener('click', close);
  layer.addEventListener('click', (event) => { if (event.target === layer) close(); });
  try {
    const result = await api.previewArtifact(currentSessionId, filePath);
    const body = layer.querySelector('.artifact-preview-body');
    if (!body) return;
    if (result.kind === 'image') body.innerHTML = `<img class="attach-preview-img" src="${result.content}" alt="${esc(result.name)}">`;
    else { body.innerHTML = ''; const pre = document.createElement('pre'); pre.textContent = result.content; body.append(pre); }
  } catch (error) {
    const body = layer.querySelector('.artifact-preview-body');
    if (body) body.textContent = error instanceof Error ? error.message : String(error);
  }
}

function newSegment(state: StreamState): Segment {
  const root = document.createElement('div');
  root.className = 'seg-run';
  state.segmentsHost.appendChild(root);
  const segment: Segment = { root, fold: null, text: null };
  state.segments.push(segment);
  state.current = segment;
  return segment;
}

function ensureActions(state: StreamState): HTMLElement {
  if (!state.current.fold) {
    const el = actionFold(liveTasks, true);
    state.current.root.appendChild(el);
    state.current.fold = el;
  }
  return state.current.fold;
}

function ensureText(state: StreamState): HTMLElement {
  if (!state.current.text) {
    // Speech after tooling starts a fresh stack, so the next action group is
    // visually separate instead of piling into one ever-growing list.
    if (state.current.fold) newSegment(state);
    const body = document.createElement('div');
    body.className = 'assistant-body prose';
    state.current.root.appendChild(body);
    state.current.text = body;
  }
  return state.current.text;
}

function startStreaming(): StreamState {
  const msg: Msg = { id: 'streaming', role: 'assistant', content: '', done: false };
  const el = makeMsgEl(msg);
  el.innerHTML =
    '<div class="bubble">' +
    '<div data-a="reasoning" hidden></div>' +
    '<div data-a="segments"></div>' +
    '<div class="meta" data-a="meta"></div>' +
    '</div>';
  thread.appendChild(el);
  const state: StreamState = {
    el,
    segmentsHost: el.querySelector('[data-a="segments"]') as HTMLElement,
    reasoning: el.querySelector('[data-a="reasoning"]') as HTMLElement,
    reasoningBody: el.querySelector('[data-a="reasoning"]') as HTMLElement,
    meta: el.querySelector('[data-a="meta"]') as HTMLElement,
    msg,
    segments: [],
    current: undefined as unknown as Segment,
  };
  newSegment(state);
  ensureText(state).innerHTML = '<span class="reply-pulse" aria-label="Writing a reply"></span>';
  return state;
}

function setCaret(state: StreamState, content: string): void {
  const body = ensureText(state);
  body.innerHTML = renderMarkdown(content) + '<span class="caret"></span>';
}

// Streaming repaints are throttled: re-parsing the whole message on every chunk
// is quadratic and melts long replies. 70ms is well below perception.
let streamPaintTimer = 0;
let pendingStream: { state: StreamState; content: string } | null = null;
let reasoningTimer = 0;

function scheduleStreamPaint(state: StreamState, content: string): void {
  pendingStream = { state, content };
  if (streamPaintTimer) return;
  streamPaintTimer = window.setTimeout(() => {
    streamPaintTimer = 0;
    const job = pendingStream;
    pendingStream = null;
    if (!job) return;
    ensureText(job.state).innerHTML = renderMarkdown(job.content) + '<span class="caret"></span>';
    scrollBottom(false);
  }, 70);
}

function scheduleReasoningPaint(state: StreamState, reasoning: string): void {
  if (reasoningTimer) return;
  reasoningTimer = window.setTimeout(() => {
    reasoningTimer = 0;
    const body = state.reasoning.querySelector('.thinking-body');
    if (body) body.innerHTML = renderMarkdown(reasoning);
  }, 120);
}

function cancelStreamPaint(): void {
  if (tasksTimer) window.clearTimeout(tasksTimer);
  tasksTimer = 0;
  if (streamPaintTimer) window.clearTimeout(streamPaintTimer);
  if (reasoningTimer) window.clearTimeout(reasoningTimer);
  streamPaintTimer = 0;
  reasoningTimer = 0;
  pendingStream = null;
}

let inspectorTimer = 0;
function scheduleInspector(): void {
  if (inspectorTimer) return;
  inspectorTimer = window.setTimeout(() => {
    inspectorTimer = 0;
    renderInspector();
  }, 260);
}

let tasksTimer = 0;

function paintTasks(state: StreamState): void {
  const existing = state.current.fold;
  const fresh = actionFold(liveTasks, true);
  if (existing) {
    const wasOpen = existing.classList.contains('open');
    existing.replaceWith(fresh);
    fresh.classList.toggle('open', wasOpen);
  } else {
    state.current.root.appendChild(fresh);
  }
  state.current.fold = fresh;
}

function scheduleTasksPaint(state: StreamState): void {
  if (tasksTimer) return;
  tasksTimer = window.setTimeout(() => {
    tasksTimer = 0;
    if (!streaming) return;
    paintTasks(state);
    scrollBottom(false);
  }, 180);
}

// ---------------------------------------------------------------------------
// Empty state and the ASCII scene
// ---------------------------------------------------------------------------

const BACKDROP_SCENES = [
  { id: 'aurora-fjord', label: 'Aurora Fjord', piece: auroraFjord },
  { id: 'alpine-dawn', label: 'Alpine Dawn', piece: alpineDawn },
  { id: 'tokyo-rain', label: 'Tokyo Rain', piece: tokyoRain },
  { id: 'night-coast', label: 'Night Coast', piece: nightCoast },
  { id: 'earthrise', label: 'Earthrise', piece: earthrise },
];
const SCENE_KEY = 'ruqenai.scene';
const backdrop = $('#chat-backdrop');
const sceneCanvas = $('#scene-canvas');
let activeScene = BACKDROP_SCENES[0].id;
let mountedScene: string | undefined;
let stopBackdrop: (() => void) | undefined;

/** The hero art belongs to a conversation, not to a timer: each new chat gets
 *  the next scene, and reopening an old chat keeps the one already on screen. */
function nextScene(): string {
  if (scenePreference !== 'rotate') return scenePreference === 'image' || BACKDROP_SCENES.some((scene) => scene.id === scenePreference)
    ? scenePreference : BACKDROP_SCENES[0].id;
  let index = 0;
  try {
    index = (Number(localStorage.getItem(SCENE_KEY)) || 0) % BACKDROP_SCENES.length;
  } catch {
    index = 0;
  }
  try {
    localStorage.setItem(SCENE_KEY, String((index + 1) % BACKDROP_SCENES.length));
  } catch {
    /* ignore */
  }
  return (BACKDROP_SCENES[index] ?? BACKDROP_SCENES[0]).id;
}

const STARTER_POOL: Array<[string, string]> = [
  ['Explain this repo', 'Walk me through this repository. What are the main entry points?'],
  ['Fix the failing test', 'Run the test suite and fix the first failure you find.'],
  ['Review my last change', 'Review the last change for bugs and edge cases.'],
  ['Find the bug', 'Something is broken. Trace the likely cause and propose a fix.'],
  ['Add a feature', 'Add the most useful missing capability here and wire it up.'],
  ['Read the stack trace', 'Look at the last error in this project and explain it plainly.'],
  ['Refactor a file', 'Pick the messiest file here and refactor it without changing behaviour.'],
  ['Write docs', 'Document the public surface of this project.'],
];

function randomStarters(): void {
  const buttons = $$('#starters .starter');
  if (!buttons.length) return;
  const pool = [...STARTER_POOL];
  for (const button of buttons) {
    const pick = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    if (!pick) continue;
    button.textContent = pick[0];
    button.dataset.prompt = pick[1];
  }
}

document.addEventListener('click', (ev) => {
  const row = (ev.target as HTMLElement).closest<HTMLElement>('.act-row');
  const holder = row?.closest<HTMLElement>('.act');
  if (!holder) return;
  const open = holder.classList.toggle('open');
  row?.setAttribute('aria-expanded', String(open));
});

type HomeBg = {
  sceneEnabled: boolean;
  scene: string;
  background: string | null;
  mediaKind: 'image' | 'video';
  name: string | null;
  darkDotsColored: boolean;
  chatVisible: boolean;
  chatOpacity: number;
  suggestionsVisible: boolean;
};
let homeBg: HomeBg = {
  darkDotsColored: false, sceneEnabled: true, scene: 'rotate', background: null, mediaKind: 'image', name: null,
  chatVisible: false, chatOpacity: 15, suggestionsVisible: true,
};

async function loadHomeBg(): Promise<void> {
  try {
    homeBg = await api.homeGet();
    scenePreference = homeBg.scene;
  } catch {
    /* keep the defaults */
  }
}

let customCss = '';

function applyCustomCss(css: string): void {
  let style = document.getElementById('custom-css-style') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'custom-css-style';
    document.head.appendChild(style);
  }
  style.textContent = css;
}

async function loadCustomCss(): Promise<void> {
  try {
    const cfg = (await api.getConfig()) as { customCss?: string };
    customCss = cfg.customCss ?? '';
    applyCustomCss(customCss);
  } catch {
    /* no custom css yet */
  }
}

let scenePreference = 'rotate';
let scenePreviews: Array<{ stop(): void }> = [];
let dottedImageSource = '';
let dottedImageUrl = '';
let dottedImagePending = false;
const video = document.createElement('video');
video.muted = true;
video.loop = true;
video.playsInline = true;
video.preload = 'metadata';
const videoDots = document.createElement('canvas');
videoDots.id = 'video-dots';
backdrop.append(videoDots);
const videoSample = document.createElement('canvas');
let videoSource = '';
let videoFrameTimer = 0;

function paintVideoDots(): void {
  if (video.paused || video.readyState < 2 || document.hidden) return;
  const out = videoDots.getContext('2d');
  if (!out) return;
  const width = 840;
  const height = Math.max(320, Math.min(700, Math.round(width * video.videoHeight / Math.max(1, video.videoWidth))));
  if (videoDots.width !== width || videoDots.height !== height) { videoDots.width = width; videoDots.height = height; }
  const step = 8;
  const sample = videoSample;
  if (sample.width !== Math.ceil(width / step) || sample.height !== Math.ceil(height / step)) {
    sample.width = Math.ceil(width / step); sample.height = Math.ceil(height / step);
  }
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  context.drawImage(video, 0, 0, sample.width, sample.height);
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
  out.clearRect(0, 0, width, height);
  for (let y = 0; y < sample.height; y++) for (let x = 0; x < sample.width; x++) {
    const i = (y * sample.width + x) * 4;
    const light = (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722) / 255;
    if (light < .1) continue;
    out.fillStyle = `rgba(${pixels[i]},${pixels[i + 1]},${pixels[i + 2]},${.16 + light * .65})`;
    out.beginPath(); out.arc(x * step + 4, y * step + 4, .5 + light * 2.2, 0, Math.PI * 2); out.fill();
  }
}

function syncVideoDots(show: boolean): void {
  window.clearInterval(videoFrameTimer);
  videoFrameTimer = 0;
  videoDots.hidden = !show;
  if (!show || !homeBg.background) { video.pause(); return; }
  if (videoSource !== homeBg.background) { videoSource = homeBg.background; video.src = videoSource; }
  void video.play().catch(() => {});
  videoFrameTimer = window.setInterval(paintVideoDots, 100);
}

/** Rasterize an imported photo to a fixed dot grid once, off the animation loop. */
function updateImportedDots(source: string): void {
  if (!source || source === dottedImageSource || dottedImagePending) return;
  dottedImagePending = true;
  const img = new Image();
  img.onload = () => {
    const width = 840;
    const height = Math.max(320, Math.min(700, Math.round(width * img.naturalHeight / Math.max(1, img.naturalWidth))));
    const step = 7;
    const sample = document.createElement('canvas');
    sample.width = Math.ceil(width / step);
    sample.height = Math.ceil(height / step);
    const sctx = sample.getContext('2d', { willReadFrequently: true });
    const out = document.createElement('canvas');
    out.width = width; out.height = height;
    const ctx = out.getContext('2d');
    if (sctx && ctx) {
      sctx.drawImage(img, 0, 0, sample.width, sample.height);
      const pixels = sctx.getImageData(0, 0, sample.width, sample.height).data;
      for (let y = 0; y < sample.height; y++) for (let x = 0; x < sample.width; x++) {
        const i = (y * sample.width + x) * 4;
        const alpha = pixels[i + 3] / 255;
        const light = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
        if (alpha < 0.1 || light < 0.08) continue;
        ctx.fillStyle = `rgba(${pixels[i]},${pixels[i + 1]},${pixels[i + 2]},${Math.min(0.9, alpha * (0.16 + light * 0.8))})`;
        ctx.beginPath();
        ctx.arc(x * step + 3, y * step + 3, 0.6 + light * 2.15, 0, Math.PI * 2);
        ctx.fill();
      }
      dottedImageSource = source;
      dottedImageUrl = out.toDataURL('image/png');
      if (homeBg.background === source) backdrop.style.setProperty('--backdrop-image', `url("${dottedImageUrl}")`);
    }
    dottedImagePending = false;
  };
  img.onerror = () => { dottedImagePending = false; };
  img.src = source;
}

function applyHomeBg(): void {
  document.documentElement.dataset.coloredDots = String(homeBg.darkDotsColored);
  const home = appEl.classList.contains('home');
  const visible = (home ? homeBg.sceneEnabled : homeBg.chatVisible) && (manageEl?.classList.contains('hidden') ?? true);
  const useImage = activeScene === 'image' && Boolean(homeBg.background);
  const useVideo = useImage && homeBg.mediaKind === 'video';
  const scene = BACKDROP_SCENES.find((entry) => entry.id === activeScene) ?? BACKDROP_SCENES[0];
  const showCanvas = visible && !useImage;
  backdrop.hidden = !visible || (!useImage && !showCanvas);
  backdrop.classList.toggle('image', useImage);
  backdrop.style.setProperty('--backdrop-image', useImage && !useVideo && dottedImageSource === homeBg.background ? `url("${dottedImageUrl}")` : 'none');
  if (useImage && !useVideo && homeBg.background) updateImportedDots(homeBg.background);
  syncVideoDots(visible && useVideo && !document.hidden);
  backdrop.style.setProperty('--chat-backdrop-opacity', String(Math.min(40, Math.max(5, homeBg.chatOpacity)) / 100));
  sceneCanvas.hidden = !showCanvas;
  if (mountedScene !== (showCanvas ? scene.id : undefined)) {
    stopBackdrop?.();
    stopBackdrop = showCanvas ? mount(sceneCanvas as HTMLCanvasElement, scene.piece, { fps: 10 }) : undefined;
    mountedScene = showCanvas ? scene.id : undefined;
  }
  const starters = emptyState.querySelector<HTMLElement>('#starters');
  if (starters) starters.hidden = !homeBg.suggestionsVisible;
  appEl.classList.toggle('backdrop-on', !backdrop.hidden);
}

function showEmpty(scene?: string): void {
  if (!emptyState.parentElement) {
    thread.innerHTML = '';
    thread.appendChild(emptyState);
  }
  randomStarters();
  appEl.classList.add('home');
  if (scene) activeScene = scene;
  applyHomeBg();
}

function hideEmpty(): void {
  if (emptyState.parentElement) emptyState.remove();
  appEl.classList.remove('home');
  applyHomeBg();
}

// ---------------------------------------------------------------------------
// Events from the agent
// ---------------------------------------------------------------------------

function handleEvent(raw: unknown): void {
  if ((raw as { type?: string }).type === 'desktop-update') {
    paintDesktopUpdate((raw as { update: DesktopUpdate }).update);
    return;
  }
  const e = raw as {
    type: string;
    sessionId?: string;
    content?: string;
    segments?: { kind: string; text: string }[];
    tasks?: TaskItem[];
    message?: ChatMessage;
    error?: string;
    request?: { id: string; type: string; target: string; description: string; rememberScope?: string };
    question?: { question: string; choices?: string[] } | string;
    choices?: string[];
  } & Record<string, unknown>;

  switch (e.type) {
    case 'stream': {
      if (!streaming || e.sessionId !== currentSessionId) return;
      streaming.msg.content = e.content ?? '';
      scheduleStreamPaint(streaming, streaming.msg.content);
      break;
    }
    case 'segments': {
      if (!streaming || e.sessionId !== currentSessionId) return;
      const reasoning = (e.segments ?? [])
        .filter((s) => s.kind === 'reasoning')
        .map((s) => s.text)
        .join('\n');
      if (!reasoning) return;
      streaming.msg.reasoning = reasoning;
      if (streaming.reasoning.hidden) {
        streaming.reasoning.hidden = false;
        streaming.reasoning.replaceChildren(thinkingFold(reasoning, false, true));
        streaming.reasoningBody = streaming.reasoning;
      } else {
        scheduleReasoningPaint(streaming, reasoning);
      }
      break;
    }
    case 'tasks': {
        if (!streaming || e.sessionId !== currentSessionId) return;
        liveTasks = e.tasks ?? [];
        renderTodos();
        streaming.msg.tasks = liveTasks;
        const running = liveTasks.find((t) => t.status === 'in_progress');
        setBusyLabel(running ? running.tool || running.title || 'Working' : 'Working');
        scheduleTasksPaint(streaming);
        scheduleInspector();
        break;
      }
    case 'notice': {
      if (!streaming || e.sessionId !== currentSessionId) return;
      streaming.meta.textContent = String((e as { message?: string }).message ?? '');
      break;
    }
    case 'done': {
        cancelStreamPaint();
      if (e.sessionId !== currentSessionId) return;
      const m = e.message as ChatMessage;
      const name = String((e as { name?: unknown }).name ?? '');
      if (name && currentChatName !== name) {
        currentChatName = name;
        chatTitle.textContent = name;
      }
      if (streaming) {
        // Keep the live DOM: re-rendering would collapse the stacks the user
        // just watched build up.
        const textBlock = streaming.current.text ?? ensureText(streaming);
        textBlock.innerHTML = renderMarkdown(m.content);
        const caret = textBlock.querySelector('.caret');
        if (caret) caret.remove();
        streaming.reasoning.querySelector('.fold-title')?.classList.remove('shimmer');
        if (m.reasoningContent && !streaming.msg.reasoning) {
          streaming.reasoning.hidden = false;
          streaming.reasoning.replaceChildren(thinkingFold(m.reasoningContent));
        }
        if (m.error) {
          const err = document.createElement('div');
          err.className = 'err';
          err.textContent = m.error;
          streaming.el.querySelector('.bubble')?.appendChild(err);
        }
        const took = timeLabel(m.durationMs);
        if (took) streaming.meta.textContent = took;
        streaming = null;
      } else {
        const msg: Msg = {
          id: m.id,
          role: 'assistant',
          content: m.content,
          reasoning: m.reasoningContent,
          tasks: m.tasks,
          error: m.error,
          durationMs: m.durationMs,
          usage: m.usage,
          done: true,
        };
        const el = makeMsgEl(msg);
        fillMsg(el, msg);
        thread.appendChild(el);
      }
      currentMessages.push(m);
      liveTasks = m.tasks ?? [];
      finishTurn();
      renderInspector();
      scrollBottom();
      refreshSidebar();
      break;
    }
    case 'error': {
      if (e.sessionId !== currentSessionId) return;
      if (streaming) {
        const err = document.createElement('div');
        err.className = 'err';
        err.textContent = e.error ?? 'The turn failed.';
        streaming.el.querySelector('.bubble')?.appendChild(err);
        streaming = null;
      }
      finishTurn();
      renderInspector();
      break;
    }
    case 'rejected': {
      finishTurn();
      break;
    }
    case 'question': {
      const q = e.question;
      if (typeof q === 'string') showQuestion({ question: q, choices: e.choices });
      else if (q) showQuestion(q);
      break;
    }
    case 'permission': {
      if (e.request) showPermission(e.request);
      break;
    }
  }
}

function setBusyLabel(label: string): void {
  const el = $('#busy-label');
  if (el) el.textContent = label.length > 34 ? label.slice(0, 32) + '…' : label;
  busyPill.classList.toggle('terminal-active', /^(run_shell|run |execute|executing)/i.test(label));
}

function setBusy(on: boolean): void {
  busy = on;
  renderTodos();
  busyPill.classList.toggle('hidden', !on);
  stopBtn.classList.toggle('hidden', !on);
  setBusyLabel('Working');
  paintUltra();
  syncSend();
  renderInspector();
}

/** UltraCode only glows while it is actually working. */
function paintUltra(): void {
  document.documentElement.dataset.ultra = busy && effort.effort === 'UltraCode' ? 'on' : 'off';
}

function finishTurn(): void {
  setBusy(false);
}

// ---------------------------------------------------------------------------
// Overlays: question, permission
// ---------------------------------------------------------------------------

function closeOverlay(): void {
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
}

function showQuestion(q: { question: string; choices?: string[] }): void {
  overlay.innerHTML = `
    <div class="overlay-card">
      <h2 class="overlay-heading">${esc(q.question)}</h2>
      <div class="overlay-actions" data-a="opts"></div>
      <div class="overlay-actions writein-row">
        <input id="writein" class="text-input" placeholder="or type your own answer…" />
        <button class="btn btn-primary" id="writein-btn">Send</button>
      </div>
    </div>`;
  overlay.classList.remove('hidden');
  const opts = overlay.querySelector('[data-a="opts"]') as HTMLElement;
  for (const c of q.choices ?? []) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = c;
    b.onclick = () => {
      closeOverlay();
      api.answerQuestion(c);
    };
    opts.appendChild(b);
  }
  const skip = document.createElement('button');
  skip.className = 'btn btn-ghost skip';
  skip.textContent = 'Skip';
  skip.onclick = () => {
    closeOverlay();
    api.answerQuestion(undefined);
  };
  opts.appendChild(skip);

  const input = $('#writein') as HTMLInputElement;
  input.onkeydown = (ev) => {
    if (ev.key === 'Enter') ($('#writein-btn') as HTMLElement).click();
  };
  input.focus();
  $('#writein-btn').onclick = () => {
    const v = input.value.trim();
    closeOverlay();
    api.answerQuestion(v || undefined);
  };
}

function showPermission(r: {
  id: string;
  type: string;
  target: string;
  description: string;
  rememberScope?: string;
}): void {
  overlay.innerHTML = `
    <div class="overlay-card">
      <h2 class="overlay-heading">Allow this action?</h2>
      <div class="overlay-body">
        <div class="perm-type">${esc(r.type)}${r.rememberScope ? `<span class="perm-scope">${esc(r.rememberScope)}</span>` : ''}</div>
        <div class="perm-path">${esc(r.description || r.target)}</div>
      </div>
      <div class="overlay-actions" data-a="acts"></div>
    </div>`;
  overlay.classList.remove('hidden');
  const acts = overlay.querySelector('[data-a="acts"]') as HTMLElement;
  const mk = (label: string, cls: string, fn: () => void) => {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.onclick = fn;
    acts.appendChild(b);
  };
  mk('Deny', 'btn-danger', () => {
    closeOverlay();
    api.answerPermission(r.id, false, false);
  });
  mk('Allow once', '', () => {
    closeOverlay();
    api.answerPermission(r.id, true, false);
  });
  if (r.rememberScope) {
    mk('Always allow', 'btn-primary', () => {
      closeOverlay();
      api.answerPermission(r.id, true, true);
    });
  }
  (acts.querySelector('.btn-primary, .btn:last-child') as HTMLElement | null)?.focus();
}

// ---------------------------------------------------------------------------
// Popovers: chat actions, reasoning effort
// ---------------------------------------------------------------------------

interface MenuItem {
  label: string;
  icon?: string;
  hint?: string;
  danger?: boolean;
  checked?: boolean;
  onSelect: () => void;
}

function closeMenu(): void {
  ctxMenu.classList.add('hidden');
  ctxMenu.innerHTML = '';
  for (const btn of $$('[data-menu-anchor="true"]')) btn.setAttribute('data-menu-anchor', 'false');
}

function openMenu(x: number, y: number, items: MenuItem[], anchor?: HTMLElement): void {
  ctxMenu.innerHTML = items
    .map(
      (it, i) =>
        `<button class="ctx-item${it.danger ? ' danger' : ''}" role="menuitem" data-i="${i}">` +
        `<span class="ctx-icon">${it.icon ? icon(it.icon as never) : ''}</span>` +
        `<span class="ctx-label">${esc(it.label)}</span>` +
        `${it.hint ? `<span class="ctx-hint">${esc(it.hint)}</span>` : ''}` +
        `${it.checked ? `<span class="ctx-check">${icon('check')}</span>` : ''}` +
        '</button>',
    )
    .join('');
  ctxMenu.classList.remove('hidden');

  // Measure, then clamp inside the window.
  const box = ctxMenu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - box.width - 12);
  const top = Math.min(y, window.innerHeight - box.height - 12);
  ctxMenu.style.left = `${Math.max(12, left)}px`;
  ctxMenu.style.top = `${Math.max(12, top)}px`;

  anchor?.setAttribute('data-menu-anchor', 'true');
  ctxMenu.querySelectorAll<HTMLElement>('.ctx-item').forEach((btn) => {
    btn.onclick = () => {
      const item = items[Number(btn.dataset.i)];
      closeMenu();
      item?.onSelect();
    };
  });
}

function openChatMenu(meta: ChatMeta, x: number, y: number): void {
  const isPinned = pinned.has(meta.id);
  openMenu(x, y, [
    { label: 'Rename', icon: 'compose', onSelect: () => startRename(meta.id) },
    {
      label: isPinned ? 'Unpin' : 'Pin',
      icon: 'pin',
      hint: isPinned ? '' : 'Keep at the top',
      onSelect: () => {
        if (isPinned) pinned.delete(meta.id);
        else pinned.add(meta.id);
        writeJSON(PIN_KEY, [...pinned]);
        renderSidebar();
      },
    },
    {
      label: 'Delete',
      icon: 'trash',
      danger: true,
      onSelect: async () => {
        await api.deleteChat(meta.id);
        if (meta.id === currentSessionId) newChat();
        await refreshSidebar();
      },
    },
  ]);
}

const effortPop = document.getElementById('effort-pop') as HTMLElement;

const EFFORT_HINTS: Record<string, string> = {
  Eco: 'Lower token use · thinking off for this chat',
  Off: 'No reasoning',
  Low: 'Fastest',
  Medium: 'Balanced',
  High: 'Default',
  XHigh: 'Max depth',
  UltraCode: 'Highest effort with subagents',
};

/** XHigh is the engine's top step; the picker calls it what users call it. */
const EFFORT_LABEL: Record<string, string> = { XHigh: 'Max' };
const effortLabel = (level: string): string => EFFORT_LABEL[level] ?? level;

function openEffortMenu(): void {
  const levels = effort.levels.length ? effort.levels : ['Off'];
  const index = Math.max(0, levels.indexOf(effort.effort));
  const rect = effortChip.getBoundingClientRect();
  effortPop.innerHTML = `
    <div class="pop-head">
      <span class="pop-title">Reasoning effort</span>
      <span class="pop-value" id="effort-value">${esc(effortLabel(levels[index]))}</span>
    </div>
    <div class="pop-track">
      <input id="effort-range" type="range" min="0" max="${levels.length - 1}" step="0.01"
        value="${index}" aria-label="Reasoning effort"
        ${levels.length < 2 ? 'disabled' : ''}
        style="--fill:${(index / Math.max(1, levels.length - 1)) * 100}%" />
    </div>
    <div class="effort-stops" style="--stops:${levels.length}">
      ${levels.map((level, position) => `<button type="button" data-position="${position}">${esc(effortLabel(level))}</button>`).join('')}
    </div>
    <div class="pop-notes" id="effort-note">${esc(EFFORT_HINTS[levels[index]] ?? '')}</div>`;
  effortPop.style.bottom = `${window.innerHeight - rect.top + 10}px`;
  effortPop.classList.remove('hidden');
  effortPop.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - effortPop.offsetWidth - 12))}px`;
  effortChip.setAttribute('aria-expanded', 'true');

  const range = document.getElementById('effort-range') as HTMLInputElement;
  const value = document.getElementById('effort-value') as HTMLElement;
  const note = document.getElementById('effort-note') as HTMLElement;
  const stops = Array.from(effortPop.querySelectorAll<HTMLButtonElement>('[data-position]'));
  const paint = (): void => {
    const raw = Number(range.value);
    const nearest = Math.max(0, Math.min(levels.length - 1, Math.round(raw)));
    range.style.setProperty('--fill', `${(raw / Math.max(1, levels.length - 1)) * 100}%`);
    value.textContent = effortLabel(levels[nearest] ?? levels[0]);
    range.setAttribute('aria-valuetext', value.textContent);
    stops.forEach((stop, position) => stop.setAttribute('aria-pressed', String(nearest === position)));
    note.textContent = EFFORT_HINTS[levels[nearest]] ?? '';
  };
  range.oninput = paint;
  range.onkeydown = (event) => {
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    range.value = String(Math.max(0, Math.min(levels.length - 1, Math.round(Number(range.value)) + direction)));
    range.dispatchEvent(new Event('change'));
  };
  range.onchange = () => {
    const nearest = Math.max(0, Math.min(levels.length - 1, Math.round(Number(range.value))));
    range.value = String(nearest);
    paint();
    void setEffort(levels[nearest]);
  };
  for (const stop of stops) {
    stop.onclick = () => {
      range.value = stop.dataset.position ?? '0';
      range.dispatchEvent(new Event('change'));
    };
  }
  paint();
  if (levels.length > 1) range.focus();
  else stops[0]?.focus();
}

function closeEffortPop(): void {
  effortPop.classList.add('hidden');
  effortPop.innerHTML = '';
  effortChip.setAttribute('aria-expanded', 'false');
}

async function setEffort(level: string): Promise<void> {
  try {
    if (!currentSessionId && !(await ensureChatForAttach())) return;
    effort = await api.setEffort(level);
  } catch {
    effort = { ...effort, effort: level };
  }
  // Deliberately stays open: closing on release made the control feel broken.
  paintEffort();
  paintEco();
  renderInspector();
}

function paintEco(): void {
  document.documentElement.dataset.eco = String(effort.effort === 'Eco');
}

async function refreshEffort(): Promise<void> {
  try {
    const cfg = await api.getConfig();
    if (cfg.effort || cfg.levels) effort = { effort: cfg.effort ?? effort.effort, levels: cfg.levels ?? effort.levels };
  } catch {
    /* keep the current picker state */
  }
  paintEffort();
}

function paintEffort(): void {
  effortName.textContent = effortLabel(effort.effort);
  effortChip.title = `Reasoning effort: ${effort.effort}`;
  effortChip.classList.toggle('muted', effort.effort === 'Off');
  paintUltra();
}

// ---------------------------------------------------------------------------
// Sidebar: projects with their chats
// ---------------------------------------------------------------------------

const CHAT_ORDER_KEY = 'ruqen.chatOrder';
let chatOrder: string[] = (() => {
  try {
    const raw = localStorage.getItem(CHAT_ORDER_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
})();
let draggingChat: string | null = null;

function sortChats(list: ChatMeta[]): ChatMeta[] {
  return [...list].sort((a, b) => {
    const pa = pinned.has(a.id) ? 1 : 0;
    const pb = pinned.has(b.id) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    // A hand-placed chat keeps its slot; everything else stays newest-first.
    const ia = chatOrder.indexOf(a.id);
    const ib = chatOrder.indexOf(b.id);
    if (ia !== ib) {
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    }
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
}

function moveChat(from: string, to: string): void {
  const order = [...chatOrder];
  for (const chat of sortChats(chatsCache)) if (!order.includes(chat.id)) order.push(chat.id);
  const fromIndex = order.indexOf(from);
  const toIndex = order.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) return;
  order.splice(fromIndex, 1);
  order.splice(toIndex, 0, from);
  chatOrder = order;
  try {
    localStorage.setItem(CHAT_ORDER_KEY, JSON.stringify(chatOrder));
  } catch {
    /* order is a nicety, not worth a crash */
  }
  renderSidebar();
}

// Drag to reorder. Delegated: the sidebar is re-rendered wholesale, so any
// per-row listener would be thrown away on the next paint.
document.addEventListener('dragstart', (ev) => {
  const row = (ev.target as HTMLElement).closest<HTMLElement>('.chat-row[data-chat]');
  const id = row?.dataset.chat;
  if (!row || !id) return;
  draggingChat = id;
  row.classList.add('dragging');
  ev.dataTransfer?.setData('text/plain', id);
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragend', () => {
  draggingChat = null;
  for (const row of $$('.chat-row.dragging, .chat-row.drop-target')) {
    row.classList.remove('dragging', 'drop-target');
  }
});
document.addEventListener('dragover', (ev) => {
  if (!draggingChat) return;
  const row = (ev.target as HTMLElement).closest<HTMLElement>('.chat-row[data-chat]');
  if (!row || row.dataset.chat === draggingChat) return;
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
  for (const other of $$('.chat-row.drop-target')) other.classList.remove('drop-target');
  row.classList.add('drop-target');
});
document.addEventListener('drop', (ev) => {
  if (!draggingChat) return;
  const row = (ev.target as HTMLElement).closest<HTMLElement>('.chat-row[data-chat]');
  const target = row?.dataset.chat;
  if (!target) return;
  ev.preventDefault();
  const from = draggingChat;
  draggingChat = null;
  if (target !== from) moveChat(from, target);
});

// Fluid minimise: collapse the body first, then let the tree re-render.
document.addEventListener(
  'click',
  (ev) => {
    const head = (ev.target as HTMLElement).closest<HTMLElement>('.tree-row.project');
    const project = head?.dataset.project;
    if (!head || !project || !openProjects.has(project)) return;
    // The ⋯ button lives inside the head; leave it to its own handler.
    if ((ev.target as HTMLElement).closest('.tree-more')) return;
    const body = head.closest<HTMLElement>('.tree')?.querySelector<HTMLElement>('.tree-chats');
    if (!body) return;
    ev.preventDefault();
    ev.stopPropagation();
    body.classList.add('collapsing');
    window.setTimeout(() => {
      openProjects.delete(project);
      renderSidebar();
    }, 170);
  },
  true,
);

function chatRow(meta: ChatMeta): string {
  if (renamingId === meta.id) {
    return `<div class="chat-row renaming"><input class="chat-rename" data-rename="${esc(meta.id)}" value="${esc(meta.name)}" spellcheck="false" /></div>`;
  }
  const active = meta.id === currentSessionId ? ' active' : '';
  const pin = pinned.has(meta.id)
    ? `<span class="chat-pin"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l-1 5 3 3v1H7v-1l3-3z"/><path d="M12 13v7"/></svg></span>`
    : '';
  const updated = new Date(meta.updatedAt);
  const date = Number.isFinite(updated.getTime()) ? updated.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const count = `<span class="chat-count">${meta.messageCount || 0} messages<span>${esc(date)}</span></span>`;
  return (
    `<div class="chat-row${active}" data-chat="${esc(meta.id)}" draggable="true" title="${esc(meta.name)}">` +
    `<span class="chat-row-icon" aria-hidden="true">${icon('chats')}</span><span class="chat-summary"><span class="chat-name">${esc(meta.name)}</span>${count}</span>${pin}<button type="button" class="chat-more" data-chat-menu="${esc(meta.id)}" aria-label="Options for ${esc(meta.name)}">${icon('more')}</button></div>`
  );
}

function renderSidebar(): void {
  const projects = [...new Set([...(provProjects ?? []), ...chatsCache.map((c) => c.project).filter(Boolean) as string[]])];
  const needle = filterText.trim().toLowerCase();
  const matches = (c: ChatMeta) => !needle || c.name.toLowerCase().includes(needle);

  // Projects tree: folder → its chats.
  projectsList.innerHTML = projects
    .map((project) => {
      const chats = sortChats(chatsCache.filter((c) => c.project === project && matches(c)));
      const open = openProjects.has(project) || Boolean(needle);
      const active = project === activeProject ? ' active' : '';
      const head =
        `<button class="tree-row project${active}" data-project="${esc(project)}" title="${esc(project)}">` +
        `<span class="tree-chev${open ? ' open' : ''}" aria-hidden="true">${icon('chevron')}</span>` +
        `<span class="tree-icon" aria-hidden="true">${icon('folder')}</span>` +
        `<span class="tree-name">${esc(projectName(project))}</span>` +
        `<span class="tree-count">${chats.length || ''}</span>` +
        `<span class="tree-more" data-project-menu="${esc(project)}">${icon('more')}</span>` +
        '</button>';
      const body = open
        ? `<div class="tree-chats">${chats.length ? chats.map(chatRow).join('') : '<div class="tree-empty">No chats in this project</div>'}</div>`
        : '';
      return `<div class="tree" data-tree="${esc(project)}">${head}${body}</div>`;
    })
    .join('');

  // Everything without a project.
  const loose = sortChats(chatsCache.filter((c) => !c.project && matches(c)));
  chatsList.innerHTML = loose.length
    ? (pinned.size ? '<div class="chat-section-label">Conversations</div>' : '<div class="chat-section-label">Recent conversations</div>') + loose.map(chatRow).join('')
    : `<div class="list-empty">${needle ? 'Nothing matches' : 'No chats yet'}</div>`;

  focusRenamer();
}

let provProjects: string[] | null = null;

function focusRenamer(): void {
  const input = document.querySelector<HTMLInputElement>('.chat-rename');
  if (!input) return;
  input.focus();
  input.select();
  const commit = async () => {
    const value = input.value.trim();
    const chatId = input.dataset.rename;
    renamingId = null;
    if (value && chatId) await api.renameChat(chatId, value);
    await refreshSidebar();
  };
  input.onblur = () => void commit();
  input.onkeydown = (ev) => {
    if (ev.key === 'Enter') void commit();
    if (ev.key === 'Escape') {
      renamingId = null;
      input.onblur = null;
      renderSidebar();
    }
  };
}

function startRename(id: string): void {
  renamingId = id;
  renderSidebar();
}

async function refreshSidebar(): Promise<void> {
  try {
    chatsCache = await api.listChats();
    provProjects = await api.listProjects();
  } catch {
    /* keep the last good list */
  }
  renderSidebar();
}

function setActiveChatRow(): void {
  for (const row of $$('.chat-row')) {
    row.classList.toggle('active', row.dataset.chat === currentSessionId);
  }
}

// ---------------------------------------------------------------------------
// Inspector: what the session has spent and what it is doing
// ---------------------------------------------------------------------------

function aggregate(): { requests: number; input: number; output: number; cost: number; unpriced: number } {
  let requests = 0;
  let input = 0;
  let output = 0;
  let cost = 0;
  let unpriced = 0;
  for (const m of currentMessages) {
    if (m.role !== 'assistant') continue;
    requests += 1;
    const u = m.usage;
    if (u) {
      input += u.inputTokens ?? 0;
      output += u.outputTokens ?? 0;
      cost += (u.costUsd ?? 0) + (u.estimatedCostUsd ?? 0);
      if (u.costUsd === undefined && u.estimatedCostUsd === undefined) unpriced += 1;
    }
  }
  return { requests, input, output, cost, unpriced };
}

function renderInspector(): void {
  renderStats();
  const active = models?.active;
  const provider = active?.provider ?? '';
  const brand = brandFor(provider);
  const totals = aggregate();
  const tasks = liveTasks.length ? liveTasks : currentMessages.at(-1)?.tasks ?? [];
  const toolCalls = tasks.filter((t) => t.kind === 'tool').length;
  const subagents = tasks.filter((t) => t.subagent).length;
  const usageRows: Array<[string, string]> = [
    ['Mode', ($$('#mode-seg .seg.active')[0]?.textContent || 'Approve').trim()],
    ['Effort', effort.effort],
    ['Requests', String(totals.requests)],
    ['Tool calls', toolCalls ? String(toolCalls) : '—'],
    ...(subagents ? ([['Subagents', String(subagents)]] as Array<[string, string]>) : []),
    ['Tokens in', totals.input ? totals.input.toLocaleString() : '—'],
    ['Tokens out', totals.output ? totals.output.toLocaleString() : '—'],
    [totals.unpriced ? 'Cost (partial)' : 'Cost', totals.cost ? money(totals.cost) : '—'],
  ];

  inspectBody.innerHTML = `
    <div class="inspect-block">
      <div class="inspect-model">
        <span class="brand-tile" style="--brand-l:${brand.hex};--brand-d:${brand.hexDark}">${brand.svg}</span>
        <div class="inspect-model-copy">
          <div class="inspect-model-name">${esc(activeModelLabel || 'No model')}</div>
          <div class="inspect-model-provider">${esc(provider || 'not connected')}</div>
        </div>
      </div>
    </div>
    <div class="inspect-block">
      <div class="inspect-label">Usage</div>
      <dl class="inspect-list">
        ${usageRows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
      </dl>
    </div>`;
}

function setInspector(open: boolean): void {
  appEl.classList.toggle('inspect-open', open);
  $('#inspector-btn')?.classList.toggle('active', open);
  $('#inspector-btn')?.setAttribute('aria-expanded', String(open));
  $('#rail-inspector')?.classList.toggle('active', open);
  $('#rail-inspector')?.setAttribute('aria-expanded', String(open));
  if (open) renderInspector();
  try {
    localStorage.setItem('ruqenai.inspector', open ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function toggleInspector(): void {
  setInspector(!appEl.classList.contains('inspect-open'));
}

// ---------------------------------------------------------------------------
// Model sheet
// ---------------------------------------------------------------------------

function positionSheet(): number {
  const rect = modelChip.getBoundingClientRect();
  const width = sheetEl.offsetWidth || 356;
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  sheetEl.style.left = `${left}px`;
  sheetEl.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  sheetEl.style.maxHeight = `${Math.max(220, rect.top - 24)}px`;
  return rect.left + rect.width / 2 - left;
}

function modelSheetHtml(data: ModelList): string {
  const bands = data.groups
    .map((group) => {
      const open = group.id === data.active.provider || data.groups.length === 1;
      const rows = group.models
        .map((m) => {
          const on = group.id === data.active.provider && m.id === data.active.model;
          return (
            `<button class="model-row${on ? ' on' : ''}" data-p="${esc(group.id)}" data-m="${esc(m.id)}">` +
            `<span class="model-check">${on ? icon('check') : ''}</span>` +
            `<span class="model-name">${esc(m.name)}</span>` +
            `${m.ctx ? `<span class="model-ctx">${ctxLabel(m.ctx)}</span>` : ''}` +
            '</button>'
          );
        })
        .join('');
      return (
        `<div class="band${open ? ' open' : ''}" data-band="${esc(group.id)}">` +
        `<button class="band-head" data-toggle-band="${esc(group.id)}" aria-expanded="${open}">` +
        brandTile(group.id, 'sm') +
        `<span class="band-name">${esc(group.name || group.id)}</span>` +
        `<span class="band-count">${group.models.length}</span>` +
        '<span class="band-chev" aria-hidden="true"></span>' +
        '</button>' +
        `<div class="band-models"><div>${rows}</div></div>` +
        '</div>'
      );
    })
    .join('');
  return (
    '<div class="sheet-in">' +
    '<div class="sheet-head"><span class="sheet-title">Model</span>' +
    `<span class="sheet-hint">${data.groups.length} providers</span></div>` +
    `<div class="sheet-body">${bands}</div>` +
    '<div class="sheet-custom">' +
    '<input id="custom-model" class="text-input" type="text" spellcheck="false" autocomplete="off" placeholder="Any model ID…" aria-label="Custom model ID" />' +
    '<button class="ghost-btn" id="custom-model-use" type="button">Use</button>' +
    '</div>' +
    '<div class="sheet-foot"><button class="sheet-link" id="manage-providers">Manage providers</button><span class="sheet-hint">esc</span></div>' +
    '</div>'
  );
}

async function openModelSheet(): Promise<void> {
  if (!sheetEl.classList.contains('hidden')) {
    closeModelSheet();
    return;
  }
  let data: ModelList;
  try {
    data = await api.listModels();
    models = data;
  } catch {
    return;
  }
  models = data;
  if (providerCache.length) {
    const ready = new Set(
      providerCache
        .filter((row) => row.connected && (row.id !== 'litellm' || Boolean((row as { hasKey?: boolean }).hasKey)))
        .map((row) => row.id),
    );
    data = { ...data, groups: data.groups.filter((group) => ready.has(group.id)) };
  }
  sheetEl.innerHTML = modelSheetHtml(data);
  sheetEl.classList.remove('hidden');
  const originX = positionSheet();
  sheetEl.style.setProperty('--ox', `${originX}px`);
  modelChip.setAttribute('aria-expanded', 'true');

  sheetEl.querySelectorAll<HTMLElement>('[data-toggle-band]').forEach((head) => {
    head.onclick = () => {
      const band = head.closest('.band');
      const open = !band?.classList.contains('open');
      band?.classList.toggle('open', Boolean(open));
      head.setAttribute('aria-expanded', String(open));
    };
  });
  sheetEl.querySelectorAll<HTMLElement>('.model-row').forEach((row) => {
    row.onclick = async () => {
      const provider = row.dataset.p || '';
      const model = row.dataset.m || '';
      closeModelSheet();
      await chooseModel(provider, model);
    };
  });
    const customInput = sheetEl.querySelector<HTMLInputElement>('#custom-model');
    const applyCustom = (): void => {
      const id = customInput?.value.trim() ?? '';
      if (!id) return;
      closeModelSheet();
      void chooseModel(models?.active.provider ?? '', id);
    };
    if (customInput) {
      customInput.onkeydown = (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          applyCustom();
        }
      };
    }
    const customUse = sheetEl.querySelector<HTMLElement>('#custom-model-use');
    if (customUse) customUse.onclick = applyCustom;
    const manage = sheetEl.querySelector<HTMLElement>('#manage-providers');
    if (manage) {
      manage.onclick = () => {
        closeModelSheet();
        void openProviders();
      };
    }
  }

function closeModelSheet(): void {
  if (sheetEl.classList.contains('hidden')) return;
  sheetEl.classList.add('hidden');
  sheetEl.innerHTML = '';
  modelChip.setAttribute('aria-expanded', 'false');
}

async function chooseModel(provider: string, model: string): Promise<void> {
  const label = models?.groups.find((g) => g.id === provider)?.models.find((m) => m.id === model)?.name ?? model;
  applyBrand(provider);
  chipMark.innerHTML = brandFor(provider).svg;
  chipName.textContent = label;
  activeModelLabel = label;
  updateChatContext();
  try {
    await api.setModel(provider, model);
      void refreshEffort();
  } catch {
    /* the picker already reflects the choice; a failure shows in the next turn */
  }
  renderInspector();
}

async function refreshModels(): Promise<void> {
  try {
    models = await api.listModels();
  } catch {
    return;
  }
  const active = models.active;
  const group = models.groups.find((g) => g.id === active.provider);
  const model = group?.models.find((m) => m.id === active.model);
  activeModelLabel = model?.name ?? active.model ?? '';
  chipMark.innerHTML = active.provider ? brandFor(active.provider).svg : '';
  chipName.textContent = activeModelLabel || 'Choose a model';
  applyBrand(active.provider);
  updateChatContext();
}

function updateChatContext(): void {
  const bits: string[] = [];
  if (activeProject) bits.push(projectName(activeProject));
  if (activeModelLabel) bits.push(activeModelLabel);
  chatContext.textContent = bits.join(' · ');
}

// ---------------------------------------------------------------------------
// Provider gallery
// ---------------------------------------------------------------------------

function groupedProviders(rows: ProviderRow[]): { category: string; rows: ProviderRow[] }[] {
  const order = ['Local & Edge', 'Frontier & General LLM', 'Open Routers & Hosts', 'Cloud Platforms', 'Custom'];
  const groups = new Map<string, ProviderRow[]>();
  for (const row of rows) {
    const key = row.category || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return [...groups.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a[0].localeCompare(b[0]);
    })
    .map(([category, list]) => ({
      category,
      rows: [...list].sort(
        (a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name),
      ),
    }));
}

function providersShell(): string {
  return (
    '<div class="modal-card">' +
    '<div class="modal-in">' +
    '<div class="modal-left">' +
    '<div class="modal-left-head"><h2 class="modal-title" id="providers-title">Providers</h2>' +
    '<p class="modal-sub" id="providers-sub">Keys stay on this machine</p></div>' +
    '<label class="search"><span class="search-icon" aria-hidden="true">' + icon('search') + '</span>' +
    '<input id="prov-search" type="search" placeholder="Search providers" spellcheck="false" aria-label="Search providers" /></label>' +
    '<div class="modal-list" id="prov-list"></div>' +
    '</div>' +
    '<div class="modal-right" id="prov-detail"></div>' +
    '</div></div>'
  );
}

function renderProviderList(): void {
  const host = $('#prov-list');
  if (!host || !provState) return;
  const rows = provState.filter
    ? provState.rows.filter((r) =>
        (r.name + ' ' + r.description + ' ' + r.id).toLowerCase().includes(provState!.filter.toLowerCase()),
      )
    : provState.rows;
  const groups = groupedProviders(rows);
  host.innerHTML = groups
    .map(
      ({ category, rows: list }) =>
        `<div class="prov-group"><div class="prov-cat">${esc(category)}</div>` +
        list
          .map((r) => {
            const sel = r.id === provState?.selected ? ' sel' : '';
            const state = r.connected
              ? `<span class="prov-dot" style="--bl:${brandFor(r.id).hex};--bd:${brandFor(r.id).hexDark}" title="Connected"></span>`
              : '';
            return (
              `<button class="prov-row${sel}" data-id="${esc(r.id)}">` +
              brandTile(r.id, 'row') +
              `<span class="prov-name">${esc(r.name)}</span>${state}</button>`
            );
          })
          .join('') +
        '</div>',
    )
    .join('');
  host.querySelectorAll<HTMLElement>('.prov-row').forEach((row) => {
    row.onclick = () => selectProvider(row.dataset.id || '');
  });
  const sub = $('#providers-sub');
  if (sub) {
    const connected = provState.rows.filter((r) => r.connected).length;
    sub.textContent = `${connected} connected · keys stay on this machine`;
  }
}

function selectProvider(id: string): void {
  if (!provState) return;
  provState.selected = id;
  // Update in place: rebuilding the list replayed the entry animation and made
  // every row blink on each click.
  for (const row of $$('.prov-row')) row.classList.toggle('sel', row.dataset.id === id);
  renderProviderDetail();
}

function renderProviderDetail(): void {
  const pane = $('#prov-detail');
  if (!pane || !provState) return;
  const row = provState.rows.find((r) => r.id === provState?.selected);
  if (!row) {
    pane.innerHTML = '<div class="detail-empty">Pick a provider to connect it.</div>';
    return;
  }
  const brand = brandFor(row.id);
  const needsKey = row.requiresKey;
  const wantsEndpoint = row.connection === 'endpoint' || row.isLocal || row.id === 'custom';
  pane.innerHTML = `
    <button class="detail-close" id="prov-close" title="Close" aria-label="Close">${icon('close')}</button>
    <div class="detail-head">
      <span class="brand-tile lg" style="--brand-l:${brand.hex};--brand-d:${brand.hexDark}">${brand.svg}</span>
      <div>
        <h3 class="detail-name">${esc(row.name)}</h3>
        <p class="detail-desc">${esc(row.description)}</p>
      </div>
    </div>
    <div class="detail-pills">
      <span class="pill${row.connected ? ' live' : ''}"><span class="status-dot"></span>${row.connected ? 'Connected' : 'Not connected'}</span>
      <span class="pill">${row.modelCount} model${row.modelCount === 1 ? '' : 's'}</span>
      ${row.isLocal ? '<span class="pill">Runs locally</span>' : ''}
    </div>
    <div class="detail-form">
      ${
        needsKey
          ? `<label class="field"><span class="field-label">API key</span>
             <input class="text-input" id="prov-key" type="password" placeholder="${row.hasKey ? 'Saved — paste a new key to replace' : 'Paste your API key'}" autocomplete="off" spellcheck="false" />
             <span class="field-hint">Written to ~/.ruqenai/env on this machine.</span></label>`
          : `<p class="detail-note">${row.isLocal ? 'No key needed — Ruqenai talks to the local runtime.' : 'Set this provider up once and it is reused for every chat.'}</p>`
      }
      ${
        wantsEndpoint
          ? `<label class="field"><span class="field-label">Endpoint</span>
             <input class="text-input" id="prov-endpoint" type="text" spellcheck="false"
               placeholder="${esc(row.defaultBaseUrl || 'https://…/v1')}" value="${esc(row.endpoint || '')}" />
             <span class="field-hint">${row.defaultBaseUrl ? `Leave blank for ${esc(row.defaultBaseUrl)}` : 'Full base URL, including /v1'}</span></label>`
          : ''
      }
      <div class="detail-actions">
        <button class="btn btn-primary" id="prov-save">${row.connected ? 'Save changes' : 'Connect'}</button>
        ${row.connected ? '<button class="btn btn-danger-ghost" id="prov-disconnect">Disconnect</button>' : ''}
      </div>
      <div class="detail-note" id="prov-note" role="status"></div>
      ${row.models.length ? `<div class="detail-catalog"><div class="field-label">In the catalog</div><div class="chip-list">${row.models.map((m) => `<span class="chip">${esc(m)}</span>`).join('')}</div></div>` : ''}
      ${row.website ? `<a class="detail-link" href="${esc(row.website)}" target="_blank" rel="noreferrer">${icon('link')}${esc(hostOf(row.website))}</a>` : ''}
    </div>`;
  wireProviderDetail(row);
}

function wireProviderDetail(row: ProviderRow): void {
  const note = $('#prov-note');
  const say = (text: string, bad = false) => {
    if (!note) return;
    note.textContent = text;
    note.classList.toggle('bad', bad);
  };
  $('#prov-close')?.addEventListener('click', closeProviders);
  $('#prov-save')?.addEventListener('click', async () => {
    const key = ($('#prov-key') as HTMLInputElement | null)?.value.trim() ?? '';
    const endpoint = ($('#prov-endpoint') as HTMLInputElement | null)?.value.trim();
    const payload: { apiKey?: string; endpoint?: string } = {};
    if (key) payload.apiKey = key;
    if (endpoint !== undefined) payload.endpoint = endpoint;
    const result = await api.connectProvider(row.id, payload);
    if (!result.ok) {
      say(result.error || 'Could not save that.', true);
      return;
    }
    provState!.rows = await api.listProviders();
    providerCache = provState!.rows;
    renderProviderList();
    renderProviderDetail();
    await refreshModels();
    const fresh = provState!.rows.find((r) => r.id === row.id);
    $('#prov-note')?.classList.remove('bad');
    if (fresh && !fresh.connected) say('Saved, but Ruqenai still cannot reach this provider.');
    else say('Connected. Pick a model from the composer when you are ready.');
  });
  $('#prov-disconnect')?.addEventListener('click', async () => {
    const result = await api.disconnectProvider(row.id);
    if (!result.ok) {
      say(result.error || 'Could not disconnect.', true);
      return;
    }
    provState!.rows = await api.listProviders();
    providerCache = provState!.rows;
    renderProviderList();
    renderProviderDetail();
    await refreshModels();
    $('#prov-note')?.classList.remove('bad');
    $('#prov-note')!.textContent = 'Disconnected.';
  });
}

async function openProviders(): Promise<void> {
  if (!modalEl.classList.contains('hidden')) {
    closeProviders();
    return;
  }
  let rows: ProviderRow[];
  try {
    rows = await api.listProviders();
  } catch {
    return;
  }
  providerCache = rows;
  const preferred =
    rows.find((r) => r.connected)?.id ?? rows[0]?.id ?? null;
  provState = { rows, selected: preferred, filter: '' };
  modalEl.innerHTML = providersShell();
  modalEl.classList.remove('hidden');
  renderProviderList();
  renderProviderDetail();
  const search = $('#prov-search') as HTMLInputElement | null;
  if (search) {
    search.oninput = () => {
      provState!.filter = search.value;
      renderProviderList();
    };
    search.focus();
  }
  modalEl.onmousedown = (ev) => {
    if (ev.target === modalEl) closeProviders();
  };
}

function closeProviders(): void {
  if (modalEl.classList.contains('hidden')) return;
  modalEl.classList.add('hidden');
  modalEl.innerHTML = '';
  provState = null;
}

// ---------------------------------------------------------------------------
// Composer and sending
// ---------------------------------------------------------------------------

function autoResize(): void {
  promptEl.style.height = 'auto';
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, 220)}px`;
}

function syncSend(): void {
  sendBtn.disabled = busy || !promptEl.value.trim();
}

function setModeUi(mode: string): void {
  const order = ['ask', 'approve', 'full'];
  const index = Math.max(0, order.indexOf(mode));
  const buttons = $$('#mode-seg .seg');
  buttons.forEach((btn, i) => {
    btn.classList.toggle('active', i === index);
    btn.classList.toggle('on', i === index);
    btn.setAttribute('aria-pressed', String(i === index));
  });
  // Drive the pill from the real button box so the labels can never drift apart.
  const target = buttons[index];
  if (target) {
    segPill.style.transform = 'none';
    segPill.style.left = `${target.offsetLeft}px`;
    segPill.style.width = `${target.offsetWidth}px`;
  }
}

async function send(): Promise<void> {
  const text = promptEl.value.trim();
  if (!text || busy) return;
  promptEl.value = '';
  autoResize();
  syncSend();

  if (!currentSessionId) {
    const chat = await api.createChat(activeProject ?? undefined);
    currentSessionId = chat.id;
    await refreshEffort();
    paintEco();
    currentChatName = chat.name;
    currentMessages = [];
    liveTasks = [];
    renderTodos();
    chatTitle.textContent = chat.name;
    // Keep the hero until the first send so attaching never blanks the page.
    await refreshSidebar();
  }

  const userMsg: Msg = { id: 'local-user', role: 'user', content: text, done: true };
  const userEl = makeMsgEl(userMsg);
  fillMsg(userEl, userMsg);
  thread.appendChild(userEl);

  hideEmpty();
  streaming = startStreaming();
  setBusy(true);
  scrollBottom();

  // The engine names an untitled chat itself from the first prompt (an LLM
  // call); the new name arrives with the done event.

  try {
    await api.sendPrompt(currentSessionId, text);
      attached = [];
      renderAttachTray();
  } catch (err) {
    if (streaming) {
      const box = document.createElement('div');
      box.className = 'err';
      box.textContent = err instanceof Error ? err.message : String(err);
      streaming.el.querySelector('.bubble')?.appendChild(box);
      streaming = null;
    }
    finishTurn();
  }
}

// ---------------------------------------------------------------------------
// Attachments: drag-drop, paste, picker. Queued on the session like /attach.
// ---------------------------------------------------------------------------

const attachTray = $('#attach-tray');
let attached: Array<{ name: string; path: string; preview?: string }> = [];

function renderAttachTray(): void {
  if (!attachTray) return;
  if (!attached.length) {
    attachTray.classList.add('hidden');
    attachTray.innerHTML = '';
    return;
  }
  attachTray.classList.remove('hidden');
  attachTray.innerHTML = attached
    .map(
      (file) =>
        `<span class="attach-chip" data-path="${esc(file.path)}" title="${esc(file.name)}">` +
        (file.preview
          ? `<span class="attach-thumb"><img src="${file.preview}" alt="" /></span>`
          : `<span class="attach-doc" aria-hidden="true">${esc((file.name.split('.').pop() ?? 'file').slice(0, 4).toUpperCase())}</span>`) +
        `<span class="attach-name">${esc(file.name)}</span>` +
        `<button type="button" class="attach-x" data-path="${esc(file.path)}" aria-label="Remove ${esc(file.name)}"></button>` +
        '</span>',
    )
    .join('');
  for (const btn of $$('#attach-tray .attach-x')) {
    btn.onclick = () => {
      const filePath = btn.dataset.path ?? '';
      attached = attached.filter((file) => file.path !== filePath);
      renderAttachTray();
      if (currentSessionId) void api.attachRemove(currentSessionId, filePath);
    };
  }

  for (const chip of $$('#attach-tray .attach-chip') as unknown as HTMLElement[]) {
    chip.addEventListener('click', (ev: MouseEvent) => {
      if ((ev.target as HTMLElement).closest('.attach-x')) return;
      const filePath = chip.dataset.path ?? '';
      const hit = attached.find((entry) => entry.path === filePath);
      if (hit) openAttachPreview(hit);
    });
  }
}

function openAttachPreview(file: { name: string; path: string; preview?: string }): void {
  const overlay = document.createElement('div');
  overlay.className = 'attach-preview';
  overlay.innerHTML =
    '<div class="attach-preview-card" role="dialog" aria-label="Attachment preview">' +
    '<div class="attach-preview-head"><span>' + esc(file.name) + '</span>' +
    '<button type="button" class="attach-preview-x" aria-label="Close"></button></div>' +
    (file.preview
      ? '<img class="attach-preview-img" src="' + file.preview + '" alt="' + esc(file.name) + '" />'
      : '<div class="attach-preview-empty shimmer">Preparing preview</div>') +
    '</div>';
  document.body.appendChild(overlay);
  if (!file.preview && currentSessionId) {
    void api.previewArtifact(currentSessionId, file.path).then((result) => {
      const body = overlay.querySelector('.attach-preview-empty');
      if (!body) return;
      body.classList.remove('shimmer');
      if (result.kind === 'image') body.innerHTML = `<img class="attach-preview-img" src="${result.content}" alt="${esc(result.name)}">`;
      else { body.innerHTML = ''; const pre = document.createElement('pre'); pre.textContent = result.content; body.append(pre); }
    }).catch((error) => {
      const body = overlay.querySelector('.attach-preview-empty');
      if (body) { body.classList.remove('shimmer'); body.textContent = error instanceof Error ? error.message : String(error); }
    });
  }
  const close = (): void => overlay.remove();
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });
  overlay.querySelector('.attach-preview-x')?.addEventListener('click', close);
  const onEsc = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    document.removeEventListener('keydown', onEsc);
    close();
  };
  document.addEventListener('keydown', onEsc);
}

async function refreshAttach(): Promise<void> {
  if (!currentSessionId) {
    attached = [];
    renderAttachTray();
    return;
  }
  try {
    attached = await api.attachList(currentSessionId);
  } catch {
    attached = [];
  }
  renderAttachTray();
}

async function ensureChatForAttach(): Promise<boolean> {
  if (currentSessionId) return true;
  try {
    const chat = await api.createChat(activeProject ?? undefined);
    currentSessionId = chat.id;
    await refreshEffort();
    paintEco();
    currentChatName = chat.name;
    chatTitle.textContent = chat.name;
    await refreshSidebar();
    return true;
  } catch {
    return false;
  }
}

async function attachPaths(paths: string[]): Promise<void> {
  if (!paths.length) return;
  if (!(await ensureChatForAttach())) return;
  for (const filePath of paths.slice(0, 10)) {
    try {
      await api.attachFile(currentSessionId ?? '', filePath);
    } catch {
      /* attachment list stays truthful; the failed file simply never appears */
    }
  }
  await refreshAttach();
}

async function stagePasted(name: string, base64: string): Promise<void> {
  if (!(await ensureChatForAttach())) return;
  try {
    await api.attachRaw(currentSessionId ?? '', { name, data: base64 });
  } catch {
    return;
  }
  await refreshAttach();
}

async function acceptDroppedFiles(files: File[]): Promise<void> {
  const paths: string[] = [];
  for (const file of files.slice(0, 10)) {
    let filePath = '';
    try {
      filePath = api.pathForFile(file);
    } catch {
      filePath = '';
    }
    if (filePath) {
      paths.push(filePath);
      continue;
    }
    // No filesystem path (an image dragged out of a browser, say): stage bytes.
      {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const raw = String(reader.result ?? '');
          resolve(raw.slice(raw.indexOf(',') + 1));
        };
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });
      if (base64) await stagePasted(file.name || 'pasted.png', base64);
    }
  }
  if (paths.length) await attachPaths(paths);
}

function wireAttach(): void {
  const composerBox = $('#composer-box');
  const dropEls = [composerBox, thread, scroller];
  const hasFiles = (ev: DragEvent): boolean =>
    Boolean(ev.dataTransfer && Array.from(ev.dataTransfer.types).includes('Files'));

  for (const el of dropEls) {
    el.addEventListener('dragover', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      composerBox.classList.add('drop-on');
    });
    el.addEventListener('dragleave', (ev) => {
      if (ev.target === el) composerBox.classList.remove('drop-on');
    });
    el.addEventListener('drop', (ev) => {
      ev.preventDefault();
      composerBox.classList.remove('drop-on');
      const files = Array.from(ev.dataTransfer?.files ?? []);
      if (files.length) void acceptDroppedFiles(files);
    });
  }
  // Keep the default file-open behaviour out of the window.
  window.addEventListener('dragover', (ev) => ev.preventDefault());
  window.addEventListener('drop', (ev) => ev.preventDefault());

  promptEl.addEventListener('paste', (ev) => {
    const items = Array.from(ev.clipboardData?.items ?? []);
    const pastedFiles = items
      .filter((item) => item.kind === 'file' && !item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (pastedFiles.length) {
      ev.preventDefault();
      void acceptDroppedFiles(pastedFiles);
      return;
    }
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    if (!imageItem) return; // text paste flows into the textarea untouched
    ev.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? '');
      void stagePasted(file.name || 'pasted.png', raw.slice(raw.indexOf(',') + 1));
    };
    reader.onerror = () => undefined;
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Chat lifecycle
// ---------------------------------------------------------------------------

function newChat(): void {
  currentSessionId = null;
  document.documentElement.dataset.eco = 'false';
  void api.getConfig().then(cfg => {
    if (currentSessionId) return;
    if (cfg.defaultEffort) effort = { ...effort, effort: cfg.defaultEffort };
    paintEffort();
  }).catch(() => {});
  activeProject = null;
  currentChatName = '';
  currentMessages = [];
  liveTasks = [];
  renderTodos();
  attached = [];
  renderAttachTray();
  thread.innerHTML = '';
  chatTitle.textContent = 'New chat';
  updateChatContext();
  showEmpty(nextScene());
  setActiveChatRow();
  renderInspector();
  void updateWorkspaceChip();
  promptEl.focus();
}

async function openChat(id: string): Promise<void> {
  let data: { id: string; name: string; project: string | null; messages: ChatMessage[]; effort?: EffortState };
  try {
    data = await api.openChat(id);
  } catch {
    return;
  }
  closeModelSheet();
  currentSessionId = data.id;
  if (data.effort) { effort = data.effort; paintEffort(); paintEco(); }
  currentChatName = data.name;
  currentMessages = data.messages ?? [];
  liveTasks = currentMessages.at(-1)?.tasks ?? [];
  setTodosOpen(false);
  renderTodos();
  void refreshAttach();
  chatTitle.textContent = currentMessages.length ? data.name : 'New chat';
  if (data.project) {
    activeProject = data.project;
    updateChatContext();
  }
  thread.innerHTML = '';
  if (!currentMessages.length) {
    showEmpty();
  } else {
    hideEmpty();
      const buildable = currentMessages.filter((m) => m.role === 'user' || m.role === 'assistant');
      const build = (m: ChatMessage): HTMLElement => {
        const msg: Msg = {
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          reasoning: m.reasoningContent,
          tasks: m.tasks,
          error: m.error,
          durationMs: m.durationMs,
          usage: m.usage,
          done: true,
        };
        const el = makeMsgEl(msg);
        fillMsg(el, msg);
        return el;
      };
      // Paint the tail first — what you actually look at — then backfill older
      // turns in idle slices, keeping the scroll anchored where it already is.
      const tailStart = Math.max(0, buildable.length - 40);
      for (let i = tailStart; i < buildable.length; i += 1) thread.appendChild(build(buildable[i]));
      scrollBottom();
      let cursor = tailStart - 1;
      const backfill = () => {
        const started = performance.now();
        let made = 0;
        while (cursor >= 0 && made < 20 && performance.now() - started < 8) {
          const el = build(buildable[cursor]);
          const before = scroller.scrollHeight;
          thread.insertBefore(el, thread.firstChild);
          scroller.scrollTop += scroller.scrollHeight - before;
          cursor -= 1;
          made += 1;
        }
        if (cursor >= 0) window.setTimeout(backfill, 0);
      };
      if (cursor >= 0) window.setTimeout(backfill, 0);
  }
  setActiveChatRow();
  renderInspector();
  promptEl.focus();
  // On a narrow window the ledger is a drawer; close it once a chat is chosen.
  if (window.innerWidth <= 1080) setPanel(false);
}

// ---------------------------------------------------------------------------
// Theme and chrome
// ---------------------------------------------------------------------------

function initTheme(): void {
  const stored = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(stored === 'ink' || stored === 'porcelain' ? stored : prefersDark ? 'ink' : 'porcelain', false);
}

function setTheme(theme: string, persist = true): void {
  const apply = () => {
    document.documentElement.dataset.theme = theme;
    const btn = $('#rail-theme');
    if (btn) btn.innerHTML = theme === 'ink' ? icon('sun') : icon('moon');
    api.setTitlebarTone?.(theme);
  };
  if (persist) {
    const startViewTransition = (document as unknown as { startViewTransition?: (cb: () => void) => void })
      .startViewTransition;
    if (startViewTransition) startViewTransition.call(document, apply);
    else apply();
  } else {
    apply();
  }
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }
}

function toggleTheme(): void {
  setTheme(document.documentElement.dataset.theme === 'ink' ? 'porcelain' : 'ink');
}

function setPanel(open: boolean): void {
  appEl.classList.toggle('panel-open', open);
  appEl.classList.toggle('panel-hidden', !open);
  const btn = $('#rail-chats');
  btn?.classList.toggle('active', open);
  btn?.setAttribute('aria-expanded', String(open));
  try {
    localStorage.setItem(PANEL_KEY, open ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function initPanel(): void {
  const stored = localStorage.getItem(PANEL_KEY);
  // Under 1080px the panel is a drawer, so it starts closed and only opens on
  // request — otherwise it covers the thread it is meant to navigate.
  const wide = window.innerWidth > 1080;
  setPanel(stored === null ? wide : stored === '1' && wide);
}

// ---------------------------------------------------------------------------
// @ mentions — files, skills, MCP servers
// ---------------------------------------------------------------------------

interface MentionItem {
  kind: string;
  label: string;
  summary: string;
}

const mentionEl = document.getElementById('mentions') as HTMLElement;
const MENTION_ORDER = ['skill', 'mcp', 'plugin', 'file'];
const MENTION_TITLES: Record<string, string> = {
  skill: 'Skills',
  mcp: 'MCP servers',
  plugin: 'Plugins',
  file: 'Files',
};
let mentionItems: MentionItem[] = [];
let mentionIndex = 0;
let mentionSeq = 0;

function currentMentionQuery(): { start: number; query: string } | null {
  const caret = promptEl.selectionStart ?? promptEl.value.length;
  const before = promptEl.value.slice(0, caret);
  const match = /(^|\s)@([\w./@:-]*)$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
}

function startMention(): void {
  const start = promptEl.selectionStart ?? promptEl.value.length;
  const end = promptEl.selectionEnd ?? start;
  const before = promptEl.value.slice(0, start);
  const pad = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  promptEl.value = `${before}${pad}@${promptEl.value.slice(end)}`;
  const pos = start + pad.length + 1;
  promptEl.setSelectionRange(pos, pos);
  autoResize();
  syncSend();
  void refreshMentions();
}

function showMentions(): void {
  const rect = promptEl.getBoundingClientRect();
  mentionEl.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 460 - 12))}px`;
  mentionEl.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  mentionEl.classList.remove('hidden');
}

function closeMentions(): void {
  mentionEl.classList.add('hidden');
  mentionEl.innerHTML = '';
  mentionItems = [];
  mentionIndex = 0;
}

function renderMentions(): void {
  if (!mentionItems.length) {
    mentionEl.innerHTML =
      '<div class="mention-empty">Nothing matched. Try a file path, or @skill: to list skills.</div>';
    return;
  }
  let html = '';
  let cursor = 0;
  for (const kind of MENTION_ORDER) {
    const rows = mentionItems.filter((item) => item.kind === kind);
    if (!rows.length) continue;
    const glyph = kind === 'file' ? icon('folder') : kind === 'mcp' ? icon('plug') : icon('terminal');
    html += `<div class="mention-group">${MENTION_TITLES[kind] ?? kind}</div>`;
    for (const item of rows) {
      const pos = cursor++;
      html += `<button type="button" class="mention${pos === mentionIndex ? ' on' : ''}" data-mention="${pos}">
        <span class="mention-glyph">${glyph}</span>
        <span class="mention-label">${esc(item.label)}</span>
        ${item.summary ? `<span class="mention-sub">${esc(item.summary)}</span>` : ''}
      </button>`;
    }
  }
  mentionEl.innerHTML = html;
  mentionEl.querySelector<HTMLElement>('.mention.on')?.scrollIntoView({ block: 'nearest' });
}

async function refreshMentions(): Promise<void> {
  const token = currentMentionQuery();
  if (!token) {
    closeMentions();
    return;
  }
  const seq = ++mentionSeq;
  let data: { extensions: MentionItem[]; files: MentionItem[] } = { extensions: [], files: [] };
  try {
    data = await api.suggestMentions(token.query, activeProject ?? undefined);
  } catch {
    data = { extensions: [], files: [] };
  }
  if (seq !== mentionSeq) return;
  const rank = (kind: string): number => {
    const index = MENTION_ORDER.indexOf(kind);
    return index === -1 ? MENTION_ORDER.length : index;
  };
  mentionItems = [...(data.extensions ?? []), ...(data.files ?? [])].sort(
    (a, b) => rank(a.kind) - rank(b.kind),
  );
  mentionIndex = 0;
  renderMentions();
  showMentions();
}

function applyMention(item: MentionItem): void {
  const token = currentMentionQuery();
  const caret = promptEl.selectionStart ?? promptEl.value.length;
  const start = token ? token.start : caret;
  promptEl.value = `${promptEl.value.slice(0, start)}${item.label} ${promptEl.value.slice(caret)}`;
  const pos = start + item.label.length + 1;
  promptEl.setSelectionRange(pos, pos);
  closeMentions();
  autoResize();
  syncSend();
  promptEl.focus();
}

function mentionKey(ev: KeyboardEvent): boolean {
  if (mentionEl.classList.contains('hidden')) return false;
  if (ev.key === 'Escape') {
    closeMentions();
    return true;
  }
  if (!mentionItems.length) return false;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    const step = ev.key === 'ArrowDown' ? 1 : -1;
    mentionIndex = (mentionIndex + step + mentionItems.length) % mentionItems.length;
    renderMentions();
    return true;
  }
  if (ev.key === 'Enter' || ev.key === 'Tab') {
    ev.preventDefault();
    const item = mentionItems[mentionIndex];
    if (item) applyMention(item);
    return true;
  }
  return false;
}

mentionEl.addEventListener('mousedown', (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-mention]');
  if (!btn) return;
  ev.preventDefault();
  const item = mentionItems[Number(btn.dataset.mention ?? '-1')];
  if (item) applyMention(item);
});

// ---------------------------------------------------------------------------
// Workspace chip — project name and git branch beside the composer
// ---------------------------------------------------------------------------

async function updateWorkspaceChip(): Promise<void> {
  const chip = document.getElementById('workspace-chip');
  if (!chip) return;
  let info: { isRepo: boolean; branch: string | null; name: string } | null = null;
  try {
    info = await api.gitInfo(activeProject ?? undefined);
  } catch {
    info = null;
  }
  if (!info || !info.name) {
    chip.classList.add('hidden');
    return;
  }
  chip.innerHTML =
    info.isRepo && info.branch
      ? `${icon('branch')}<b>${esc(info.name)}</b><span class="ws-sep">/</span><span>${esc(info.branch)}</span>`
      : `${icon('folder')}<b>${esc(info.name)}</b>`;
  chip.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Overlay docking — prompts sit above the composer, not over the whole window
// ---------------------------------------------------------------------------

function watchComposerDock(): void {
  const composer = document.getElementById('composer');
  const overlay = document.getElementById('overlay');
  if (!composer || !overlay) return;
  const sync = (): void => {
    overlay.style.setProperty('--dock', `${Math.round(composer.offsetHeight + 8)}px`);
  };
  new ResizeObserver(sync).observe(composer);
  window.addEventListener('resize', sync);
  sync();
}

// ---------------------------------------------------------------------------
// Manage window — skills, MCP servers, plugins, models, appearance, tuning
// ---------------------------------------------------------------------------

type ManageTab =
  | 'overview'
  | 'skills'
  | 'mcp'
  | 'plugins'
  | 'models'
  | 'defaults'
  | 'colors'
  | 'temperature'
  | 'compact'
  | 'shortcuts';

interface ManageConfig {
  temperature?: number;
  autoCompact?: boolean;
  compactThreshold?: number;
}

const MANAGE_GROUPS: Array<{ label: string; tabs: Array<[ManageTab, string]> }> = [
  { label: 'General', tabs: [['overview', 'Overview'], ['colors', 'Appearance'], ['shortcuts', 'Shortcuts']] },
  { label: 'Chat', tabs: [['models', 'Models'], ['defaults', 'Defaults'], ['temperature', 'Temperature'], ['compact', 'Auto compact']] },
  { label: 'Extensions', tabs: [['skills', 'Skills'], ['mcp', 'MCP servers'], ['plugins', 'Plugins']] },
];

const manageApi = api as unknown as {
  readManage(): Promise<ManageConfig>;
  setTemperature(value: number): Promise<{ ok: boolean; temperature?: number }>;
  setCompact(payload: {
    autoCompact?: boolean;
    compactThreshold?: number;
  }): Promise<{ ok: boolean; autoCompact?: boolean; compactThreshold?: number }>;
};

let manageEl: HTMLElement | null = null;
let manageTab: ManageTab = 'colors';

function manageShell(): HTMLElement {
  if (manageEl) return manageEl;
  const el = document.createElement('div');
  el.id = 'manage-modal';
  el.className = 'modal hidden';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Manage');
  el.innerHTML =
    '<div class="modal-card manage-card"><div class="modal-in manage">' +
    '<aside class="manage-tabs" id="manage-tabs"></aside>' +
    '<div class="manage-content"><h2 id="manage-section-title"></h2><section class="manage-pane" id="manage-pane"></section></div>' +
    '</div><button id="manage-close" class="modal-close" aria-label="Close"></button></div>';
  document.body.appendChild(el);
  el.addEventListener('mousedown', (ev) => {
    if (ev.target === el) closeManage();
  });
  manageEl = el;
  return el;
}

function closeManage(): void {
  manageEl?.classList.add('hidden');
  for (const preview of scenePreviews) preview.stop();
  scenePreviews = [];
  applyHomeBg();
}

function renderManageTabs(): void {
  const host = document.getElementById('manage-tabs');
  if (!host) return;
  host.innerHTML =
    '<div class="manage-heading">Manage</div>' +
    MANAGE_GROUPS.map(
      ({ label, tabs }) => `<div class="manage-nav-group"><div class="manage-nav-label">${label}</div>` +
        tabs.map(([id, title]) =>
          `<button type="button" class="manage-tab${id === manageTab ? ' on' : ''}" data-tab="${id}"${id === manageTab ? ' aria-current="true"' : ''}>${title}</button>`,
        ).join('') + '</div>',
    ).join('');
  for (const btn of $$('#manage-tabs .manage-tab')) {
    btn.onclick = () => {
      const next = btn.dataset.tab as ManageTab | undefined;
      if (!next || next === manageTab) return;
      manageTab = next;
      renderManageTabs();
      void renderManagePane();
    };
  }
}

function manageEmpty(text: string): string {
  return `<div class="manage-empty">${esc(text)}</div>`;
}

function manageList(rows: Array<{ label: string; summary?: string; action?: string; data?: string }>): string {
  return `<div class="manage-list">${rows
    .map(
      (row) =>
        '<div class="manage-row">' +
        `<span class="manage-row-label">${esc(row.label)}</span>` +
        (row.summary ? `<span class="manage-row-sub">${esc(row.summary)}</span>` : '') +
        (row.action
          ? `<button type="button" class="ghost-btn sm" data-act="${esc(row.data ?? '')}">${esc(row.action)}</button>`
          : '') +
        '</div>',
    )
    .join('')}</div>`;
}

async function extensionRows(kind: 'skill' | 'mcp' | 'plugin'): Promise<string> {
  let rows: Array<{ name: string; description?: string; removable: boolean }> = [];
  try {
    const data = await api.listExtensions();
    rows = data[kind === 'skill' ? 'skills' : kind === 'mcp' ? 'mcp' : 'plugins'] ?? [];
  } catch { /* Keep the panel usable if an extension config is malformed. */ }
  if (!rows.length) {
    return manageEmpty(
      kind === 'skill'
        ? 'No skills installed. Drop a skill folder in .ruqenai/skills and it appears here.'
        : kind === 'mcp'
          ? 'No MCP servers configured.'
          : 'No plugins installed.',
    );
  }
  return '<div class="manage-list">' + rows.map((item) =>
    `<div class="manage-row"><span class="manage-row-label">${esc(item.name)}</span>` +
    `<span class="manage-row-sub">${esc(item.description ?? '')}</span>` +
    `<button type="button" class="ghost-btn sm" data-act="@${kind}:${esc(item.name)}">Insert</button>` +
    (item.removable ? `<button type="button" class="ghost-btn sm remove-extension" data-kind="${kind}" data-name="${esc(item.name)}" aria-label="Delete ${esc(item.name)}">Delete</button>` : '') +
    '</div>').join('') + '</div>';
}

function insertMention(label: string): void {
  closeManage();
  promptEl.focus();
  const caret = promptEl.selectionStart ?? promptEl.value.length;
  const before = promptEl.value.slice(0, caret);
  const pad = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  promptEl.value = `${before}${pad}${label} ${promptEl.value.slice(caret)}`;
  autoResize();
  syncSend();
}

async function renderManagePane(): Promise<void> {
  for (const mini of scenePreviews) mini.stop();
  scenePreviews = [];
  const pane = document.getElementById('manage-pane');
  if (!pane) return;
  $('#manage-section-title').textContent = MANAGE_GROUPS.flatMap(({ tabs }) => tabs)
    .find(([id]) => id === manageTab)?.[1] ?? '';

  if (manageTab === 'overview') {
    const totalModels = (models?.groups ?? []).reduce((count, group) => count + group.models.length, 0);
    pane.innerHTML =
      '<div class="manage-note">What this workspace is running.</div>' +
      manageList([
        { label: 'Workspace', summary: activeProject ?? 'none' },
        { label: 'Chats', summary: String(chatsCache.length) },
        { label: 'Projects', summary: String(provProjects?.length ?? 0) },
        { label: 'Providers ready', summary: String(providerCache.filter((row) => row.connected).length) },
        { label: 'Models', summary: String(totalModels) },
        { label: 'Theme', summary: document.documentElement.dataset.theme ?? 'porcelain' },
      ]) + '<button type="button" class="manage-update-check">Check for desktop updates</button><p class="manage-note">New releases download automatically. Choose Install when you are ready.</p>';
    pane.querySelector('.manage-update-check')?.addEventListener('click', () => {
      updateCard.dataset.manual = 'true';
      void api.checkUpdate().then((update) => {
        paintDesktopUpdate(update);
        if (update.status === 'current') {
          pane.querySelector('.manage-update-check')!.textContent = 'You are up to date';
        }
      });
    });
    return;
  }
  if (manageTab === 'shortcuts') {
    pane.innerHTML =
      '<div class="manage-note">Keyboard, while the prompt is focused.</div>' +
      manageList([
        { label: 'Ctrl N', summary: 'New chat' },
        { label: 'Ctrl K', summary: 'Focus the chat filter' },
        { label: 'Ctrl I', summary: 'Session details' },
        { label: 'Ctrl B', summary: 'Toggle the chat list' },
        { label: 'Enter', summary: 'Send' },
        { label: 'Shift Enter', summary: 'New line' },
        { label: '@', summary: 'Mention a file, skill or MCP server' },
        { label: 'Esc', summary: 'Close the open panel' },
      ]);
    return;
  }
  if (manageTab === 'skills' || manageTab === 'mcp' || manageTab === 'plugins') {
    const kind = manageTab === 'mcp' ? 'mcp' : manageTab === 'plugins' ? 'plugin' : 'skill';
    pane.innerHTML = await extensionRows(kind);
    for (const btn of $$('#manage-pane [data-act]')) {
      btn.onclick = () => {
        const label = btn.dataset.act ?? '';
        if (label) insertMention(label);
      };
    }
    for (const btn of $$('#manage-pane .remove-extension')) {
      btn.onclick = async () => {
        const name = btn.dataset.name ?? '';
        const kind = btn.dataset.kind ?? '';
        if (!name || !window.confirm(`Delete ${name} from Ruqenai?`)) return;
        const result = await api.removeExtension(kind, name);
        if (!result.ok) { window.alert(result.error ?? 'Could not delete extension.'); return; }
        await renderManagePane();
      };
    }
    return;
  }

  if (manageTab === 'models') {
    await refreshModels();
    const groups = models?.groups ?? [];
    if (!groups.length) {
      pane.innerHTML = manageEmpty('No models available. Connect a provider first.');
      return;
    }
    pane.innerHTML = groups
      .map(
        (group) =>
          `<div class="manage-group">${esc(group.name)}</div>` +
          group.models
            .map(
              (model) =>
                `<button type="button" class="manage-row pick${models?.active.model === model.id ? ' on' : ''}" data-p="${esc(group.id)}" data-m="${esc(model.id)}">` +
                `<span class="manage-row-label">${esc(model.name)}</span>` +
                `<span class="manage-row-sub">${esc(model.id)}</span>` +
                `</button>`,
            )
            .join(''),
      )
      .join('');
    for (const row of $$('#manage-pane .manage-row.pick')) {
      row.onclick = () => {
        const provider = row.dataset.p ?? '';
        const model = row.dataset.m ?? '';
        if (model) void chooseModel(provider, model).then(() => renderManagePane());
      };
    }
    return;
  }

  if (manageTab === 'colors') {
    const themes: Array<[string, string]> = [
      ['porcelain', 'Porcelain'],
      ['ink', 'Ink'],
    ];
    pane.innerHTML =
      '<div class="manage-group">Theme</div><div class="manage-swatches">' +
      themes
        .map(
          ([id, label]) =>
            `<button type="button" class="manage-swatch${document.documentElement.dataset.theme === id ? ' on' : ''}" data-theme="${id}">` +
            `<span class="swatch-dot ${id}"></span><span>${label}</span></button>`,
        )
        .join('') +
      '</div>';
    for (const btn of $$('#manage-pane [data-theme]')) {
      btn.onclick = () => {
        setTheme(btn.dataset.theme ?? 'porcelain', true);
        void renderManagePane();
      };
    }
    pane.insertAdjacentHTML(
      'beforeend',
      '<div class="manage-group">Background</div>' +
        `<label class="appearance-toggle">Colored dots in dark mode<input id="dark-dots" type="checkbox"${homeBg.darkDotsColored ? ' checked' : ''}></label>` +
        `<label class="appearance-toggle">Show background on new chat<input id="home-scene" type="checkbox"${homeBg.sceneEnabled ? ' checked' : ''}></label>` +
        `<label class="appearance-toggle">Keep background once the chat starts<input id="chat-scene" type="checkbox"${homeBg.chatVisible ? ' checked' : ''}></label>` +
        `<label class="appearance-toggle" for="chat-scene-opacity">Chat background opacity <output id="chat-opacity-value">${homeBg.chatOpacity}%</output></label>` +
        `<input class="appearance-range" id="chat-scene-opacity" type="range" min="5" max="40" value="${homeBg.chatOpacity}"${homeBg.chatVisible ? '' : ' disabled'}>` +
        '<div class="manage-row"><span class="manage-row-label">Background image or video</span>' +
        '<span class="manage-row-sub">' +
        esc(homeBg.name ?? 'None chosen') +
        '</span><span class="manage-inline">' +
        '<button type="button" class="ghost-btn sm" id="home-pick">Import</button>' +
        '<button type="button" class="ghost-btn sm" id="home-clear">Clear</button>' +
        '</span></div>',
    );
    pane.insertAdjacentHTML(
      'beforeend',
      '<details id="appearance-advanced" class="appearance-advanced"><summary>Custom CSS</summary>' +
        '<textarea id="custom-css" class="manage-css" aria-label="Custom CSS" spellcheck="false" placeholder=":root { --accent: #7c9bff; }"></textarea>' +
        '<div class="manage-inline">' +
        '<button type="button" class="ghost-btn sm" id="custom-css-save">Apply</button>' +
        '<button type="button" class="ghost-btn sm" id="custom-css-clear">Reset</button>' +
        '</div></details>',
    );
    const cssArea = document.getElementById('custom-css') as HTMLTextAreaElement | null;
    if (cssArea) cssArea.value = customCss;
    const cssSave = document.getElementById('custom-css-save');
    if (cssSave) {
      cssSave.onclick = async () => {
        customCss = cssArea?.value ?? '';
        applyCustomCss(customCss);
        await (api as unknown as { setCustomCss(v: string): Promise<unknown> }).setCustomCss(customCss);
      };
    }
    const cssClear = document.getElementById('custom-css-clear');
    if (cssClear) {
      cssClear.onclick = async () => {
        customCss = '';
        if (cssArea) cssArea.value = '';
        applyCustomCss('');
        await (api as unknown as { setCustomCss(v: string): Promise<unknown> }).setCustomCss('');
      };
    }
    const sceneChoices = [
      { id: 'rotate', label: 'Rotate scenes' },
      ...BACKDROP_SCENES,
      ...(homeBg.background ? [{ id: 'image', label: homeBg.mediaKind === 'video' ? 'Imported video' : 'Imported image' }] : []),
    ];
    pane.insertAdjacentHTML(
      'beforeend',
      '<div class="manage-group">Scene library</div>' +
        '<div class="scene-gallery" id="scene-gallery">' +
        sceneChoices
          .map(
            ({ id, label }) =>
              '<button type="button" class="scene-card' + (scenePreference === id ? ' on' : '') + '" data-scene="' + id +
              '" aria-pressed="' + String(scenePreference === id) + '">' +
              '<span class="scene-prev" aria-hidden="true"></span>' +
              '<span class="scene-name">' + esc(label) + '</span>' +
              '</button>',
          )
          .join('') +
        '</div><a class="scene-credit" href="https://ascii.rest/#scenes" target="_blank" rel="noopener">Scenes by ascii.rest</a>' +
        '<div class="manage-group">New chat</div>' +
        `<label class="appearance-toggle">Show suggested prompts<input id="home-suggestions" type="checkbox"${homeBg.suggestionsVisible ? ' checked' : ''}></label>`,
    );
    pane.append($('#appearance-advanced'));
    for (const card of document.querySelectorAll('#scene-gallery .scene-card')) {
      const el = card as HTMLElement;
      const name = el.dataset.scene ?? 'rotate';
      const host = el.querySelector('.scene-prev') as HTMLElement | null;
      const piece = BACKDROP_SCENES.find((entry) => entry.id === name)?.piece;
      if (host && piece) {
        const canvas = document.createElement('canvas');
        host.append(canvas);
        scenePreviews.push({ stop: mount(canvas, piece, { fps: 0 }) });
      } else if (host && name === 'image') {
        if (homeBg.mediaKind === 'video') host.textContent = 'VIDEO';
        else host.style.backgroundImage = dottedImageUrl ? `url("${dottedImageUrl}")` : 'none';
      } else if (host) {
        host.innerHTML = icon('more');
      }
      el.onclick = async () => {
        scenePreference = name;
        activeScene = nextScene();
        await api.homeSetSceneName(name);
        applyHomeBg();
        if (manageTab === 'colors') void renderManagePane();
      };
    }
    const dots = $('#dark-dots') as HTMLInputElement;
    dots.onchange = () => { homeBg.darkDotsColored = dots.checked; applyHomeBg(); void api.homeSetDisplay({ darkDotsColored: dots.checked }); };
    const sceneToggle = $('#home-scene') as HTMLInputElement;
    const chatToggle = $('#chat-scene') as HTMLInputElement;
    const opacity = $('#chat-scene-opacity') as HTMLInputElement;
    const suggestions = $('#home-suggestions') as HTMLInputElement;
    sceneToggle.onchange = () => {
      homeBg.sceneEnabled = sceneToggle.checked;
      applyHomeBg();
      void api.homeSetScene(sceneToggle.checked);
    };
    chatToggle.onchange = () => {
      homeBg.chatVisible = chatToggle.checked;
      opacity.disabled = !chatToggle.checked;
      applyHomeBg();
      void api.homeSetDisplay({ chatVisible: chatToggle.checked });
    };
    opacity.oninput = () => {
      homeBg.chatOpacity = Number(opacity.value);
      $('#chat-opacity-value').textContent = `${opacity.value}%`;
      applyHomeBg();
    };
    opacity.onchange = () => void api.homeSetDisplay({ chatOpacity: homeBg.chatOpacity });
    suggestions.onchange = () => {
      homeBg.suggestionsVisible = suggestions.checked;
      applyHomeBg();
      void api.homeSetDisplay({ suggestionsVisible: suggestions.checked });
    };
    const pickBtn = document.getElementById('home-pick');
    if (pickBtn) {
      pickBtn.onclick = async () => {
        const picked = await api.homePick();
        if (!picked?.ok) return;
        await loadHomeBg();
        activeScene = nextScene();
        applyHomeBg();
        void renderManagePane();
      };
    }
    const clearBtn = document.getElementById('home-clear');
    if (clearBtn) {
      clearBtn.onclick = async () => {
        await api.homeClear();
        await loadHomeBg();
        if (activeScene === 'image') activeScene = nextScene();
        applyHomeBg();
        void renderManagePane();
      };
    }
    return;
  }

  if (manageTab === 'defaults') {
    await refreshModels();
    const active = models?.active;
    const groups = models?.groups ?? [];
    const mode = $$('#mode-seg .seg.active')[0]?.getAttribute('data-mode') ?? 'approve';
    const options = groups
      .map(
        (group) =>
          `<optgroup label="${esc(group.name)}">${group.models
            .map(
              (model) =>
                `<option value="${esc(group.id)}:${esc(model.id)}"${
                  active && group.id === active.provider && model.id === active.model ? ' selected' : ''
                }>${esc(model.name)}</option>`,
            )
            .join('')}</optgroup>`,
      )
      .join('');
    pane.innerHTML =
      '<div class="manage-note">Where a new chat starts. Applies instantly and is remembered.</div>' +
      '<div class="manage-group">Default model</div>' +
      `<select id="defaults-model" class="manage-select" aria-label="Default model">${options}</select>` +
      '<div class="manage-group">Permission mode</div>' +
      '<div class="manage-seg" id="defaults-mode">' +
      ['ask', 'approve', 'full']
        .map(
          (m) =>
            `<button type="button" class="seg${mode === m ? ' active' : ''}" data-mode="${m}">${
              m === 'ask' ? 'Ask' : m === 'approve' ? 'Approve' : 'Full'
            }</button>`,
        )
        .join('') +
      '</div>' +
      '<div class="manage-group">Reasoning effort</div>' +
      `<select id="defaults-effort" class="manage-select" aria-label="Reasoning effort">${effort.levels
        .map(
          (level) =>
            `<option value="${esc(level)}"${level === effort.effort ? ' selected' : ''}>${esc(effortLabel(level))}</option>`,
        )
        .join('')}</select>`;
    const modelSelect = document.getElementById('defaults-model') as HTMLSelectElement | null;
    const effortSelect = document.getElementById('defaults-effort') as HTMLSelectElement | null;
    modelSelect?.addEventListener('change', () => {
      const [provider, model] = modelSelect.value.split(':');
      if (provider && model) void chooseModel(provider, model).then(() => renderManagePane());
    });
    effortSelect?.addEventListener('change', () => {
      void setEffort(effortSelect.value).then(() => renderManagePane());
    });
    for (const btn of $$('#defaults-mode .seg')) {
      btn.onclick = () => {
        const m = btn.dataset.mode ?? 'approve';
        setModeUi(m);
        void api.setMode(m);
        $$('#defaults-mode .seg').forEach((b) => b.classList.toggle('active', b === btn));
        void renderManagePane();
      };
    }
    return;
  }

  let config: ManageConfig = {};
  try {
    config = await manageApi.readManage();
  } catch {
    config = {};
  }

  if (manageTab === 'temperature') {
    const value = typeof config.temperature === 'number' ? config.temperature : 0.7;
    pane.innerHTML =
      '<div class="manage-note">Sampling temperature. Lower is more deterministic.</div>' +
      `<div class="manage-value" id="manage-temp-value">${value.toFixed(2)}</div>` +
      `<div class="pop-track"><input id="manage-temp" type="range" min="0" max="2" step="0.05" value="${value}" style="--fill:${(value / 2) * 100}%" aria-label="Temperature" /></div>`;
    const input = document.getElementById('manage-temp') as HTMLInputElement | null;
    const label = document.getElementById('manage-temp-value');
    if (input && label) {
      input.oninput = () => {
        const next = Number(input.value);
        input.style.setProperty('--fill', `${(next / 2) * 100}%`);
        label.textContent = next.toFixed(2);
      };
      input.onchange = () => {
        void manageApi.setTemperature(Number(input.value));
      };
    }
    return;
  }

  const auto = config.autoCompact !== false;
  const threshold = typeof config.compactThreshold === 'number' ? config.compactThreshold : 28;
  pane.innerHTML =
    '<div class="manage-note">Summarise the conversation once it grows past the threshold.</div>' +
    `<label class="manage-toggle"><input id="manage-auto" type="checkbox"${auto ? ' checked' : ''} /><span>Auto compact</span></label>` +
    `<div class="manage-value" id="manage-threshold-value">${threshold} messages</div>` +
    `<div class="pop-track"><input id="manage-threshold" type="range" min="8" max="80" step="1" value="${threshold}" style="--fill:${((threshold - 8) / 72) * 100}%" aria-label="Compact threshold" /></div>`;
  const autoInput = document.getElementById('manage-auto') as HTMLInputElement | null;
  const range = document.getElementById('manage-threshold') as HTMLInputElement | null;
  const rangeLabel = document.getElementById('manage-threshold-value');
  if (autoInput) {
    autoInput.onchange = () => {
      void manageApi.setCompact({ autoCompact: Boolean(autoInput.checked) });
    };
  }
  if (range && rangeLabel) {
    range.oninput = () => {
      const next = Number(range.value);
      range.style.setProperty('--fill', `${((next - 8) / 72) * 100}%`);
      rangeLabel.textContent = `${next} messages`;
    };
    range.onchange = () => {
      void manageApi.setCompact({ compactThreshold: Number(range.value) });
    };
  }
}

async function openManage(): Promise<void> {
  const el = manageShell();
  stopBackdrop?.();
  stopBackdrop = undefined;
  mountedScene = undefined;
  syncVideoDots(false);
  const close = document.getElementById('manage-close');
  if (close) {
    close.innerHTML = icon('close');
    close.onclick = () => closeManage();
  }
  el.classList.remove('hidden');
  renderManageTabs();
  await renderManagePane();
}

// ---------------------------------------------------------------------------
// Footer stats — turns, steps, throughput, context usage
// ---------------------------------------------------------------------------

const STAT_ROTATE =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.8 8a4.8 4.8 0 1 1-1.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M12.9 2.6v2.7h-2.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const STAT_DB =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="4.2" rx="4.6" ry="1.9" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3.4 4.2v3.6c0 1 2.1 1.9 4.6 1.9s4.6-.9 4.6-1.9V4.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3.4 7.8v3.6c0 1 2.1 1.9 4.6 1.9s4.6-.9 4.6-1.9V7.8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';

interface UsageSnapshot {
  input: number;
  output: number;
  cached: number;
  cost: number;
  turns: number;
  steps: number;
  ms: number;
  lastInput: number;
}

function compactNum(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function contextWindow(): number | null {
  const active = models?.active;
  if (!active) return null;
  for (const group of models?.groups ?? []) {
    if (group.id !== active.provider) continue;
    const match = group.models.find((entry) => entry.id === active.model);
    if (match?.ctx) return match.ctx;
  }
  return null;
}

function usageSnapshot(): UsageSnapshot {
  const snapshot: UsageSnapshot = { input: 0, output: 0, cached: 0, cost: 0, turns: 0, steps: 0, ms: 0, lastInput: 0 };
  // Every assistant message carries the whole task list, so summing the tool
  // tasks counts the same step once per message. Dedupe by id.
  const seenSteps = new Set<string>();
  for (const message of currentMessages) {
    const usage = (message as {
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        cachedInputTokens?: number;
        costUsd?: number;
        estimatedCostUsd?: number;
      };
    }).usage;
    if (usage) {
      snapshot.input += usage.inputTokens ?? 0;
      snapshot.output += usage.outputTokens ?? 0;
      snapshot.cached += usage.cachedInputTokens ?? 0;
      snapshot.cost += (usage.costUsd ?? 0) + (usage.estimatedCostUsd ?? 0);
    }
    if (message.role === 'assistant') {
      snapshot.turns += 1;
      if (usage?.inputTokens) snapshot.lastInput = usage.inputTokens;
    }
    if (typeof message.durationMs === 'number') snapshot.ms += message.durationMs;
    for (const task of message.tasks ?? []) {
      if (task.kind !== 'tool' || seenSteps.has(task.id)) continue;
      seenSteps.add(task.id);
      snapshot.steps += 1;
    }
  }
  return snapshot;
}

function contextEstimate(): number {
  let chars = 0;
  for (const message of currentMessages) {
    chars += (message.content ?? '').length;
    for (const task of message.tasks ?? []) {
      chars += (task.title ?? '').length + (task.detail ?? '').length + (task.output ?? '').length;
    }
  }
  return Math.max(0, Math.round(chars / 4));
}

/** Provider usage sometimes arrives cumulative for the whole session. A prompt
 *  larger than the model window is not a prompt size, so fall back to the
 *  transcript's own character count. */
function contextNow(reported: number, limit: number | null): number {
  const estimate = contextEstimate();
  if (!reported) return estimate;
  if (limit && reported > limit * 1.1) return estimate;
  return reported;
}

function ringSvg(percent: number | null): string {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const value = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const dash = (value / 100) * circumference;
  return (
    '<svg class="stat-ring-svg" viewBox="0 0 16 16" aria-hidden="true">' +
    `<circle cx="8" cy="8" r="${radius}" fill="none" stroke="currentColor" stroke-opacity="0.2" stroke-width="1.8"/>` +
    `<circle cx="8" cy="8" r="${radius}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 8 8)"/>` +
    '</svg>'
  );
}

function renderStats(): void {
  const host = document.getElementById('stats-bar');
  if (!host) return;
  if (!currentMessages.length) {
    host.innerHTML = '<span class="stat stat-empty">No usage yet this session</span>';
    return;
  }
  const snapshot = usageSnapshot();
  const limit = contextWindow();
  const ctx = contextNow(snapshot.lastInput, limit);
  const percent = limit && ctx ? Math.min(100, (ctx / limit) * 100) : null;
  const tps = snapshot.ms > 0 ? Math.round(snapshot.output / (snapshot.ms / 1000)) : null;
  const cache = snapshot.input > 0 ? Math.round((snapshot.cached / snapshot.input) * 100) : null;
  host.innerHTML =
    `<span class="stat"><span class="stat-ico">${STAT_ROTATE}</span><b>${snapshot.turns}</b> turns <b>${snapshot.steps}</b> steps<span class="stat-sep">·</span><b>${tps ?? '—'}</b> tok/s</span>` +
    `<span class="stat"><span class="stat-ico">${STAT_DB}</span>Cache hit <b>${cache === null ? '—' : `${cache}%`}</b><span class="stat-sep">·</span>last ctx <b>${compactNum(ctx)}</b></span>` +
    `<span class="stat stat-ring" title="Context window used">${ringSvg(percent)}<b>${percent === null ? '—' : `${Math.round(percent)}%`}</b></span>`;
}

function closeStatsPop(): void {
  document.getElementById('stats-pop')?.remove();
}

function openStatsPop(): void {
  const bar = document.getElementById('stats-bar');
  if (!bar) return;
  closeStatsPop();
  const snapshot = usageSnapshot();
  const limit = contextWindow();
  const ctx = contextNow(snapshot.lastInput, limit);
  const percent = limit && ctx ? Math.min(100, (ctx / limit) * 100) : 0;
  const pop = document.createElement('div');
  pop.id = 'stats-pop';
  pop.className = 'pop stats-pop';
  pop.innerHTML =
    `<div class="pop-head"><span class="pop-title">Context</span><span class="pop-value">${Math.round(percent)}% of ${limit ? compactNum(limit) : '—'}</span></div>` +
    `<div class="stats-track"><span style="width:${percent.toFixed(1)}%"></span></div>` +
    '<dl class="inspect-list stats-rows">' +
    `<div><dt>Billed input (session)</dt><dd>${snapshot.input.toLocaleString()}</dd></div>` +
    `<div><dt>Billed output (session)</dt><dd>${snapshot.output.toLocaleString()}</dd></div>` +
    `<div><dt>Context now</dt><dd>${compactNum(ctx)}</dd></div>` +
    `<div><dt>Cached</dt><dd>${snapshot.cached.toLocaleString()}</dd></div>` +
    `<div><dt>Steps</dt><dd>${snapshot.steps}</dd></div>` +
    `<div><dt>Cost</dt><dd>${snapshot.cost ? `$${snapshot.cost.toFixed(2)}` : '—'}</dd></div>` +
    '</dl>' +
    '<button id="stats-compact" class="ghost-btn stats-compact" type="button">Compact conversation</button>';
  document.body.appendChild(pop);
  const rect = bar.getBoundingClientRect();
  const dock = (document.getElementById('composer-box') ?? bar).getBoundingClientRect();
  pop.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 304))}px`;
  pop.style.bottom = `${window.innerHeight - dock.top + 10}px`;
  const compactButton = document.getElementById('stats-compact') as HTMLButtonElement | null;
  if (compactButton) {
    compactButton.onclick = () => {
      compactButton.disabled = true;
      compactButton.textContent = 'Compacting…';
      void (api as unknown as {
        compact(payload?: { sessionId?: string }): Promise<{ ok: boolean; error?: string; note?: string }>;
      })
        .compact({ sessionId: currentSessionId ?? undefined })
        .then(async (result) => {
          if (result?.ok === false) {
            // Keep the popover open so the reason is actually visible.
            compactButton.disabled = false;
            compactButton.textContent = result.error ?? 'Compaction failed.';
            return;
          }
          compactButton.disabled = false;
          compactButton.textContent = result.note ? `Compacted — ${result.note}` : 'Compacted ✓';
          if (currentSessionId) await openChat(currentSessionId);
          renderStats();
        })
        .catch((error: unknown) => {
          compactButton.disabled = false;
          compactButton.textContent = error instanceof Error ? error.message : 'Compaction failed.';
        });
    };
  }
}

document.getElementById('stats-bar')?.addEventListener('click', () => openStatsPop());
document.addEventListener('mousedown', (ev) => {
  if (effortPop.classList.contains('hidden')) return;
  const target = ev.target as Node;
  if (!effortPop.contains(target) && !effortChip.contains(target)) closeEffortPop();
});
document.addEventListener('mousedown', (ev) => {
  const pop = document.getElementById('stats-pop');
  if (!pop) return;
  const target = ev.target as Node;
  if (!pop.contains(target) && target !== document.getElementById('stats-bar')) pop.remove();
});

function wireChrome(): void {
  $('#rail-new').innerHTML = icon('compose');
  $('#rail-chats').innerHTML = icon('chats');
  $('#rail-mentions').innerHTML = icon('sliders');
  $('#rail-mentions').title = 'Manage — skills, MCP servers, models';
  $('#rail-mentions').setAttribute('aria-label', 'Manage');
  $('#rail-providers').innerHTML = icon('plug');
  $('#rail-inspector').innerHTML = icon('branch');
  $('#rail-theme').innerHTML = icon('moon');
  $('#panel-collapse').innerHTML = icon('chevronLeft');
  $('#add-project-btn').innerHTML = icon('plus');
  $('#send-btn').innerHTML = icon('arrowUp');
  const topMenu = $('#topbar-menu');
  if (topMenu) topMenu.innerHTML = icon('chats');
  const inspectClose = $('#inspect-close');
  if (inspectClose) inspectClose.innerHTML = icon('close');

  $('#rail-new').onclick = () => newChat();
  $('#rail-chats').onclick = () => setPanel(!appEl.classList.contains('panel-open'));
  $('#rail-mentions').onclick = () => {
    void openManage();
  };
  $('#rail-providers').onclick = () => void openProviders();
  $('#rail-inspector').onclick = () => toggleInspector();
  $('#rail-theme').onclick = () => toggleTheme();
  $('#panel-collapse').onclick = () => setPanel(false);
  $('#topbar-menu').onclick = () => setPanel(!appEl.classList.contains('panel-open'));
  // Session details live in the rail only.
  $('#inspect-close').onclick = () => setInspector(false);
  $('#new-chat-btn').onclick = () => newChat();
  $('#add-project-btn').onclick = async () => {
    const project = await api.addProject();
    if (project) {
      activeProject = project;
      openProjects.add(project);
      writeJSON(OPEN_KEY, [...openProjects]);
      updateChatContext();
      await refreshSidebar();
    }
  };
  $('#chat-filter').oninput = (ev) => {
    filterText = (ev.target as HTMLInputElement).value;
    renderSidebar();
  };
  modelChip.onclick = () => void openModelSheet();
  effortChip.onclick = () => {
    if (effortPop.classList.contains('hidden')) openEffortMenu();
    else closeEffortPop();
  };
  $('#mode-seg').onclick = (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('.seg');
    if (!btn) return;
    const mode = btn.dataset.mode || '';
    setModeUi(mode);
    void api.setMode(mode);
    renderInspector();
  };

  const mentionBtn = document.getElementById('mention-btn');
  if (mentionBtn) {
    mentionBtn.onclick = () => {
      // "+" opens the file picker; @-mentions still work by typing @.
      void api.attachPick().then((paths) => {
        if (paths.length) void attachPaths(paths);
      });
    };
  }

  watchComposerDock();
  document.addEventListener('mousedown', (ev) => {
    const target = ev.target as Node;
    if (
      !effortPop.classList.contains('hidden') &&
      !effortPop.contains(target) &&
      !effortChip.contains(target)
    ) {
      closeEffortPop();
    }
    if (!mentionEl.classList.contains('hidden') && !mentionEl.contains(target) && target !== promptEl) {
      closeMentions();
    }
  });
}

function wirePanel(): void {
  panelScroll.addEventListener('click', async (ev) => {
    const target = ev.target as HTMLElement;
    const chatMenu = target.closest<HTMLElement>('[data-chat-menu]');
    if (chatMenu) {
      const meta = chatsCache.find((chat) => chat.id === chatMenu.dataset.chatMenu);
      if (meta) {
        const rect = chatMenu.getBoundingClientRect();
        openChatMenu(meta, rect.right, rect.bottom);
      }
      return;
    }
    const menu = target.closest<HTMLElement>('[data-project-menu]');
    if (menu) {
      ev.stopPropagation();
      const project = menu.dataset.projectMenu || '';
      const rect = menu.getBoundingClientRect();
      openMenu(rect.left - 150, rect.bottom + 6, [
        {
          label: 'New chat outside project',
            icon: 'plus',
            onSelect: () => {
              // Stays out of the project: the next message lands in a loose chat.
              newChat();
              void refreshSidebar();
            },
          },
          {
            label: 'Remove from list',
          icon: 'trash',
          danger: true,
          onSelect: async () => {
            await api.removeProject(project);
            await refreshSidebar();
          },
        },
      ]);
      return;
    }
    const projectBtn = target.closest<HTMLElement>('[data-project]');
    if (projectBtn) {
      const project = projectBtn.dataset.project || '';
      if (openProjects.has(project)) openProjects.delete(project);
      else openProjects.add(project);
      writeJSON(OPEN_KEY, [...openProjects]);
      activeProject = project;
      void api.setActiveProject(project);
      updateChatContext();
      renderSidebar();
      return;
    }
    const chatBtn = target.closest<HTMLElement>('[data-chat]');
    if (chatBtn?.dataset.chat) void openChat(chatBtn.dataset.chat);
  });

  panelScroll.addEventListener('contextmenu', (ev) => {
    const row = (ev.target as HTMLElement).closest<HTMLElement>('[data-chat]');
    if (!row?.dataset.chat) return;
    const meta = chatsCache.find((c) => c.id === row.dataset.chat);
    if (!meta) return;
    ev.preventDefault();
    openChatMenu(meta, ev.clientX, ev.clientY);
  });
}

function wireComposer(): void {
  promptEl.addEventListener('input', () => {
    autoResize();
    syncSend();
    void refreshMentions();
  });
  promptEl.addEventListener('keydown', (ev) => {
    if (mentionKey(ev)) return;
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      void send();
    }
  });
  sendBtn.onclick = () => void send();
  stopBtn.onclick = () => void api.stop();
  $('#starters').addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-prompt]');
    if (!btn?.dataset.prompt) return;
    promptEl.value = btn.dataset.prompt;
    autoResize();
    syncSend();
    void send();
  });
}

function wireGlobal(): void {
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (!effortPop.classList.contains('hidden')) {
        closeEffortPop();
        effortChip.focus();
        return;
      }
      if (manageEl && !manageEl.classList.contains('hidden')) {
        closeManage();
        $('#rail-mentions').focus();
        return;
      }
      if (!ctxMenu.classList.contains('hidden')) {
        closeMenu();
        return;
      }
      if (!sheetEl.classList.contains('hidden')) {
        closeModelSheet();
        return;
      }
      if (!modalEl.classList.contains('hidden')) {
        closeProviders();
        return;
      }
      if (!overlay.classList.contains('hidden')) return; // answered explicitly
      if (busy) void api.stop();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'n') {
      ev.preventDefault();
      newChat();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'i') {
      ev.preventDefault();
      toggleInspector();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'b') {
      ev.preventDefault();
      setPanel(!appEl.classList.contains('panel-open'));
    } else if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key.toLowerCase() === 'k')) {
      ev.preventDefault();
      void openModelSheet();
    }
  });

  document.addEventListener('mousedown', (ev) => {
    const target = ev.target as Node;
    if (!ctxMenu.classList.contains('hidden') && !ctxMenu.contains(target)) closeMenu();
    // The model sheet behaves like a popover: click anywhere off it to dismiss.
    if (
      !sheetEl.classList.contains('hidden') &&
      !sheetEl.contains(target) &&
      !modelChip.contains(target)
    ) {
      closeModelSheet();
    }
  });
  window.addEventListener('resize', () => {
    if (!sheetEl.classList.contains('hidden')) positionSheet();
    closeMenu();
    // Crossing into drawer width: keep the ledger from covering the thread.
    if (window.innerWidth <= 1080 && appEl.classList.contains('panel-open')) setPanel(false);
  });
  scroller.addEventListener('scroll', closeMenu, { passive: true });
  document.addEventListener('visibilitychange', () => {
    applyHomeBg();
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  await loadCustomCss();
  await loadHomeBg();
  const data = await api.init();
  document.body.dataset.platform = data.platform ?? 'unknown';
  initTheme();
  initPanel();
  wireChrome();
  wirePanel();
  wireComposer();
  wireGlobal();
  wireAttach();

  const cfg = data.config ?? {};
  setModeUi(cfg.mode ?? 'approve');
  if (cfg.effort) {
    effort = { effort: cfg.effort, levels: cfg.levels ?? effort.levels };
  }
  paintEffort();
  paintEco();

  provProjects = data.projects ?? [];
  activeProject = data.activeProject ?? null;
  chatsCache = data.chats ?? [];
  renderSidebar();
  void updateWorkspaceChip();
  await refreshModels();

  if (data.activeProject) {
    openProjects.add(data.activeProject);
    writeJSON(OPEN_KEY, [...openProjects]);
  }

  if (localStorage.getItem('ruqenai.inspector') === '1') setInspector(true);
  else renderInspector();

  newChat();

  autoResize();
  syncSend();
  api.onEvent(handleEvent);
  void api.updateState().then(paintDesktopUpdate);

  // First run: nothing connected means no model, so show the gallery.
  try {
    providerCache = await api.listProviders();
    if (providerCache.length && !providerCache.some((p) => p.connected)) {
      window.setTimeout(() => void openProviders(), 420);
    }
  } catch {
    /* the gallery is optional */
  }
}

function initJumpButton(): void {
  if (document.getElementById('jump-bottom')) return;
  const button = document.createElement('button');
  button.id = 'jump-bottom';
  button.type = 'button';
  button.setAttribute('aria-label', 'Scroll to latest message');
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5.5v12" /><path d="M6.5 12.5 12 18l5.5-5.5" /></svg>';

  const place = (): void => {
    const rect = scroller.getBoundingClientRect();
    button.style.left = `${Math.round(rect.left + rect.width / 2 - 18)}px`;
    button.style.top = `${Math.round(rect.bottom - 58)}px`;
  };

  const update = (): void => {
    place();
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    button.classList.toggle('show', distance > 380);
  };

  button.addEventListener('click', () => {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    button.classList.remove('show');
  });

  scroller.addEventListener('scroll', () => window.requestAnimationFrame(update), { passive: true });
  window.addEventListener('resize', update);
  jumpRefresh = update;
  document.body.appendChild(button);
  update();
}

initJumpButton();
void boot().then(() => {
  document.body.classList.add('app-ready');
  window.setTimeout(() => document.getElementById('startup-screen')?.remove(), 350);
}).catch((error) => {
  const label = document.getElementById('startup-label');
  if (label) label.textContent = `Startup failed: ${error instanceof Error ? error.message : String(error)}`;
});
