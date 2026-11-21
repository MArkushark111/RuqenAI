import React, { useState, useSyncExternalStore } from 'react';
import { Box, Text, useInput } from 'ink';
import { ProviderUsage, TaskItem } from '../types/index.js';
import { costSummary } from '../providers/usage.js';
import { useMouse } from './MouseListener.js';
import { colors, fill, fit } from './terminal.js';

const dots = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let frame = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    frame = Math.floor(performance.now() / 80) % dots.length;
    for (const tick of listeners) tick();
  }, 80);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const idleSubscribe = () => () => {};
const getFrame = () => frame;
const idleFrame = () => 0;

export function Spinner({ active, animate = true }: { active: boolean; animate?: boolean }) {
  const moving = active && animate;
  const index = useSyncExternalStore(moving ? subscribe : idleSubscribe, moving ? getFrame : idleFrame);
  return <Text>{active ? dots[index] : ' '}</Text>;
}

interface ActivityPanelProps {
  width: number;
  height: number;
  x: number;
  y: number;
  animate: boolean;
  accent: string;
  cloud: boolean;
  sessionUsage?: ProviderUsage;
  sessionTokens: number;
  liveUsage?: ProviderUsage;
  tasks: TaskItem[];
  attachments: number;
  keyboard?: boolean;
}

export function ActivityPanel({ width, height, x, y, animate, accent, cloud, sessionUsage, sessionTokens, liveUsage, tasks, attachments, keyboard }: ActivityPanelProps) {
  const [offset, setOffset] = useState(0);
  const showCost = cloud || sessionUsage?.costUsd !== undefined || sessionUsage?.estimatedCostUsd !== undefined;
  const cost = costSummary(sessionUsage, liveUsage);
  const tokens = Math.max(sessionTokens, sessionUsage?.totalTokens ?? 0) + (liveUsage?.totalTokens ?? 0);
  const row = (label: string, value: string) => (
    <Text color={colors.muted}>{fit(`${label.padEnd(10)}${value}`, width)}</Text>
  );
  const maxTasks = Math.max(0, height - (showCost ? 7 : 6) - Number(cost.unpriced > 0) - Number(attachments > 0));
  const start = Math.min(offset, Math.max(0, tasks.length - maxTasks));
  const move = (delta: number) => setOffset(Math.max(0, Math.min(tasks.length - maxTasks, start + delta)));

  useInput((_, key) => {
    if (key.upArrow || key.downArrow || key.pageUp || key.pageDown) {
      move((key.upArrow || key.pageUp ? -1 : 1) * (key.pageUp || key.pageDown ? maxTasks : 1));
    }
  }, { isActive: keyboard === true });

  useMouse((event) => {
    if (event.x <= x || event.x > x + width || event.y <= y || event.y > y + height) return;
    if (event.type === 'scroll_up' || event.type === 'scroll_down') {
      move(event.type === 'scroll_up' ? -2 : 2);
    }
  });

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Text backgroundColor={colors.raised} bold color={colors.ink}>{fill(' Activity', width)}</Text>
      <Box height={1} flexShrink={0} />
      {row('Tokens', tokens ? tokens.toLocaleString() : '—')}
      {showCost && row(cost.label, cost.value)}
      {cost.unpriced > 0 && row('Unpriced', `${cost.unpriced.toLocaleString()} ${cost.unpriced === 1 ? 'request' : 'requests'}`)}
      {attachments > 0 && row('Attached', String(attachments))}
      <Box height={1} flexShrink={0} />
      <Text color={accent} bold>{fit(tasks.length ? `Tasks  ${tasks.length}` : 'Tasks', width)}</Text>
      {tasks.length === 0 ? <Text color={colors.muted}>No open tasks</Text> :
        tasks.slice(start, start + maxTasks).map((task) => {
          const running = task.status === 'in_progress';
          return <Text key={task.id} color={running ? accent : colors.muted}>
            {running ? <>[<Spinner active animate={animate} />]</> : '[ ]'}
            {' ' + fit(task.detail && !task.title.includes(task.detail) ? `${task.title} · ${task.detail}` : task.title, width - 4)}
          </Text>;
        })}
      {tasks.length > maxTasks && maxTasks > 0 &&
        <Text color={colors.muted}>{fit(`${start + 1}–${Math.min(tasks.length, start + maxTasks)} of ${tasks.length}  ·  ${keyboard ? '↑ ↓' : 'wheel'}`, width)}</Text>}
    </Box>
  );
}
