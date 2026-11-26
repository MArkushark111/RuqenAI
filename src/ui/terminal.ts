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

export interface Palette {
  coffee: string;
  ink: string;
  muted: string;
  code: string;
  surface: string;
  raised: string;
  rule: string;
  board: string;
  warning: string;
  error: string;
  done: string;
}

export const themes: Record<string, Palette> = {
  coffee: {
    coffee: '#CDA781', ink: '#E8E8E8', muted: '#A09A94', code: '#C8C8C8',
    surface: '#000000', raised: '#0F0F0F', rule: '#1E1E1E', board: '#1B1917',
    warning: '#E5BF90', error: '#F48383', done: '#9CC7AA',
  },
  dark: {
    coffee: '#CDA781', ink: '#E8E8E8', muted: '#A09A94', code: '#C8C8C8',
    surface: '#000000', raised: '#0F0F0F', rule: '#1E1E1E', board: '#1B1917',
    warning: '#E5BF90', error: '#F48383', done: '#9CC7AA',
  },
  matrix: {
    coffee: '#4ADE80', ink: '#D1FAE5', muted: '#6EE7B7', code: '#A7F3D0',
    surface: '#000000', raised: '#04140A', rule: '#0B2B18', board: '#04140A',
    warning: '#FBBF24', error: '#F87171', done: '#4ADE80',
  },
  ocean: {
    coffee: '#60A5FA', ink: '#E0F2FE', muted: '#93C5FD', code: '#BFDBFE',
    surface: '#020617', raised: '#0B1B30', rule: '#14304D', board: '#0B1B30',
    warning: '#FBBF24', error: '#F87171', done: '#34D399',
  },
  sunset: {
    coffee: '#FB923C', ink: '#FFF7ED', muted: '#FDBA74', code: '#FED7AA',
    surface: '#0C0603', raised: '#1F1206', rule: '#3B2410', board: '#1F1206',
    warning: '#FDE047', error: '#F87171', done: '#4ADE80',
  },
  mono: {
    coffee: '#E5E5E5', ink: '#FAFAFA', muted: '#A3A3A3', code: '#D4D4D4',
    surface: '#000000', raised: '#0A0A0A', rule: '#1F1F1F', board: '#0A0A0A',
    warning: '#EAB308', error: '#EF4444', done: '#A3A3A3',
  },
  cyberpunk: {
    coffee: '#E879F9', ink: '#FAF5FF', muted: '#F0ABFC', code: '#E9D5FF',
    surface: '#05010A', raised: '#170B24', rule: '#3B1D52', board: '#170B24',
    warning: '#FBBF24', error: '#F472B6', done: '#22D3EE',
  },
  mint: {
    coffee: '#5EEAD4', ink: '#F0FDFA', muted: '#99F6E4', code: '#CCFBF1',
    surface: '#010C0A', raised: '#04211C', rule: '#134E4A', board: '#04211C',
    warning: '#FBBF24', error: '#F87171', done: '#5EEAD4',
  },
  ultracode: {
    coffee: '#5EEAD4', ink: '#F0FDFA', muted: '#99F6E4', code: '#CCFBF1',
    surface: '#010C0A', raised: '#04211C', rule: '#134E4A', board: '#04211C',
    warning: '#FBBF24', error: '#F87171', done: '#5EEAD4',
  },
  rose: {
    coffee: '#FB7185', ink: '#FFF1F2', muted: '#FDA4AF', code: '#FECDD3',
    surface: '#0D0208', raised: '#20060D', rule: '#4C0519', board: '#20060D',
    warning: '#FBBF24', error: '#FB7185', done: '#34D399',
  },
  lavender: {
    coffee: '#A78BFA', ink: '#F5F3FF', muted: '#C4B5FD', code: '#DDD6FE',
    surface: '#080514', raised: '#120A24', rule: '#2E1065', board: '#120A24',
    warning: '#FBBF24', error: '#F87171', done: '#34D399',
  },
  nord: {
    coffee: '#88C0D0', ink: '#ECEFF4', muted: '#81A1C1', code: '#D8DEE9',
    surface: '#2E3440', raised: '#3B4252', rule: '#4C566A', board: '#3B4252',
    warning: '#EBCB8B', error: '#BF616A', done: '#A3BE8C',
  },
  dracula: {
    coffee: '#8BE9FD', ink: '#F8F8F2', muted: '#8B93B8', code: '#F8F8F2',
    surface: '#282A36', raised: '#343746', rule: '#44475A', board: '#2F3243',
    warning: '#FFB86C', error: '#FF5555', done: '#50FA7B',
  },
  gruvbox: {
    coffee: '#FABD2F', ink: '#EBDBB2', muted: '#A89984', code: '#EBDBB2',
    surface: '#282828', raised: '#3C3836', rule: '#504945', board: '#32302F',
    warning: '#FABD2F', error: '#FB4934', done: '#B8BB26',
  },
  tokyo: {
    coffee: '#7AA2F7', ink: '#C0CAF5', muted: '#737AA2', code: '#C0CAF5',
    surface: '#1A1B26', raised: '#24283B', rule: '#3B4261', board: '#1F2335',
    warning: '#E0AF68', error: '#F7768E', done: '#9ECE6A',
  },
  ember: {
    coffee: '#FF8A5C', ink: '#FFE8DC', muted: '#C98A6B', code: '#FFD9C2',
    surface: '#140B08', raised: '#2A140C', rule: '#4A2417', board: '#1F0F09',
    warning: '#FFC46B', error: '#FF6B6B', done: '#8FD18F',
  },
  amber: {
    coffee: '#FBBF24', ink: '#FEF3C7', muted: '#D9A441', code: '#FDE68A',
    surface: '#120D04', raised: '#241A08', rule: '#3A2C10', board: '#1C1406',
    warning: '#FDE047', error: '#F87171', done: '#86EFAC',
  },
};

export const themeNames = Object.keys(themes);

let base: Palette = themes.coffee;
let eco = false;

function applyPalette(): void {
  Object.assign(colors, base);
  if (eco) {
    // Eco tints the active theme toward green instead of replacing it, so eco + any theme still looks coherent.
    colors.coffee = '#8FE388';
    colors.board = mixHex(base.board, '#0E1B12', 0.6);
    colors.rule = mixHex(base.rule, '#16301F', 0.6);
    colors.raised = mixHex(base.raised, '#0E1B12', 0.45);
  }
}

/** The theme palette without the eco overlay — for per-chat accents like tab colors. */
export function themePalette(): Palette {
  return base;
}

export function applyTheme(name: string | undefined): void {
  base = themes[name ?? ''] ?? themes.coffee;
  applyPalette();
}

export const ecoAccent = '#8FE388';

export function ecoActive(): boolean {
  return eco;
}

export function applyEcoMode(on: boolean): void {
  eco = on;
  applyPalette();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return Math.max(0, Math.round(ms)) + 'ms';
  if (ms < 60_000) return (ms / 1000).toFixed(1) + 's';
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Mix two #RRGGBB colors; t=0 returns a, t=1 returns b. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const channel = (x: number, y: number) => Math.round(x + (y - x) * t);
  return '#' + [channel(ar, br), channel(ag, bg), channel(ab, bb)]
    .map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

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
