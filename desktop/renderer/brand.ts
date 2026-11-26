// Provider identity: a mark or a sigil, and the hue that goes with it.
//
// The palette rule for the whole app is that colour only appears where it
// means something — provider identity. Chrome stays porcelain and ink; a
// provider brings its own hue and the composer, chips and sheets borrow it.

import { MARKS, SIGILS } from './logos';

export interface Brand {
  /** Inline SVG for the mark, sized by CSS. */
  svg: string;
  /** Brand hue on porcelain. */
  hex: string;
  /** The same hue lifted for the ink theme. */
  hexDark: string;
}

function markSvg(inner: string): string {
  return `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${inner}</svg>`;
}

/** Two initials for a provider that has no upstream mark. */
function initials(id: string): string {
  const parts = id.split(/[-_\s]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : id.slice(0, 2);
  return letters.toUpperCase();
}

function sigilSvg(letters: string): string {
  const size = letters.length > 2 ? 7 : letters.length === 2 ? 8.4 : 10.5;
  return (
    '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true">' +
    '<rect x="1.6" y="1.6" width="20.8" height="20.8" rx="6.4" fill="currentColor" opacity="0.11"/>' +
    '<rect x="1.6" y="1.6" width="20.8" height="20.8" rx="6.4" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="1.2"/>' +
    `<text x="12" y="12.4" text-anchor="middle" dominant-baseline="middle" font-family="Cascadia Mono, JetBrains Mono, ui-monospace, monospace" font-size="${size}" font-weight="700" letter-spacing="-0.2" fill="currentColor">${letters}</text>` +
    '</svg>'
  );
}

const NEUTRAL: Brand = { svg: sigilSvg('?'), hex: '#14130f', hexDark: '#f0ece4' };

const cache = new Map<string, Brand>();

export function brandFor(providerId: string): Brand {
  const id = String(providerId || '').toLowerCase();
  const hit = cache.get(id);
  if (hit) return hit;

  let brand: Brand = NEUTRAL;
  const mark = MARKS[id];
  const sigil = SIGILS[id] ?? { letters: initials(id), hex: '#14130f', hexDark: '#f0ece4' };
  if (mark) brand = { svg: markSvg(mark.inner), hex: mark.hex, hexDark: mark.hexDark };
  else if (id) brand = { svg: sigilSvg(sigil.letters), hex: sigil.hex, hexDark: sigil.hexDark };

  cache.set(id, brand);
  return brand;
}

/** `<span class="brand-tile">` wrapper that carries both theme hues. */
export function brandTile(providerId: string, extraClass = ''): string {
  const brand = brandFor(providerId);
  return (
    `<span class="brand-tile${extraClass ? ' ' + extraClass : ''}" style="--brand-l:${brand.hex};--brand-d:${brand.hexDark}" aria-hidden="true">` +
    brand.svg +
    '</span>'
  );
}

/** Human-readable provider name without the catalog's category suffix. */
export function providerName(id: string, fallback?: string): string {
  return (fallback || id).replace(/\s*\((Local|Vertex)\)$/i, (m, s) => (s === 'Local' ? ' (local)' : ''));
}

/**
 * Push the active provider's hue onto the document so chrome, focus rings and
 * the model sheet all agree on it.
 */
export function applyBrand(providerId: string): void {
  const brand = brandFor(providerId);
  const root = document.documentElement;
  root.style.setProperty('--brand-l', brand.hex);
  root.style.setProperty('--brand-d', brand.hexDark);
}
