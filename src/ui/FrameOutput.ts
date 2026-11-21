import type { WriteStream } from 'node:tty';

// In the alternate screen each render is a frame. Leave unchanged terminal rows alone.
export function createFrameOutput(terminal: WriteStream) {
  let previous: string[] = [];
  let lastSize = '';
  let pending = '';
  let render: ReturnType<typeof setImmediate> | undefined;
  const flush = () => {
    render = undefined;
    const size = `${terminal.columns}:${terminal.rows}`;
    const resized = size !== lastSize;
    if (resized) previous = [];
    lastSize = size;
    const lines = pending.split('\n').slice(0, terminal.rows || 24);
    let patch = resized ? '\x1b[2J' : '';
    for (let index = 0; index < Math.max(previous.length, lines.length); index++) {
      if (previous[index] === lines[index]) continue;
      patch += `\x1b[${index + 1};1H${lines[index] ?? ''}\x1b[0m\x1b[K`;
    }
    previous = lines;
    if (patch) terminal.write(patch);
  };
  const write = (frame: string | Uint8Array) => {
    const text = typeof frame === 'string' ? frame : Buffer.from(frame).toString('utf8');
    if (/^\x1b\[\?25[hl]$/.test(text)) return terminal.write(text);
    pending = text;
    render ??= setImmediate(flush);
    return true;
  };
  const stdout = new Proxy(terminal, {
    get(target, key) {
      if (key === 'write') return write;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { stdout, stop: () => { if (render) clearImmediate(render); } };
}
