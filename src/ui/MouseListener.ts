import { useEffect, useRef } from 'react';
import { PassThrough } from 'node:stream';
import type { ReadStream } from 'node:tty';

export interface MouseEventData {
  type: 'click' | 'release' | 'move' | 'scroll_up' | 'scroll_down';
  button: number;
  x: number;
  y: number;
}

export class MouseListener {
  private static enabled = false;
  private static listeners = new Set<(event: MouseEventData) => void>();

  public static start(): void {
    if (this.enabled || !process.stdin.isTTY || process.env.TERM === 'dumb') return;
    this.enabled = true;
    process.stdout.write('\x1b[?1003h\x1b[?1006h');
  }

  public static stop(): void {
    if (!this.enabled) return;
    this.enabled = false;
    process.stdout.write('\x1b[?1003l\x1b[?1006l');
  }

  public static onMouse(callback: (event: MouseEventData) => void): () => void {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  }

  private static pendingMove?: MouseEventData;
  private static moveFrame?: ReturnType<typeof setImmediate>;

  public static report(code: number, x: number, y: number, pressed: boolean): void {
    if (!this.enabled || code & 4) return;
    const button = code & 3;
    if (code & 64 && button > 1) return;
    const type = code & 64 ? (button === 0 ? 'scroll_up' : 'scroll_down')
      : code & 32 ? 'move' : pressed ? 'click' : 'release';
    const event: MouseEventData = { type, button, x, y };
    if (type !== 'move') {
      this.emit(event);
      return;
    }
    this.pendingMove = event;
    this.moveFrame ??= setImmediate(() => {
      this.moveFrame = undefined;
      const move = this.pendingMove;
      this.pendingMove = undefined;
      if (move && this.enabled) this.emit(move);
    });
  }

  private static emit(event: MouseEventData) {
    for (const listener of [...this.listeners]) listener(event);
  }
}

// Route terminal mouse reports before Ink interprets keyboard input.
export function createTerminalInput(source: ReadStream) {
  const stream = new PassThrough();
  let pasteHandler: ((text: string) => boolean) | undefined;
  let paste: string | undefined;
  const pasteEnd = '\x1b[201~';
  let pending = '';
  let escapeTimer: ReturnType<typeof setTimeout> | undefined;
  const forward = (text: string) => { if (text) stream.write(text); };
  const read = (chunk: string) => {
    clearTimeout(escapeTimer);
    let text = pending + chunk;
    pending = '';
    while (paste !== undefined) {
      const end = text.indexOf(pasteEnd);
      if (end === -1) {
        const partial = /\x1b(?:\[(?:2(?:0(?:1)?)?)?)?$/.exec(text);
        paste += partial ? text.slice(0, partial.index) : text;
        pending = partial?.[0] ?? '';
        return;
      }
      const value = paste + text.slice(0, end);
      paste = undefined;
      text = text.slice(end + pasteEnd.length);
      if (!pasteHandler?.(value)) forward(value.replace(/[\x00-\x1f\x7f]/g, ' '));
    }
    const start = text.indexOf('\x1b[200~');
    if (start !== -1) {
      read(text.slice(0, start));
      paste = '';
      read(text.slice(start + pasteEnd.length));
      return;
    }
    let cursor = 0;
    for (const match of text.matchAll(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g)) {
      forward(text.slice(cursor, match.index));
      MouseListener.report(Number(match[1]), Number(match[2]), Number(match[3]), match[4] === 'M');
      cursor = match.index + match[0].length;
    }
    const tail = text.slice(cursor);
    const partial = /\x1b(?:\[(?:<\d*(?:;\d*){0,2}|2(?:0(?:0)?)?)?)?$/.exec(tail);
    if (!partial) return forward(tail);
    forward(tail.slice(0, partial.index));
    pending = partial[0];
    // Escape on its own is a key. A partial mouse packet stays buffered across reads.
    if (pending === '\x1b') escapeTimer = setTimeout(() => {
      const key = pending;
      pending = '';
      forward(key);
    }, 30);
  };
  const stdin = Object.assign(stream, {
    isTTY: true,
    ref: () => source.ref(),
    unref: () => source.unref(),
    setRawMode: (enabled: boolean) => {
      source.setRawMode(enabled);
      if (enabled) {
        source.setEncoding('utf8');
        source.on('data', read);
      } else {
        source.off('data', read);
        source.pause();
        clearTimeout(escapeTimer);
        pending = '';
        paste = undefined;
      }
      return stdin;
    },
  }) as unknown as ReadStream;
  return {
    stdin,
    onPaste(handler?: (text: string) => boolean) { pasteHandler = handler; },
  };
}

export function useMouse(callback: (event: MouseEventData) => void) {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => MouseListener.onMouse((event) => latest.current(event)), []);
}
