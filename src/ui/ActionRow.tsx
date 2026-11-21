import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { useMouse } from './MouseListener.js';
import { colors, fill } from './terminal.js';
import type { DOMElement } from 'ink';
import { mouseOrigin } from './mouseBounds.js';

export interface Action {
  id?: string;
  label: string;
  run: () => void;
  color?: string;
  selected?: boolean;
  glow?: boolean;
}

export function ActionRow({ actions, width, trailing = '', background, animate = false, blocked = false }: {
  actions: Action[];
  width: number;
  x: number;
  y: number;
  trailing?: string;
  background?: string;
  animate?: boolean;
  blocked?: boolean;
}) {
  const [hover, setHover] = useState<string>();
  const element = useRef<DOMElement>(null);
  const [phase, setPhase] = useState(0);
  const glowing = actions.some(({ glow }) => glow);
  useEffect(() => {
    if (!animate || !glowing) return;
    const timer = setInterval(() => setPhase((value) => (value + 1) % 30), 115);
    return () => clearInterval(timer);
  }, [animate, glowing]);
  let used = 0;
  const items: Array<Action & { start: number; end: number; gap: number }> = [];
  for (const action of actions) {
    const gap = items.length === 0 ? 0 : 3;
    const cells = gap + stringWidth(action.label);
    if (width - used < cells) break;
    items.push({ ...action, gap, start: used + gap, end: used + cells });
    used += cells;
  }
  useMouse((event) => {
    const origin = mouseOrigin(element.current);
    const cell = event.x - (origin?.x ?? 0) - 1;
    const near = event.type === 'move' ? 1 : 0;
    const action = !blocked && origin && event.y === origin.y + 1 ? items.find(({ start, end }) => cell >= start - near && cell < end + near) : undefined;
    if (event.type === 'move') setHover(action ? action.id ?? action.label : undefined);
    if (event.type === 'click' && event.button === 0) action?.run();
  });

  const remaining = width - used;
  return (
    <Box ref={element} height={1} width={width} flexShrink={0}>
      <Text backgroundColor={background}>
        {items.map((action) => {
          const key = action.id ?? action.label;
          const highlighted = (!blocked && hover === key) || action.selected;
          return <React.Fragment key={key}>
            {' '.repeat(action.gap)}
            <Text color={highlighted ? colors.ink : action.color ?? colors.coffee}
              backgroundColor={highlighted ? colors.rule : undefined}>
              {action.glow ? [...action.label].map((character, index) => {
                const light = Math.max(0, 3 - Math.abs(index - phase + 3));
                const foreground = light
                  ? ['#D0AA88', '#E0BA95', '#EBC9A8', '#F8E4CE'][light]
                  : index < action.label.length / 2 ? '#CCA583' : '#DAB591';
                return <Text key={index} bold color={foreground}
                  backgroundColor={light ? '#483426' : highlighted ? '#392D24' : '#2A211B'}>{character}</Text>;
              }) : action.label}
            </Text>
          </React.Fragment>;
        })}
        <Text color={colors.muted}>{fill(trailing ? trailing.padStart(Math.max(trailing.length, remaining)) : '', remaining)}</Text>
      </Text>
    </Box>
  );
}
