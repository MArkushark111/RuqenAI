import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import stringWidth from 'string-width';
import { Action, ActionRow } from './ActionRow.js';
import { ActivityPanel, Spinner } from './ActivityPanel.js';
import { ChatHistory, formatMessage } from './ChatHistory.js';
import { ChatTabs } from './ChatTabs.js';
import { CommandOverlay } from './CommandOverlay.js';
import { Composer } from './Composer.js';
import { PermissionPrompt, permissionHeight } from './PermissionPrompt.js';
import { QuestionPrompt, questionHeight, type QuestionRequest } from './QuestionPrompt.js';
import { MouseListener, useMouse } from './MouseListener.js';
import { applyEcoMode, applyTheme, colors, fit, mixHex, singleLine } from './terminal.js';
import { Wordmark } from './Wordmark.js';
import { UpdateBoard } from './UpdateBoard.js';
import { SubagentDetails } from './SubagentDetails.js';
import { checkForUpdate } from '../updates.js';
import { configManager } from '../config/settings.js';
import { DEFAULT_SESSION_NAME, inWorkspace, SessionManager, sessionManager, type SavedSession } from '../agent/context.js';
import { clipboardPaths, extractDroppedFiles, readWindowsClipboard } from './windowsClipboard.js';
import { isLargePaste, stashPaste } from './largePaste.js';
import { stat } from 'node:fs/promises';
import { permissionManager, PermissionRequest } from '../agent/permissions.js';
import { ProviderCatalog } from '../providers/catalog.js';
import { ollamaClient } from '../providers/ollama.js';
import { canonicalCommand, type CommandView } from '../commands/catalog.js';
import { SlashCommandRouter, openSystemPath } from '../commands/router.js';
import { AgentEngine, type AgentMode } from '../agent/engine.js';
import { acquireChatLock } from '../agent/chatLock.js';
import { ChatMessage, ModelMetadata, ProviderUsage, TaskItem, TranscriptSegment } from '../types/index.js';

const permissionLabel = {
  ask: 'Ask permission',
  approve: 'Approve for me',
  full: 'Full access',
};

export function App({ onPaste }: { onPaste?: (handler?: (text: string) => boolean) => void }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const measure = () => ({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
  const [terminal, setTerminal] = useState(measure);
  const [config, setConfig] = useState(() => configManager.get());
  const [messages, setMessages] = useState(() => [...sessionManager.getSession().messages]);
  useEffect(() => sessionManager.onExternalChange(() => {
    setMessages([...sessionManager.getSession().messages]);
  }), []);
  const [history, setHistory] = useState<string[]>([]);
  const [prefill, setPrefill] = useState<{ text: string }>();
  const [insertion, setInsertion] = useState<{ text: string }>();
  const readingClipboard = useRef(false);
  const [view, setView] = useState<CommandView>();
  const [pendingUpdate, setPendingUpdate] = useState<string>();
  const [promptId, setPromptId] = useState<string>();
  const [clipboardError, setClipboardError] = useState('');
  const [scrollOffset, setScrollOffset] = useState(0);
  const [ollamaOnline, setOllamaOnline] = useState<boolean>();
  const [localModels, setLocalModels] = useState<ModelMetadata[]>([]);
  const [localReasoning, setLocalReasoning] = useState<{ model: string; supported: boolean }>();
  const [pendingPermission, setPermission] = useState<PermissionRequest | null>(null);
  const [pendingQuestion, setQuestion] = useState<QuestionRequest>();
  const [turns, setTurns] = useState<Record<string, { kind: 'command' | 'prompt' | 'compact'; session: SavedSession }>>({});
  const [gitBranch, setGitBranch] = useState<{ cwd: string; name: string }>();
  const [liveByChat, setLiveByChat] = useState<Record<string, {
    segments: readonly TranscriptSegment[];
    tasks: TaskItem[];
    usage?: ProviderUsage;
    note?: string;
  }>>({});
  const pendingSegments = useRef<Record<string, readonly TranscriptSegment[]>>({});
  const transcriptTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [showReasoning, setShowReasoning] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});
  const expansionAnchor = useRef<{ id: string; screenRow: number }>();
  const [showActivity, setShowActivity] = useState<boolean>();
  const [activityOnly, setActivityOnly] = useState(false);
  const [suggestionRows, setSuggestionRows] = useState(0);
  const [inputRows, setInputRows] = useState(1);
  const [agentMode, setAgentMode] = useState<AgentMode>('build');
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const check = (retryOnFailure: boolean) => {
      void checkForUpdate(controller.signal).then((release) => {
        if (!controller.signal.aborted) setPendingUpdate(release);
      }).catch(() => {
        if (retryOnFailure && !controller.signal.aborted) retry = setTimeout(() => check(false), 10_000);
      });
    };
    check(true);
    return () => { clearTimeout(retry); controller.abort(); };
  }, []);

  useEffect(() => {
    if (!pendingUpdate) return;
    if (view?.kind === 'update') {
      setPendingUpdate(undefined);
      return;
    }
    if (view || Object.keys(turns).length || pendingPermission || controllers.current.size || terminal.rows < 12) return;
    setView({ kind: 'update', release: pendingUpdate });
    setPendingUpdate(undefined);
  }, [pendingUpdate, view, turns, pendingPermission, terminal.rows]);

  const ultra = config.ultracodeMode;
  const animate = config.animationsEnabled && process.env.RUQENAI_REDUCED_MOTION !== '1' && process.env.TERM !== 'dumb';
  const accent = colors.coffee;
  const isLocal = config.activeProvider === 'ollama';
  const models = isLocal ? localModels : ProviderCatalog.get(config.activeProvider)?.popularModels ?? [];
  const activeModel = models.find((model) => model.id === config.activeModel);
  const session = sessionManager.getSession();
  const eco = session.ecoMode === true;
  useEffect(() => {
    applyEcoMode(eco);
  }, [eco, session.id]);
  useEffect(() => {
    applyTheme(config.theme);
  }, [config.theme]);
  const activeTurn = turns[session.id];
  const work = activeTurn?.kind;
  const busyIds = useMemo(() => new Set(Object.keys(turns)), [turns]);
  const commandRunning = useMemo(() => Object.values(turns).some((turn) => turn.kind === 'command'), [turns]);
  const live = liveByChat[session.id];
  const liveSegments = live?.segments ?? [];
  const liveTasks = live?.tasks ?? [];
  const liveUsage = live?.usage;
  const statusNote = live?.note;
  const permission = work ? pendingPermission : null;
  const question = work ? pendingQuestion : undefined;
  const interaction = Boolean(permission || question);
  const cwd = process.cwd();
  const selectedPrompt = messages.find((message) => message.id === promptId && message.role === 'user');
  const [tabOrder, setTabOrder] = useState<string[]>(() => SessionManager.getOrder());
  const [tabRevision, setTabRevision] = useState(0);
  const tabSessions = useMemo(() => {
    const rank = new Map(tabOrder.map((id, index) => [id, index]));
    const sessions = SessionManager.listAll().filter((chat) => !chat.hidden && inWorkspace(chat.workspace));
    sessions.sort((a, b) => ((rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
      || b.updatedAt - a.updatedAt);
    for (const turn of Object.values(turns)) {
      if (turn.kind !== 'prompt' || turn.session.hidden || sessions.some(({ id }) => id === turn.session.id)) continue;
      sessions.unshift({
        id: turn.session.id, name: turn.session.name, updatedAt: turn.session.updatedAt,
        messageCount: turn.session.messages.length, hidden: false, ecoMode: turn.session.ecoMode,
      });
    }
    return sessions;
  }, [messages, session.id, tabOrder, tabRevision, turns]);
  const lastReply = [...messages].reverse().find((message) => message.role === 'assistant');
  const currentTasks = work === 'prompt' ? liveTasks : lastReply?.tasks ?? [];
  const tasks = currentTasks.filter((task) =>
    task.kind === 'plan' || (work === 'prompt' && task.status === 'in_progress' && !task.subagent && !task.parentTaskId));
  const subagentHistory = useMemo(() => [...messages].reverse().flatMap((message) =>
    [...(message.tasks ?? [])].reverse().filter((task) => task.tool === 'delegate')), [messages]);
  const liveSubagents = work === 'prompt' ? liveTasks.filter((task) => task.tool === 'delegate') : [];
  const allSubagents = [...liveSubagents, ...subagentHistory];
  const subagents = currentTasks.filter((task) => task.tool === 'delegate');
  const viewedSubagent = view?.kind === 'subagent-detail' ? allSubagents.find((task) => task.id === view.taskId) : undefined;
  const showSubagentChat = Boolean(viewedSubagent && !interaction);
  useEffect(() => {
    if (view?.kind === 'subagent-detail' && !viewedSubagent) setView(undefined);
  }, [view, viewedSubagent]);

  const inset = 1;
  const width = Math.max(4, terminal.columns - inset * 2);
  const height = Math.max(4, terminal.rows - 1);
  const showFooter = height >= 12;
  const showChatTabs = width >= 48 && height >= 14;
  const sceneY = 1 + (showChatTabs ? 2 : 0);
  const sceneHeight = Math.max(1, height - sceneY - Number(showFooter));
  const wide = width >= 96;
  const welcome = messages.length === 0 && !work;
  const showRail = wide && (showActivity ?? (!welcome && (!isLocal || currentTasks.length > 0 || subagents.length > 0)));
  const compactActivity = !wide && activityOnly && !interaction;
  const railWidth = showRail ? Math.min(34, Math.floor(width * 0.27)) : 0;
  const workspaceWidth = Math.min(width, 154);
  const sceneOffset = Math.floor((width - workspaceWidth) / 2);
  const mainArea = workspaceWidth - (railWidth ? railWidth + 3 : 0);
  const mainWidth = Math.min(welcome ? 86 : 114, mainArea);
  const mainOffset = Math.floor((mainArea - mainWidth) / 2);
  const mainX = inset + sceneOffset + mainOffset;
  const modelRow = height >= 11 && !interaction;
  const showWorkspace = height >= 11 && !interaction;
  const showAttachments = sceneHeight >= 2 && session.attachedFiles.length > 0;
  const showClipboardError = Boolean(clipboardError) && modelRow && !work;
  const composerHeight = (modelRow ? 4 + Number(Boolean(work)) : 1) + Number(showAttachments)
    + Number(showWorkspace) + Number(showClipboardError);
  const maxSuggestionRows = Math.min(10, Math.max(0, sceneHeight - (modelRow ? 9 : 3)));
  const shownSuggestions = interaction || work || view || compactActivity ? 0 : Math.min(maxSuggestionRows, suggestionRows);
  const maxInputRows = Math.max(1, sceneHeight - composerHeight - shownSuggestions - 1);
  const extraInputRows = Math.min(maxInputRows, inputRows) - 1;
  const entryHeight = question ? Math.min(questionHeight(question, mainWidth), sceneHeight)
    : permission ? Math.min(permissionHeight(permission, mainWidth), sceneHeight) : composerHeight + shownSuggestions + extraInputRows;
  const bodyHeight = Math.max(0, welcome
    ? Math.min(sceneHeight - entryHeight, Math.round((sceneHeight + 7 - composerHeight) * 0.43) - shownSuggestions - extraInputRows)
    : sceneHeight - entryHeight);
  const composerY = sceneY + bodyHeight;
  const framed = width >= 22 && height >= 10;
  const boardWidth = Math.min(framed ? width - 4 : width, view?.kind === 'settings' ? 82 : 68);
  const preferredHeight: Partial<Record<CommandView['kind'], number>> = {
    'agent-mode': 8, effort: 13, permissions: 9, settings: 22, 'prompt-actions': 9, 'rewind-prompt': 9, host: 12, theme: 15,
    'session-menu': 9, 'session-rename': 8, update: 13,
  };
  const boardHeight = Math.min(framed ? height - (showChatTabs ? 6 : 2) : height, view ? preferredHeight[view.kind] ?? 17 : 0);
  const boardTop = Math.floor((height - boardHeight) / 2);
  const boardLeft = inset + Math.floor((width - boardWidth) / 2);
  const panelInset = framed ? 2 : 0;
  const overlayWidth = boardWidth - panelInset * 2;
  const overlayHeight = boardHeight - panelInset * 2;

  const previousLines = useMemo(() => messages
    .map((message) => formatMessage(message, mainWidth, (id) => expandedReasoning[id] ?? (!id.startsWith('output:') && showReasoning)))
    .filter((rows) => rows.length > 0)
    .flatMap((rows, index) => index === 0 ? rows : [{ text: '' }, ...rows]), [messages, mainWidth, showReasoning, expandedReasoning]);
  const displayingStream = work === 'prompt' && liveSegments.length > 0;
  const lines = displayingStream ? [
    ...previousLines,
    { text: '' },
    ...formatMessage({ role: 'assistant', content: '', segments: liveSegments, tasks: liveTasks },
      mainWidth, (id) => expandedReasoning[id] ?? (!id.startsWith('output:') && showReasoning)),
  ] : previousLines;
  const maxOffset = lines.length > bodyHeight ? lines.length - bodyHeight + 1 : 0;
  useLayoutEffect(() => {
    const anchor = expansionAnchor.current;
    if (!anchor) return;
    expansionAnchor.current = undefined;
    const row = lines.findIndex((line) => line.reasoningId === anchor.id);
    if (row >= 0) {
      const offset = lines.length - row - bodyHeight + anchor.screenRow;
      setScrollOffset(Math.max(0, Math.min(maxOffset, offset)));
    }
  }, [lines, bodyHeight, maxOffset]);

  useEffect(() => {
    let current = true;
    const readBranch = () => execFile('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd, windowsHide: true, timeout: 2000,
    }, (error, stdout) => {
      if (!current) return;
      const name = error ? '' : singleLine(stdout.trim());
      setGitBranch((previous) => previous?.cwd === cwd && previous.name === name ? previous : { cwd, name });
    });
    readBranch();
    const timer = setInterval(readBranch, 5000);
    return () => { current = false; clearInterval(timer); };
  }, [cwd]);

  useEffect(() => {
    const resize = () => setTerminal(measure());
    stdout.on('resize', resize);
    return () => { stdout.off('resize', resize); };
  }, [stdout]);

  useEffect(() => {
    const host = configManager.getOllamaHost();
    ollamaClient.setBaseUrl(host);
    setOllamaOnline(undefined);
    if (!config.ollamaAutoDetect || !isLocal) return;
    let active = true;
    const check = () => void ollamaClient.detect().then(({ isOnline, models: installed }) => {
      if (!active) return;
      setOllamaOnline(isOnline);
      setLocalModels(isOnline ? installed : []);
      const latest = configManager.get();
      if (isOnline && latest.activeProvider === 'ollama' && !configManager.hasSelectedModel()
        && installed[0] && !installed.some(({ id }) => id === latest.activeModel)) {
        setConfig(configManager.update({ activeModel: installed[0].id }, { rememberModel: false }));
      }
    });
    check();
    const timer = setInterval(check, 12_000);
    return () => { active = false; clearInterval(timer); };
  }, [isLocal, config.ollamaHost, config.ollamaAutoDetect]);

  useEffect(() => {
    if (!isLocal || !ollamaOnline) return;
    const controller = new AbortController();
    void ollamaClient.showModel(config.activeModel, controller.signal).then((details) => {
      if (!controller.signal.aborted && details?.capabilities) {
        setLocalReasoning({
          model: config.activeModel,
          supported: details.thinking?.values?.some((value) => value !== false) ?? details.capabilities.includes('thinking'),
        });
      }
    });
    return () => controller.abort();
  }, [isLocal, ollamaOnline, config.activeModel, config.ollamaHost]);

  useEffect(() => {
    permissionManager.setRequestListener(setPermission);
    MouseListener.start();
    return () => {
      for (const controller of controllers.current.values()) controller.abort();
      for (const timer of Object.values(transcriptTimers.current)) clearTimeout(timer);
      permissionManager.setRequestListener(undefined);
      MouseListener.stop();
    };
  }, []);

  useEffect(() => {
    if (!clipboardError) return;
    const timer = setTimeout(() => setClipboardError(''), 4500);
    return () => clearTimeout(timer);
  }, [clipboardError]);

  function scrollBy(delta: number) {
    setScrollOffset((previous) => Math.max(0, Math.min(maxOffset, Math.min(maxOffset, previous) + delta)));
  }

  function toggleActivity() {
    if (wide) setShowActivity(!showRail);
    else setActivityOnly((current) => !current);
  }

  function open(kind: CommandView['kind']) {
    if ((controllers.current.has(session.id) && (kind !== 'sessions' || work === 'command'))
      || kind === 'provider-setup' || kind === 'session-menu' || kind === 'session-rename' || kind === 'subagent-detail') return;
    setActivityOnly(false);
    setView({ kind });
  }

  function refreshTab() {
    setView(undefined);
    setMessages([...sessionManager.getSession().messages]);
    setScrollOffset(0);
    setActivityOnly(false);
    setClipboardError('');
    setInsertion(undefined);
    setPrefill(undefined);
  }

  function selectTab(id: string) {
    if (commandRunning) return;
    if (id === '__new__') {
      if (sessionManager.switchSession(`session-${Date.now()}-${randomUUID().slice(0, 8)}`, { create: true })) refreshTab();
      return;
    }
    if (id === '__overflow__') { open('sessions'); return; }
    if (id === session.id) { setView(undefined); return; }
    const running = turns[id];
    if (running) sessionManager.focusSession(running.session);
    else if (!sessionManager.switchSession(id)) return;
    refreshTab();
  }

  function leaveSession(id: string) {
    const index = tabSessions.findIndex((tab) => tab.id === id);
    const adjacent = tabSessions[index + 1] ?? tabSessions[index - 1];
    const adjacentTurn = adjacent ? turns[adjacent.id] : undefined;
    if (adjacentTurn) sessionManager.focusSession(adjacentTurn.session);
    else if (!adjacent || !sessionManager.switchSession(adjacent.id)) sessionManager.startFreshSession();
    refreshTab();
  }

  function deleteChat(id: string): boolean {
    if (!SessionManager.deleteSession(id)) return false;
    setTabOrder(SessionManager.getOrder());
    if (sessionManager.getSession().id === id) leaveSession(id);
    setTabRevision((revision) => revision + 1);
    return true;
  }

  function closeTab(id: string) {
    if (commandRunning || turns[id] || view) return;
    // Default: closing a tab only hides the chat so it can be restored from /sessions.
    // Settings → "Delete chats on tab close" restores permanent deletion.
    if (config.deleteChatsOnClose === true) {
      deleteChat(id);
      return;
    }
    if (!sessionManager.editSession(id, { hidden: true })) return;
    if (id === session.id) leaveSession(id);
    setTabRevision((revision) => revision + 1);
  }

  function reorderTabs(ids: string[]) {
    setTabOrder(ids);
    SessionManager.setOrder(ids);
  }

  async function insertPaste(text: string) {
    if (!isLargePaste(text)) { setInsertion({ text }); return; }
    try {
      const { file, marker } = await stashPaste(text);
      if (controllers.current.has(sessionManager.getSession().id)) return;
      // Attaching the saved file lets the agent read the full text on demand
      // while the composer only ever draws the short marker.
      sessionManager.attachFile(file);
      setMessages([...sessionManager.getSession().messages]);
      setInsertion({ text: marker });
    } catch {
      setInsertion({ text });
    }
  }

  async function pasteClipboard(pastedText?: string, attachmentOnly = false) {
    if (process.platform !== 'win32' || readingClipboard.current || controllers.current.has(sessionManager.getSession().id)
      || permission || (!attachmentOnly && (view || compactActivity))) return;
    readingClipboard.current = true;
    setClipboardError('');
    const target = sessionManager.getSession();
    try {
      let clipboard: Awaited<ReturnType<typeof readWindowsClipboard>> = {};
      let failed = false;
      try {
        clipboard = await readWindowsClipboard();
      } catch {
        failed = true;
      }
      const text = pastedText || clipboard.text || '';
      const paths = clipboard.files?.length ? clipboard.files : clipboardPaths(text);
      const files = (await Promise.all([...new Set(paths)].map(async (file) =>
        (await stat(file).catch(() => undefined))?.isFile() ? file : undefined,
      ))).filter((file): file is string => file !== undefined);
      if (sessionManager.getSession() !== target || controllers.current.has(target.id)) return;
      if (files.length) {
        for (const file of files) sessionManager.attachFile(file);
        setMessages([...target.messages]);
      } else if (text && !attachmentOnly) await insertPaste(text);
      else setClipboardError(failed ? 'Could not read the Windows clipboard.' : 'Clipboard has no readable file or image.');
    } finally {
      readingClipboard.current = false;
    }
  }

  useEffect(() => {
    onPaste?.((text) => {
      if (view || interaction || compactActivity || controllers.current.has(sessionManager.getSession().id)) return false;
      const couldBeFile = !text.trim() || clipboardPaths(text).length > 0 || /^https?:\/\//i.test(text.trim());
      if (process.platform === 'win32' && couldBeFile && !readingClipboard.current) void pasteClipboard(text);
      else if (text) void insertPaste(text);
      return true;
    });
    return () => onPaste?.();
  });

  function rewindPrompt() {
    if (!selectedPrompt) return;
    if (!sessionManager.rewindToPrompt(selectedPrompt.id)) {
      setClipboardError('Could not rewind this chat.');
    } else {
      setMessages([...sessionManager.getSession().messages]);
      setScrollOffset(0);
      setPrefill({ text: selectedPrompt.content });
    }
    setView(undefined);
  }

  useMouse((event) => {
    if (view || interaction || compactActivity || event.x <= mainX || event.x > mainX + mainWidth) return;
    if (event.y <= sceneY || event.y > composerY) return;
    if (event.type === 'scroll_up' || event.type === 'scroll_down') scrollBy(event.type === 'scroll_up' ? 3 : -3);
  });

  useInput((input, key) => {
    if (interaction || view) return;
    if (key.escape && compactActivity) {
      setActivityOnly(false);
      return;
    }
    if (key.escape && work) {
      controllers.current.get(session.id)?.abort();
      return;
    }
    if (key.ctrl && input === 'p') open('commands');
    if (key.ctrl && (input === 'v' || input === 'y')) void pasteClipboard();
    if (key.ctrl && input === 'o') open('models');
    if (key.ctrl && input === 'l') open('sessions');
    if (key.ctrl && input === 't') open('effort');
    if (key.ctrl && input === 'g') toggleActivity();
    if (key.ctrl && input === 'r') {
      setShowReasoning((visible) => !visible);
      setExpandedReasoning({});
    }
    if (key.ctrl && input === 'u') open('effort');
    if (key.shift && key.tab) { open('models'); return; }
    if (!compactActivity && (key.pageUp || key.pageDown)) {
      scrollBy(Math.max(1, bodyHeight - 2) * (key.pageUp ? 1 : -1));
    }
  });

  async function handleSubmit(value: string) {
    const target = sessionManager.getSession();
    const dropped = await extractDroppedFiles(value);
    for (const file of dropped.files) sessionManager.attachFile(file);
    const prompt = dropped.text || (target.attachedFiles.length ? 'Review the attachments.' : '');
    if (!prompt) return;
    if (controllers.current.has(target.id)) return;
    if (process.platform === 'win32' && /^\/[^\s]+$/.test(prompt)
      && canonicalCommand(prompt.slice(1).toLowerCase()) === 'attach') {
      setView(undefined);
      setActivityOnly(false);
      await pasteClipboard(undefined, true);
      return;
    }
    const releaseChat = acquireChatLock('cli');
    if (!releaseChat) {
      setPrefill({ text: value });
      setClipboardError('A reply is running on your phone.');
      return;
    }
    const controller = new AbortController();
    controllers.current.set(target.id, controller);
    const command = prompt.startsWith('/');
    const agentCommand = /^\/(?:agents|subagents|skills)\s+run\s+\S+\s+([\s\S]+)$/i.exec(prompt);
    const messageText = command ? agentCommand?.[1] : prompt;
    setView(undefined);
    setClipboardError('');
    if (!/^\/(login|setup|auth)\b/i.test(prompt)) setHistory((recent) => [...recent.slice(-59), prompt]);
    setActivityOnly(false);
    setScrollOffset(0);
    setLiveByChat((current) => ({ ...current, [target.id]: { segments: [], tasks: [] } }));
    const compacting = command && canonicalCommand(prompt.slice(1).split(/\s+/, 1)[0].toLowerCase()) === 'compact';
    const kind = compacting ? 'compact' as const : messageText ? 'prompt' as const : 'command' as const;
    setTurns((current) => ({ ...current, [target.id]: { kind, session: target } }));
    let promptSaved = false;
    const patchLive = (patch: Partial<{
      segments: readonly TranscriptSegment[];
      tasks: TaskItem[];
      usage?: ProviderUsage;
      note?: string;
    }>) => {
      setLiveByChat((current) => {
        const previous = current[target.id] ?? { segments: [], tasks: [] };
        return { ...current, [target.id]: { ...previous, ...patch } };
      });
    };
    const callbacks = {
      onQuestion: (prompt: Omit<QuestionRequest, 'id' | 'answer'>, signal?: AbortSignal) =>
        new Promise<string | undefined>((resolve) => {
          if (signal?.aborted) return resolve(undefined);
          const id = randomUUID();
          const abort = () => answer();
          function answer(value?: string) {
            signal?.removeEventListener('abort', abort);
            setQuestion((current) => current?.id === id ? undefined : current);
            resolve(value);
          }
          signal?.addEventListener('abort', abort, { once: true });
          setView(undefined);
          setQuestion({ ...prompt, id, answer });
        }),
      onTranscriptUpdate: (segments: readonly TranscriptSegment[]) => {
        if (controller.signal.aborted) return;
        pendingSegments.current[target.id] = segments;
        transcriptTimers.current[target.id] ??= setTimeout(() => {
          delete transcriptTimers.current[target.id];
          patchLive({ segments: pendingSegments.current[target.id] ?? [] });
        }, 65);
      },
      onTaskUpdate: (tasks: TaskItem[]) => patchLive({ tasks }),
      onUsageUpdate: (usage: ProviderUsage) => patchLive({ usage }),
      onNotice: (note: string) => patchLive({ note }),
      onUserMessage: () => {
        promptSaved = true;
        if (sessionManager.getSession() === target) setMessages([...target.messages]);
      },
      onSendRejected: () => {
        if (sessionManager.getSession() === target) setPrefill({ text: value });
      },
    };

    function addFeedback(content: string, error?: string) {
      sessionManager.addMessage({ id: randomUUID(), role: 'system', content, error, timestamp: Date.now() },
        messageText || compacting ? target : sessionManager.getSession());
    }

    try {
      if (command) {
        const result = await SlashCommandRouter.handle(prompt, controller.signal, callbacks, agentMode);
        if (result.action === 'exit') return exit();
        if (result.action === 'clear') {
          sessionManager.clearConversation();
        }
        if (result.view) setView(result.view);
        if (result.output && !result.quiet) {
          if (result.error) addFeedback('', result.output);
          else addFeedback(result.output);
        }
        if (!result.handled) addFeedback(`Unknown command ${prompt.split(/\s+/, 1)[0]}. Press Ctrl+P for commands.`);
      } else {
        await AgentEngine.execute(prompt, callbacks, { signal: controller.signal, mode: agentMode });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (messageText && !promptSaved && sessionManager.getSession() === target) {
        setPrefill({ text: value });
        setClipboardError(detail);
      } else addFeedback('', detail);
    } finally {
      clearTimeout(transcriptTimers.current[target.id]);
      delete transcriptTimers.current[target.id];
      delete pendingSegments.current[target.id];
      if (!messageText && sessionManager.getSession().id !== target.id) {
        setInsertion(undefined);
        setPrefill(undefined);
      }
      setConfig(configManager.get());
      setTurns((current) => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      setLiveByChat((current) => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      if (sessionManager.getSession().id === target.id) setMessages([...target.messages]);
      else {
        setTabRevision((value) => value + 1);
        setMessages([...sessionManager.getSession().messages]);
        setScrollOffset(0);
      }
      controllers.current.delete(target.id);
      releaseChat();
    }
  }

  const activeTool = [...liveTasks].reverse().find((task) => task.status === 'in_progress' && task.kind === 'tool');
  const currentSegment = liveSegments.at(-1);
  const progress = statusNote
    || (work === 'compact' ? 'Summarizing older messages'
      : work === 'command' ? 'Running command'
        : activeTool ? activeTool.title
          : currentSegment?.kind === 'text' ? 'Writing response'
            : currentSegment?.kind === 'reasoning' && currentSegment.durationMs === undefined ? 'Reasoning'
              : 'Waiting for model');
  const compactControls = mainWidth < 58;
  const reasoningSupport = isLocal && localReasoning?.model === config.activeModel ? localReasoning.supported : activeModel?.supportsThinking;
  const access = compactControls
    ? { ask: 'Ask', approve: 'Approve', full: 'Full' }[config.permissionMode]
    : permissionLabel[config.permissionMode];
  const modelActions: Action[] = compactActivity ? [] : [
    { label: agentMode === 'plan' ? 'Plan ▾' : 'Build ▾', selected: true, run: () => open('agent-mode') },
    { label: fit(activeModel?.name || config.activeModel, Math.max(0, mainWidth - stringWidth(access) - 13)) || 'Model',
      run: () => open('models') },
    { label: access, color: config.permissionMode === 'full' ? colors.warning : colors.muted,
      run: () => open('permissions') },
  ];
  const headerActions: Action[] = [
    { label: compactActivity ? 'Back' : tasks.length ? `Activity (${tasks.length})` : 'Activity', run: toggleActivity },
    { label: 'Settings', run: () => open('settings') },
  ];
  const actionWidth = Math.min(Math.max(0, width - 13), headerActions.map(({ label }) => stringWidth(label)).reduce((a, b) => a + b, 0)
    + Math.max(0, headerActions.length - 1) * 3);
  const folderLimit = Math.min(46, Math.max(0, width - actionWidth - 15));
  const named = session.name && session.name !== DEFAULT_SESSION_NAME && session.name !== `Session ${session.id}`;
  const folder = named ? fit(session.name, folderLimit) : '';
  const branch = gitBranch?.cwd === cwd && gitBranch.name ? fit(gitBranch.name, Math.floor(mainWidth / 3)) : '';
  const workspaceLabel = fit(cwd, mainWidth - (branch ? stringWidth(branch) + 3 : 0), true) + (branch ? ` · ${branch}` : '');
  const ultraLabel = `Effort: ${reasoningSupport === false ? 'Default' : ultra ? 'UltraCode' : config.thinkingEnabled ? config.thinkingEffort : 'Off'}`;
  const ultraWidth = stringWidth(ultraLabel);
  const composerRule = <Text color={welcome ? mixHex(colors.board, colors.coffee, 0.22) : colors.rule}>{'─'.repeat(mainWidth)}</Text>;
  const attachmentNames = session.attachedFiles.map((file) => singleLine(path.basename(file))).join(' · ');
  const attachmentLabel = session.attachedFiles.length === 1 ? 'Attached' : `${session.attachedFiles.length} attached`;

  return (
    <Box flexDirection="column" width={terminal.columns} height={height} paddingX={inset} overflowY="hidden">
      <Box justifyContent="space-between" height={1} flexShrink={0}>
        <Text color={colors.ink}>
          <Text bold color={accent}>Ruqenai</Text>
          {folder && <Text color={colors.muted}>{'  /  ' + folder}</Text>}
        </Text>
        <ActionRow actions={headerActions} width={actionWidth} x={inset + width - actionWidth} y={0} blocked={Boolean(view || interaction)} />
      </Box>
      {showChatTabs && <ChatTabs width={width} blocked={Boolean(view || commandRunning)} busy={busyIds} animate={animate}
        onSelect={selectTab} onClose={closeTab} onReorder={reorderTabs}
        onMenu={(sessionId) => setView({ kind: 'session-menu', sessionId })}
        tabs={[
          ...tabSessions.map((chat) => ({
            id: chat.id,
            label: fit(chat.id === session.id ? session.name : chat.name, 22),
            selected: chat.id === session.id,
            eco: chat.ecoMode === true,
          })),
          { id: '__new__', label: '+ New', fixed: true },
        ]} />}
      {showChatTabs && <Text color={colors.rule}>{'─'.repeat(width)}</Text>}

      {showSubagentChat && viewedSubagent && (
        <Box width={workspaceWidth} height={sceneHeight} marginLeft={sceneOffset} flexShrink={0}>
          <SubagentDetails key={viewedSubagent.id} task={viewedSubagent} animate={animate}
            actions={(liveSubagents.includes(viewedSubagent) ? liveTasks
              : messages.find((message) => message.tasks?.includes(viewedSubagent))?.tasks ?? [])
              .filter((task) => task.parentTaskId === viewedSubagent.id)}
            width={workspaceWidth} height={sceneHeight} x={inset + sceneOffset} y={sceneY}
            onClose={() => setView(undefined)} />
        </Box>
      )}
      <Box display={showSubagentChat ? 'none' : 'flex'} width={workspaceWidth} height={sceneHeight}
        marginLeft={compactActivity ? 0 : sceneOffset} flexShrink={0} overflowY="hidden">
        <Box width={mainArea} paddingLeft={mainOffset} flexShrink={0} display={compactActivity ? 'none' : 'flex'} flexDirection="column">
          <Box width={mainWidth} height={bodyHeight} flexDirection="column" flexShrink={0} overflowY="hidden">
            {welcome
              ? <Box height={bodyHeight} justifyContent="flex-end" flexDirection="column" paddingBottom={bodyHeight > 7 ? 1 : 0}>
                <Wordmark width={mainWidth} height={Math.min(7, Math.max(0, bodyHeight - Number(bodyHeight > 7)))} animate={animate} />
              </Box>
              : <ChatHistory lines={lines} width={mainWidth} height={bodyHeight} scrollOffset={scrollOffset} accent={accent}
                onPrompt={view || work || interaction || compactActivity ? undefined : (id) => {
                  setPromptId(id);
                  open('prompt-actions');
                }}
                x={mainX} y={sceneY} onReasoning={view || interaction || compactActivity ? undefined : (id, screenRow) => {
                  if (id.startsWith('subagent:')) {
                    setView({ kind: 'subagent-detail', taskId: id.slice('subagent:'.length) });
                    return;
                  }
                  if (id.startsWith('file:')) {
                    void openSystemPath(id.slice(5));
                    return;
                  }
                  expansionAnchor.current = { id, screenRow };
                  setExpandedReasoning((expanded) => ({ ...expanded, [id]: !(expanded[id] ?? (!id.startsWith('output:') && showReasoning)) }));
                }} />}
          </Box>
          {permission && <PermissionPrompt key={permission.id} request={permission} width={mainWidth}
            height={entryHeight} x={mainX} y={composerY} />}
          {question && <QuestionPrompt key={question.id} request={question} width={mainWidth}
            height={entryHeight} x={mainX} y={composerY} />}
          <Box display={interaction ? 'none' : 'flex'} width={mainWidth} flexDirection="column" flexShrink={0}>
            {modelRow && (
              <>
                {composerRule}
                <ActionRow actions={modelActions} width={mainWidth}
                  x={mainX} y={composerY + 1} background={colors.board} blocked={Boolean(view)} />
              </>
            )}
            {showAttachments && <ActionRow width={mainWidth} x={mainX} y={composerY + (modelRow ? 2 : 0)}
              background={colors.board} blocked={Boolean(view || work)} actions={[{
                label: fit(` ${attachmentLabel}  ${attachmentNames}  ×`, mainWidth),
                run: () => open('attachments'),
              }]} />}
            {showClipboardError && <Text color={colors.error}>{fit(clipboardError, mainWidth)}</Text>}
            <Composer key={session.id} width={mainWidth} accent={accent} active={!work && !view && !interaction && !compactActivity}
              history={history} prefill={prefill} insertion={insertion} x={mainX}
              y={composerY + (modelRow ? 2 : 0) + Number(showAttachments) + Number(showClipboardError)}
              onModels={() => open('models')}
              maxInputRows={maxInputRows} onInputRows={setInputRows} canSendAttachments={showAttachments}
              submissionBlocked={Boolean(work)}
              maxSuggestionRows={maxSuggestionRows} onSuggestionRows={setSuggestionRows}
              placeholder={work ? '' : (!showClipboardError && clipboardError) || 'Ask about this workspace'} onSubmit={handleSubmit}
              footer={modelRow && work && (
              <Text color={accent}>
                {' '}<Spinner active animate={animate} />{'  '}
                {fit(progress + (work === 'prompt' || work === 'compact' ? '  ·  Esc to cancel' : ''), mainWidth - 4)}
              </Text>
            )} />
            {modelRow && composerRule}
            {showWorkspace && <Text color={colors.muted}>{workspaceLabel}</Text>}
          </Box>
        </Box>

        {(showRail || compactActivity) && (
          <Box width={compactActivity ? width : railWidth + 3} flexShrink={0}>
            {!compactActivity && <Box width={3} height={sceneHeight} flexShrink={0}
              borderStyle="single" borderColor={colors.rule} borderTop={false} borderRight={false} borderBottom={false} />}
            <ActivityPanel width={compactActivity ? width : railWidth} height={sceneHeight}
              x={compactActivity ? inset : inset + sceneOffset + mainArea + 3} y={sceneY}
              animate={animate} accent={accent} cloud={!isLocal} sessionUsage={session.usage} sessionTokens={session.totalTokens} tasks={tasks}
              subagents={subagents} onSubagent={view || interaction ? undefined : (taskId) => setView({ kind: 'subagent-detail', taskId })}
              liveUsage={work === 'prompt' ? liveUsage : undefined} attachments={session.attachedFiles.length}
              keyboard={compactActivity && !view && !interaction} />
          </Box>
        )}
      </Box>

      {showFooter && (
        <Box justifyContent="space-between" height={1} flexShrink={0}>
          <Text color={colors.muted}>{fit(showSubagentChat ? 'Subagent transcript' : compactActivity ? 'Esc  Back to chat'
            : width >= 62 ? 'Ctrl+P Commands   Shift+Tab Models' : 'Ctrl+P Commands',
            Math.max(0, width - ultraWidth - 2))}</Text>
          {width >= ultraWidth + 4 && <ActionRow actions={[{ label: ultraLabel, run: () => open('effort'), color: colors.muted, glow: ultra && reasoningSupport !== false }]}
            width={ultraWidth} x={inset + width - ultraWidth} y={height - 1} animate={animate} blocked={Boolean(view || interaction)} />}
        </Box>
      )}
      {view && view.kind !== 'subagent-detail' && !interaction && (
        <Box position="absolute" marginTop={boardTop} marginLeft={boardLeft - inset} width={boardWidth} height={boardHeight}
          borderStyle={framed ? 'single' : undefined} borderColor={mixHex(colors.board, colors.coffee, 0.35)}
          paddingX={framed ? 1 : 0} paddingY={framed ? 1 : 0} flexDirection="column">
          <Box position="absolute" marginTop={framed ? -1 : 0} marginLeft={framed ? -1 : 0} width={boardWidth - (framed ? 2 : 0)}>
            <Text backgroundColor={colors.board}>{Array(boardHeight - (framed ? 2 : 0)).fill(' '.repeat(boardWidth - (framed ? 2 : 0))).join('\n')}</Text>
          </Box>
          {view.kind === 'update' ? <UpdateBoard release={view.release} width={overlayWidth} height={overlayHeight}
            onClose={() => setView(undefined)} /> : <CommandOverlay view={view} width={overlayWidth} height={overlayHeight}
            top={boardTop + panelInset} left={boardLeft + panelInset} accent={accent} reasoningSupport={reasoningSupport} onClose={() => setView(undefined)}
            agentMode={agentMode} onAgentMode={(mode) => { setAgentMode(mode); setView(undefined); }}
            onView={setView} onCommand={(value) => void handleSubmit(value)}
            onFill={(value) => { setView(undefined); setPrefill({ text: value }); }}
            promptText={selectedPrompt?.content} onRewindPrompt={rewindPrompt}
            onDropAttachment={(file) => {
              if (!sessionManager.dropFile(file)) return;
              setMessages([...sessionManager.getSession().messages]);
              if (!sessionManager.getSession().attachedFiles.length) setView(undefined);
            }}
            onChanged={() => setConfig(configManager.get())}
            onEditSession={(id, changes) => {
              if (!sessionManager.editSession(id, changes, turns[id]?.session)) return false;
              setTabRevision((revision) => revision + 1);
              return true;
            }}
            onDeleteSession={deleteChat} />}
        </Box>
      )}
    </Box>
  );
}
