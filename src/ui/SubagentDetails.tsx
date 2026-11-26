import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TaskItem } from '../types/index.js';
import { ActionRow } from './ActionRow.js';
import { Spinner } from './ActivityPanel.js';
import { useMouse } from './MouseListener.js';
import { colors, fill, fit, wrapLines } from './terminal.js';

export function SubagentDetails({ task, actions, width, height, x, y, animate, onClose }: {
  task: TaskItem;
  actions: TaskItem[];
  width: number;
  height: number;
  x: number;
  y: number;
  animate: boolean;
  onClose: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const active = task.status === 'in_progress';
  const current = actions.find((step) => step.status === 'in_progress');
  const status = active ? current?.title ?? 'Waiting for the model' : task.status;
  const lines = [
    ...wrapLines(status, width),
    '',
    'Assignment',
    ...wrapLines(task.subagent?.assignment ?? 'No assignment was recorded.', width),
    ...(actions.length ? ['', 'Tool activity', ...actions.flatMap((step) =>
      wrapLines(`${step.status === 'in_progress' ? '›' : step.status === 'completed' ? '✓' : '!'} ${step.title}`, width))] : []),
    ...(task.subagent?.transcript ? ['', 'Transcript', ...wrapLines(task.subagent.transcript, width, true)] : []),
    ...(task.output ? ['', 'Result', ...wrapLines(task.output, width, true)] : []),
  ];
  const page = Math.max(0, height - 2);
  const max = Math.max(0, lines.length - page);
  const start = max - Math.min(offset, max);
  const move = (delta: number) => setOffset((previous) => Math.max(0, Math.min(max, Math.min(previous, max) - delta)));
  useInput((_, key) => {
    if (key.escape) onClose();
    else if (key.upArrow || key.downArrow) move(key.upArrow ? -1 : 1);
    else if (key.pageUp || key.pageDown) move(key.pageUp ? -page : page);
  });
  useMouse((event) => {
    if (event.x <= x || event.x > x + width || event.y <= y || event.y > y + height) return;
    if (event.type === 'scroll_up' || event.type === 'scroll_down') move(event.type === 'scroll_up' ? -3 : 3);
  });
  return <Box flexDirection="column" width={width} height={height} overflowY="hidden">
    <Text bold color={colors.coffee} backgroundColor={colors.board}>
      {active && <><Spinner active animate={animate} />{' '}</>}
      {fill('Subagent · ' + (task.subagent?.name ?? task.title), width - (active ? 2 : 0))}
    </Text>
    <Box height={page} flexDirection="column" flexShrink={0} overflowY="hidden">
      {lines.slice(start, start + page).map((line, index) => <Text key={start + index}
        color={['Assignment', 'Tool activity', 'Transcript', 'Result'].includes(line) ? colors.coffee : colors.ink}>{line || ' '}</Text>)}
    </Box>
    {height >= 2 && <ActionRow actions={[{ label: fit('Esc Back to chat', width), run: onClose }]}
      trailing={max ? `↑ ↓ Scroll  ·  ${start + 1}–${start + page}/${lines.length}` : ''}
      width={width} x={x} y={y + page + 1} background={colors.board} />}
  </Box>;
}
