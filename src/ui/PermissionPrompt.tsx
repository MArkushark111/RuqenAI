import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PermissionRequest } from '../agent/permissions.js';
import { colors, fit, wrapLines } from './terminal.js';
import { ActionRow } from './ActionRow.js';
import { useMouse } from './MouseListener.js';

interface PermissionPromptProps {
  request: PermissionRequest;
  width: number;
  height: number;
  x: number;
  y: number;
}

export function PermissionPrompt({ request, width, height, x, y }: PermissionPromptProps) {
  const [offset, setOffset] = useState(0);
  const canRemember = request.type === 'shell' || request.type === 'file_write';
  const lines = wrapLines(request.description || request.target, width);
  const pageSize = Math.max(1, height - 2);
  const maxOffset = Math.max(0, lines.length - pageSize);
  const start = Math.min(offset, maxOffset);
  const move = (delta: number) => setOffset(Math.max(0, Math.min(maxOffset, start + delta)));

  useMouse((event) => {
    if (event.x <= x || event.x > x + width || event.y <= y || event.y > y + height) return;
    if (event.type === 'scroll_up' || event.type === 'scroll_down') move(event.type === 'scroll_up' ? -3 : 3);
  });
  useInput((input, key) => {
    if (key.ctrl || (key.meta && !key.escape)) return;
    if (key.pageUp || key.pageDown || key.upArrow || key.downArrow) {
      const delta = key.pageUp ? -pageSize : key.pageDown ? pageSize : key.upArrow ? -1 : 1;
      move(delta);
      return;
    }
    const letter = input.toLowerCase();
    if (key.escape || letter === 'n' || letter === '3') {
      request.onDecide(false, false);
    } else if (key.return || input === '\n' || input === '\r\n' || letter === 'y' || letter === '1') {
      request.onDecide(true, false);
    } else if (canRemember && (letter === 'a' || letter === '2')) {
      request.onDecide(true, true);
    }
  });

  const choices = [
    { label: 'Y Allow once', run: () => request.onDecide(true, false) },
    ...(canRemember ? [{ label: width >= 56 ? 'A Always allow' : 'A Always', run: () => request.onDecide(true, true) }] : []),
    { label: 'N Deny', run: () => request.onDecide(false, false) },
  ];
  const shown = lines.slice(start, start + pageSize);

  return (
    <Box flexDirection="column" flexShrink={0} height={height}>
      <Text bold color={colors.warning}>
        {fit(maxOffset ? `Permission required  ·  ↑/↓ to read  ${start + 1}–${Math.min(lines.length, start + pageSize)}/${lines.length}` : 'Permission required', width)}
      </Text>
      {shown.map((line, index) => <Text key={start + index}>{line || ' '}</Text>)}
      <ActionRow actions={choices} width={width} x={x} y={y + 1 + shown.length} />
    </Box>
  );
}
