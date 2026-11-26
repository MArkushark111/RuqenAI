// A tiny markdown renderer. Escapes HTML first, then applies a safe subset:
// fenced code, headings, rules, quotes, lists, inline code/emphasis/links.

import { highlightCode } from './highlight';

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMd(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[highlight\]([\s\S]*?)\[\/highlight\]/gi, '<mark class="hl">$1</mark>')
    .replace(/\[color=#([\da-f]{6})\]([^\n]+?)\[\/color\]/gi, '<span class="tint" style="color:#$1">$2</span>')
    .replace(/==([^=\n]+)==/g, '<mark class="hl">$1</mark>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

export function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const buf: string[] = [];
      const lang = fence[1];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence
      out.push(
        `<pre class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${highlightCode(buf.join('\n'), lang)}</code></pre>`,
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const lvl = h[1].length; out.push(`<h${lvl}>${inlineMd(h[2])}</h${lvl}>`); i++; continue; }
    if (/^\s*(?:---|\*\*\*)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    const bq = line.match(/^&gt;\s?(.*)$/) || line.match(/^>\s?(.*)$/);
    if (bq) { out.push(`<blockquote>${inlineMd(bq[1])}</blockquote>`); i++; continue; }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(`<li>${inlineMd(lines[i].replace(/^\s*[-*+]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inlineMd(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    out.push(`<p>${inlineMd(line)}</p>`);
    i++;
  }
  return out.join('');
}
