import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { AgentQuestion } from '../agent/tools.js';
import { ActionRow } from './ActionRow.js';
import { cleanText, colors, fill, fit, graphemes, wrapLines } from './terminal.js';

export interface QuestionRequest extends AgentQuestion {
  id: string;
  answer: (value?: string) => void;
}

function questionLines(question: AgentQuestion, width: number) {
  return wrapLines(question.question, Math.max(1, width - 2));
}

export function questionHeight(question: AgentQuestion, width: number) {
  return Math.min(14, 3 + questionLines(question, width).length + question.choices.length);
}

export function QuestionPrompt({ request, width, height, x, y }: {
  request: QuestionRequest;
  width: number;
  height: number;
  x: number;
  y: number;
}) {
  const [selected, select] = useState(0);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState('');
  const [offset, setOffset] = useState(0);
  const choices = [...request.choices, 'Type your own answer'];
  const lines = questionLines(request, width);
  const hasHeader = height >= 2;
  const hasFooter = height >= 4;
  const questionRows = Math.min(lines.length, Math.max(0, height - Number(hasHeader) - Number(hasFooter) - 1),
    Math.max(1, height - 2 - Math.min(choices.length, Math.floor(height / 2))));
  const availableRows = Math.max(1, height - questionRows - Number(hasHeader) - Number(hasFooter));
  const firstChoice = Math.min(Math.max(0, choices.length - availableRows), Math.max(0, selected - availableRows + 1));
  const maxOffset = Math.max(0, lines.length - questionRows);
  const start = Math.min(offset, maxOffset);
  const choose = (index: number) => {
    if (index === request.choices.length) setCustom(true);
    else request.answer(request.choices[index]);
  };

  useInput((input, key) => {
    if (key.escape) {
      if (custom) setCustom(false);
      else request.answer();
      return;
    }
    if (key.pageUp || key.pageDown) {
      setOffset(Math.max(0, Math.min(maxOffset, start + (key.pageUp ? -questionRows : questionRows))));
      return;
    }
    if (custom) {
      if (key.return && draft.trim()) request.answer(draft.trim());
      else if (key.backspace || key.delete) setDraft((value) => graphemes(value).slice(0, -1).join(''));
      else if (!key.ctrl && !key.meta && !key.return && !key.upArrow && !key.downArrow
        && !key.leftArrow && !key.rightArrow && !key.tab) {
        setDraft((value) => (value + cleanText(input).replace(/[\r\n]+/g, ' ')).slice(0, 1000));
      }
      return;
    }
    if (key.upArrow || key.downArrow || key.tab) {
      const direction = key.upArrow || key.shift ? -1 : 1;
      select((value) => (value + direction + choices.length) % choices.length);
    } else if (key.return) choose(selected);
  });

  return <Box flexDirection="column" flexShrink={0} width={width} height={height}>
    {hasHeader && <Text backgroundColor={colors.board} bold color={colors.coffee}>
      {fill(maxOffset ? ' Question · PgUp/PgDn to read' : ' Question', width)}
    </Text>}
    {lines.slice(start, start + questionRows).map((line, index) =>
      <Text key={index} backgroundColor={colors.board}>{fill(' ' + line, width)}</Text>)}
    {custom
      ? <Text backgroundColor={colors.board}>{fill(' › ' + (draft ? fit(draft, width - 3, true) : 'Type your answer'), width)}</Text>
      : choices.slice(firstChoice, firstChoice + availableRows).map((choice, index) => {
        const id = index + firstChoice;
        return <ActionRow key={id} width={width} x={x} y={y + Number(hasHeader) + questionRows + index} background={colors.board}
          actions={[{ label: fill((selected === id ? ' › ' : '   ') + cleanText(choice), width),
            color: id === request.choices.length ? colors.muted : colors.ink, selected: selected === id, run: () => choose(id) }]} />;
      })}
    {hasFooter && <Text color={colors.muted} backgroundColor={colors.board}>
      {fill(custom ? ' Enter Send   Esc Back' : ' ↑ ↓ Move   Enter Select   Esc Skip', width)}
    </Text>}
  </Box>;
}
