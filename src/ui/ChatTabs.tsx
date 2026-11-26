import React, { useRef, useState } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { Spinner } from './ActivityPanel.js';
import { useMouse } from './MouseListener.js';
import { mixHex, themePalette } from './terminal.js';
import type { DOMElement } from 'ink';
import { mouseOrigin } from './mouseBounds.js';

export interface ChatTab {
  id: string;
  label: string;
  selected?: boolean;
  fixed?: boolean;
  eco?: boolean;
}

interface Segment {
  tab: ChatTab;
  start: number;
  end: number;
  spin: number;
  closeStart?: number;
  closeEnd?: number;
}

export function ChatTabs({ tabs, width, blocked, busy, animate = true, onSelect, onClose, onReorder, onMenu }: {
  tabs: ChatTab[];
  width: number;
  blocked: boolean;
  busy?: string | ReadonlySet<string>;
  animate?: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onMenu: (id: string) => void;
}) {
  const [hover, setHover] = useState<string>();
  const [hoverClose, setHoverClose] = useState<string>();
  const [dragId, setDragId] = useState<string>();
  const dragging = useRef<string>();
  const pressed = useRef<string>();
  const moved = useRef(false);
  const element = useRef<DOMElement>(null);
  const isBusy = (id: string) => typeof busy === 'string' ? busy === id : Boolean(busy?.has(id));

  const gap = 1;
  const spanFor = (tab: ChatTab) => stringWidth(tab.label) + (tab.fixed ? 2 : 4) + (isBusy(tab.id) ? 2 : 0);
  const total = tabs.reduce((size, tab) => size + spanFor(tab) + gap, -gap);
  const overflow = total > width;
  const keep = tabs.filter((tab) => tab.selected || tab.fixed);
  const overflowSpace = overflow ? String(tabs.length).length + 5 : 0;
  let available = width - overflowSpace - keep.reduce((size, tab) => size + spanFor(tab) + gap, 0) + gap;
  const visible = tabs.filter((tab) => {
    if (keep.includes(tab)) return true;
    const size = spanFor(tab) + gap;
    if (size > available) return false;
    available -= size;
    return true;
  });
  if (overflow) visible.push({ id: '__overflow__', label: `… ${tabs.length - visible.length}`, fixed: true });
  let used = 0;
  const segments: Segment[] = visible.map((tab, index) => {
    const spin = isBusy(tab.id) ? 2 : 0;
    const start = used + (index === 0 ? 0 : gap);
    const span = spanFor(tab);
    const segment: Segment = { tab, start, end: start + span, spin };
    if (!tab.fixed) {
      segment.closeStart = segment.end - 2;
      segment.closeEnd = segment.closeStart + 1;
    }
    used = segment.end;
    return segment;
  });

  useMouse((event) => {
    if (blocked) {
      setHover(undefined);
      setHoverClose(undefined);
      if (event.type === 'release') {
        pressed.current = undefined;
        dragging.current = undefined;
        setDragId(undefined);
      }
      return;
    }
    const origin = mouseOrigin(element.current);
    if (!origin) return;
    const onRow = event.y === origin.y + 1;
    if (!onRow && event.type !== 'release' && event.type !== 'move') return;
    const cell = event.x - origin.x - 1;
    const hit = onRow ? segments.find((segment) => cell >= segment.start && cell < segment.end) : undefined;
    const closeStart = hit?.closeStart;
    const closeEnd = hit?.closeEnd;
    const overClose = closeStart !== undefined && closeEnd !== undefined && cell >= closeStart && cell < closeEnd;
    if (event.type === 'click' && event.button === 2 && hit && !hit.tab.fixed) {
      onMenu(hit.tab.id);
      return;
    }

    if (event.type === 'move') {
      setHover(hit?.tab.id);
      setHoverClose(overClose ? hit?.tab.id : undefined);
      const active = dragging.current;
      if (active && event.button === 0 && hit && !hit.tab.fixed && hit.tab.id !== active) {
        const order = tabs.filter((tab) => !tab.fixed).map((tab) => tab.id);
        const from = order.indexOf(active);
        const to = order.indexOf(hit.tab.id);
        // Only swap once the cursor passes the neighbour's centre, so a drag stays deliberate.
        const centre = (hit.start + hit.end) / 2;
        const crossed = to > from ? cell >= centre : cell <= centre;
        if (from >= 0 && to >= 0 && from !== to && crossed) {
          order.splice(to, 0, order.splice(from, 1)[0]);
          moved.current = true;
          onReorder(order);
        }
      }
      return;
    }

    if (event.type === 'click' && event.button === 0) {
      if (!hit) return;
      if (overClose) {
        onClose(hit.tab.id);
        return;
      }
      pressed.current = hit.tab.id;
      moved.current = false;
      if (!hit.tab.fixed) {
        dragging.current = hit.tab.id;
        setDragId(hit.tab.id);
      }
      return;
    }

    if (event.type === 'release') {
      const id = pressed.current;
      pressed.current = undefined;
      dragging.current = undefined;
      setDragId(undefined);
      if (id && !moved.current && hit?.tab.id === id) onSelect(id);
      moved.current = false;
    }
  });

  return (
    <Box ref={element} height={1} width={width} flexShrink={0}>
      <Text>
        {segments.map((segment, index) => {
          const { tab } = segment;
          const active = !blocked && tab.id === hover;
          const lifted = tab.id === dragId;
          // Each tab uses the theme palette (not the live eco overlay) plus its own eco flag,
          // so an eco chat never recolors the other tabs.
          const palette = themePalette();
          const accent = tab.eco ? '#8FE388' : palette.coffee;
          const surface = tab.selected || lifted ? mixHex(palette.board, accent, 0.2)
            : active ? mixHex(palette.board, accent, 0.11)
            : tab.fixed ? undefined : palette.board;
          const foreground = tab.selected ? accent : active ? palette.ink : palette.muted;
          return (
            <React.Fragment key={tab.id}>
              {index > 0 && ' '.repeat(gap)}
              <Text backgroundColor={surface} color={foreground} bold={tab.selected || lifted}>{` ${tab.label} `}</Text>
              {segment.spin > 0 && (
                <Text backgroundColor={surface} color={accent}><Spinner active animate={animate} />{' '}</Text>
              )}
              {!tab.fixed && (
                <Text backgroundColor={surface} bold={hoverClose === tab.id} color={hoverClose === tab.id ? palette.error : palette.muted}>× </Text>
              )}
            </React.Fragment>
          );
        })}
        {' '.repeat(Math.max(0, width - used))}
      </Text>
    </Box>
  );
}
