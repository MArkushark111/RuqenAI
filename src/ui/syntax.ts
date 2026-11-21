import { common, createLowlight } from 'lowlight';
import wrapAnsi from 'wrap-ansi';

const syntax = createLowlight(common);
const palette = new Map([
  ['keyword', '209;169;225'], ['literal', '230;181;134'], ['number', '230;181;134'],
  ['string', '163;198;148'], ['regexp', '163;198;148'], ['comment', '154;151;148'],
  ['title', '153;193;224'], ['built_in', '153;193;224'], ['type', '153;193;224'],
  ['attr', '220;189;142'], ['name', '220;189;142'], ['meta', '220;189;142'],
]);

type Node = ReturnType<typeof syntax.highlight>['children'][number];

function paint(node: Node, parent?: string): string {
  if (node.type === 'text') return parent ? `\x1b[38;2;${parent}m${node.value}\x1b[39m` : node.value;
  if (node.type !== 'element') return '';
  const classes = node.properties.className;
  const color = Array.isArray(classes) ? classes.map((name) => palette.get(String(name).replace(/^hljs-/, ''))).find(Boolean) : undefined;
  return node.children.map((child) => paint(child, color ?? parent)).join('');
}

export function highlightCode(code: string, language: string, width: number): string[] {
  let styled = code;
  if (code.length <= 32_000) {
    const tree = syntax.registered(language) ? syntax.highlight(language, code)
      : !language && code.length < 8_000 && code.trim()
        ? syntax.highlightAuto(code, { subset: ['javascript', 'typescript', 'python', 'css', 'xml', 'json', 'bash'] })
        : undefined;
    if (tree) styled = tree.children.map((node) => paint(node)).join('');
  }
  return wrapAnsi(styled, Math.max(1, width), { hard: true, trim: false }).split('\n');
}
