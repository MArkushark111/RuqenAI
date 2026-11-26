import { app } from 'electron';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'error';
  installed: string;
  version?: string;
  progress?: number;
  error?: string;
}

const releaseApi = 'https://api.github.com/repos/MArkushark111/RuqenAI/releases/latest';
let state: UpdateState;
let installer: string | undefined;
let pending: Promise<UpdateState> | undefined;

export function updateState(): UpdateState {
  return state ??= { status: 'idle', installed: app.getVersion() };
}

function newer(version: string, installed: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const current = installed.split('.').map(Number);
  const next = version.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (next[index] !== current[index]) return next[index] > current[index];
  }
  return false;
}

export function checkDesktopUpdate(notify: (value: UpdateState) => void): Promise<UpdateState> {
  if (pending) return pending;
  const publish = (value: Partial<UpdateState>) => {
    state = { ...updateState(), ...value };
    notify(state);
    return state;
  };
  pending = (async () => {
    if (installer && updateState().status === 'ready') return updateState();
    publish({ status: 'checking', error: undefined });
    let temporary: string | undefined;
    try {
      const response = await fetch(releaseApi, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Ruqenai-Desktop' },
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 404) throw new Error('No accessible desktop release yet. Publish an installer in GitHub Releases.');
      if (!response.ok) throw new Error('Update service unavailable. Try again later.');
      const release = await response.json() as {
        tag_name: string; draft: boolean; prerelease: boolean;
        assets: Array<{ name: string; browser_download_url: string; digest?: string; size: number }>;
      };
      const candidates = release.assets.map((asset) => ({
        asset,
        version: /^Ruqenai-Setup-(\d+\.\d+\.\d+)\.exe$/i.exec(asset.name)?.[1],
      })).filter((entry): entry is { asset: typeof release.assets[number]; version: string } => Boolean(entry.version));
      candidates.sort((a, b) => {
        const left = a.version.split('.').map(Number);
        const right = b.version.split('.').map(Number);
        return (right[0] - left[0]) || (right[1] - left[1]) || (right[2] - left[2]);
      });
      const latest = candidates[0];
      const version = latest?.version;
      if (release.draft || release.prerelease || !version || !newer(version, app.getVersion())) {
        return publish({ status: 'current' });
      }
      if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Automatic installers currently support Windows x64.');
      const asset = latest.asset;
      if (!asset || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? '')) {
        throw new Error('This release needs a Windows installer with a SHA-256 digest.');
      }
      const url = new URL(asset.browser_download_url);
      if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/MArkushark111/RuqenAI/releases/download/')) {
        throw new Error('Invalid installer location.');
      }
      publish({ status: 'downloading', version, progress: 0 });
      const directory = path.join(app.getPath('userData'), 'updates');
      await fs.mkdir(directory, { recursive: true });
      const destination = path.join(directory, asset.name);
      temporary = destination + '.part';
      const download = await fetch(url, { signal: AbortSignal.timeout(600000) });
      if (!download.ok || !download.body) throw new Error('Installer download failed.');
      if (asset.size <= 0 || asset.size > 1024 ** 3) throw new Error('Invalid installer size.');
      const file = await fs.open(temporary, 'w');
      const hash = createHash('sha256');
      let received = 0;
      let lastProgress = -1;
      try {
        for await (const chunk of download.body) {
          received += chunk.length;
          if (received > asset.size) throw new Error('Installer size does not match the release.');
          hash.update(chunk);
          await file.writeFile(chunk);
          const progress = Math.floor(received / asset.size * 100);
          if (progress !== lastProgress) {
            publish({ progress });
            lastProgress = progress;
          }
        }
      } finally {
        await file.close();
      }
      if (received !== asset.size || 'sha256:' + hash.digest('hex') !== asset.digest!.toLowerCase()) {
        throw new Error('Installer verification failed. Retry the download.');
      }
      await fs.rename(temporary, destination);
      installer = destination;
      return publish({ status: 'ready', progress: 100 });
    } catch (error) {
      if (temporary) await fs.rm(temporary, { force: true }).catch(() => {});
      return publish({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  })().finally(() => { pending = undefined; });
  return pending;
}

export async function installDesktopUpdate(): Promise<void> {
  if (!installer || updateState().status !== 'ready') throw new Error('Download an update first.');
  await fs.access(installer);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(installer!, ['/RESTARTAPP', '/CLOSEAPPLICATIONS'], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  app.quit();
}
