// Label shaping for the desktop UI.
//
// The model picker never renders provider wording. Two rules do that:
//   1. BANNED words are removed from every label, whatever provider or model
//      they came from.
//   2. A provider's own brand is removed from the labels it produces, so
//      "DeepSeek V4.1 Flash" renders as "V4.1 Flash".
// What is left is collapsed and trimmed; if nothing is left, the caller falls
// back (model id, then a neutral word) or omits the label entirely.

/** Words the UI must never render. */
const BANNED: string[] = ['deepseek'];

/** Strip every banned word and brand from `label`. '' if nothing is left. */
export function brandless(label: string, ...brands: string[]): string {
  let out = String(label ?? '');
  for (const brand of [...BANNED, ...brands]) {
    const b = String(brand ?? '').trim();
    if (!b) continue;
    // Whole-word match only: a short brand must not eat the middle of a word
    // (brand "udio" would otherwise turn "Audio" into "A").
    const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp('\\b' + escaped + '\\b', 'gi'), ' ');
  }
  return out
    .replace(/\(\s*\)/g, ' ') // drop parentheticals the strip emptied
    .replace(/[\s/_:|-]+/g, ' ')
    .trim();
}

/** A display label for a model: name first, then its id, then a neutral word. */
export function modelLabel(name: string, id: string, ...brands: string[]): string {
  return brandless(name, ...brands) || brandless(id, ...brands) || 'Model';
}

/** A section header for a provider: its name, else its id, else nothing. */
export function groupLabel(name: string, id: string): string {
  return brandless(name) || brandless(id);
}
