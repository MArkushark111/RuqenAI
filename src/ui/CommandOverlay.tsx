import React, { useEffect, useMemo, useRef, useState } from 'react';
import path from 'node:path';
import { Box, Text, useInput } from 'ink';
import stringWidth from 'string-width';
import { commandGroups, type CommandView } from '../commands/catalog.js';
import { configManager } from '../config/settings.js';
import { ProviderCatalog } from '../providers/catalog.js';
import { ProviderManager } from '../providers/manager.js';
import { SessionManager, sessionManager } from '../agent/context.js';
import type { AgentMode } from '../agent/engine.js';
import { normalizeEndpoint } from '../providers/protocols.js';
import { defaultModelRates, modelRateKey } from '../providers/usage.js';
import type { ProviderMetadata } from '../types/index.js';
import { MouseListener } from './MouseListener.js';
import { colors, fit, graphemes, singleLine } from './terminal.js';

export interface CommandOverlayProps {
  agentMode: AgentMode;
  onAgentMode: (mode: AgentMode) => void;
  view: CommandView;
  width: number;
  height: number;
  top: number;
  left: number;
  accent: string;
  reasoningSupport?: boolean;
  onClose: () => void;
  onCommand: (command: string) => void;
  onView: (view: CommandView) => void;
  onFill?: (command: string) => void;
  onChanged?: () => void;
  promptText?: string;
  onRewindPrompt: () => void;
  onDropAttachment: (file: string) => void;
  onEditSession: (id: string, changes: { name?: string; hidden?: boolean }) => boolean;
}

interface Row {
  id: string;
  label: string;
  detail?: string;
  searchable?: string;
  activate?: () => void;
  menu?: () => void;
}

interface Group {
  title?: string;
  rows: Row[];
}

type Layout = Pick<CommandOverlayProps, 'width' | 'height' | 'top' | 'left' | 'accent' | 'onClose'>;

const selectedSurface = '#47362A';
const panelMuted = '#ADA198';

function pad(text: string, width: number): string {
  const clipped = fit(text, width);
  return clipped + ' '.repeat(Math.max(0, width - stringWidth(clipped)));
}

function inputText(input: string): string {
  return singleLine(input.replace(/(?:\x1b)?\[(?:200|201)~/g, ''));
}

function erase(text: string): string {
  return graphemes(text).slice(0, -1).join('');
}

function PanelHeader({ title, width, accent }: Pick<Layout, 'width' | 'accent'> & { title: string }) {
  const close = width >= 34 ? 'Esc close' : 'Esc';
  return (
    <Box height={1} flexShrink={0} justifyContent="space-between">
      <Text bold color={accent} backgroundColor={colors.board}>{fit(title, Math.max(0, width - close.length - 2))}</Text>
      {width >= 8 && <Text color={panelMuted} backgroundColor={colors.board}>{close}</Text>}
    </Box>
  );
}

function Picker({ title, groups, search = true, message, initialId, ...layout }: Layout & {
  title: string;
  groups: Group[];
  search?: boolean;
  message?: string;
  initialId?: string;
}) {
  const { width, height, top, left, accent, onClose } = layout;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(initialId);
  const [hoveredId, setHoveredId] = useState<string>();
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const entries = groups.flatMap(({ title: groupTitle, rows }) => {
    const filtered = rows.filter((row) => {
      const label = [groupTitle, row.label, row.detail, row.searchable].filter(Boolean).join(' ').toLowerCase();
      return terms.every((term) => label.includes(term));
    });
    if (!filtered.length) return [];
    return [...(groupTitle ? [{ heading: groupTitle }] : []), ...filtered.map((row) => ({ row }))];
  }) as Array<{ heading: string } | { row: Row }>;
  const choices = entries.flatMap((entry) => 'row' in entry && entry.row.activate ? [entry.row] : []);
  const selection = Math.max(0, choices.findIndex((row) => row.id === selectedId));
  const selected = choices[selection];
  const selectedLine = selected ? entries.findIndex((entry) => 'row' in entry && entry.row.id === selected.id) : 0;
  const showSubheading = height >= 5 && (search || Boolean(message));
  const showFooter = height >= 4;
  const rowTop = 1 + Number(showSubheading);
  const room = Math.max(1, height - rowTop - Number(showFooter));
  const first = Math.min(Math.max(0, entries.length - room), Math.max(0, selectedLine - Math.floor(room / 2)));
  const visible = entries.slice(first, first + room);
  const pick = (index: number) => setSelectedId(choices[Math.max(0, Math.min(choices.length - 1, index))]?.id);

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (key.ctrl || key.meta) return;
    if (key.rightArrow && selected?.menu) return selected.menu();
    if (key.return || input === '\n' || input === '\r\n') return selected?.activate?.();
    if (key.tab || key.upArrow || key.downArrow || key.pageUp || key.pageDown) {
      const direction = key.upArrow || key.pageUp || (key.tab && key.shift) ? -1 : 1;
      if (key.tab && choices.length) return pick((selection + direction + choices.length) % choices.length);
      pick(selection + direction * (key.pageUp || key.pageDown ? room : 1));
      return;
    }
    if (!search) return;
    if (key.backspace || key.delete) {
      setQuery(erase(query));
      setSelectedId(undefined);
    } else if (input && !key.tab && !key.leftArrow && !key.rightArrow) {
      const text = inputText(input);
      if (text) {
        setQuery(query + text);
        setSelectedId(undefined);
      }
    }
  });

  useEffect(() => MouseListener.onMouse((event) => {
    const x = event.x - left - 1;
    const y = event.y - top - 1;
    if (event.type === 'move') {
      const entry = x >= 0 && x < width && y >= rowTop ? visible[y - rowTop] : undefined;
      setHoveredId(entry && 'row' in entry && entry.row.activate ? entry.row.id : undefined);
      return;
    }
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    if (event.type === 'scroll_up' || event.type === 'scroll_down') {
      pick(selection + (event.type === 'scroll_up' ? -3 : 3));
    } else if (event.type === 'click' && event.button === 0 && y === 0 && x >= width - (width >= 34 ? 9 : 3)) {
      onClose();
    } else if (event.type === 'click' && y >= rowTop) {
      const entry = visible[y - rowTop];
      if (entry && 'row' in entry) {
        if (event.button === 0) entry.row.activate?.();
        if (event.button === 2) entry.row.menu?.();
      }
    }
  }));

  const matches = choices.length === 0 ? 'No matches' : `${selection + 1} / ${choices.length}`;
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <PanelHeader title={title} width={width} accent={accent} />
      {showSubheading && <Text color={panelMuted} backgroundColor={colors.board}>
        {search ? <><Text color={accent}>{'Find  '}</Text>{fit(query || message || '', width - 6)}</> : fit(message || '', width)}
      </Text>}
      <Box flexDirection="column" height={room} flexShrink={0}>
        {visible.length === 0 && <Text color={panelMuted} backgroundColor={colors.board}>{fit(query ? 'No matching entries' : message || 'No entries', width)}</Text>}
        {visible.map((entry) => {
          if ('heading' in entry) return <Text key={entry.heading} color={panelMuted} backgroundColor={colors.board} bold>{fit(entry.heading, width)}</Text>;
          const { row } = entry;
          const active = row.id === selected?.id;
          const detailWidth = width >= 40 && row.detail ? Math.min(41, Math.floor(width / 2)) : 0;
          const nameWidth = Math.max(0, width - 2 - detailWidth);
          return (
            <Text key={row.id} backgroundColor={row.id === hoveredId ? '#564335' : active ? selectedSurface : colors.board}>
              <Text bold={active} color={active ? accent : row.activate ? colors.ink : panelMuted}>{fit(active ? '› ' : '  ', width) + pad(row.label, nameWidth)}</Text>
              {detailWidth > 0 && <Text color={panelMuted}>{pad('  ' + row.detail, detailWidth)}</Text>}
            </Text>
          );
        })}
      </Box>
      {showFooter && (
        <Box justifyContent="space-between" height={1} flexShrink={0}>
          <Text color={panelMuted} backgroundColor={colors.board}>{fit(width >= 34 ? '↑ ↓ Move   Enter Select' : 'Enter Select', Math.max(0, width - matches.length - 1))}</Text>
          <Text color={panelMuted} backgroundColor={colors.board}>{fit(matches, width)}</Text>
        </Box>
      )}
    </Box>
  );
}

function ProviderPicker(props: CommandOverlayProps) {
  const cfg = configManager.get();
  const sections = new Map<string, Row[]>([
    ['Local and custom', []], ['Configured cloud', []], ['Cloud providers', []], ['Catalog only', []],
  ]);
  for (const provider of ProviderCatalog.all()) {
    const connection = ProviderCatalog.connection(provider.id);
    const configured = !cfg.disconnectedProviders.includes(provider.id)
      && Boolean(configManager.getApiKey(provider.id, provider.envKey) || cfg.customEndpoints[provider.id]);
    const section = provider.id === 'ollama' || provider.id === 'custom' ? 'Local and custom'
      : connection === 'catalog' ? 'Catalog only'
      : configured ? 'Configured cloud' : 'Cloud providers';
    sections.get(section)?.push({
      id: provider.id,
      label: provider.name,
      detail: [provider.id, provider.id === cfg.activeProvider ? 'active' : configured ? 'configured' : ''].filter(Boolean).join(' · '),
      searchable: provider.id,
      activate: () => props.onView({ kind: 'provider-setup', providerId: provider.id }),
    });
  }
  const groups = Array.from(sections, ([title, rows]) => ({ title, rows }));
  return <Picker {...props} title="Providers" groups={groups} message="Search by name or ID" />;
}

function ProviderModels({ requested, ...props }: CommandOverlayProps & { requested?: string }) {
  const cfg = configManager.get();
  const providerIds = useMemo(() => {
    const ids = new Set(['ollama']);
    if (requested && requested !== 'ollama') ids.add(requested);
    if (cfg.activeProvider !== 'ollama') ids.add(cfg.activeProvider);
    for (const provider of ProviderCatalog.all()) {
      if (provider.id === 'ollama' || ProviderCatalog.connection(provider.id) === 'catalog') continue;
      if (configManager.getApiKey(provider.id, provider.envKey) || cfg.customEndpoints[provider.id]) ids.add(provider.id);
    }
    return [...ids].filter((id) => !cfg.disconnectedProviders.includes(id));
  }, [requested, cfg]);
  const [results, setResults] = useState<Record<string, Awaited<ReturnType<typeof ProviderManager.discoverModels>>>>({});

  useEffect(() => {
    let active = true;
    for (const providerId of providerIds) {
      void ProviderManager.discoverModels(providerId).then((result) => {
        if (active) setResults((previous) => ({ ...previous, [providerId]: result }));
      }, () => {
        if (active) setResults((previous) => ({ ...previous, [providerId]: { status: 'unavailable', models: [], detail: 'Discovery failed' } }));
      });
    }
    return () => { active = false; };
  }, [providerIds]);

  const groups: Group[] = providerIds.map((providerId) => {
    const result = results[providerId];
    const provider = result?.provider ?? ProviderCatalog.get(providerId);
    const label = providerId === 'ollama' ? 'Ollama' : provider?.name ?? providerId;
    const status = providerId === 'ollama' && result?.status === 'live' ? 'installed'
      : result?.status === 'live' ? 'live' : result?.status === 'catalog' ? 'catalog' : '';
    const fill = props.onFill;
    const manual: Row[] = fill && result && providerId !== 'ollama'
      && ProviderCatalog.connection(providerId) !== 'catalog' && (result.status !== 'live' || !result.models.length)
      ? [{ id: `manual:${providerId}`, label: 'Enter model ID', detail: 'Use a deployment model by name',
          activate: () => fill(`/model ${providerId} `) }]
      : [];
    if (!result || result.models.length === 0) {
      return { title: label, rows: [{
        id: `verify:${providerId}`,
        label: result ? result.detail || (providerId === 'ollama' ? 'No models installed' : 'No models found') : 'Checking connection',
        detail: result ? 'Open setup' : undefined,
        activate: result ? () => props.onView({ kind: 'provider-setup', providerId }) : undefined,
      }, ...manual] };
    }

    const models: Row[] = result.models.map((model) => ({
      id: `${providerId}:${model.id}`,
      label: model.id,
      detail: [model.id === cfg.activeModel && providerId === cfg.activeProvider ? 'active' : '', model.chatSupport === 'unsupported' ? 'no chat' : model.supportsThinking ? 'reasoning' : ''].filter(Boolean).join(' · '),
      searchable: model.name,
      activate: model.chatSupport === 'unsupported' ? undefined : () => props.onCommand(`/model ${providerId} ${model.id}`),
    }));
    return { title: status ? `${label} · ${status}` : label, rows: [...models, ...manual] };
  });
  return <Picker {...props} title="Models" groups={groups} message="Search installed and cloud models" />;
}

function SetupField({ layout, title, value, masked, onChange, onDone, onCancel, hint }: {
  layout: Layout;
  title: string;
  value: string;
  masked: boolean;
  onChange: (value: string) => void;
  onDone: () => void;
  onCancel?: () => void;
  hint?: string;
}) {
  const { accent, width, height, left, top } = layout;
  useInput((input, key) => {
    if (key.escape) return (onCancel ?? onDone)();
    if (key.return || input === '\n' || input === '\r\n') return onDone();
    if (onCancel && key.ctrl && input === 'u') return onChange('');
    if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageDown || key.pageUp) return;
    if (key.backspace || key.delete) onChange(erase(value));
    else if (input) onChange(value + inputText(input));
  });
  useEffect(() => MouseListener.onMouse((event) => {
    if (event.type !== 'click' || event.button !== 0 || event.x <= left || event.x > left + width) return;
    if (event.y === top + 1 && event.x > left + width - 9) (onCancel ?? onDone)();
    if (event.y === top + 3) onDone();
  }));
  const preview = masked ? '•'.repeat(Math.min(value.length, Math.max(0, width - 3))) : value;
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <PanelHeader title={title} width={width} accent={accent} />
      <Text color={colors.ink} backgroundColor={colors.board}><Text color={accent}>{'› '}</Text>{fit(preview, Math.max(0, width - 3), true)}<Text inverse>{' '}</Text></Text>
      <Text color={panelMuted} backgroundColor={colors.board}>{fit(hint ?? (masked ? 'Paste the key   Enter Done' : 'Enter Done'), width)}</Text>
    </Box>
  );
}

function ProviderSetup({ provider, ...props }: CommandOverlayProps & { provider: ProviderMetadata }) {
  const cfg = configManager.get();
  const kind = ProviderCatalog.connection(provider.id);
  const local = provider.id === 'ollama';
  const needsKey = provider.requiresKey !== false && !local;
  const supportsEndpoint = local || kind === 'compatible' || kind === 'endpoint';
  const savedEndpoint = local ? configManager.getOllamaHost() : cfg.customEndpoints[provider.id] ?? '';
  const savedKey = Boolean(configManager.getApiKey(provider.id, provider.envKey));
  const storedKey = Boolean(configManager.getSavedApiKey(provider.id));
  const [key, setKey] = useState('');
  const [endpoint, setEndpoint] = useState(savedEndpoint);
  const [field, setField] = useState<'key' | 'endpoint' | undefined>(() => needsKey && kind !== 'catalog' && !savedKey ? 'key' : undefined);
  const [status, setStatus] = useState('');
  const checking = useRef(false);

  function validate(): { apiKey?: string; endpoint?: string } {
    const apiKey = key.trim() || undefined;
    const url = endpoint.trim() ? normalizeEndpoint(endpoint.trim()) : '';
    if (kind === 'endpoint' && !url) throw new Error('Enter an API endpoint.');
    if (!apiKey && savedKey && supportsEndpoint && endpoint.trim() !== savedEndpoint) {
      throw new Error('Enter a key for the new endpoint before continuing.');
    }
    if (needsKey && !apiKey && !savedKey) throw new Error('Enter an API key to continue.');
    return { apiKey, endpoint: url || (savedEndpoint && !endpoint.trim() ? provider.defaultBaseUrl : undefined) };
  }

  async function test() {
    if (checking.current) return;
    checking.current = true;
    setStatus('Checking connection');
    try {
      const result = await ProviderManager.checkProvider(provider.id, validate());
      setStatus(result.detail || result.status);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not check the connection.');
    } finally {
      checking.current = false;
    }
  }

  function save() {
    if (checking.current) return;
    try {
      const values = validate();
      const changedEndpoint = supportsEndpoint && endpoint.trim() !== savedEndpoint ? endpoint.trim() : undefined;
      if (values.apiKey || changedEndpoint !== undefined || cfg.disconnectedProviders.includes(provider.id)) {
        configManager.saveProviderConnection(provider.id, { apiKey: values.apiKey, endpoint: changedEndpoint });
        props.onChanged?.();
      }
      props.onView({ kind: 'models', providerId: provider.id });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save provider settings.');
    }
  }

  const back: Row = { id: 'back', label: 'Back to providers', activate: () => props.onView({ kind: 'providers' }) };
  if (kind === 'catalog') {
    return <Picker {...props} title={provider.name} search={false} message="Catalog entry · no chat connection" groups={[{ rows: [back] }]} />;
  }
  if (field) {
    return <SetupField layout={props} title={`${provider.name} · ${field === 'key' ? 'API key' : 'Endpoint'}`}
      value={field === 'key' ? key : endpoint} masked={field === 'key'} onChange={field === 'key' ? setKey : setEndpoint} onDone={() => setField(undefined)} />;
  }
  const rows: Row[] = [];
  if (needsKey || kind === 'endpoint') rows.push({ id: 'key', label: savedKey ? 'Replace API key' : 'Add API key', detail: key ? 'entered' : undefined, activate: () => setField('key') });
  if (supportsEndpoint) rows.push({ id: 'endpoint', label: 'API endpoint', detail: endpoint ? 'configured' : 'default', activate: () => setField('endpoint') });
  rows.push({ id: 'test', label: 'Test connection', activate: () => { void test(); } });
  rows.push({ id: 'save', label: 'Save and view models', activate: save });
  if (storedKey && !local) rows.push({
    id: 'remove', label: 'Remove saved API key', detail: 'Hide this provider’s models',
    activate: () => {
      if (checking.current) return;
      try {
        configManager.removeApiKey(provider.id);
        props.onChanged?.();
        props.onView({ kind: 'providers' });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not remove the saved API key.');
      }
    },
  });
  rows.push(back);
  const firstAction = kind === 'endpoint' && !endpoint ? 'endpoint' : !needsKey || savedKey || key ? 'save' : 'key';
  return <Picker {...props} title={provider.name} search={false} message={status || ProviderCatalog.setupHint(provider.id) || 'Connection setup'}
    initialId={firstAction} groups={[{ rows }]} />;
}

function CommandContent(props: CommandOverlayProps) {
  const { view, onCommand, onFill, onView } = props;
  const cfg = configManager.get();
  switch (view.kind) {
    case 'session-menu':
    case 'session-rename':
      return <SessionMenu {...props} view={view} />;
    case 'attachments': {
      const rows = sessionManager.getSession().attachedFiles.map((file) => ({
        id: file, label: path.basename(file), detail: path.dirname(file),
        activate: () => props.onDropAttachment(file),
      }));
      return <Picker {...props} title="Remove attachment" groups={[{ rows }]} message="Choose a file to detach from this chat" search={false} />;
    }
    case 'prompt-actions':
      return <Picker {...props} title="Prompt actions" search={false} message={singleLine(props.promptText ?? '')}
        groups={[{ rows: [
          { id: 'edit', label: 'Copy to draft', activate: () => onFill?.(props.promptText ?? '') },
          { id: 'rewind', label: 'Rewind to this prompt', activate: () => onView({ kind: 'rewind-prompt' }) },
        ] }]} />;
    case 'rewind-prompt':
      return <Picker {...props} title="Rewind chat" search={false} message="Remove this prompt and all later messages?"
        groups={[{ rows: [
          { id: 'back', label: 'Cancel', activate: () => onView({ kind: 'prompt-actions' }) },
          { id: 'confirm', label: 'Rewind and restore draft', activate: props.onRewindPrompt },
        ] }]} />;
    case 'agent-mode':
      return <Picker {...props} title="Agent mode" search={false} initialId={props.agentMode}
        groups={[{ rows: [
          { id: 'build', label: 'Build', detail: 'Edit and run with permissions', activate: () => props.onAgentMode('build') },
          { id: 'plan', label: 'Plan', detail: 'Inspect and propose steps', activate: () => props.onAgentMode('plan') },
        ] }]} />;
    case 'commands': {
      const groups = commandGroups.map(({ name, commands }) => ({ title: name, rows: commands.map((entry) => ({
        id: entry.name,
        label: `/${entry.name}${entry.usage ? ` ${entry.usage}` : ''}`,
        detail: entry.summary,
        searchable: entry.aliases?.map((alias) => '/' + alias).join(' '),
        activate: () => entry.prefill && onFill ? onFill(`/${entry.name} `) : onCommand(`/${entry.name}`),
      })) }));
      return <Picker {...props} title="Commands" groups={groups} message="Search commands" />;
    }
    case 'providers':
      return <ProviderPicker {...props} />;
    case 'models':
      return <ProviderModels {...props} requested={view.providerId} />;
    case 'provider-setup': {
      const provider = ProviderCatalog.get(view.providerId);
      return provider ? <ProviderSetup {...props} provider={provider} /> : <ProviderPicker {...props} />;
    }
    case 'effort': {
      return <EffortPicker {...props} />;
    }
    case 'permissions': {
      const modes = [['ask', 'Ask permission', 'Ask for approval before actions'], ['approve', 'Approve for me', 'Allow reads and remembered actions'], ['full', 'Full access', 'Allow actions without prompts']];
      const rows = modes.map(([mode, label, description]) => ({
        id: mode, label, detail: `${mode === cfg.permissionMode ? 'current · ' : ''}${description}`, activate: () => onCommand(`/mode ${mode}`),
      }));
      return <Picker {...props} title="Access" groups={[{ rows }]} search={false} />;
    }
    case 'settings':
      return <Settings {...props} />;
    case 'sessions': {
      const current = sessionManager.getSession();
      const rows: Row[] = [{ id: 'new', label: 'New chat', activate: () => onCommand('/new') }];
      const hidden: Row[] = [];
      for (const session of SessionManager.listAll()) {
        (session.hidden ? hidden : rows).push({ id: session.id, label: session.name, searchable: session.id,
          detail: session.id === current.id ? 'current' : `${session.messageCount} messages`,
          activate: () => onCommand(`/sessions ${session.id}`),
          menu: () => onView({ kind: 'session-menu', sessionId: session.id, fromSessions: true }) });
      }
      return <Picker {...props} title="Chats" groups={[{ rows }, { title: 'Hidden chats', rows: hidden }]}
        message="Search saved chats · Right-click for options" />;
    }
  }
}

function SessionMenu(props: CommandOverlayProps & { view: Extract<CommandView, { sessionId: string }> }) {
  const { view, onView, onClose, onEditSession } = props;
  const chat = SessionManager.listAll().find((item) => item.id === view.sessionId);
  const [name, setName] = useState(chat?.name ?? '');
  const [error, setError] = useState('');
  const close = () => view.fromSessions ? onView({ kind: 'sessions' }) : onClose();
  if (!chat) return <Picker {...props} title="Chat options" groups={[]} message="Chat unavailable" search={false} onClose={close} />;
  if (view.kind === 'session-rename') {
    return <SetupField layout={props} title="Rename chat" value={name} masked={false}
      onChange={setName} onCancel={() => onView({ ...view, kind: 'session-menu' })}
      hint={error || 'Enter save   Ctrl+U clear   Esc cancel'} onDone={() => {
        const title = name.trim();
        if (!title || graphemes(title).length > 72) return setError('Enter a title from 1 to 72 characters.');
        if (onEditSession(chat.id, { name: title })) close();
        else setError('Could not save the chat name.');
      }} />;
  }
  return <Picker {...props} title="Chat options" search={false} message={error || chat.name} onClose={close}
    groups={[{ rows: [
      { id: 'rename', label: 'Rename', activate: () => onView({ ...view, kind: 'session-rename' }) },
      { id: 'hide', label: chat.hidden ? 'Stop hiding' : 'Hide tab', activate: () => {
        if (onEditSession(chat.id, { hidden: !chat.hidden })) close();
        else setError('Could not update the tab.');
      } },
    ] }]} />;
}

function Settings(props: CommandOverlayProps) {
  const cfg = configManager.get();
  const { onView, onCommand, onChanged } = props;
  const [editor, setEditor] = useState<{ label: string; save: (value: string) => void; hint?: string }>();
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string>();
  const edit = (id: string, label: string, detail: string, save: (value: string) => void, initial = detail, hint?: string): Row => ({
    id, label, detail, activate: () => {
      setSelected(id);
      setValue(initial);
      setMessage('');
      setEditor({ label, save, hint });
    },
  });
  const toggle = (id: string, label: string, enabled: boolean, apply: () => void): Row => ({
    id, label, detail: enabled ? 'On' : 'Off', activate: () => {
      setSelected(id);
      apply();
      onChanged?.();
    },
  });
  if (editor) return <SetupField layout={props} title={editor.label} value={value} masked={false}
    onChange={setValue} onCancel={() => { setEditor(undefined); setMessage(''); }}
    hint={message || editor.hint || 'Enter save   Esc cancel   Ctrl+U clear'}
    onDone={() => {
      try {
        editor.save(value.trim());
        setEditor(undefined);
        setMessage(`${editor.label} saved.`);
        onChanged?.();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }} />;

  const rateKey = modelRateKey(cfg.activeProvider, cfg.activeModel);
  const savedRates = cfg.modelRates[rateKey];
  const rateText = savedRates ? `${savedRates.input} ${savedRates.output}` : '';
  const standardRates = defaultModelRates(cfg.activeProvider, cfg.activeModel, cfg.customEndpoints[cfg.activeProvider]);
  const editRates = edit('rates', 'Token rates (USD per 1M)', savedRates
    ? `$${savedRates.input} in  $${savedRates.output} out`
    : standardRates ? `$${standardRates.input} in  $${standardRates.output} out (default)` : 'Use provider cost when available', (raw) => {
    const modelRates = { ...cfg.modelRates };
    if (raw) {
      const parts = raw.split(/\s+/);
      const [input, output] = parts.map(Number);
      if (parts.length !== 2 || !Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) {
        throw new Error('Enter two prices such as 0.15 0.60. Leave blank to reset.');
      }
      modelRates[rateKey] = { input, output };
    } else {
      delete modelRates[rateKey];
    }
    configManager.update({ modelRates });
  }, rateText, 'Input and output prices separated by a space · Enter save');
  const groups: Group[] = [
    { title: 'Provider and model', rows: [
      { id: 'providers', label: 'Providers and API keys', detail: cfg.activeProvider, activate: () => onView({ kind: 'providers' }) },
      { id: 'models', label: 'Active model', detail: cfg.activeModel, activate: () => onView({ kind: 'models' }) },
      ...(cfg.activeProvider !== 'ollama' ? [editRates] : []),
    ] },
    { title: 'Generation', rows: [
      { id: 'effort', label: 'Reasoning effort', detail: props.reasoningSupport === false ? 'Default' : cfg.ultracodeMode ? 'UltraCode' : cfg.thinkingEnabled ? cfg.thinkingEffort : 'Off', activate: () => onView({ kind: 'effort' }) },
      edit('temperature', 'Temperature', String(cfg.temperature), (raw) => {
        const temperature = Number(raw);
        if (!raw || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('Enter a temperature from 0 to 2.');
        configManager.update({ temperature });
      }),
      edit('tokens', 'Maximum output tokens', cfg.maxTokens?.toString() ?? 'Provider default', (raw) => {
        const maxTokens = raw === '' ? undefined : Number(raw);
        if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens < 1)) throw new Error('Enter a positive whole number or leave it blank.');
        configManager.update({ maxTokens });
      }, cfg.maxTokens?.toString() ?? ''),
    ] },
    { title: 'Local Ollama', rows: [
      edit('host', 'Ollama server URL', configManager.getOllamaHost(), (raw) => {
        configManager.setEndpoint('ollama', raw);
      }, cfg.ollamaHost),
      toggle('detect', 'Auto-detect Ollama', cfg.ollamaAutoDetect, () => configManager.update({ ollamaAutoDetect: !cfg.ollamaAutoDetect })),
    ] },
    { title: 'Permissions', rows: [
      { id: 'permissions', label: 'Access mode', detail: cfg.permissionMode, activate: () => onView({ kind: 'permissions' }) },
      { id: 'approvals', label: 'Remembered approvals', detail: `${cfg.approvedCommands.length} commands · ${cfg.approvedPaths.length} paths`, activate: () => onCommand('/approvals') },
    ] },
    { title: 'Interface and files', rows: [
      toggle('animations', 'Animations', cfg.animationsEnabled, () => configManager.update({ animationsEnabled: !cfg.animationsEnabled })),
      { id: 'config', label: 'Show configuration', detail: 'Redacted JSON', activate: () => onCommand('/config show') },
      { id: 'workspace', label: 'Write workspace config', detail: 'ruqenai.json', activate: () => onCommand('/init') },
    ] },
  ];
  return <Picker {...props} title="Settings" groups={groups} initialId={selected} search={false} message={message} />;
}

function EffortPicker(props: CommandOverlayProps) {
  const { activeProvider, activeModel, thinkingEnabled, thinkingEffort, ultracodeMode } = configManager.get();
  const catalog = ProviderCatalog.get(activeProvider)?.popularModels.find((candidate) => candidate.id === activeModel);
  const known = props.reasoningSupport ?? catalog?.supportsThinking;
  const [discovered, setSupported] = useState<boolean>();
  const supported = known ?? discovered;
  useEffect(() => {
    let current = true;
    if (known === undefined) {
      void ProviderManager.discoverModels(activeProvider).then((result) => {
        if (current) setSupported(result.models.find((candidate) => candidate.id === activeModel)?.supportsThinking);
      }, () => {});
    }
    return () => { current = false; };
  }, [activeProvider, activeModel, known]);
  const levels = supported === false ? ['Default'] : ['Off', 'Low', 'Medium', 'High', 'XHigh', 'UltraCode'];
  const current = supported === false ? 'Default' : ultracodeMode ? 'UltraCode' : thinkingEnabled ? thinkingEffort : 'Off';
  const rows: Row[] = levels.map((level) => ({
    id: level,
    label: level,
    detail: level === current ? 'current' : level === 'UltraCode' ? 'Extended agent budget' : undefined,
    activate: () => level === 'Default' ? props.onClose() : props.onCommand(`/effort ${level.toLowerCase()}`),
  }));
  const message = supported ? activeModel : `${activeModel} · ${supported === false ? 'reasoning unavailable' : 'applies when supported'}`;
  return <Picker {...props} title="Reasoning effort" groups={[{ rows }]} initialId={current} search={false} message={message} />;
}

export function CommandOverlay(props: CommandOverlayProps) {
  const providerId = 'providerId' in props.view ? props.view.providerId : '';
  return <CommandContent key={`${props.view.kind}:${providerId || ''}`} {...props} />;
}
