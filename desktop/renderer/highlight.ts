// Syntax highlighting for code blocks. lowlight (highlight.js based) is already
// a dependency; this wraps it with a tiny hast serializer so the renderer stays
// dependency-light and the HTML is safe (highlight.js output is escaped).

import { common, createLowlight } from 'lowlight';

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, string | number | string[]>;
  value?: string;
  children?: HastNode[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hastToHtml(node: HastNode | HastNode[]): string {
  const walk = (n: HastNode): string => {
    if (!n || typeof n !== 'object') return '';
    if (n.type === 'text') return esc(String(n.value ?? ''));
    if (n.type === 'element' && n.tagName) {
      const props = n.properties ?? {};
      const className = props.className;
      const cls = typeof className === 'string'
        ? ` class="${className}"`
        : Array.isArray(className) && className.length
          ? ` class="${className.join(' ')}"`
          : '';
      return `<${n.tagName}${cls}>${(n.children ?? []).map(walk).join('')}</${n.tagName}>`;
    }
    return (n.children ?? []).map(walk).join('');
  };
  return Array.isArray(node) ? node.map(walk).join('') : walk(node);
}

const low = createLowlight(common) as unknown as {
  registered: (lang: string) => boolean;
  highlight: (lang: string, value: string) => HastNode;
};

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'shell',
  zsh: 'shell',
  bash: 'shell',
  html: 'xml',
  yml: 'yaml',
  md: 'markdown',
  txt: 'plaintext',
  text: 'plaintext',
};

/** Highlight a code block; falls back to plaintext (still escaped). */
export function highlightCode(code: string, lang: string): string {
  const raw = String(lang || '').toLowerCase();
  const key = LANG_ALIASES[raw] ?? raw;
  const use = key && typeof low.registered === 'function' && low.registered(key) ? key : 'plaintext';
  try {
    return hastToHtml(low.highlight(use, code));
  } catch {
    return esc(code);
  }
}
