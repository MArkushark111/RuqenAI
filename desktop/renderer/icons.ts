// Inline stroke icons. One grid (16), one weight (1.4), round caps — so the
// whole chrome reads as a single drawing rather than a pile of borrowed sets.

const wrap = (body: string, fill = false): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ` +
  (fill
    ? 'fill="currentColor" stroke="none">'
    : 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">') +
  body +
  '</svg>';

export const ICONS = {
  plus: wrap('<path d="M8 3.2v9.6M3.2 8h9.6"/>'),
  compose: wrap('<path d="M13.4 8.6v3.6a1.6 1.6 0 0 1-1.6 1.6H3.8a1.6 1.6 0 0 1-1.6-1.6V4.2a1.6 1.6 0 0 1 1.6-1.6h3.6"/><path d="M11.4 2.2l2.4 2.4-5.2 5.2-2.9.5.5-2.9 5.2-5.2Z"/>'),
  panel: wrap('<rect x="2.2" y="3" width="11.6" height="10" rx="2.4"/><path d="M6.2 3v10"/>'),
  chats: wrap('<path d="M13.2 7.9c0 2.5-2.3 4.4-5.2 4.4-.6 0-1.2-.1-1.7-.2l-2.6 1.2.8-2.2a4.2 4.2 0 0 1-1.1-2.8c0-2.5 2.3-4.4 5.2-4.4s4.6 1.9 4.6 4Z"/>'),
  plug: wrap('<path d="M6 2.4v2.8M10 2.4v2.8"/><path d="M4.2 5.2h7.6v2.6a3.8 3.8 0 0 1-7.6 0V5.2Z"/><path d="M8 11.6v2"/>'),
  sun: wrap('<circle cx="8" cy="8" r="2.9"/><path d="M8 1.6v1.4M8 13v1.4M1.6 8H3M13 8h1.4M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1"/>'),
  moon: wrap('<path d="M13.2 9.7A5.6 5.6 0 0 1 6.3 2.8a5.6 5.6 0 1 0 6.9 6.9Z"/>'),
  folder: wrap('<path d="M2.2 4.9c0-.9.6-1.5 1.4-1.5h2.3c.5 0 1 .3 1.2.7l.6 1h4.7c.8 0 1.4.6 1.4 1.5v4.9c0 .9-.6 1.5-1.4 1.5H3.6c-.8 0-1.4-.6-1.4-1.5V4.9Z"/>'),
  chevron: wrap('<path d="M4.4 6.4L8 10l3.6-3.6"/>'),
  chevronLeft: wrap('<path d="M9.6 4.4L6 8l3.6 3.6"/>'),
  arrowUp: wrap('<path d="M8 13V3.4"/><path d="M4 7.2L8 3.2l4 4"/>'),
  stop: wrap('<rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.8" fill="currentColor" stroke="none"/>'),
  close: wrap('<path d="M4 4l8 8M12 4l-8 8"/>'),
  check: wrap('<path d="M3 8.4l3.2 3.2 6.8-7"/>'),
  search: wrap('<circle cx="7.2" cy="7.2" r="4.2"/><path d="M10.4 10.4l3 3"/>'),
  key: wrap('<circle cx="5.6" cy="10.4" r="2.6"/><path d="M7.5 8.5l5-5M10.4 5.6L12 7.2M11.6 4.4l1.6 1.6"/>'),
  link: wrap('<path d="M6.6 9.4l2.8-2.8"/><path d="M9.2 4.6l1-1a2.6 2.6 0 0 1 3.7 3.7l-1.7 1.7"/><path d="M6.8 11.4l-1 1a2.6 2.6 0 0 1-3.7-3.7l1.7-1.7"/>'),
  trash: wrap('<path d="M2.8 4.6h10.4M6.2 4.6V3h3.6v1.6"/><path d="M4.6 4.6l.6 8.2h5.6l.6-8.2"/>'),
  more: wrap('<circle cx="3.4" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.6" cy="8" r="1.1" fill="currentColor" stroke="none"/>'),
  sliders: wrap('<path d="M2.5 5h11M2.5 11h11"/><circle cx="6" cy="5" r="1.7"/><circle cx="10.4" cy="11" r="1.7"/>'),
  terminal: wrap('<rect x="2.2" y="3" width="11.6" height="10" rx="2.4"/><path d="M5 6.4L7.2 8 5 9.6M9 10h2.2"/>'),
  spark: wrap('<path d="M8 2.4l1.5 4.1 4.1 1.5-4.1 1.5L8 13.6 6.5 9.5 2.4 8l4.1-1.5L8 2.4Z"/>'),
  globe: wrap('<circle cx="8" cy="8" r="5.6"/><path d="M2.6 8h10.8"/><path d="M8 2.4c3 3.2 3 8 0 11.2-3-3.2-3-8 0-11.2Z"/>'),
  refresh: wrap('<path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8"/><path d="M13.4 2.6v3h-3"/>'),
  shield: wrap('<path d="M8 2.2l4.6 1.7v3.5c0 2.9-1.9 5.1-4.6 6.4-2.7-1.3-4.6-3.5-4.6-6.4V3.9L8 2.2Z"/>'),
  copy: wrap('<rect x="5.6" y="5.6" width="8" height="8" rx="1.8"/><path d="M10.4 3.6a1.8 1.8 0 0 0-1.8-1.8H4a1.8 1.8 0 0 0-1.8 1.8v4.6A1.8 1.8 0 0 0 4 10"/>'),
  branch: wrap('<circle cx="4.4" cy="4" r="1.6"/><circle cx="4.4" cy="12" r="1.6"/><circle cx="11.6" cy="7" r="1.6"/><path d="M4.4 5.6v4.8M6 4.6c2.4 0 4-.6 4-2.2v2.9"/>'),
  pin: wrap('<path d="M6.2 2.4h3.6l-.5 3.5 2.1 2.1H4.6l2.1-2.1-.5-3.5Z"/><path d="M8 8v5.6"/>'),
  panelRight: wrap('<rect x="2.2" y="3" width="11.6" height="10" rx="2.4"/><path d="M9.6 3v10"/><path d="M4.6 6.4h2.6M4.6 9.2h2.6"/>'),
} as const;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName): string => ICONS[name];
