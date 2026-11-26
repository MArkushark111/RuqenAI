import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Pastes above either threshold would make the Ink composer redraw thousands of characters. */
const CHARS_THRESHOLD = 2000;
const LINES_THRESHOLD = 24;

export function isLargePaste(text: string): boolean {
  return text.length >= CHARS_THRESHOLD || text.split(/\r?\n/).length >= LINES_THRESHOLD;
}

/** Short token shown in the composer instead of the full pasted text. */
export function pasteMarker(text: string): string {
  return `[(${text.split(/\r?\n/).length})#]`;
}

/** Save the full paste outside the workspace and return the path plus its marker. */
export async function stashPaste(text: string): Promise<{ file: string; marker: string }> {
  const directory = path.join(os.homedir(), '.ruqenai', 'pastes');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `paste-${Date.now()}-${randomUUID().slice(0, 6)}.txt`);
  await fs.writeFile(file, text, { encoding: 'utf8', mode: 0o600 });
  return { file, marker: pasteMarker(text) };
}
