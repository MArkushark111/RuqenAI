import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import stringWidth from 'string-width';
import { cleanText, colors, fill, fit, graphemes } from './terminal.js';
import { mentionAt, suggestMentions } from '../agent/mentions.js';
import { useMouse } from './MouseListener.js';
import { suggestCommands } from './commandSuggestions.js';
import { canonicalCommand } from '../commands/catalog.js';
import { ActionRow } from './ActionRow.js';

interface ComposerProps {
  width: number;
  accent: string;
  active: boolean;
  history: string[];
  prefill?: { text: string };
  insertion?: { text: string };
  x: number;
  y: number;
  placeholder?: string;
  footer?: React.ReactNode;
  maxSuggestionRows: number;
  onSuggestionRows: (rows: number) => void;
  onSubmit: (value: string) => void;
  onModels: () => void;
  maxInputRows: number;
  onInputRows: (rows: number) => void;
  canSendAttachments: boolean;
  submissionBlocked?: boolean;
}

export function Composer({ width, accent, active, history, prefill, insertion, x, y, placeholder, footer, maxSuggestionRows, onSuggestionRows, onSubmit, onModels, maxInputRows, onInputRows, canSendAttachments, submissionBlocked }: ComposerProps) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState('');
  const [selection, setSelection] = useState(0);
  const [dismissed, setDismissed] = useState<string>();
  const segments = graphemes(value);
  const offset = segments.slice(0, cursor).join('').length;
  const canSuggest = active && maxSuggestionRows > 0 && value !== dismissed;
  const mention = canSuggest && !value.startsWith('/') ? mentionAt(value, offset) : undefined;
  const token = mention?.token;
  const mentions = useMemo(() => token ? suggestMentions(token) : [], [token]);
  const suggestions = !canSuggest ? [] : mention ? mentions : suggestCommands(value)
    .map(({ command, summary }) => ({ label: '/' + command, summary }));
  const suggestion = suggestions[selection] ?? suggestions[0];
  const firstRow = Math.max(0, selection - maxSuggestionRows + 1);
  const visibleRows = suggestions.slice(firstRow, firstRow + maxSuggestionRows);
  const labelWidth = Math.min(mention ? 34 : 17, Math.floor(width * 0.6));
  const inputY = y + visibleRows.length;
  useLayoutEffect(() => {
    onSuggestionRows(visibleRows.length);
  }, [visibleRows.length, onSuggestionRows]);
  useEffect(() => {
    setSelection(0);
  }, [value, token]);
  useEffect(() => {
    setDismissed(undefined);
  }, [value]);

  useEffect(() => {
    if (!prefill) return;
    setValue(prefill.text);
    setCursor(graphemes(prefill.text).length);
    setDraft('');
    setHistoryIndex(-1);
  }, [prefill]);

  useEffect(() => {
    if (!insertion) return;
    const before = value.slice(0, offset) + cleanText(insertion.text);
    setValue(before + value.slice(offset));
    setCursor(graphemes(before).length);
  }, [insertion]);

  function complete(label: string) {
    const after = mention ? value.slice(mention.end) : '';
    const before = (mention ? value.slice(0, mention.start) : '') + label;
    const separator = /^\s/.test(after) ? '' : ' ';
    setValue(before + separator + after);
    setCursor(graphemes(before + separator).length + Number(!separator && after.startsWith(' ')));
    setHistoryIndex(-1);
  }

  const space = Math.max(1, width - 3);
  const credentialPrefix = value.match(/^\/(?:login|auth)\s+\S+\s+/i)?.[0];
  const secretStart = credentialPrefix ? graphemes(credentialPrefix).length : segments.length;
  const display = segments.map((segment, index) =>
    index >= secretStart ? '*' : segment === '\t' ? ' ' : stringWidth(segment) > space ? '…' : segment,
  );
  const rows: Array<{ start: number; end: number; cells: number }> = [];
  let start = 0;
  let cells = 0;
  for (const [index, character] of display.entries()) {
    const size = stringWidth(character);
    if (character === '\n' || cells + size > space) {
      rows.push({ start, end: index, cells });
      start = character === '\n' ? index + 1 : index;
      cells = 0;
    }
    if (character !== '\n') cells += size;
  }
  rows.push({ start, end: display.length, cells });
  if (cells === space) rows.push({ start: display.length, end: display.length, cells: 0 });

  const nextRow = rows.findIndex((row) => row.start > cursor);
  const currentRow = nextRow < 0 ? rows.length - 1 : nextRow - 1;
  const column = (row: typeof rows[number], position: number) =>
    stringWidth(display.slice(row.start, position).join(''));
  function positionAt(row: typeof rows[number], cell: number) {
    let position = row.start;
    while (position < row.end && cell >= stringWidth(display[position])) {
      cell -= stringWidth(display[position]);
      position++;
    }
    return position;
  }

  const rowCount = Math.min(maxInputRows, rows.length);
  const [viewport, setViewport] = useState(0);
  const top = Math.min(Math.max(0, rows.length - rowCount), Math.max(currentRow - rowCount + 1, Math.min(currentRow, viewport)));
  useLayoutEffect(() => {
    setViewport(top);
    onInputRows(rowCount);
  }, [top, rowCount, onInputRows]);
  const hint = fit(placeholder ?? 'Enter a prompt or command', Math.max(0, space - 1));
  useMouse((event) => {
    const index = event.y - inputY - 1;
    if (!active || event.type !== 'click' || event.button !== 0 || index < 0 || index >= rowCount || event.x <= x || event.x > x + width) return;
    setCursor(positionAt(rows[top + index], Math.max(0, event.x - x - 4)));
  });

  useInput((input, key) => {
    if (key.escape) {
      setDismissed(value);
      return;
    }
    if (key.ctrl || key.meta || (key.shift && key.tab) || key.pageUp || key.pageDown) return;
    if (key.tab) {
      if (suggestion) complete(suggestion.label);
      else if (!value) onModels();
      return;
    }
    if (key.return || input === '\n' || input === '\r\n') {
      if (submissionBlocked) return;
      if (key.shift) {
        setValue(value.slice(0, offset) + '\n' + value.slice(offset));
        setCursor(cursor + 1);
        return;
      }
      if (suggestion && (mention
        ? value.slice(mention.start, mention.end).toLowerCase() !== suggestion.label.toLowerCase()
        : canonicalCommand(value.slice(1).toLowerCase()) !== suggestion.label.slice(1))) {
        complete(suggestion.label);
        return;
      }
      if (value === '/') return;
      if (!value.trim() && !canSendAttachments) return;
      onSubmit(value);
      setValue('');
      setCursor(0);
      setHistoryIndex(-1);
      setDraft('');
      return;
    }
    if (key.upArrow || key.downArrow) {
      if (suggestion) {
        setSelection((selection + suggestions.length + (key.upArrow ? -1 : 1)) % suggestions.length);
        return;
      }
      const targetRow = rows[currentRow + (key.upArrow ? -1 : 1)];
      if (targetRow) {
        setCursor(positionAt(targetRow, column(rows[currentRow], cursor)));
        return;
      }
      const next = historyIndex + (key.upArrow ? 1 : -1);
      if (next < -1 || next >= history.length) return;
      if (historyIndex < 0) setDraft(value);
      const recalled = next < 0 ? draft : history[history.length - next - 1];
      setHistoryIndex(next);
      setValue(recalled);
      setCursor(graphemes(recalled).length);
      return;
    }
    if (key.leftArrow || key.rightArrow) {
      setCursor(Math.max(0, Math.min(segments.length, cursor + (key.leftArrow ? -1 : 1))));
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor === 0) return;
      setValue(value.slice(0, offset - segments[cursor - 1].length) + value.slice(offset));
      setCursor(cursor - 1);
      return;
    }

    const pasted = cleanText(input)
      .replace(/^(?:\x1b)?\[(?:200|201)~/, '');
    if (!pasted) return;
    const before = value.slice(0, offset) + pasted;
    setValue(before + value.slice(offset));
    setCursor(graphemes(before).length);
  }, { isActive: active });

  return (
    <>
    {visibleRows.map((item, index) => <ActionRow key={item.label}
      actions={[{
        label: fill(width < 32 ? ' ' + item.label : fill(' ' + item.label, labelWidth) + ' ' + item.summary, width),
        selected: item.label === suggestion?.label, run: () => complete(item.label),
      }]}
      width={width} x={x} y={y + index} background={colors.surface} />)}
    <Box height={rowCount} width={width} flexDirection="column" flexShrink={0} overflow="hidden">
      {rows.slice(top, top + rowCount).map((row, index) => {
        const rowIndex = top + index;
        const cursorHere = active && rowIndex === currentRow;
        const caret = cursorHere && cursor < row.end ? display[cursor] : ' ';
        const caretAtEnd = cursorHere && cursor === row.end && row.cells < space;
        return <Text key={rowIndex} backgroundColor={colors.raised} color={colors.ink}>
          <Text color={active ? accent : colors.muted} bold>{rowIndex === 0 ? ' > ' : index === 0 ? ' ↑ ' : '   '}</Text>
          {!value ? <>
            <Text inverse={cursorHere}>{' '}</Text>
            <Text color={colors.muted}>{hint}</Text>
            {' '.repeat(Math.max(0, space - 1 - stringWidth(hint)))}
          </> : <>
            {display.slice(row.start, cursorHere ? cursor : row.end).join('')}
            {cursorHere && (cursor < row.end || caretAtEnd) && <Text inverse>{caret}</Text>}
            {cursorHere && display.slice(cursor + 1, row.end).join('')}
            {' '.repeat(Math.max(0, space - row.cells - Number(caretAtEnd)))}
          </>}
        </Text>;
      })}
    </Box>
    {footer}
    </>
  );
}
