import { randomUUID } from 'node:crypto';
import { PermissionMode } from '../types/index.js';
import { configManager } from '../config/settings.js';

export interface PermissionRequest {
  id: string;
  type: 'shell' | 'file_write' | 'file_delete' | 'network';
  target: string;
  description: string;
  onDecide: (allowed: boolean, alwaysAllow?: boolean) => void;
}

const safeCommands = new Set([
  'ls', 'dir', 'git status', 'git status --short', 'git diff', 'git diff --stat', 'pwd',
  'node -v', 'npm --version', 'python --version',
]);

export class PermissionManager {
  private readonly queue: PermissionRequest[] = [];
  private requestListener?: (request: PermissionRequest | null) => void;

  public getMode(): PermissionMode {
    return configManager.get().permissionMode;
  }

  public setMode(mode: PermissionMode): void {
    configManager.update({ permissionMode: mode });
  }

  public setRequestListener(listener?: (request: PermissionRequest | null) => void): void {
    this.requestListener = listener;
    if (listener) {
      listener(this.getPendingRequest());
    } else {
      for (const request of [...this.queue]) request.onDecide(false);
    }
  }

  public async checkPermission(
    type: PermissionRequest['type'],
    target: string,
    description: string,
    signal?: AbortSignal,
    mode = this.getMode(),
  ): Promise<boolean> {
    signal?.throwIfAborted();
    if (mode === 'full') return true;

    const config = configManager.get();
    if (type === 'shell' && config.approvedCommands.includes(target)) return true;
    if (type === 'file_write' && config.approvedPaths.includes(target)) return true;
    if (mode === 'approve' && type === 'shell' && safeCommands.has(target)) return true;
    if (!this.requestListener) return false;

    return new Promise<boolean>((resolve) => {
      const request: PermissionRequest = {
        id: randomUUID(), type, target, description,
        onDecide: (allowed, alwaysAllow) => {
          const index = this.queue.indexOf(request);
          if (index < 0) return;
          this.queue.splice(index, 1);
          signal?.removeEventListener('abort', cancel);

          if (allowed && alwaysAllow) {
            const current = configManager.get();
            if (type === 'shell' && !current.approvedCommands.includes(target)) {
              configManager.update({ approvedCommands: [...current.approvedCommands, target] });
            } else if (type === 'file_write' && !current.approvedPaths.includes(target)) {
              configManager.update({ approvedPaths: [...current.approvedPaths, target] });
            }
          }

          if (index === 0) this.requestListener?.(this.getPendingRequest());
          resolve(allowed);
        },
      };
      const cancel = () => request.onDecide(false);
      this.queue.push(request);
      signal?.addEventListener('abort', cancel, { once: true });
      if (this.queue.length === 1) this.requestListener?.(request);
    });
  }

  public getPendingRequest(): PermissionRequest | null {
    return this.queue[0] ?? null;
  }
}

export const permissionManager = new PermissionManager();
