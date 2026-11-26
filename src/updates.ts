import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const { name, version } = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};
export const installedVersion = version;
export const installedFromPackage = path.basename(path.dirname(path.resolve(packageRoot))) === 'node_modules';
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const registry = 'https://registry.npmjs.org';
const run = promisify(execFile);

export async function checkForUpdate(signal?: AbortSignal): Promise<string | undefined> {
  const timeout = AbortSignal.timeout(5000);
  const response = await fetch(`${registry}/${encodeURIComponent(name)}/latest`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error('The npm release could not be checked.');
  const release = (await response.json() as { version?: unknown }).version;
  const latest = typeof release === 'string' ? stableVersion.exec(release) : null;
  const installed = stableVersion.exec(version);
  if (!latest || !installed) throw new Error('The npm release version could not be read.');
  for (let part = 1; part <= 3; part++) {
    const difference = BigInt(latest[part]) - BigInt(installed[part]);
    if (difference !== 0n) return difference > 0n ? release as string : undefined;
  }
  return undefined;
}

function npm(args: string[], timeout: number) {
  const windows = process.platform === 'win32';
  // Windows needs cmd.exe to launch npm.cmd. Arguments are fixed or validated above.
  return run(windows ? 'cmd.exe' : 'npm', windows ? ['/d', '/c', 'npm.cmd', ...args] : args, {
    cwd: tmpdir(), windowsHide: true, timeout,
  });
}

export async function canInstallUpdate(): Promise<boolean> {
  if (!installedFromPackage) return false;
  try {
    const { stdout } = await npm(['root', '-g'], 5000);
    const globalPackage = path.join(stdout.trim(), name);
    return (await lstat(globalPackage)).isDirectory() &&
      (await realpath(globalPackage)) === (await realpath(packageRoot));
  } catch {
    return false;
  }
}

export async function installUpdate(release: string): Promise<boolean> {
  if (name !== 'ruqenai' || !stableVersion.test(release)) throw new Error('Invalid release.');
  if (!(await canInstallUpdate())) return false;
  await npm(['install', '-g', `${name}@${release}`, `--registry=${registry}`], 180000);
  return true;
}
