import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';

export const colors = {
  coffee: '#CDA781',
  ink: '#E8E8E8',
  muted: '#A09A94',
  code: '#C8C8C8',
  surface: '#000000',
  raised: '#0F0F0F',
  rule: '#1E1E1E',
  board: '#1B1917',
  warning: '#E5BF90',
  error: '#F48383',
  done: '#9CC7AA',
};

export function fill(value: string, width: number): string {
  const text = fit(value, width);
  return text + ' '.repeat(Math.max(0, width - stringWidth(text)));
}

export function cleanText(value: string): string {
  return stripVTControlCharacters(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

export function singleLine(value: string): string {
  return cleanText(value).replace(/[\n\t]/g, ' ');
}

export function wrapLines(value: string, width: number, preserveIndent = false): string[] {
  return cleanText(value).replace(/\t/g, '    ').split('\n').flatMap((line) => {
    const lines = wrapAnsi(line, Math.max(1, width), { hard: true, trim: false }).split('\n');
    return preserveIndent ? lines : lines.map((part, index) => index > 0 ? part.trimStart() : part);
  });
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function graphemes(value: string): string[] {
  return Array.from(segmenter.segment(value), ({ segment }) => segment);
}

export function fit(value: string, width: number, keepEnd = false): string {
  const line = singleLine(value);
  if (width < 1) return '';
  if (stringWidth(line) <= width) return line;

  const segments = graphemes(line);
  if (keepEnd) segments.reverse();

  const visible: string[] = [];
  let remaining = width - 1;
  for (const segment of segments) {
    const cells = stringWidth(segment);
    if (cells > remaining) break;
    visible.push(segment);
    remaining -= cells;
  }

  return keepEnd ? '…' + visible.reverse().join('') : visible.join('') + '…';
}
