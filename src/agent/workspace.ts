import { exec, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { PermissionMode } from '../types/index.js';
import { permissionManager } from './permissions.js';

export interface WorkspaceActionOptions {
  cwd?: string;
  signal?: AbortSignal;
  permissionMode?: PermissionMode;
}

export class ActionDeniedError extends Error {}

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const maxFileBytes = 1_000_000;
const skipped = new Set(['.git', 'node_modules']);

function isWithin(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

export async function workspacePath(cwd: string, input: string, mayCreate = false): Promise<string> {
  if (!input || /[\u0000-\u001f]/.test(input)) throw new Error('Invalid workspace path');
  const root = await fs.realpath(cwd);
  const absolute = path.resolve(cwd, input);
  if (!isWithin(path.resolve(cwd), absolute)) throw new Error('Path is outside the workspace: ' + input);
  if (process.platform === 'win32' && path.relative(cwd, absolute).includes(':')) throw new Error('Invalid workspace path: ' + input);

  let existing = absolute;
  const missing: string[] = [];
  while (true) {
    try {
      const real = await fs.realpath(existing);
      const target = path.resolve(real, ...missing);
      if (!isWithin(root, real) || !isWithin(root, target)) throw new Error('Path is outside the workspace: ' + input);
      return target;
    } catch (error) {
      if (!mayCreate || (error as NodeJS.ErrnoException).code !== 'ENOENT' || existing === cwd) throw error;
      try {
        await fs.lstat(existing);
        throw new Error('Path points to a broken link: ' + input);
      } catch (linkError) {
        if ((linkError as NodeJS.ErrnoException).code !== 'ENOENT') throw linkError;
      }
      missing.unshift(path.basename(existing));
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
}

async function readText(filepath: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const info = await fs.stat(filepath);
  if (!info.isFile()) throw new Error('Path is not a regular file: ' + filepath);
  if (info.size > maxFileBytes) throw new Error('File exceeds 1 MB: ' + filepath);
  const contents = await fs.readFile(filepath, { signal });
  if (contents.includes(0)) throw new Error('Cannot read a binary file as text: ' + filepath);
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(contents);
}

async function writeText(target: string, content: string, signal?: AbortSignal): Promise<void> {
  const stat = await fs.stat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (stat && !stat.isFile()) throw new Error('Path is not a regular file: ' + target);
  const temporary = path.join(path.dirname(target), '.ruqenai-' + randomUUID() + '.tmp');
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', signal, flag: 'wx', mode: stat?.mode ?? 0o666 });
    signal?.throwIfAborted();
    await fs.rename(temporary, target);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

export async function readWorkspaceFile(file: string, start: number, end: number | undefined, options: WorkspaceActionOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const filepath = await workspacePath(cwd, file);
  const lines = (await readText(filepath, options.signal)).split(/\r\n|\n|\r/);
  if (start > lines.length) throw new Error('Start line exceeds the file length (' + lines.length + ')');
  const last = Math.min(end ?? start + 199, start + 399, lines.length);
  const numbered = lines.slice(start - 1, last).map((line, index) => (start + index) + '  ' + line);
  if (last < lines.length) numbered.push('… ' + (lines.length - last) + ' more lines');
  return numbered.join('\n');
}

export async function listWorkspaceDirectory(directory: string, options: WorkspaceActionOptions): Promise<string> {
  const filepath = await workspacePath(options.cwd ?? process.cwd(), directory);
  options.signal?.throwIfAborted();
  const entries = await fs.readdir(filepath, { withFileTypes: true });
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const lines = entries.slice(0, 400).map((entry) => entry.name + (entry.isDirectory() ? '/' : entry.isSymbolicLink() ? '@' : ''));
  if (entries.length > lines.length) lines.push('… ' + (entries.length - lines.length) + ' more entries');
  return lines.join('\n') || 'Directory is empty.';
}

export async function searchWorkspace(query: string, directory: string, options: WorkspaceActionOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const target = await workspacePath(cwd, directory);
  try {
    const result = await execFileAsync('rg', [
      '--line-number', '--no-heading', '--color', 'never', '--fixed-strings', '--max-count', '20',
      '--glob', '!node_modules', '--glob', '!.git', '--', query, path.relative(cwd, target) || '.',
    ], { cwd, signal: options.signal, timeout: 15_000, maxBuffer: 256_000, windowsHide: true });
    return result.stdout.trimEnd() || 'No matches.';
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (Number(failure.code) === 1) return 'No matches.';
    if (failure.code !== 'ENOENT') throw error;
  }

  const matches: string[] = [];
  const queue = [target];
  let inspected = 0;
  let truncated = false;

  while (queue.length && matches.length < 200) {
    if (inspected++ >= 1_500 || queue.length > 3_000) {
      truncated = true;
      break;
    }
    options.signal?.throwIfAborted();
    const candidate = queue.pop()!;
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      const entries = await fs.readdir(candidate, { withFileTypes: true });
      for (const entry of entries.reverse()) {
        if (!entry.isSymbolicLink() && !skipped.has(entry.name)) queue.push(path.join(candidate, entry.name));
      }
      continue;
    }
    if (!stat.isFile() || stat.size > maxFileBytes) continue;
    let text: string;
    try {
      text = await readText(candidate, options.signal);
    } catch {
      options.signal?.throwIfAborted();
      continue;
    }
    let matchesInFile = 0;
    for (const [index, line] of text.split(/\r\n|\n|\r/).entries()) {
      if (!line.includes(query)) continue;
      matches.push(path.relative(cwd, candidate) + ':' + (index + 1) + ':' + line.slice(0, 800));
      if (++matchesInFile >= 20 || matches.length >= 200) break;
    }
  }
  if (truncated || queue.length) matches.push('Search limit reached. Narrow the search path.');
  return matches.join('\n') || 'No matches.';
}

function lineChanges(before: string, after: string) {
  const lines = (text: string) => text.replace(/\r\n?/g, '\n').match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const oldLines = lines(before);
  const newLines = lines(after);
  if (!oldLines.length || !newLines.length) return { added: newLines.length, removed: oldLines.length };
  const parts = diffArrays(oldLines, newLines, { timeout: 250 });
  if (!parts) return undefined;
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    if (part.added) added += part.count;
    if (part.removed) removed += part.count;
  }
  return { added, removed };
}

export async function writeWorkspaceFile(file: string, content: string, options: WorkspaceActionOptions) {
  const cwd = options.cwd ?? process.cwd();
  if (Buffer.byteLength(content) > maxFileBytes) throw new Error('Write content exceeds 1 MB');
  const target = await workspacePath(cwd, file, true);
  const allowed = await permissionManager.checkPermission('file_write', target, 'Write file: ' + target, options.signal, options.permissionMode);
  options.signal?.throwIfAborted();
  if (!allowed) throw new ActionDeniedError('File write denied by permission settings.');
  if (await workspacePath(cwd, file, true) !== target) throw new Error('File target changed while awaiting approval');
  const before = await readText(target, options.signal).catch((error: NodeJS.ErrnoException) =>
    error.code === 'ENOENT' ? '' : undefined);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await writeText(target, content, options.signal);
  return { text: 'Wrote ' + path.relative(cwd, target) + ' (' + Buffer.byteLength(content) + ' bytes).',
    changes: before === undefined ? undefined : lineChanges(before, content) };
}

export async function editWorkspaceFile(
  file: string, oldText: string, newText: string, replaceAll: boolean, options: WorkspaceActionOptions,
) {
  const cwd = options.cwd ?? process.cwd();
  if (!oldText) throw new Error('old_text must not be empty');
  const target = await workspacePath(cwd, file);
  const allowed = await permissionManager.checkPermission('file_write', target, 'Edit file: ' + target, options.signal, options.permissionMode);
  options.signal?.throwIfAborted();
  if (!allowed) throw new ActionDeniedError('File edit denied by permission settings.');
  if (await workspacePath(cwd, file) !== target) throw new Error('File target changed while awaiting approval');
  const current = await readText(target, options.signal);
  if (current.includes('\r\n')) {
    oldText = oldText.replace(/\r?\n/g, '\r\n');
    newText = newText.replace(/\r?\n/g, '\r\n');
  }
  const first = current.indexOf(oldText);
  if (first < 0) throw new Error('old_text was not found. Read the file before editing.');
  const parts = current.split(oldText);
  if (!replaceAll && parts.length > 2) throw new Error('old_text appears more than once. Include more context or request all matches.');
  const next = parts.join(newText);
  if (Buffer.byteLength(next) > maxFileBytes) throw new Error('Updated file exceeds 1 MB');
  if (next === current) return { text: 'No changes in ' + path.relative(cwd, target) + '.', changes: { added: 0, removed: 0 } };
  await writeText(target, next, options.signal);
  return { text: 'Edited ' + path.relative(cwd, target) + ' (' + (parts.length - 1) + ' replacement(s)).', changes: lineChanges(current, next) };
}

export async function runShellCommand(
  command: string, options: WorkspaceActionOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; denied?: boolean }> {
  if (!command.trim() || command.includes('\0')) throw new Error('A valid shell command is required');
  const cwd = options.cwd ?? process.cwd();
  const allowed = await permissionManager.checkPermission('shell', command, 'Run shell command:\n' + command + '\n\nWorking directory: ' + cwd,
    options.signal, options.permissionMode);
  options.signal?.throwIfAborted();
  if (!allowed) return { stdout: '', stderr: 'Action denied by permission settings.', exitCode: 1, denied: true };

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd, signal: options.signal, timeout: 60_000, maxBuffer: 256_000, windowsHide: true,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    options.signal?.throwIfAborted();
    const failure = error as Error & { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    const diagnostic = failure.killed ? 'Shell command timed out or exceeded its output limit.' : failure.message;
    return {
      stdout: failure.stdout ?? '',
      stderr: [failure.stderr?.trimEnd(), diagnostic].filter(Boolean).join('\n'),
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
    };
  }
}
import { diffArrays } from 'diff';
