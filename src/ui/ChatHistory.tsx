import React from 'react';
import { Box, Text } from 'ink';
import { ChatMessage, TaskItem, TranscriptSegment } from '../types/index.js';
import stringWidth from 'string-width';
import { useMouse } from './MouseListener.js';
import { highlightCode } from './syntax.js';
import { cleanText, colors, fill, fit, formatDuration, wrapLines } from './terminal.js';

interface TranscriptLine {
  text: string;
  tone?: 'prompt' | 'command' | 'reasoning' | 'muted' | 'code' | 'emphasis' | 'error' | 'tool';
  mark?: string;
  changes?: TaskItem['changes'];
  diffLine?: 'added' | 'removed';
  reasoningId?: string;
  promptId?: string;
  filePath?: string;
  spans?: StyledSpan[];
}

type MessageView = Partial<ChatMessage> & Pick<ChatMessage, 'role' | 'content'>;

interface StyledSpan {
  text: string;
  color?: string;
  bold?: boolean;
}

function wrapHighlights(source: string, width: number): TranscriptLine[] {
  const spans: StyledSpan[] = [];
  let end = 0;
  for (const match of source.matchAll(/`[^`]*`|\[highlight\]([^\n]+?)\[\/highlight\]|\[color=#([\da-f]{6})\]([^\n]+?)\[\/color\]/gi)) {
    spans.push({ text: source.slice(end, match.index) });
    const [raw, highlight, hex, body] = match;
    spans.push(highlight !== undefined ? { text: highlight, color: colors.coffee, bold: true }
      : hex !== undefined ? { text: body, color: '#' + hex } : { text: raw });
    end = match.index + raw.length;
  }
  spans.push({ text: source.slice(end) });
  const visible = spans.map((span) => span.text).join('');
  let index = 0;
  let used = 0;
  return wrapLines(visible, width, true).map((text) => {
    const parts: StyledSpan[] = [];
    let remaining = text.length;
    while (remaining > 0 && index < spans.length) {
      const span = spans[index];
      const length = Math.min(remaining, span.text.length - used);
      if (length) parts.push({ ...span, text: span.text.slice(used, used + length) });
      remaining -= length;
      used += length;
      if (used === span.text.length) {
        index++;
        used = 0;
      }
    }
    return { text, spans: parts };
  });
}

function proseLines(source: string, width: number, reasoning = false, markdown = true): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const mark = reasoning ? '|' : undefined;
  const room = Math.max(1, width - 3);
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
    const textLine = (heading?.[1] ?? line).normalize();
    const wrapped = markdown && !reasoning && /\[(?:highlight\]|color=)/i.test(textLine)
      ? wrapHighlights(textLine, room)
      : wrapLines(textLine, room).map((text) => ({ text }));
    for (const row of wrapped) {
      lines.push({ ...row, tone: reasoning ? 'reasoning' : heading ? 'emphasis' : undefined, mark });
    }
  }
  flushCode();
  return lines;
}

const segmentCache = new WeakMap<TranscriptSegment, { width: number; accent: string; lines: TranscriptLine[] }>();

function segmentLines(segment: Extract<TranscriptSegment, { text: string }>, width: number) {
  const accent = colors.coffee;
  const cached = segmentCache.get(segment);
  if (cached?.width === width && cached.accent === accent) return cached.lines;
  const lines = proseLines(segment.text, width, segment.kind === 'reasoning');
  segmentCache.set(segment, { width, accent, lines });
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
    const fileChange = task.status === 'completed' && (task.tool === 'write_file' || task.tool === 'edit_file');
    const expandable = fileChange || (task.tool === 'run_shell' && task.status !== 'in_progress');
    const id = expandable ? 'output:' + task.id : task.tool === 'delegate' ? 'subagent:' + task.id : undefined;
    const expanded = expandable && id !== undefined && isExpanded(id);
    const title = id ? `${expanded ? '▾' : '▸'} ${text}` : text;
    const changeWidth = task.changes ? stringWidth(`  +${task.changes.added} −${task.changes.removed}`) : 0;
    lines.push({ text: fit(title, Math.max(1, width - 2 - changeWidth - stringWidth(detail))) + detail,
      tone: failed ? 'error' : 'tool', changes: task.changes, reasoningId: id });
    if (expanded) {
      const addLog = (body: string, tone: TranscriptLine['tone'] = 'code') => {
        for (const line of wrapLines(body, width - 4, true)) lines.push({ text: '  ' + line, tone });
      };
      if (fileChange) {
        if (!task.diff) {
          addLog(task.diff === '' ? 'No changes.' : 'No diff was recorded.', 'muted');
        } else {
          for (const line of task.diff.split('\n')) {
            const diffLine = line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : undefined;
            for (const text of wrapLines(line, width - 4, true)) {
              lines.push({ text: '  ' + text, tone: line.startsWith('@@') ? 'muted' : 'code', diffLine });
            }
          }
        }
      } else if (task.shellLog) {
        const { command, cwd, stdout, stderr } = task.shellLog;
        addLog('Command', 'command');
        addLog(command);
        addLog(`Working directory: ${cwd}`, 'muted');
        const exit = task.exitCode === undefined ? task.status : `exit ${task.exitCode}`;
        const elapsed = task.durationMs === undefined ? '' : ` · ${task.durationMs} ms`;
        addLog(exit + elapsed, failed ? 'error' : 'muted');
        addLog('stdout', 'command');
        addLog(stdout.replace(/\r?\n$/, '') || '(empty)');
        addLog('stderr', 'command');
        addLog(stderr.replace(/\r?\n$/, '') || '(empty)', stderr ? 'error' : 'muted');
      } else {
        addLog(task.output?.trimEnd() || 'No output was recorded.', failed ? 'error' : 'code');
      }
    }
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
        const label = elapsed === undefined ? 'Thinking' : `Thought · ${formatDuration(elapsed)}`;
        addThought(segment.id, label, () => segmentLines(segment, width));
      } else if (segment.kind === 'text') {
        lines.push(...segmentLines(segment, width));
      } else if (segment.kind === 'question') {
        for (const text of wrapLines('Question · ' + segment.question + '\n' +
          (segment.answer === undefined ? 'Skipped' : 'Answer · ' + segment.answer), width - 3)) {
          lines.push({ text, tone: 'muted' });
        }
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

  for (const file of message.attachments ?? []) {
    lines.push({ text: fit(`Attached: ${file.name}  ${file.path}`, width - 2), tone: 'muted', filePath: file.path });
  }

  if (message.error) {
    for (const text of wrapLines(`Error: ${message.error}`, width - 2)) lines.push({ text, tone: 'error' });
  }

  if (message.role === 'assistant' && message.durationMs && (message.content || message.reasoningContent)) {
    const elapsed = formatDuration(message.durationMs);
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
  onReasoning?: (id: string, screenRow: number) => void;
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
    const fileId = onReasoning && line?.filePath && column >= 0 && column < width ? 'file:' + line.filePath : undefined;
    if (event.type === 'move') setHovered(id ?? promptId ?? fileId);
    if (id && event.type === 'click' && event.button === 0) onReasoning?.(id, event.y - y - 1);
    if (promptId && event.type === 'click' && event.button === 0) onPrompt?.(promptId);
    if (fileId && event.type === 'click' && event.button === 0) onReasoning?.(fileId, event.y - y - 1);
  });
  const tones = { command: colors.muted, reasoning: colors.muted, muted: colors.muted, code: colors.code, error: colors.error, tool: colors.coffee };

  return (
    <Box width={width} height={height} flexDirection="column" flexShrink={0} overflowY="hidden">
      {reserveHint && (
        <Text color={colors.muted}>
          {fit(offset > 0 ? `↓  ${offset} newer ${offset === 1 ? 'line' : 'lines'}` : '↑  PageUp for earlier lines', width)}
        </Text>
      )}
      {lines.slice(start, end).map(({ text, tone, mark, changes, reasoningId, promptId, filePath, diffLine, spans }, index) => {
        const link = reasoningId ?? (filePath ? 'file:' + filePath : undefined);
        return tone === 'prompt' ? (
        <Text key={start + index} backgroundColor={onPrompt && promptId === hovered ? colors.board : colors.surface} color={colors.ink}>
          <Text color={accent} bold>{` ${mark ?? ' '} `}</Text>{fill(text, width - 3)}
        </Text>
      ) : (
        <Text key={start + index} color={tone && tone !== 'emphasis' ? tones[tone] : colors.ink} bold={tone === 'emphasis' || tone === 'command'}>
          {mark ? `${mark} ` : '  '}{diffLine ? (
            <Text color={diffLine === 'added' ? '#B6E6BD' : '#FFB9B3'}
              backgroundColor={diffLine === 'added' ? '#243B2B' : '#492B2B'}>{fill(text, width - 2)}</Text>
          ) : link ? <Text backgroundColor={link === hovered ? colors.rule : undefined}>{text}</Text>
            : spans?.length ? spans.map((span, part) => <Text key={part} color={span.color} bold={span.bold}>
              {inlineFormat(span.text)}
            </Text>) : tone === 'code' || tone === 'tool' || tone === 'error' ? text : inlineFormat(text || ' ')}
          {changes && <><Text color={colors.done}>{`  +${changes.added}`}</Text><Text color={colors.error}>{` −${changes.removed}`}</Text></>}
        </Text>
      );})}
    </Box>
  );
}
