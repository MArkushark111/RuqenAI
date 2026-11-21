import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { permissionManager } from '../agent/permissions.js';
import { PermissionMode, ToolDefinition } from '../types/index.js';

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
}

export interface McpPlugin {
  name: string;
  description?: string;
  servers: string[];
  enabled: boolean;
}

export interface McpToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

const configDirectory = path.join(os.homedir(), '.ruqenai');
const protocols = new Set(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
const safeEnvironment = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'USERPROFILE', 'HOME',
  'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SHELL',
]);
const requestTimeout = 20_000;

export class McpPermissionError extends Error {}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error('Cannot read ' + file + ': ' + (error instanceof Error ? error.message : String(error)));
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseServers(value: unknown): McpServerConfig[] {
  const entries = readRecord(value);
  if (!entries) return [];

  return Object.entries(entries).map(([name, raw]) => {
    const entry = readRecord(raw);
    const env = entry?.env === undefined ? undefined : readRecord(entry.env);
    if (!/^[a-zA-Z0-9._-]+$/.test(name) || !entry || typeof entry.command !== 'string' || !entry.command.trim()
      || (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some((arg) => typeof arg !== 'string')))
      || (entry.env !== undefined && (!env || Object.values(env).some((value) => typeof value !== 'string')))) {
      throw new Error('Invalid MCP server configuration for ' + name);
    }
    return {
      name,
      command: entry.command,
      args: entry.args as string[] | undefined,
      env: env as Record<string, string> | undefined,
      description: typeof entry.description === 'string' ? entry.description : undefined,
    };
  });
}

function saveJson(file: string, value: unknown, exclusive = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = JSON.stringify(value, null, 2) + '\n';
  if (exclusive) {
    fs.writeFileSync(file, body, { flag: 'wx', mode: 0o600 });
    return;
  }
  const temporary = file + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temporary, body, { flag: 'wx', mode: 0o600 });
  try { fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
}

export function updateMcpServer(name: string, spec?: unknown) {
  const file = path.join(configDirectory, 'mcp.json');
  const config = readRecord(readJson(file));
  if (!config) throw new Error('Expected an MCP configuration object.');
  const key = config.mcpServers === undefined && config.servers !== undefined ? 'servers' : 'mcpServers';
  const existing = config[key] === undefined ? {} : readRecord(config[key]);
  if (!existing) throw new Error('Expected a server map.');
  const servers = { ...existing };
  if (spec !== undefined) {
    if (mcpClient.listServers().some((server) => server.name === name)) throw new Error('Server already exists: ' + name);
    const { name: _name, ...server } = parseServers({ [name]: spec })[0];
    Object.defineProperty(servers, name, { value: server, enumerable: true, configurable: true });
  } else {
    if (!Object.hasOwn(servers, name)) throw new Error('No directly configured server named ' + name);
    delete servers[name];
  }
  saveJson(file, { ...config, [key]: servers });
}

function pluginFile(name: string) {
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(name) || name.endsWith('.')) throw new Error('Invalid plugin name.');
  return path.join(configDirectory, 'plugins', name + '.json');
}

export function installMcpPlugin(source: string): string {
  const target = path.resolve(source);
  const directory = fs.statSync(target).isDirectory();
  const root = directory ? target : path.dirname(target);
  const manifest = readRecord(readJson(directory ? path.join(target, '.claude-plugin', 'plugin.json') : target));
  const raw = directory && manifest?.mcpServers === undefined ? readRecord(readJson(path.join(target, '.mcp.json'))) : manifest;
  const declared = raw?.mcpServers ?? raw?.servers ?? (directory && raw !== manifest ? raw : undefined);
  const config = typeof declared === 'string' ? readRecord(readJson(path.resolve(root, declared))) : undefined;
  const specs = parseServers(config ? config.mcpServers ?? config.servers ?? config : declared);
  if (!specs.length) throw new Error('The plugin must declare local stdio MCP servers.');
  const expand = (value: string) => value.replaceAll('${CLAUDE_PLUGIN_ROOT}', () => root);
  const servers = Object.fromEntries(specs.map(({ name, command, args, env, description }) => [name, {
    command: expand(command),
    args: args?.map(expand),
    env: env && Object.fromEntries(Object.entries(env).map(([key, value]) => [key, expand(value)])),
    description,
  }]));
  const name = typeof manifest?.name === 'string' ? manifest.name : path.basename(target, directory ? undefined : '.json');
  saveJson(pluginFile(name), { name, description: manifest?.description, mcpServers: servers }, true);
  return name;
}

export function updateMcpPlugin(name: string, enabled?: boolean) {
  const file = pluginFile(name);
  if (enabled === undefined) { fs.unlinkSync(file); return; }
  const plugin = readRecord(readJson(file));
  if (!plugin || !fs.existsSync(file)) throw new Error('No installed plugin named ' + name);
  saveJson(file, { ...plugin, enabled });
}

function launch(server: McpServerConfig, signal?: AbortSignal): ChildProcessWithoutNullStreams {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => safeEnvironment.has(key.toUpperCase())));
  const args = server.args ?? [];
  const executable = server.command;
  if (process.platform === 'win32' && /^(?:npm|npx)(?:\.cmd)?$/i.test(executable)) {
    const npm = executable.toLowerCase().startsWith('npx') ? 'npx' : 'npm';
    const npmScript = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', npm + '-cli.js');
    if (fs.existsSync(npmScript)) {
      return spawn(process.execPath, [npmScript, ...args], { env: { ...env, ...server.env }, windowsHide: true, signal });
    }
  }
  return spawn(executable, args, { env: { ...env, ...server.env }, windowsHide: true, signal });
}

class StdioConnection {
  private buffer = '';
  private stderr = '';
  private failed?: Error;
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(private readonly process: ChildProcessWithoutNullStreams) {
    process.stdout.setEncoding('utf8').on('data', (text: string) => this.read(text));
    process.stderr.setEncoding('utf8').on('data', (text: string) => { this.stderr = (this.stderr + text).slice(-512); });
    process.on('error', (error) => this.fail(error));
    process.stdin.on('error', (error) => this.fail(error));
    process.on('close', (code) => {
      const diagnostics = this.stderr.trim();
      this.fail(new Error('MCP server exited (' + code + ')' + (diagnostics ? ': ' + diagnostics : '')));
    });
  }

  public request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.failed) return Promise.reject(this.failed);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('MCP request timed out: ' + method)), requestTimeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  public notify(method: string): void {
    this.send({ method });
  }

  public close(): void {
    if (!this.process.stdin.destroyed) this.process.stdin.end();
    const timeout = setTimeout(() => {
      if (this.process.exitCode === null && this.process.signalCode === null) this.process.kill();
    }, 250);
    timeout.unref();
  }

  private send(message: Record<string, unknown>): void {
    if (this.process.stdin.writable) {
      this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
    }
  }

  private read(text: string): void {
    if (this.failed) return;
    this.buffer += text;
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      if (line.length > 1_000_000) {
        this.fail(new Error('MCP response exceeded the message limit'));
        return;
      }
      try {
        const message = readRecord(JSON.parse(line));
        if (!message || message.jsonrpc !== '2.0') throw new Error('Invalid JSON-RPC message');
        if (typeof message.method === 'string') {
          if (typeof message.id === 'number' || typeof message.id === 'string') {
            this.send(message.method === 'ping'
              ? { id: message.id, result: {} }
              : { id: message.id, error: { code: -32601, message: 'Unsupported client request' } });
          }
          continue;
        }
        if (typeof message.id !== 'number') continue;
        const request = this.pending.get(message.id);
        if (!request) continue;
        clearTimeout(request.timer);
        this.pending.delete(message.id);
        const error = readRecord(message.error);
        if (error) request.reject(new Error(String(error.message ?? 'MCP request failed')));
        else request.resolve(message.result);
      } catch (error) {
        this.fail(new Error('Invalid message from MCP server: ' + (error instanceof Error ? error.message : String(error))));
        return;
      }
    }
    if (this.buffer.length > 1_000_000) this.fail(new Error('MCP response exceeded the message limit'));
  }

  private fail(error: Error): void {
    if (this.failed) return;
    this.failed = error;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.close();
  }
}

export class McpClient {
  private readonly registered = new Map<string, McpServerConfig>();

  public addServer(config: McpServerConfig): void {
    const { name, ...spec } = config;
    this.registered.set(name, parseServers({ [name]: spec })[0]);
  }

  private readConfiguration() {
    const global = readRecord(readJson(path.join(configDirectory, 'mcp.json')));
    const servers = new Map(parseServers(global?.mcpServers ?? global?.servers).map((server) => [server.name, server]));
    const pluginDirectory = path.join(configDirectory, 'plugins');
    const plugins: McpPlugin[] = [];

    if (fs.existsSync(pluginDirectory)) {
      for (const item of fs.readdirSync(pluginDirectory, { withFileTypes: true })) {
        if (!item.isFile() || !item.name.endsWith('.json')) continue;
        const plugin = readRecord(readJson(path.join(pluginDirectory, item.name)));
        const specs = parseServers(plugin?.mcpServers ?? plugin?.servers);
        const name = typeof plugin?.name === 'string' ? plugin.name : item.name.slice(0, -5);
        const enabled = plugin?.enabled !== false;
        for (const server of enabled ? specs : []) {
          if (!servers.has(server.name)) servers.set(server.name, server);
        }
        plugins.push({ name, enabled, description: typeof plugin?.description === 'string' ? plugin.description : undefined, servers: specs.map((server) => server.name) });
      }
    }
    for (const [name, config] of this.registered) servers.set(name, config);
    return { servers, plugins };
  }

  public listServers(): {name: string; description?: string}[] {
    return [...this.readConfiguration().servers.values()].map(({ name, description }) => ({ name, description }));
  }

  public getServer(name: string) {
    const server = this.readConfiguration().servers.get(name);
    if (!server) throw new Error('No MCP server named ' + name);
    return { name, command: server.command, args: server.args, environment: Object.keys(server.env ?? {}) };
  }

  public listPlugins(): McpPlugin[] {
    return this.readConfiguration().plugins;
  }

  public async listTools(name: string, signal?: AbortSignal, mode?: PermissionMode): Promise<ToolDefinition[]> {
    return this.withServer(name, 'List tools on MCP server ' + name, signal, mode, async (connection) => {
      const tools: ToolDefinition[] = [];
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const result = readRecord(await connection.request('tools/list', cursor ? { cursor } : {}));
        if (!Array.isArray(result?.tools)) throw new Error('MCP server returned an invalid tool list');
        for (const entry of result.tools) {
          if (typeof entry?.name === 'string' && readRecord(entry.inputSchema)) {
            tools.push({ name: entry.name, description: String(entry.description ?? ''), inputSchema: entry.inputSchema });
          }
        }
        cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
        if (cursor && (cursors.has(cursor) || cursors.size >= 49)) throw new Error('MCP tool listing exceeded the page limit');
        if (cursor) cursors.add(cursor);
      } while (cursor);
      return tools;
    });
  }

  public async callTool(name: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal, mode?: PermissionMode): Promise<McpToolResult> {
    const description = 'Call MCP tool ' + name + '/' + tool + '\n' + JSON.stringify(args, null, 2);
    return this.withServer(name, description, signal, mode, async (connection) => {
      const result = readRecord(await connection.request('tools/call', { name: tool, arguments: args }));
      if (!result || (!Array.isArray(result.content) && result.structuredContent === undefined)) {
        throw new Error('MCP server returned an invalid tool result');
      }
      return result as McpToolResult;
    });
  }

  private async withServer<T>(
    name: string, description: string, signal: AbortSignal | undefined, mode: PermissionMode | undefined,
    callback: (connection: StdioConnection) => Promise<T>,
  ): Promise<T> {
    const server = this.readConfiguration().servers.get(name);
    if (!server) throw new Error('Unknown MCP server ' + name);
    const allowed = await permissionManager.checkPermission('network', name, description, signal, mode);
    signal?.throwIfAborted();
    if (!allowed) throw new McpPermissionError('MCP action denied by permission settings.');

    const connection = new StdioConnection(launch(server, signal));
    try {
      const result = readRecord(await connection.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'Ruqenai', version: '1.0.0' },
      }));
      if (typeof result?.protocolVersion !== 'string' || !protocols.has(result.protocolVersion)) {
        throw new Error('MCP server negotiated an unsupported protocol version');
      }
      connection.notify('notifications/initialized');
      return await callback(connection);
    } finally {
      connection.close();
    }
  }
}

export const mcpClient = new McpClient();
