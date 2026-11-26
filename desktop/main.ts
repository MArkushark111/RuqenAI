import { app, BrowserWindow, ipcMain, dialog, shell, screen, globalShortcut } from 'electron';
import { AgentEngine } from '../src/agent/engine.js';
import { sessionManager, SessionManager } from '../src/agent/context.js';
import { configManager } from '../src/config/settings.js';
import type { ThinkingEffort } from '../src/types/index.js';
import { permissionManager } from '../src/agent/permissions.js';
import { ProviderCatalog } from '../src/providers/catalog.js';
import { ProviderManager } from '../src/providers/manager.js';
import { modelLabel } from './labels.js';
import { suggestMentions } from '../src/agent/mentions.js';
import { skillsManager } from '../src/skills/manager.js';
import { mcpClient, updateMcpPlugin, updateMcpServer } from '../src/mcp/client.js';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';
import { checkDesktopUpdate, installDesktopUpdate, updateState } from './updates.js';
import { unzipSync } from 'fflate';
import { onComputerUse, pauseComputerUse, resumeComputerUse, stopComputerUse } from '../src/agent/computer.js';

let mainWindow: BrowserWindow | null = null;
let computerOverlay: BrowserWindow | null = null;

function showComputerOverlay(active: boolean): void {
  if (!active) {
    globalShortcut.unregister('Escape');
    computerOverlay?.close();
    computerOverlay = null;
    return;
  }
  if (computerOverlay) return;
  const bounds = screen.getPrimaryDisplay().bounds;
  computerOverlay = new BrowserWindow({
    ...bounds, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, hasShadow: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  computerOverlay.setIgnoreMouseEvents(true, { forward: true });
  computerOverlay.setAlwaysOnTop(true, 'screen-saver');
  const html = '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;height:100%;background:transparent;pointer-events:none;font:500 12.5px/1.2 ui-sans-serif,system-ui,"Segoe UI",sans-serif;color:#f4efe7}.edge{position:fixed;inset:6px;border-radius:16px;border:1px solid rgba(138,178,255,.24);box-shadow:inset 0 0 150px rgba(96,150,255,.17),inset 0 0 34px rgba(0,0,0,.26),0 0 26px rgba(96,150,255,.10)}.pill{position:fixed;top:18px;left:50%;display:flex;align-items:center;gap:10px;padding:9px 13px;border-radius:999px;background:rgba(20,19,17,.86);border:1px solid rgba(255,255,255,.12);box-shadow:0 14px 36px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(14px) saturate(1.2);transform:translateX(-50%);animation:in 260ms cubic-bezier(.22,1,.36,1) both}@keyframes in{from{opacity:0;transform:translate(-50%,-14px) scale(.97)}}.dot{width:7px;height:7px;border-radius:50%;background:#7fb2ff;animation:pulse 1.9s ease-out infinite}@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(127,178,255,.45)}70%{box-shadow:0 0 0 8px rgba(127,178,255,0)}100%{box-shadow:0 0 0 0 rgba(127,178,255,0)}}.sep{width:1px;height:14px;background:rgba(255,255,255,.14)}.key{font:600 10.5px/1 ui-monospace,Consolas,monospace;padding:4px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:#d9d3c9}.hint{color:#a8a09a;font-weight:400}</style><div class="edge"></div><div class="pill"><span class="dot"></span><span>Ruqenai is using your computer</span><span class="sep"></span><span class="key">Esc</span><span class="hint">stop</span></div>';
  void computerOverlay.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  globalShortcut.register('Escape', () => {
      // Hand control back without aborting the turn: the next computer action
      // returns an error to the model, which then answers normally.
      pauseComputerUse();
    });
}

/**
 * Effort levels a model actually supports. The picker only renders levels from
 * the active model's list, so a DeepSeek chat shows Off / Low / High / Max
 * (XHigh) and nothing it cannot honor.
 */
const MODEL_EFFORTS: Record<string, string[]> = {
  'deepseek-flash': ['Off', 'Low', 'High', 'XHigh'],
  'deepseek-v4-pro': ['Off', 'Low', 'High', 'XHigh'],
};
const ALL_EFFORTS = ['Off', 'Low', 'Medium', 'High', 'XHigh', 'UltraCode'];

function effortLevels(modelId: string | undefined): string[] {
  return (modelId && MODEL_EFFORTS[modelId]) || ALL_EFFORTS;
}

/** What the effort picker should show as selected. */
function effortState(ignoreEco = false): { effort: string; levels: string[] } {
  const cfg = configManager.get();
  const eco = !ignoreEco && sessionManager.getSession().ecoMode === true;
  const levels = ['Eco', ...effortLevels(cfg.activeModel)];
  let effort = eco ? 'Eco' : cfg.ultracodeMode
    ? 'UltraCode'
    : !cfg.thinkingEnabled
      ? 'Off'
      : (cfg.thinkingEffort ?? 'High');
  // The selected effort may belong to a model the user just switched away
  // from. Snap to the nearest level this model supports instead of showing a
  // value the next turn cannot honor.
  if (!levels.includes(effort)) {
    effort = levels.includes('High') ? 'High' : (levels[levels.length - 1] ?? 'Off');
  }
  return { effort, levels };
}

// ---------------------------------------------------------------------------
// Desktop store: the "project" concept (a working directory) plus which chat
// belongs to which project. Kept separate from the CLI's session files so the
// CLI keeps working unchanged.
// ---------------------------------------------------------------------------
interface DesktopStore {
  projects: string[];
  activeProject: string | null;
  sessionProject: Record<string, string>;
}

const STORE_PATH = path.join(os.homedir(), '.ruqenai', 'desktop.json');

function loadStore(): DesktopStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects.filter((p: unknown) => typeof p === 'string') : [],
      activeProject: typeof parsed.activeProject === 'string' ? parsed.activeProject : null,
      sessionProject:
        parsed.sessionProject && typeof parsed.sessionProject === 'object' && !Array.isArray(parsed.sessionProject)
          ? parsed.sessionProject
          : {},
    };
  } catch {
    return { projects: [], activeProject: null, sessionProject: {} };
  }
}

let store = loadStore();

function saveStore(): void {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
  } catch {}
}

// ---------------------------------------------------------------------------
// Turn state
// ---------------------------------------------------------------------------
let activeController: AbortController | null = null;
let pendingQuestion: { resolve: (value: string | undefined) => void } | null = null;

function emit(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function cwdFor(sessionId: string): string {
  return store.sessionProject[sessionId] ?? store.activeProject ?? process.cwd();
}

function chatList(): unknown[] {
  const active = sessionManager.getSession().id;
  return SessionManager
    .listAll()
    .filter((s) => !s.hidden)
    .map((s) => ({
      id: s.id,
      name: s.name,
      updatedAt: s.updatedAt,
      messageCount: s.messageCount,
      project: store.sessionProject[s.id] ?? null,
      active: s.id === active,
    }));
}

async function runTurn(sessionId: string, prompt: string): Promise<void> {
  const session = sessionManager.getSavedSession(sessionId);
  if (!session) throw new Error('Chat not found.');
  sessionManager.focusSession(session);

  const controller = new AbortController();
  activeController = controller;
  resumeComputerUse();
  const cwd = cwdFor(sessionId);

  try {
    await AgentEngine.execute(
      prompt,
      {
        onContentUpdate: (content) => emit('event', { type: 'stream', sessionId, content }),
        onTranscriptUpdate: (segments) => emit('event', { type: 'segments', sessionId, segments }),
        onTaskUpdate: (tasks) => emit('event', { type: 'tasks', sessionId, tasks }),
        onToolEvent: (task) => emit('event', { type: 'tool', sessionId, task }),
        onUsageUpdate: (usage) => emit('event', { type: 'usage', sessionId, usage }),
        onNotice: (message) => emit('event', { type: 'notice', sessionId, message }),
        onSendRejected: () => emit('event', { type: 'rejected', sessionId }),
        onDone: (message) => emit('event', { type: 'done', sessionId, message, name: session.name }),
        onQuestion: (question, signal) =>
          new Promise<string | undefined>((resolve) => {
            pendingQuestion = { resolve };
            emit('event', { type: 'question', sessionId, question: { question: question.question, choices: question.choices } });
            signal?.addEventListener(
              'abort',
              () => {
                if (pendingQuestion) {
                  pendingQuestion.resolve(undefined);
                  pendingQuestion = null;
                }
              },
              { once: true },
            );
          }),
      },
      { cwd, signal: controller.signal },
    );
  } finally {
    stopComputerUse();
    if (activeController === controller) activeController = null;
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
const TITLEBAR_TONES = {
  porcelain: { color: '#f3f2ef', symbolColor: '#14130f' },
  ink: { color: '#131211', symbolColor: '#f1ede5' },
} as const;

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: TITLEBAR_TONES.porcelain.color,
    title: 'Ruqenai',
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    // The renderer draws its own top bar in the app's colours; the native
    // controls stay so snapping, resizing and window menus keep working.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 20 } }
      : { titleBarOverlay: { ...TITLEBAR_TONES.porcelain, height: 54 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Own the zoom keys instead of relying on Chromium's default accelerator.
  // On many layouts "Ctrl +" arrives as Ctrl+Shift+=, which the default misses,
  // leaving the window stuck zoomed out after an accidental Ctrl+-.
  const ZOOM_MIN = -3;
  const ZOOM_MAX = 3;
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const key = input.key.toLowerCase();
    const code = (input as { code?: string }).code ?? '';
    let step = 0;
    let reset = false;
    if (key === '=' || key === '+' || code === 'NumpadAdd') step = 1;
    else if (key === '-' || key === '_' || code === 'NumpadSubtract') step = -1;
    else if (key === '0' || code === 'Numpad0') reset = true;
    if (!step && !reset) return;
    event.preventDefault();
    const wc = mainWindow?.webContents;
    if (!wc) return;
    wc.setZoomLevel(reset ? 0 : Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, wc.getZoomLevel() + step)));
  });

  // Surface renderer console messages to the main process log (helps diagnose UI errors).
  mainWindow.webContents.on('console-message', (_e: unknown, levelOrDetails: unknown, message?: string) => {
    const text = typeof message === 'string' ? message : (levelOrDetails as { message?: string })?.message;
    if (text) console.log('[renderer] ' + text);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc(): void {
  ipcMain.handle('updates:state', () => updateState());
  ipcMain.handle('updates:check', () => checkDesktopUpdate((update) => emit('event', { type: 'desktop-update', update })));
  ipcMain.handle('updates:install', async () => {
    if (activeController) throw new Error('Stop the current reply before installing.');
    await installDesktopUpdate();
  });
  ipcMain.handle('app:init', async () => {
    const cfg = configManager.get();
    return {
      config: {
        provider: cfg.activeProvider,
        model: cfg.activeModel,
        mode: cfg.permissionMode,
        thinking: cfg.thinkingEnabled,
        ultracode: cfg.ultracodeMode,
        ...effortState(),
      },
      projects: store.projects,
      activeProject: store.activeProject,
      chats: chatList(),
      platform: process.platform,
    };
  });

  ipcMain.handle('config:get', () => {
    const c = configManager.get();
    return {
      provider: c.activeProvider,
      model: c.activeModel,
      mode: c.permissionMode,
      thinking: c.thinkingEnabled,
      ultracode: c.ultracodeMode,
      customCss: c.customCss ?? '',
      defaultEffort: effortState(true).effort,
      ...effortState(),
    };
  });

  // New-chat appearance: hero scene toggle + optional custom background image.
  ipcMain.handle('config:setCustomCss', (_e, css: string) => {
    configManager.update({ customCss: String(css ?? '').slice(0, 200_000) });
    return { ok: true };
  });

  ipcMain.handle('view:zoomReset', () => {
    mainWindow?.webContents.setZoomLevel(0);
    return true;
  });

  ipcMain.handle('home:setSceneName', (_e, scene: string) => {
    configManager.update({ homeScene: String(scene ?? 'rotate') });
    return { ok: true };
  });

  ipcMain.handle('home:get', () => {
    const c = configManager.get();
    const imagePath = c.homeBackground ?? null;
    let dataUrl: string | null = null;
    let mediaKind: 'image' | 'video' = 'image';
    if (imagePath) {
      try {
        const ext = imagePath.split('.').pop()?.toLowerCase() ?? '';
        if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) {
          mediaKind = 'video';
          dataUrl = pathToFileURL(imagePath).href;
        } else {
          const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
          dataUrl = 'data:' + mime + ';base64,' + fs.readFileSync(imagePath).toString('base64');
        }
      } catch {
        dataUrl = null;
      }
    }
    return {
      sceneEnabled: c.homeSceneEnabled !== false,
      scene: c.homeScene ?? 'rotate',
      darkDotsColored: c.darkDotsColored === true,
      chatVisible: c.chatBackgroundVisible === true,
      chatOpacity: Number.isFinite(c.chatBackgroundOpacity) ? Math.max(5, Math.min(40, c.chatBackgroundOpacity!)) : 15,
      suggestionsVisible: c.homeSuggestionsVisible !== false,
      background: dataUrl,
      mediaKind,
      name: imagePath ? imagePath.split(/[\\/]/).pop() ?? null : null,
    };
  });

  ipcMain.handle('home:pick', async () => {
    const picked = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'Images and videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov', 'm4v'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false };
    configManager.update({ homeBackground: picked.filePaths[0], homeScene: 'image' });
    return { ok: true };
  });

  ipcMain.handle('home:setScene', (_e, enabled: boolean) => {
    configManager.update({ homeSceneEnabled: Boolean(enabled) });
    return { ok: true };
  });

  ipcMain.handle('home:setDisplay', (_e, value: { darkDotsColored?: boolean; chatVisible?: boolean; chatOpacity?: number; suggestionsVisible?: boolean }) => {
    configManager.update({
      ...(typeof value?.darkDotsColored === 'boolean' && { darkDotsColored: value.darkDotsColored }),
      ...(typeof value?.chatVisible === 'boolean' && { chatBackgroundVisible: value.chatVisible }),
      ...(Number.isFinite(value?.chatOpacity) && { chatBackgroundOpacity: Math.max(5, Math.min(40, value.chatOpacity!)) }),
      ...(typeof value?.suggestionsVisible === 'boolean' && { homeSuggestionsVisible: value.suggestionsVisible }),
    });
  });

  ipcMain.handle('home:clear', () => {
    configManager.update({
      homeBackground: null,
      ...(configManager.get().homeScene === 'image' && { homeScene: 'rotate' }),
    });
    return { ok: true };
  });

  ipcMain.handle('config:setMode', (_e, mode: string) => {
    if (mode === 'ask' || mode === 'approve' || mode === 'full') configManager.update({ permissionMode: mode });
  });

  // Reasoning effort — same levels the /effort command exposes in the CLI.
  ipcMain.handle('config:setEffort', (_e, level: string) => {
    const value = String(level || '');
    if (value === 'Eco') {
      sessionManager.setEcoMode(true);
      return effortState();
    }
    if (sessionManager.getSession().ecoMode) sessionManager.setEcoMode(false);
    if (value === 'Off') {
      configManager.update({ ultracodeMode: false, thinkingEnabled: false });
      return effortState();
    }
    if (value === 'UltraCode') {
      configManager.update({ theme: 'ultracode', ultracodeMode: true, thinkingEffort: 'XHigh', thinkingEnabled: true });
      return effortState();
    }
    const allowed = ['Low', 'Medium', 'High', 'XHigh'];
    if (allowed.includes(value)) {
      configManager.update({ theme: 'dark', ultracodeMode: false, thinkingEffort: value as ThinkingEffort, thinkingEnabled: true });
    }
    return effortState();
  });

  // Model picker: the green dot in the composer opens this list.
  ipcMain.handle('model:list', () => {
    const cfg = configManager.get();
    const groups = ProviderCatalog.all()
      .filter((provider) => ProviderManager.hasChatConnection(provider))
      .map((provider) => {
        const models: { id: string; name: string; ctx?: number }[] = [];
        const seen = new Set<string>();
        for (const m of provider.popularModels) {
          // Retired catalogue entries stay in the CLI (they still resolve by id)
          // but the picker only offers models you would pick today.
          if (m.deprecated) continue;
          if (!(m.capabilities.includes('text') || m.capabilities.includes('code'))) continue;
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          models.push({
            id: m.id,
            name: modelLabel(m.name, m.id, provider.name, provider.id),
            ctx: m.contextWindow,
          });
        }
        if (provider.id === cfg.activeProvider && cfg.activeModel && !seen.has(cfg.activeModel)) {
          models.unshift({
            id: cfg.activeModel,
            name: modelLabel(cfg.activeModel, cfg.activeModel, provider.name, provider.id),
          });
        }
        return {
          id: provider.id,
          // The gallery identifies providers by name and mark, so the model
          // sheet's section header matches it. Model rows stay brandless.
          name: provider.name,
          models,
        };
      })
      .filter((group) => group.models.length > 0);
    return {
      active: { provider: cfg.activeProvider, model: cfg.activeModel },
      groups,
    };
  });

  ipcMain.handle('model:set', (_e, providerId: unknown, modelId: unknown) => {
    if (typeof providerId !== 'string' || typeof modelId !== 'string' || !providerId || !modelId) return false;
    configManager.update({ activeProvider: providerId, activeModel: modelId });
    return true;
  });

  // -------------------------------------------------------------------------
  // Providers — the desktop gallery. Reads the same catalog the CLI uses, so
  // connecting here means the next `ruqenai` run already knows the key.
  // -------------------------------------------------------------------------
  ipcMain.handle('providers:list', () => {
    const cfg = configManager.get();
    return ProviderCatalog.all()
      // Catalog-only records have no verified chat route, so offering them in
      // a connect screen would promise something that cannot work.
      .filter((provider) => ProviderCatalog.connection(provider.id) !== 'catalog')
      .map((provider) => {
        let connected = false;
        try {
          connected = ProviderManager.hasChatConnection(provider);
        } catch {}
        return {
          id: provider.id,
          name: provider.name,
          category: provider.category,
          description: provider.description,
          website: provider.website ?? null,
          requiresKey: provider.requiresKey !== false,
          isLocal: Boolean(provider.isLocal),
          connected,
          hasKey: Boolean(configManager.getSavedApiKey(provider.id)),
          endpoint: provider.id === 'ollama' ? cfg.ollamaHost : cfg.customEndpoints[provider.id] ?? '',
          defaultBaseUrl: provider.defaultBaseUrl ?? '',
          modelCount: provider.popularModels.length,
          models: provider.popularModels.slice(0, 6).map((model) => model.name),
          connection: ProviderCatalog.connection(provider.id),
        };
      });
  });

  ipcMain.handle('providers:connect', (_e, id: unknown, payload: unknown) => {
    try {
      if (typeof id !== 'string' || !id) return { ok: false, error: 'Unknown provider.' };
      const input = (payload ?? {}) as { apiKey?: unknown; endpoint?: unknown };
      const apiKey = typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : undefined;
      const endpoint = typeof input.endpoint === 'string' ? input.endpoint : undefined;
      configManager.saveProviderConnection(id, { apiKey, endpoint });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('providers:disconnect', (_e, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id) return { ok: false, error: 'Unknown provider.' };
      if (configManager.getSavedApiKey(id)) configManager.removeApiKey(id);
      const cfg = configManager.get();
      if (!cfg.disconnectedProviders.includes(id)) {
        configManager.update({ disconnectedProviders: [...cfg.disconnectedProviders, id] });
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Keep the native window controls legible when the renderer flips theme.
  // ---------------------------------------------------------------------------
  // Workspace context — the `@` menu and the composer's project/git chip.
  // ---------------------------------------------------------------------------
  const FILE_SCAN_TTL_MS = 20_000;
  const FILE_SCAN_LIMIT = 4000;
  const SKIP_DIRS = new Set([
    '.git', 'node_modules', 'dist', 'dist-desktop', 'build', 'out', '.next', '.nuxt',
    '.cache', 'coverage', '.venv', 'venv', 'env', '__pycache__', '.idea', 'target',
  ]);
  const fileScans = new Map<string, { at: number; files: string[] }>();

  /** Breadth-first-ish walk of the workspace, capped so a big repo stays cheap. */
  function scanWorkspace(root: string): string[] {
    const cached = fileScans.get(root);
    if (cached && Date.now() - cached.at < FILE_SCAN_TTL_MS) return cached.files;
    const files: string[] = [];
    const walk = (dir: string, depth: number): void => {
      if (files.length >= FILE_SCAN_LIMIT || depth > 5) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= FILE_SCAN_LIMIT) return;
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          walk(full, depth + 1);
        } else if (entry.isFile()) {
          files.push(path.relative(root, full).replace(/\\/g, '/'));
        }
      }
    };
    walk(root, 0);
    fileScans.set(root, { at: Date.now(), files });
    return files;
  }

  ipcMain.handle('mention:suggest', (_e, token: unknown, rootArg: unknown) => {
    const root = typeof rootArg === 'string' && rootArg ? rootArg : (store.activeProject ?? process.cwd());
    const query = typeof token === 'string' ? token.replace(/^@/, '').toLowerCase() : '';
    const extensions: { kind: string; label: string; summary: string; enabled: boolean }[] = [];
    try {
      for (const mention of suggestMentions('@' + query)) {
        const kind = mention.label.startsWith('@skill:') ? 'skill' : mention.label.startsWith('@mcp:') ? 'mcp' : 'plugin';
        extensions.push({ kind, label: mention.label, summary: mention.summary, enabled: mention.enabled });
      }
    } catch {
      // A broken connector config must not take the composer down with it.
    }
    let files: { kind: string; label: string; summary: string; enabled: boolean }[] = [];
    if (query) {
      try {
        files = scanWorkspace(root)
          .filter((file) => file.toLowerCase().includes(query))
          .sort((a, b) => a.length - b.length || a.localeCompare(b))
          .slice(0, 24)
          .map((file) => ({ kind: 'file', label: file, summary: '', enabled: true }));
      } catch {
        files = [];
      }
    }
    return { extensions: extensions.slice(0, 16), files };
  });

  ipcMain.handle('workspace:git', (_e, rootArg: unknown) => new Promise((resolve) => {
    const root = typeof rootArg === 'string' && rootArg ? rootArg : (store.activeProject ?? process.cwd());
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeout: 2000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve({ isRepo: false, branch: null, name: path.basename(root) });
        return;
      }
      resolve({ isRepo: true, branch: String(stdout).trim() || 'HEAD', name: path.basename(root) });
    });
  }));

  ipcMain.handle('session:compact', async (_event, raw) => {
    try {
      // The desktop views saved chats without making them the manager's current
      // session, so resolve the id the renderer is actually showing.
      const id = String((raw as { sessionId?: unknown } | undefined)?.sessionId ?? '');
      const session = (id ? sessionManager.getSavedSession(id) : undefined) ?? sessionManager.getSession();
      if (!session || !session.messages.length) {
        return { ok: false, error: 'Nothing to compact yet.' };
      }
      const cfg = configManager.get();
      const note = await AgentEngine.compact(undefined, session, cfg.activeProvider, cfg.activeModel);
      sessionManager.notifyExternalChange();
      return { ok: true, note };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('config:manage', () => {
    const cfg = configManager.get();
    return {
      temperature: cfg.temperature,
      autoCompact: cfg.autoCompact,
      compactThreshold: cfg.compactThreshold,
    };
  });

  ipcMain.handle('config:setTemperature', (_e, raw: unknown) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return { ok: false };
    const temperature = Math.min(2, Math.max(0, Math.round(value * 100) / 100));
    configManager.update({ temperature });
    return { ok: true, temperature };
  });

  ipcMain.handle('config:setCompact', (_e, raw: unknown) => {
    const payload = (raw ?? {}) as { autoCompact?: unknown; compactThreshold?: unknown };
    const next: { autoCompact?: boolean; compactThreshold?: number } = {};
    if (typeof payload.autoCompact === 'boolean') next.autoCompact = payload.autoCompact;
    const threshold = Number(payload.compactThreshold);
    if (Number.isFinite(threshold)) {
      next.compactThreshold = Math.min(90, Math.max(4, Math.round(threshold)));
    }
    if (Object.keys(next).length) configManager.update(next);
    const cfg = configManager.get();
    return { ok: true, autoCompact: cfg.autoCompact, compactThreshold: cfg.compactThreshold };
  });

  ipcMain.on('window:tone', (_e, theme: unknown) => {
    const tone = theme === 'ink' ? TITLEBAR_TONES.ink : TITLEBAR_TONES.porcelain;
    try {
      (mainWindow as unknown as { setTitleBarOverlay?: (o: Record<string, unknown>) => void })
        ?.setTitleBarOverlay?.({ ...tone, height: 54 });
    } catch {}
  });

  ipcMain.handle('chat:create', async (_e, projectPath?: string) => {
    // Only an explicit project joins a project; the global New chat stays loose.
    const proj = projectPath || undefined;
    if (proj && !store.projects.includes(proj)) store.projects.unshift(proj);
    if (proj) store.activeProject = proj;
    const session = sessionManager.createSavedChat();
    if (proj) store.sessionProject[session.id] = proj;
    saveStore();
    return { id: session.id, name: session.name, project: proj ?? null };
  });

  ipcMain.handle('chat:open', async (_e, id: string) => {
    const session = sessionManager.getSavedSession(id);
    if (!session) throw new Error('Chat not found.');
    sessionManager.focusSession(session);
    return { id: session.id, name: session.name, project: store.sessionProject[id] ?? null, messages: session.messages, effort: effortState() };
  });

  ipcMain.handle('extensions:list', () => {
    const configured = (() => {
      try {
        const value = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.ruqenai', 'mcp.json'), 'utf8'));
        return Object.keys(value.mcpServers ?? value.servers ?? {});
      } catch { return []; }
    })();
    return {
      skills: skillsManager.list().map(({ name, description, filePath }) => ({ name, description, removable: Boolean(filePath) })),
      mcp: mcpClient.listServers().map(({ name, description }) => ({ name, description, removable: configured.includes(name) })),
      plugins: mcpClient.listPlugins().map(({ name, description }) => ({ name, description, removable: true })),
    };
  });
  ipcMain.handle('extensions:remove', (_e, kind: string, name: string) => {
    if (!/^[\w.-]{1,80}$/.test(name)) return { ok: false, error: 'Invalid extension name.' };
    try {
      if (kind === 'skill') {
        const skill = skillsManager.get(name);
        if (!skill?.filePath) throw new Error('Built-in skills cannot be removed.');
        const root = path.join(os.homedir(), '.ruqenai', 'skills');
        const target = path.resolve(skill.dirPath ?? skill.filePath);
        if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Skill is outside the user skills folder.');
        if (skill.dirPath) fs.rmSync(target, { recursive: true });
        else fs.unlinkSync(target);
        skillsManager.reload();
      } else if (kind === 'mcp') updateMcpServer(name);
      else if (kind === 'plugin') updateMcpPlugin(name);
      else throw new Error('Unknown extension type.');
      return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });

  ipcMain.handle('artifact:preview', (_e, sessionId: string, rawPath: string) => {
    const session = sessionManager.getSavedSession(sessionId);
    if (!session) throw new Error('Chat not found.');
    const root = fs.realpathSync(cwdFor(sessionId));
    const candidate = path.resolve(root, String(rawPath ?? ''));
    const file = fs.realpathSync(candidate);
    const relative = path.relative(root, file);
    const queued = session.attachedFiles.some((item) => {
      try { return fs.realpathSync(item) === file; } catch { return false; }
    });
    if ((!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) && !queued) {
      throw new Error('Preview is outside this workspace.');
    }
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 6 * 1024 * 1024) throw new Error('Preview supports files up to 6 MB.');
    const bytes = fs.readFileSync(file);
    const extension = path.extname(file).toLowerCase();
    const name = path.basename(file);
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension)) {
      const mime = extension === '.png' ? 'image/png' : extension === '.gif' ? 'image/gif' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
      return { name, kind: 'image', content: `data:${mime};base64,${bytes.toString('base64')}` };
    }
    if (extension === '.docx') {
      const xml = unzipSync(bytes, { filter: (entry) => entry.name === 'word/document.xml' && entry.originalSize < 3 * 1024 * 1024 })['word/document.xml'];
      if (!xml) throw new Error('Document text is unavailable.');
      const text = new TextDecoder().decode(xml).replace(/<w:tab\b[^>]*\/?\s*>/g, '\t').replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
      return { name, kind: 'text', content: text.slice(0, 60_000) || 'This document has no previewable text.' };
    }
    if (bytes.includes(0)) return { name, kind: 'binary', content: `${name} · ${stat.size.toLocaleString()} bytes` };
    return { name, kind: 'text', content: new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 60_000)) };
  });

  ipcMain.handle('chat:send', async (_e, sessionId: string, prompt: string) => {
    if (activeController) throw new Error('A reply is already running.');
    runTurn(sessionId, prompt).catch((err) => {
      emit('event', { type: 'error', sessionId, message: err instanceof Error ? err.message : String(err) });
    });
    return true;
  });

  ipcMain.handle('chat:stop', () => {
    activeController?.abort();
    return true;
  });

  ipcMain.handle('chat:clearTasks', (_e, id: string) => {
    if (activeController) return false;
    const session = sessionManager.getSavedSession(id);
    return session ? sessionManager.clearTasks(session) : false;
  });

  ipcMain.handle('chat:delete', async (_e, id: string) => {
    SessionManager.deleteSession(id);
    delete store.sessionProject[id];
    saveStore();
    return true;
  });

  ipcMain.handle('chat:rename', async (_e, id: string, name: string) => {
    sessionManager.editSession(id, { name: name.trim() || undefined });
    return true;
  });

  // Attachments: queued on the session until the next send, exactly like the
  // CLI's /attach. Raw bytes (pasted images) are staged in the OS temp dir.
  const attachDir = () => path.join(os.tmpdir(), 'ruqenai-attachments');

  ipcMain.handle('attach:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'All files', extensions: ['*'] }],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('attach:file', (_e, sessionId: string, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) return false;
    const session = sessionManager.getSavedSession(sessionId);
    if (!session) throw new Error('Chat not found.');
    sessionManager.focusSession(session);
    return sessionManager.attachFile(filePath);
  });

  ipcMain.handle('attach:raw', (_e, sessionId: string, payload: unknown) => {
    const input = (payload ?? {}) as { name?: unknown; data?: unknown };
    const name = String(input.name ?? 'pasted.png');
    const data = String(input.data ?? '');
    if (!data) return false;
    const session = sessionManager.getSavedSession(sessionId);
    if (!session) throw new Error('Chat not found.');
    sessionManager.focusSession(session);
    const dir = attachDir();
    fs.mkdirSync(dir, { recursive: true });
    const safe = name.replace(/[^\w.-]+/g, '-').slice(-60) || 'pasted.png';
    const file = path.join(dir, `${Date.now()}-${safe}`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return sessionManager.attachFile(file);
  });

  ipcMain.handle('attach:list', (_e, sessionId: string) => {
    const session = sessionManager.getSavedSession(sessionId);
    if (!session) return [];
    const mime = (file: string): string => {
      const lower = file.toLowerCase();
      if (lower.endsWith('.png')) return 'image/png';
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
      if (lower.endsWith('.gif')) return 'image/gif';
      if (lower.endsWith('.webp')) return 'image/webp';
      return '';
    };
    return session.attachedFiles.map((file) => {
      const type = mime(file);
      let preview: string | undefined;
      if (type) {
        try {
          const size = fs.statSync(file).size;
          if (size <= 4 * 1024 * 1024) preview = `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
        } catch {
          preview = undefined;
        }
      }
      return { name: path.basename(file), path: file, preview };
    });
  });

  ipcMain.handle('attach:remove', (_e, sessionId: string, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) return false;
    const session = sessionManager.getSavedSession(sessionId);
    if (!session) throw new Error('Chat not found.');
    sessionManager.focusSession(session);
    return sessionManager.dropFile(filePath);
  });

  ipcMain.handle('chat:list', () => chatList());

  ipcMain.handle('system:hardware', () => ({
    cores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    platform: process.platform,
  }));

  ipcMain.handle('project:list', () => store.projects);

  ipcMain.handle('project:add', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const p = result.filePaths[0];
    if (!store.projects.includes(p)) store.projects.unshift(p);
    store.activeProject = p;
    saveStore();
    return p;
  });

  ipcMain.handle('project:setActive', (_e, p: string) => {
    store.activeProject = p;
    saveStore();
    return true;
  });

  ipcMain.handle('project:remove', (_e, p: string) => {
    store.projects = store.projects.filter((x) => x !== p);
    if (store.activeProject === p) store.activeProject = store.projects[0] ?? null;
    saveStore();
    return true;
  });

  // Decisions flow back from the renderer.
  ipcMain.on('answer:question', (_e, answer: string | undefined) => {
    if (pendingQuestion) {
      const r = pendingQuestion;
      pendingQuestion = null;
      r.resolve(typeof answer === 'string' && answer.length ? answer : undefined);
    }
  });

  ipcMain.on('answer:permission', (_e, requestId: string, allowed: boolean, alwaysAllow: boolean) => {
    const req = permissionManager.getPendingRequest();
    if (req && req.id === requestId) req.onDecide(Boolean(allowed), Boolean(alwaysAllow));
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
if (process.platform === 'win32') app.setAppUserModelId('ai.ruqenai.desktop');

app.whenReady().then(() => {
  registerIpc();
  onComputerUse(showComputerOverlay);

  // Surface permission checks (shell / file writes / network) in the chat UI.
  permissionManager.setRequestListener((request) => {
    if (request) {
      emit('event', {
        type: 'permission',
        request: {
          id: request.id,
          type: request.type,
          target: request.target,
          description: request.description,
          rememberScope: request.rememberScope,
        },
      });
    }
  });

  createWindow();
  void checkDesktopUpdate((update) => emit('event', { type: 'desktop-update', update }));
  const updateTimer = setInterval(() => {
    void checkDesktopUpdate((update) => emit('event', { type: 'desktop-update', update }));
  }, 4 * 60 * 60 * 1000);
  updateTimer.unref();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  activeController?.abort();
  stopComputerUse();
  if (process.platform !== 'darwin') app.quit();
});
