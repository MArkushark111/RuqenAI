import React from 'react';
import { Box, Text } from 'ink';
import { ChatMessage, TaskItem, TranscriptSegment } from '../types/index.js';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import { useMouse } from './MouseListener.js';
import { highlightCode } from './syntax.js';
import { cleanText, colors, fill, fit, wrapLines } from './terminal.js';

interface TranscriptLine {
  text: string;
  tone?: 'prompt' | 'command' | 'reasoning' | 'muted' | 'code' | 'emphasis' | 'error' | 'tool';
  mark?: string;
  changes?: TaskItem['changes'];
  reasoningId?: string;
  promptId?: string;
}

type MessageView = Partial<ChatMessage> & Pick<ChatMessage, 'role' | 'content'>;

function colorHighlights(text: string): string {
  const applyColor = process.env.TERM !== 'dumb' && !Object.hasOwn(process.env, 'NO_COLOR');
  const paint = (body: string, hex: string, bold = false) => {
    if (!applyColor) return body;
    const rgb = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)).join(';');
    return `\x1b[${bold ? '1;' : ''}38;2;${rgb}m${body}\x1b[39m${bold ? '\x1b[22m' : ''}`;
  };
  return text.replace(/`[^`]*`|\[highlight\]([^\n]+?)\[\/highlight\]|\[color=#([\da-f]{6})\]([^\n]+?)\[\/color\]/gi,
    (match, highlight, hex, body) => highlight !== undefined ? paint(highlight, colors.coffee.slice(1), true)
      : hex !== undefined ? paint(body, hex) : match);
}

function proseLines(source: string, width: number, reasoning = false, markdown = true): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const mark = reasoning ? '|' : undefined;
  const room = width - 2;
  let fence: { marker: string; language: string; code: string[] } | undefined;
  function flushCode() {
    if (!fence || !fence.code.length) return;
    for (const text of highlightCode(fence.code.join('\n'), fence.language, room)) {
      lines.push({ text, tone: 'code', mark });
    }
  }

  const content = cleanText(source).replace(/\t/g, '    ').trimEnd();
  for (const line of content ? content.split('\n') : []) {
    // Accept Markdown fences and a standalone backtick around multiline reasoning snippets.
    const marker = markdown ? line.match(/^\s*(`{3,}|~{3,}|`(?=\s*$))\s*(.*?)\s*$/) : null;
    if (marker && (marker[1] !== '`' || reasoning)) {
      if (!fence) {
        fence = { marker: marker[1], language: marker[2].split(/\s/, 1)[0].toLowerCase(), code: [] };
        continue;
      }
      if (!marker[2] && marker[1][0] === fence.marker[0] && marker[1].length >= fence.marker.length) {
        flushCode();
        fence = undefined;
        continue;
      }
    }
    if (fence) {
      fence.code.push(line);
      continue;
    }
    const heading = !reasoning && markdown ? line.match(/^\s{0,3}#{1,6}\s+(.*)$/) : null;
    const textLine = heading?.[1] ?? line;
    const wrapped = markdown && !reasoning && /\[(?:highlight\]|color=)/i.test(textLine)
      ? wrapAnsi(colorHighlights(textLine), Math.max(1, room), { hard: true, trim: false }).split('\n')
      : wrapLines(textLine, room);
    for (const text of wrapped) {
      lines.push({ text, tone: reasoning ? 'reasoning' : heading ? 'emphasis' : undefined, mark });
    }
  }
  flushCode();
  return lines;
}

const segmentCache = new WeakMap<TranscriptSegment, { width: number; lines: TranscriptLine[] }>();

function segmentLines(segment: Extract<TranscriptSegment, { text: string }>, width: number) {
  const cached = segmentCache.get(segment);
  if (cached?.width === width) return cached.lines;
  const lines = proseLines(segment.text, width, segment.kind === 'reasoning');
  segmentCache.set(segment, { width, lines });
  return lines;
}

export function formatMessage(message: MessageView, width: number, isExpanded: (id: string) => boolean): TranscriptLine[] {
  if (message.role === 'user') {
    const promptLines: TranscriptLine[] = wrapLines(message.content, Math.max(1, width - 5)).map((text, index) => ({
      text, mark: index === 0 ? '>' : ' ', tone: 'prompt', promptId: message.id,
    }));
    if (message.attachmentNames?.length) promptLines.push({
      text: fit('Attached: ' + message.attachmentNames.join(' · '), width - 3), tone: 'prompt', promptId: message.id,
    });
    return promptLines;
  }
  if (message.role === 'tool') return [];

  const lines: TranscriptLine[] = [];
  const tools = (message.tasks ?? []).filter((task) => task.kind === 'tool' && task.status !== 'pending');
  const addTool = (task: TaskItem) => {
    const text = task.status === 'completed'
      ? task.title.replace(/^Write /, 'Wrote ').replace(/^Edit /, 'Edited ').replace(/^Run(?: command)? /, 'Ran ')
      : task.title;
    const failed = task.status === 'failed' || (task.exitCode !== undefined && task.exitCode !== 0);
    const detail = task.exitCode !== undefined ? ` · exit ${task.exitCode}`
      : task.status === 'completed' ? '' : ` · ${task.status === 'in_progress' ? 'running' : task.status}`;
    const changeWidth = task.changes ? stringWidth(`  +${task.changes.added} −${task.changes.removed}`) : 0;
    lines.push({ text: fit(text, Math.max(1, width - 2 - changeWidth - stringWidth(detail))) + detail,
      tone: failed ? 'error' : 'tool', changes: task.changes });
  };
  const addThought = (id: string, label: string, body: () => TranscriptLine[]) => {
    const expanded = isExpanded(id);
    lines.push({ text: fit(`${expanded ? '▾' : '▸'} ${label}`, width - 2), tone: 'reasoning', reasoningId: id });
    if (expanded) lines.push(...body());
  };

  if (message.role === 'system') lines.push({ text: 'Command', tone: 'command' });
  if (message.segments?.length) {
    const byId = new Map(tools.map((task) => [task.id, task]));
    let previous: TranscriptSegment['kind'] | undefined;
    for (const segment of message.segments) {
      if (previous && previous !== segment.kind) lines.push({ text: '' });
      if (segment.kind === 'reasoning') {
        const elapsed = segment.durationMs;
        const label = elapsed === undefined ? 'Thinking'
          : `Thought · ${elapsed < 1000 ? elapsed + 'ms' : (elapsed / 1000).toFixed(1) + 's'}`;
        addThought(segment.id, label, () => segmentLines(segment, width));
      } else if (segment.kind === 'text') {
        lines.push(...segmentLines(segment, width));
      } else {
        const task = byId.get(segment.taskId);
        if (task) addTool(task);
      }
      previous = segment.kind;
    }
  } else {
    // Keep older saved transcripts readable.
    if (message.id && message.reasoningContent?.trim()) {
      addThought(message.id, 'Reasoning', () => proseLines(message.reasoningContent ?? '', width, true));
      if (message.content || message.error || tools.length) lines.push({ text: '' });
    }
    tools.forEach(addTool);
    if (tools.length && message.content) lines.push({ text: '' });
    lines.push(...proseLines(message.content, width, false, message.role === 'assistant'));
  }
  if (message.note) {
    lines.push({ text: '' }, ...wrapLines(message.note, width - 2).map((text): TranscriptLine => ({ text, tone: 'muted' })));
  }

  if (message.error) {
    for (const text of wrapLines(`Error: ${message.error}`, width - 2)) lines.push({ text, tone: 'error' });
  }

  if (message.role === 'assistant' && message.durationMs && (message.content || message.reasoningContent)) {
    const elapsed = `${(message.durationMs / 1000).toFixed(1)}s`;
    const tokens = message.usage?.outputTokens;
    const measured = tokens === undefined ? '' : `${tokens.toLocaleString()} output tokens`;
    const details = [elapsed, measured].filter(Boolean).join('  ·  ');
    lines.push({ text: '' }, { text: details, tone: 'muted' });
  }
  return lines;
}

function inlineFormat(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, index) => (
    part.startsWith('**') && part.endsWith('**') ? <Text key={index} bold>{part.slice(2, -2)}</Text>
      : part.startsWith('`') && part.endsWith('`') ? <Text key={index} color={colors.code}>{part.slice(1, -1)}</Text>
      : part
  ));
}

interface ChatHistoryProps {
  lines: TranscriptLine[];
  width: number;
  height: number;
  scrollOffset: number;
  accent: string;
  x: number;
  y: number;
  onReasoning?: (id: string) => void;
  onPrompt?: (id: string) => void;
}

export function ChatHistory({ lines, width, height, scrollOffset, accent, x, y, onReasoning, onPrompt }: ChatHistoryProps) {
  const offset = Math.min(scrollOffset, Math.max(0, lines.length - height + 1));
  const reserveHint = offset > 0 || lines.length > height;
  const end = lines.length - offset;
  const start = Math.max(0, end - Math.max(0, height - Number(reserveHint)));
  const [hovered, setHovered] = React.useState<string>();
  useMouse((event) => {
    const index = start + event.y - y - 1 - Number(reserveHint);
    const line = index >= start && index < end ? lines[index] : undefined;
    const column = event.x - x - 1;
    const id = onReasoning && line?.reasoningId && column >= 2 && column < 2 + stringWidth(line.text)
      ? line.reasoningId : undefined;
    const promptId = onPrompt && line?.promptId && column >= 0 && column < width ? line.promptId : undefined;
    if (event.type === 'move') setHovered(id ?? promptId);
    if (id && event.type === 'click' && event.button === 0) onReasoning?.(id);
    if (promptId && event.type === 'click' && event.button === 0) onPrompt?.(promptId);
  });
  const tones = { command: colors.muted, reasoning: colors.muted, muted: colors.muted, code: colors.code, error: colors.error, tool: colors.coffee };

  return (
    <Box width={width} height={height} flexDirection="column" flexShrink={0} overflow="hidden">
      {reserveHint && (
        <Text color={colors.muted}>
          {fit(offset > 0 ? `↓  ${offset} newer ${offset === 1 ? 'line' : 'lines'}` : '↑  PageUp for earlier lines', width)}
        </Text>
      )}
      {lines.slice(start, end).map(({ text, tone, mark, changes, reasoningId, promptId }, index) => tone === 'prompt' ? (
        <Text key={start + index} backgroundColor={onPrompt && promptId === hovered ? colors.board : colors.surface} color={colors.ink}>
          <Text color={accent} bold>{` ${mark ?? ' '} `}</Text>{fill(text, width - 3)}
        </Text>
      ) : (
        <Text key={start + index} color={tone && tone !== 'emphasis' ? tones[tone] : colors.ink} bold={tone === 'emphasis' || tone === 'command'}>
          {mark ? `${mark} ` : '  '}{reasoningId ? <Text backgroundColor={reasoningId === hovered ? colors.rule : undefined}>{text}</Text>
            : tone === 'code' || tone === 'tool' || tone === 'error' ? text : inlineFormat(text || ' ')}
          {changes && <><Text color={colors.done}>{`  +${changes.added}`}</Text><Text color={colors.error}>{` −${changes.removed}`}</Text></>}
        </Text>
      ))}
    </Box>
  );
}
