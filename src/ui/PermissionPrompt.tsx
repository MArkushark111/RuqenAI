import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PermissionRequest } from '../agent/permissions.js';
import { colors, fill, wrapLines } from './terminal.js';
import { ActionRow } from './ActionRow.js';
import { useMouse } from './MouseListener.js';

interface PermissionPromptProps {
  request: PermissionRequest;
  width: number;
  height: number;
  x: number;
  y: number;
}

function permissionLines(request: PermissionRequest, width: number) {
  return wrapLines(request.description || request.target, Math.max(1, width - 3), true);
}

export function permissionHeight(request: PermissionRequest, width: number) {
  return Math.min(16, permissionLines(request, width).length + (request.rememberScope ? 6 : 4));
}

export function PermissionPrompt({ request, width, height, x, y }: PermissionPromptProps) {
  const [offset, setOffset] = useState(0);
  const [selected, select] = useState(0);
  const choices = [
    { key: 'n', number: '3', label: 'Deny', color: colors.error, run: () => request.onDecide(false) },
    { key: 'y', number: '1', label: 'Allow once', color: colors.ink, run: () => request.onDecide(true) },
    ...(request.rememberScope ? [{
      key: 'a', number: '2', label: 'Always allow', color: colors.warning, run: () => request.onDecide(true, true),
    }] : []),
  ];
  const displayOrder = [...choices.slice(1), choices[0]];
  const compact = height < choices.length + 2;
  const showScope = Boolean(request.rememberScope && height >= choices.length + 4);
  const showHelp = height >= choices.length + 3;
  const lines = permissionLines(request, width);
  const pageSize = Math.max(0, height - 1 - (compact ? 1 : choices.length) - Number(showScope) - Number(showHelp));
  const maxOffset = Math.max(0, lines.length - pageSize);
  const start = Math.min(offset, maxOffset);
  const move = (delta: number) => setOffset(Math.max(0, Math.min(maxOffset, start + delta)));

  useMouse((event) => {
    if (event.x <= x || event.x > x + width || event.y <= y || event.y > y + height) return;
    if (event.type === 'scroll_up' || event.type === 'scroll_down') move(event.type === 'scroll_up' ? -3 : 3);
  });
  useInput((input, key) => {
    if (key.ctrl || (key.meta && !key.escape)) return;
    if (key.pageUp || key.pageDown) {
      move(key.pageUp ? -pageSize : pageSize);
      return;
    }
    if (key.upArrow || key.downArrow || key.tab) {
      const index = displayOrder.indexOf(choices[selected]);
      const next = (index + displayOrder.length + (key.upArrow || key.shift ? -1 : 1)) % displayOrder.length;
      select(choices.indexOf(displayOrder[next]));
      return;
    }
    if (key.escape) choices[0].run();
    else if (key.return) choices[selected].run();
    else choices.find(({ key: shortcut, number }) => shortcut === input.toLowerCase() || number === input)?.run();
  });

  const shown = lines.slice(start, start + pageSize);
  const options = compact ? [choices[selected]] : displayOrder;

  return (
    <Box flexDirection="column" width={width} flexShrink={0} height={height}>
      <Text bold color={colors.surface} backgroundColor={colors.warning}>
        {fill(' Permission required' + (maxOffset && pageSize ? `  ·  Lines ${start + 1}–${start + shown.length}/${lines.length}` : ''), width)}
      </Text>
      {shown.map((line, index) => <Text key={start + index} color={colors.ink} backgroundColor={colors.board}>
        {fill('  ' + line, width)}
      </Text>)}
      {options.map((choice, index) => <ActionRow key={choice.key} width={width} x={x} y={y + 1 + shown.length + index}
        background={colors.board} actions={[{
          ...choice,
          label: fill(` ${choice === choices[selected] ? '›' : ' '}  ${choice.label}  [${choice.key.toUpperCase()}]`, width),
          selected: choice === choices[selected],
        }]} />)}
      {showScope && <Text color={colors.ink} backgroundColor={colors.board}>
        {fill(' Remembers ' + request.rememberScope + '.', width)}
      </Text>}
      {showHelp && <Text color={colors.muted} backgroundColor={colors.board}>
        {fill(maxOffset ? ' PgUp/PgDn Details  ↑↓ Select  Esc Deny' : ' ↑↓ Select  Enter Confirm  Esc Deny', width)}
      </Text>}
    </Box>
  );
}
