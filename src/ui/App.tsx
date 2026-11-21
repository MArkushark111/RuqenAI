import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { PermissionPrompt } from './PermissionPrompt.js';
import { MouseListener, useMouse } from './MouseListener.js';
import { colors, fit, singleLine } from './terminal.js';
import { Wordmark } from './Wordmark.js';
import { configManager } from '../config/settings.js';
import { DEFAULT_SESSION_NAME, SessionManager, sessionManager, type SavedSession } from '../agent/context.js';
import { clipboardPaths, readWindowsClipboard } from './windowsClipboard.js';
import { stat } from 'node:fs/promises';
import { permissionManager, PermissionRequest } from '../agent/permissions.js';
import { ProviderCatalog } from '../providers/catalog.js';
import { ollamaClient } from '../providers/ollama.js';
import { canonicalCommand, type CommandView } from '../commands/catalog.js';
import { SlashCommandRouter } from '../commands/router.js';
import { AgentEngine, type AgentMode } from '../agent/engine.js';
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
  const [history, setHistory] = useState<string[]>([]);
  const [prefill, setPrefill] = useState<{ text: string }>();
  const [insertion, setInsertion] = useState<{ text: string }>();
  const readingClipboard = useRef(false);
  const [view, setView] = useState<CommandView>();
  const [promptId, setPromptId] = useState<string>();
  const [clipboardError, setClipboardError] = useState('');
  const [scrollOffset, setScrollOffset] = useState(0);
  const [ollamaOnline, setOllamaOnline] = useState<boolean>();
  const [localModels, setLocalModels] = useState<ModelMetadata[]>([]);
  const [localReasoning, setLocalReasoning] = useState<{ model: string; supported: boolean }>();
  const [pendingPermission, setPermission] = useState<PermissionRequest | null>(null);
  const [turn, setTurn] = useState<{ kind: 'command' | 'prompt'; session: SavedSession }>();
  const [gitBranch, setGitBranch] = useState<{ cwd: string; name: string }>();
  const [liveSegments, setLiveSegments] = useState<readonly TranscriptSegment[]>([]);
  const pendingSegments = useRef<readonly TranscriptSegment[]>([]);
  const transcriptTimer = useRef<ReturnType<typeof setTimeout>>();
  const [liveTasks, setLiveTasks] = useState<TaskItem[]>([]);
  const [liveUsage, setLiveUsage] = useState<ProviderUsage>();
  const [showReasoning, setShowReasoning] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});
  const [showActivity, setShowActivity] = useState<boolean>();
  const [activityOnly, setActivityOnly] = useState(false);
  const [suggestionRows, setSuggestionRows] = useState(0);
  const [inputRows, setInputRows] = useState(1);
  const [agentMode, setAgentMode] = useState<AgentMode>('build');
  const submitting = useRef<AbortController>();

  const ultra = config.ultracodeMode;
  const animate = config.animationsEnabled && process.env.RUQENAI_REDUCED_MOTION !== '1' && process.env.TERM !== 'dumb';
  const accent = colors.coffee;
  const isLocal = config.activeProvider === 'ollama';
  const models = isLocal ? localModels : ProviderCatalog.get(config.activeProvider)?.popularModels ?? [];
  const activeModel = models.find((model) => model.id === config.activeModel);
  const session = sessionManager.getSession();
  const work = turn?.session.id === session.id ? turn.kind : undefined;
  const permission = work ? pendingPermission : null;
  const cwd = process.cwd();
  const selectedPrompt = messages.find((message) => message.id === promptId && message.role === 'user');
  const [tabOrder, setTabOrder] = useState<string[]>(() => SessionManager.getOrder());
  const [tabRevision, setTabRevision] = useState(0);
  const tabSessions = useMemo(() => {
    const rank = new Map(tabOrder.map((id, index) => [id, index]));
    const sessions = SessionManager.listAll().filter((chat) => !chat.hidden);
    sessions.sort((a, b) => ((rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
      || b.updatedAt - a.updatedAt);
    const running = turn?.kind === 'prompt' ? turn.session : undefined;
    if (running && !running.hidden && !sessions.some(({ id }) => id === running.id)) {
      sessions.unshift({ id: running.id, name: running.name, updatedAt: running.updatedAt, messageCount: running.messages.length, hidden: false });
    }
    return sessions;
  }, [messages, session.id, tabOrder, tabRevision, turn]);
  const lastReply = [...messages].reverse().find((message) => message.role === 'assistant');
  const tasks = (work === 'prompt' ? liveTasks : lastReply?.tasks ?? []).filter((task) =>
    task.kind === 'plan' ? task.status === 'pending' || task.status === 'in_progress'
      : work === 'prompt' && task.status === 'in_progress');

  const inset = 1;
  const width = Math.max(4, terminal.columns - inset * 2);
  const height = Math.max(4, terminal.rows - 1);
  const showFooter = height >= 12;
  const showChatTabs = width >= 48 && height >= 14;
  const sceneY = 1 + (showChatTabs ? 2 : 0);
  const sceneHeight = Math.max(1, height - sceneY - Number(showFooter));
  const wide = width >= 96;
  const welcome = messages.length === 0 && !work;
  const showRail = wide && (showActivity ?? (!welcome && (!isLocal || (work === 'prompt' ? liveTasks.length : lastReply?.tasks?.length ?? 0) > 0)));
  const compactActivity = !wide && activityOnly && !permission;
  const railWidth = showRail ? Math.min(34, Math.floor(width * 0.27)) : 0;
  const workspaceWidth = Math.min(width, 154);
  const sceneOffset = Math.floor((width - workspaceWidth) / 2);
  const mainArea = workspaceWidth - (railWidth ? railWidth + 3 : 0);
  const mainWidth = Math.min(welcome ? 86 : 114, mainArea);
  const mainOffset = Math.floor((mainArea - mainWidth) / 2);
  const mainX = inset + sceneOffset + mainOffset;
  const modelRow = height >= 11 && !permission;
  const showWorkspace = height >= 11 && !permission;
  const showAttachments = sceneHeight >= 2 && session.attachedFiles.length > 0;
  const showClipboardError = Boolean(clipboardError) && modelRow && !work;
  const composerHeight = (modelRow ? 4 + Number(Boolean(work)) : 1) + Number(showAttachments)
    + Number(showWorkspace) + Number(showClipboardError);
  const maxSuggestionRows = Math.min(10, Math.max(0, sceneHeight - (modelRow ? 9 : 3)));
  const shownSuggestions = permission || work || view || compactActivity ? 0 : Math.min(maxSuggestionRows, suggestionRows);
  const maxInputRows = Math.max(1, sceneHeight - composerHeight - shownSuggestions - 1);
  const extraInputRows = Math.min(maxInputRows, inputRows) - 1;
  const entryHeight = permission ? Math.min(7, Math.max(3, Math.floor(sceneHeight / 2))) : composerHeight + shownSuggestions + extraInputRows;
  const bodyHeight = Math.max(0, welcome
    ? Math.min(sceneHeight - entryHeight, Math.round((sceneHeight + 7 - composerHeight) * 0.43) - shownSuggestions - extraInputRows)
    : sceneHeight - entryHeight);
  const composerY = sceneY + bodyHeight;
  const framed = width >= 22 && height >= 10;
  const boardWidth = Math.min(framed ? width - 4 : width, view?.kind === 'settings' ? 82 : 68);
  const preferredHeight: Partial<Record<CommandView['kind'], number>> = {
    'agent-mode': 8, effort: 13, permissions: 9, settings: 22, 'prompt-actions': 9, 'rewind-prompt': 9,
    'session-menu': 9, 'session-rename': 8,
  };
  const boardHeight = Math.min(framed ? height - (showChatTabs ? 6 : 2) : height, view ? preferredHeight[view.kind] ?? 17 : 0);
  const boardTop = Math.floor((height - boardHeight) / 2);
  const boardLeft = inset + Math.floor((width - boardWidth) / 2);
  const panelInset = framed ? 2 : 0;
  const overlayWidth = boardWidth - panelInset * 2;
  const overlayHeight = boardHeight - panelInset * 2;

  const previousLines = useMemo(() => messages
    .map((message) => formatMessage(message, mainWidth, (id) => expandedReasoning[id] ?? showReasoning))
    .filter((rows) => rows.length > 0)
    .flatMap((rows, index) => index === 0 ? rows : [{ text: '' }, ...rows]), [messages, mainWidth, showReasoning, expandedReasoning]);
  const displayingStream = work === 'prompt' && liveSegments.length > 0;
  const lines = displayingStream ? [
    ...previousLines,
    { text: '' },
    ...formatMessage({ role: 'assistant', content: '', segments: liveSegments, tasks: liveTasks },
      mainWidth, (id) => expandedReasoning[id] ?? showReasoning),
  ] : previousLines;
  const maxOffset = lines.length > bodyHeight ? lines.length - bodyHeight + 1 : 0;

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
      submitting.current?.abort();
      clearTimeout(transcriptTimer.current);
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
    if ((submitting.current && (kind !== 'sessions' || turn?.kind === 'command'))
      || kind === 'provider-setup' || kind === 'session-menu' || kind === 'session-rename') return;
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
    if (turn?.kind === 'command') return;
    if (id === '__new__') {
      if (sessionManager.switchSession(`session-${Date.now()}-${randomUUID().slice(0, 8)}`, { create: true })) refreshTab();
      return;
    }
    if (id === '__overflow__') { open('sessions'); return; }
    if (id === session.id) { setView(undefined); return; }
    if (id === turn?.session.id) sessionManager.focusSession(turn.session);
    else if (!sessionManager.switchSession(id)) return;
    refreshTab();
  }

  function closeTab(id: string) {
    if (turn?.kind === 'command' || id === turn?.session.id || view) return;
    const wasCurrent = id === session.id;
    const index = tabSessions.findIndex((tab) => tab.id === id);
    if (!SessionManager.deleteSession(id)) return;
    setTabOrder(SessionManager.getOrder());
    if (wasCurrent) {
      const adjacent = tabSessions[index + 1] ?? tabSessions[index - 1];
      if (adjacent?.id === turn?.session.id && turn) sessionManager.focusSession(turn.session);
      else if (!adjacent || !sessionManager.switchSession(adjacent.id)) sessionManager.startFreshSession();
      refreshTab();
    }
  }

  function reorderTabs(ids: string[]) {
    setTabOrder(ids);
    SessionManager.setOrder(ids);
  }

  async function pasteClipboard(pastedText?: string, attachmentOnly = false) {
    if (process.platform !== 'win32' || readingClipboard.current || submitting.current || permission
      || (!attachmentOnly && (view || compactActivity))) return;
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
      if (sessionManager.getSession() !== target || submitting.current) return;
      if (files.length) {
        for (const file of files) sessionManager.attachFile(file);
        setMessages([...target.messages]);
      } else if (text && !attachmentOnly) setInsertion({ text });
      else setClipboardError(failed ? 'Could not read the Windows clipboard.' : 'Clipboard has no readable file or image.');
    } finally {
      readingClipboard.current = false;
    }
  }

  useEffect(() => {
    onPaste?.((text) => {
      if (view || permission || compactActivity || submitting.current) return false;
      const couldBeFile = !text.trim() || clipboardPaths(text).length > 0 || /^https?:\/\//i.test(text.trim());
      if (process.platform === 'win32' && couldBeFile && !readingClipboard.current) void pasteClipboard(text);
      else if (text) setInsertion({ text });
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
    if (view || permission || compactActivity || event.x <= mainX || event.x > mainX + mainWidth) return;
    if (event.y <= sceneY || event.y > composerY) return;
    if (event.type === 'scroll_up' || event.type === 'scroll_down') scrollBy(event.type === 'scroll_up' ? 3 : -3);
  });

  useInput((input, key) => {
    if (permission || view) return;
    if (key.escape && work) {
      submitting.current?.abort();
      return;
    }
    if (key.escape && compactActivity) setActivityOnly(false);
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
    const prompt = value.trim() || (target.attachedFiles.length ? 'Review the attachments.' : '');
    if (!prompt) return;
    if (submitting.current) {
      if (turn?.kind !== 'prompt') return;
      const resume = /^\/sessions\s+(\S+)$/i.exec(prompt);
      if (resume) selectTab(resume[1]);
      else if (prompt === '/new') selectTab('__new__');
      return;
    }
    if (process.platform === 'win32' && /^\/[^\s]+$/.test(prompt)
      && canonicalCommand(prompt.slice(1).toLowerCase()) === 'attach') {
      setView(undefined);
      setActivityOnly(false);
      await pasteClipboard(undefined, true);
      return;
    }
    const controller = new AbortController();
    submitting.current = controller;
    const command = prompt.startsWith('/');
    const agentCommand = /^\/(?:agents|subagents|skills)\s+run\s+\S+\s+([\s\S]+)$/i.exec(prompt);
    const messageText = command ? agentCommand?.[1] : prompt;
    setView(undefined);
    setClipboardError('');
    if (!/^\/(login|setup|auth)\b/i.test(prompt)) setHistory((recent) => [...recent.slice(-59), prompt]);
    setActivityOnly(false);
    setScrollOffset(0);
    setLiveSegments([]);
    setLiveTasks([]);
    setLiveUsage(undefined);
    setTurn({ kind: messageText ? 'prompt' : 'command', session: target });
    let promptSaved = false;
    const callbacks = {
      onTranscriptUpdate: (segments: readonly TranscriptSegment[]) => {
        if (controller.signal.aborted) return;
        pendingSegments.current = segments;
        transcriptTimer.current ??= setTimeout(() => {
          transcriptTimer.current = undefined;
          setLiveSegments(pendingSegments.current);
        }, 65);
      },
      onTaskUpdate: setLiveTasks,
      onUsageUpdate: setLiveUsage,
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
        messageText ? target : sessionManager.getSession());
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
      clearTimeout(transcriptTimer.current);
      transcriptTimer.current = undefined;
      pendingSegments.current = [];
      if (!messageText && sessionManager.getSession().id !== target.id) {
        setInsertion(undefined);
        setPrefill(undefined);
      }
      setConfig(configManager.get());
      setTurn(undefined);
      setMessages([...sessionManager.getSession().messages]);
      submitting.current = undefined;
    }
  }

  const activeTool = [...liveTasks].reverse().find((task) => task.status === 'in_progress' && task.kind === 'tool');
  const currentSegment = liveSegments.at(-1);
  const progress = work === 'command' ? 'Running command'
    : activeTool ? activeTool.title
    : currentSegment?.kind === 'text' ? 'Writing response'
    : currentSegment?.kind === 'reasoning' && currentSegment.durationMs === undefined ? 'Reasoning'
    : 'Waiting for model';
  const compactControls = mainWidth < 58;
  const reasoningSupport = isLocal && localReasoning?.model === config.activeModel ? localReasoning.supported : activeModel?.supportsThinking;
  const access = compactControls
    ? { ask: 'Ask', approve: 'Approve', full: 'Full' }[config.permissionMode]
    : permissionLabel[config.permissionMode];
  const modelActions: Action[] = compactActivity ? [] : [
    { label: agentMode === 'plan' ? 'Plan ▾' : 'Build ▾', selected: true, run: () => open('agent-mode') },
    { label: fit(config.activeModel, Math.max(0, mainWidth - stringWidth(access) - 13)) || 'Model', run: () => open('models') },
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
  const composerRule = <Text color={welcome ? '#44382E' : colors.rule}>{'─'.repeat(mainWidth)}</Text>;
  const attachmentNames = session.attachedFiles.map((file) => singleLine(path.basename(file))).join(' · ');
  const attachmentLabel = session.attachedFiles.length === 1 ? 'Attached' : `${session.attachedFiles.length} attached`;

  return (
    <Box flexDirection="column" width={terminal.columns} height={height} paddingX={inset} overflow="hidden">
      <Box justifyContent="space-between" height={1} flexShrink={0}>
        <Text color={colors.ink}>
          <Text bold color={accent}>Ruqenai</Text>
          {folder && <Text color={colors.muted}>{'  /  ' + folder}</Text>}
        </Text>
        <ActionRow actions={headerActions} width={actionWidth} x={inset + width - actionWidth} y={0} blocked={Boolean(view || permission)} />
      </Box>
      {showChatTabs && <ChatTabs width={width} blocked={Boolean(view || turn?.kind === 'command')} busy={turn?.session.id} animate={animate}
        onSelect={selectTab} onClose={closeTab} onReorder={reorderTabs}
        onMenu={(sessionId) => setView({ kind: 'session-menu', sessionId })}
        tabs={[
          ...tabSessions.map((chat) => ({
            id: chat.id,
            label: fit(chat.id === session.id ? session.name : chat.name, 22),
            selected: chat.id === session.id,
          })),
          { id: '__new__', label: '+ New', fixed: true },
        ]} />}
      {showChatTabs && <Text color={colors.rule}>{'─'.repeat(width)}</Text>}

      <Box height={sceneHeight} paddingLeft={sceneOffset} flexShrink={0} overflow="hidden">
        <Box width={mainArea} paddingLeft={mainOffset} display={compactActivity ? 'none' : 'flex'} flexDirection="column">
          <Box width={mainWidth} height={bodyHeight} flexDirection="column" flexShrink={0} overflow="hidden">
            {welcome
              ? <Box height={bodyHeight} justifyContent="flex-end" flexDirection="column" paddingBottom={bodyHeight > 7 ? 1 : 0}>
                <Wordmark width={mainWidth} height={Math.min(7, Math.max(0, bodyHeight - Number(bodyHeight > 7)))} animate={animate} />
              </Box>
              : <ChatHistory lines={lines} width={mainWidth} height={bodyHeight} scrollOffset={scrollOffset} accent={accent}
                onPrompt={view || work || permission || compactActivity ? undefined : (id) => {
                  setPromptId(id);
                  open('prompt-actions');
                }}
                x={mainX} y={sceneY} onReasoning={view || permission || compactActivity ? undefined : (id) =>
                  setExpandedReasoning((expanded) => ({ ...expanded, [id]: !(expanded[id] ?? showReasoning) }))} />}
          </Box>
          {permission && <PermissionPrompt key={permission.id} request={permission} width={mainWidth}
            height={entryHeight} x={mainX} y={composerY} />}
          <Box display={permission ? 'none' : 'flex'} width={mainWidth} flexDirection="column" flexShrink={0}>
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
            <Composer key={session.id} width={mainWidth} accent={accent} active={!work && !view && !permission && !compactActivity}
              history={history} prefill={prefill} insertion={insertion} x={mainX}
              y={composerY + (modelRow ? 2 : 0) + Number(showAttachments) + Number(showClipboardError)}
              onModels={() => open('models')}
              maxInputRows={maxInputRows} onInputRows={setInputRows} canSendAttachments={showAttachments}
              submissionBlocked={Boolean(turn)}
              maxSuggestionRows={maxSuggestionRows} onSuggestionRows={setSuggestionRows}
              placeholder={work ? '' : (!showClipboardError && clipboardError) || (turn ? 'A reply is running in another chat' : 'Ask about this workspace')} onSubmit={handleSubmit}
              footer={modelRow && work && (
              <Text color={accent}>
                {' '}<Spinner active animate={animate} />{'  '}
                {fit(progress + (work === 'prompt' ? '  ·  Esc to cancel' : ''), mainWidth - 4)}
              </Text>
            )} />
            {modelRow && composerRule}
            {showWorkspace && <Text color={colors.muted}>{workspaceLabel}</Text>}
          </Box>
        </Box>

        {(showRail || compactActivity) && (
          <Box width={compactActivity ? width : railWidth + 3} paddingLeft={compactActivity ? 0 : 2} flexDirection="column" flexShrink={0}
            borderStyle={compactActivity ? undefined : 'single'} borderLeft={!compactActivity}
            borderTop={false} borderRight={false} borderBottom={false} borderColor={colors.rule}>
            <ActivityPanel width={compactActivity ? width : railWidth} height={sceneHeight}
              x={compactActivity ? inset : inset + sceneOffset + mainArea + 3} y={sceneY}
              animate={animate} accent={accent} cloud={!isLocal} sessionUsage={session.usage} sessionTokens={session.totalTokens} tasks={tasks}
              liveUsage={work === 'prompt' ? liveUsage : undefined} attachments={session.attachedFiles.length}
              keyboard={compactActivity && !view && !permission} />
          </Box>
        )}
      </Box>

      {showFooter && (
        <Box justifyContent="space-between" height={1} flexShrink={0}>
          <Text color={colors.muted}>{fit(compactActivity ? 'Esc  Back to chat'
            : width >= 62 ? 'Ctrl+P Commands   Shift+Tab Models' : 'Ctrl+P Commands',
            Math.max(0, width - ultraWidth - 2))}</Text>
          {width >= ultraWidth + 4 && <ActionRow actions={[{ label: ultraLabel, run: () => open('effort'), color: colors.muted, glow: ultra && reasoningSupport !== false }]}
            width={ultraWidth} x={inset + width - ultraWidth} y={height - 1} animate={animate} blocked={Boolean(view || permission)} />}
        </Box>
      )}
      {view && !permission && (
        <Box position="absolute" marginTop={boardTop} marginLeft={boardLeft - inset} width={boardWidth} height={boardHeight}
          borderStyle={framed ? 'single' : undefined} borderColor="#51443A"
          paddingX={framed ? 1 : 0} paddingY={framed ? 1 : 0} flexDirection="column">
          <Box position="absolute" marginTop={framed ? -1 : 0} marginLeft={framed ? -1 : 0} width={boardWidth - (framed ? 2 : 0)}>
            <Text backgroundColor={colors.board}>{Array(boardHeight - (framed ? 2 : 0)).fill(' '.repeat(boardWidth - (framed ? 2 : 0))).join('\n')}</Text>
          </Box>
          <CommandOverlay view={view} width={overlayWidth} height={overlayHeight}
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
              if (!sessionManager.editSession(id, changes, turn?.session)) return false;
              setTabRevision((revision) => revision + 1);
              return true;
            }} />
        </Box>
      )}
    </Box>
  );
}
