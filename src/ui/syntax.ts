import { common, createLowlight } from 'lowlight';
import wrapAnsi from 'wrap-ansi';
import { colors, hexToRgb } from './terminal.js';

const syntax = createLowlight(common);

// Warm tones follow the active accent so themes (and eco) recolor code too.
let cachedAccent = '';
let cachedPalette = new Map<string, string>();
function palette(): Map<string, string> {
  if (colors.coffee === cachedAccent) return cachedPalette;
  cachedAccent = colors.coffee;
  const [r, g, b] = hexToRgb(colors.coffee);
  const warm = (t: number) => [r, g, b].map((v) => Math.round(v + (255 - v) * t)).join(';');
  cachedPalette = new Map([
    ['keyword', '209;169;225'], ['literal', warm(0.5)], ['number', warm(0.5)],
    ['string', '163;198;148'], ['regexp', '163;198;148'], ['comment', '154;151;148'],
    ['title', '153;193;224'], ['built_in', '153;193;224'], ['type', '153;193;224'],
    ['attr', warm(0.38)], ['name', warm(0.38)], ['meta', warm(0.38)],
  ]);
  return cachedPalette;
}

type Node = ReturnType<typeof syntax.highlight>['children'][number];

function paint(node: Node, parent?: string, colors: Map<string, string> = palette()): string {
  if (node.type === 'text') return parent ? `\x1b[38;2;${parent}m${node.value}\x1b[39m` : node.value;
  if (node.type !== 'element') return '';
  const classes = node.properties.className;
  const color = Array.isArray(classes) ? classes.map((name) => colors.get(String(name).replace(/^hljs-/, ''))).find(Boolean) : undefined;
  return node.children.map((child) => paint(child, color ?? parent, colors)).join('');
}

export function highlightCode(code: string, language: string, width: number): string[] {
  const colors = palette();
  let styled = code;
  if (code.length <= 32_000) {
    const tree = syntax.registered(language) ? syntax.highlight(language, code)
      : !language && code.length < 8_000 && code.trim()
        ? syntax.highlightAuto(code, { subset: ['javascript', 'typescript', 'python', 'css', 'xml', 'json', 'bash'] })
        : undefined;
    if (tree) styled = tree.children.map((node) => paint(node, undefined, colors)).join('');
  }
  return wrapAnsi(styled, Math.max(1, width), { hard: true, trim: false }).split('\n');
}
