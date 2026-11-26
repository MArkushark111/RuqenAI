import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { configManager } from '../config/settings.js';
import { sessionManager, SessionManager, workspaceKey } from '../agent/context.js';
import { permissionManager } from '../agent/permissions.js';
import { ProviderCatalog } from '../providers/catalog.js';
import { ProviderManager } from '../providers/manager.js';
import { normalizeEndpoint } from '../providers/protocols.js';
import { ollamaClient } from '../providers/ollama.js';
import { costSummary } from '../providers/usage.js';
import { skillsManager } from '../skills/manager.js';
import { subagentManager } from '../agent/subagents.js';
import { AgentEngine, type AgentMode, type EngineCallbacks } from '../agent/engine.js';
import { KeyStore } from '../config/keystore.js';
import { mcpClient } from '../mcp/client.js';
import { lanHostAddress, lanHostPort, mobilePairingCode, startLanHost, stopLanHost } from '../lan/host.js';
import { canonicalCommand, listCommands, type CommandView } from './catalog.js';
import { applyEcoMode, applyTheme } from '../ui/terminal.js';
import type { PermissionMode, ThinkingEffort } from '../types/index.js';

export interface CommandResult {
  handled: boolean;
  output?: string;
  quiet?: boolean;
  error?: boolean;
  action?: 'exit' | 'clear';
  view?: CommandView;
  prefill?: string;
}

const effortLevels: Record<string, ThinkingEffort> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh' };
const permissionModes = new Set(['ask', 'approve', 'full']);

function ollamaAddress(): string {
  try {
    return normalizeEndpoint(configManager.getOllamaHost());
  } catch {
    return 'invalid endpoint';
  }
}

function argumentPath(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function switchWorkspace(dir: string): CommandResult {
  const target = path.resolve(argumentPath(dir));
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return { handled: true, error: true, output: `No such directory: ${dir}` };
  }
  if (!stat.isDirectory()) return { handled: true, error: true, output: `Not a directory: ${target}` };
  process.chdir(target);
  // Pick up the new workspace's ruqenai.json so its settings apply immediately.
  configManager.reloadWorkspace();
  applyTheme(configManager.get().theme);
  // With workspace chats off, switching folders keeps the current chat instead of filtering sessions.
  if (configManager.get().workspaceChats !== true) {
    return { handled: true, output: `Workspace: ${target}\nChat: ${sessionManager.getSession().name}` };
  }
  const key = workspaceKey(target);
  const latest = SessionManager.listAll()
    .filter((chat) => chat.workspace && !chat.hidden && workspaceKey(chat.workspace) === key)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (latest) sessionManager.switchSession(latest.id);
  else sessionManager.startFreshSession();
  return { handled: true, output: `Workspace: ${target}\nChat: ${sessionManager.getSession().name}` };
}

function parseArguments(json: string | undefined): Record<string, unknown> {
  if (!json?.trim()) return {};
  const value = JSON.parse(json) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be a JSON object.');
  return value as Record<string, unknown>;
}

export async function copyToClipboard(value: string): Promise<boolean> {
  const programs: [string, string[]][] = process.platform === 'win32' ? [['clip.exe', []]]
    : process.platform === 'darwin' ? [['pbcopy', []]] : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']]];
  for (const [program, args] of programs) {
    const copied = await new Promise<boolean>((resolve) => {
      const child = spawn(program, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
      child.once('error', () => resolve(false));
      child.once('close', (code) => resolve(code === 0));
      child.stdin.on('error', () => {});
      child.stdin.end(process.platform === 'win32' ? Buffer.from('\ufeff' + value, 'utf16le') : value);
    });
    if (copied) return true;
  }
  return false;
}

export function openSystemPath(target: string): void {
  const [program, args] = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', `start "" "${target}"`]]
    : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  try {
    const child = spawn(program, args, { windowsHide: true, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

export class SlashCommandRouter {
  public static async handle(input: string, signal?: AbortSignal, callbacks?: EngineCallbacks, mode?: AgentMode): Promise<CommandResult> {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return { handled: false };
    }

    const [, name, remainder] = trimmed.match(/^\/(\S*)\s*([\s\S]*)$/) ?? ['', '', ''];
    const cmd = canonicalCommand(name.toLowerCase());
    const argStr = remainder.trim();
    const args = argStr ? argStr.split(/\s+/) : [];

    switch (cmd) {
      // ---------------- NAVIGATION & CONTROL ----------------
      case '':
      case 'help':
        return argStr.toLowerCase() === 'all'
          ? { handled: true, output: listCommands() }
          : { handled: true, view: { kind: 'commands' } };

      case 'host': {
        const flag = argStr.toLowerCase();
        if (flag === 'on' || flag === 'true') {
          await startLanHost();
          const code = await mobilePairingCode();
          return { handled: true, output: `Hosting the Android companion on ${lanHostAddress()}:${lanHostPort()}\nPairing code: ${code}` };
        }
        if (flag === 'off' || flag === 'false') {
          const wasRunning = Boolean(lanHostPort());
          await stopLanHost();
          return { handled: true, output: wasRunning ? 'Companion hosting stopped.' : 'Companion hosting was not running.' };
        }
        return { handled: true, view: { kind: 'host' } };
      }

      case 'exit':
        return { handled: true, action: 'exit' };

      case 'clear':
        return { handled: true, action: 'clear' };

      case 'cleartasks':
        return sessionManager.clearTasks()
          ? { handled: true, quiet: true }
          : { handled: true, error: true, output: 'Could not clear tasks.' };

      case 'new': {
        const newId = `session-${Date.now()}`;
        const created = sessionManager.switchSession(newId, { create: true });
        return { handled: true, quiet: created, output: created ? 'New chat started.' : 'Could not start a new chat.' };
      }

      case 'sessions': {
        if (!argStr) return { handled: true, view: { kind: 'sessions' } };
        const resumed = sessionManager.switchSession(argStr);
        return { handled: true, quiet: resumed, output: resumed ? `Resumed session ${argStr}` : `No saved session named ${argStr}.` };
      }

      case 'compact': {
        const res = await AgentEngine.compact(signal);
        return { handled: true, output: res };
      }

      case 'undo': {
        if (argStr && argStr !== 'chat') return { handled: true, error: true, output: 'Usage: /undo [chat]' };
        const undone = await sessionManager.undoLastTurn({ chatOnly: argStr === 'chat' || name.toLowerCase() === 'rewind' });
        return { handled: true, output: undone
          ? undone.restored ? `Undid the last turn and restored ${undone.restored} file(s).` : 'Undid the last chat turn. No tracked file changes were restored.'
          : 'Nothing to undo.' };
      }

      case 'fork': {
        const branchName = argStr || `branch-${Date.now()}`;
        sessionManager.forkBranch(branchName);
        return { handled: true, output: `Switched to new branch ${branchName}` };
      }

      case 'export': {
        const filename = argumentPath(argStr) || `ruqenai-export-${Date.now()}.md`;
        const msgs = sessionManager.getSession().messages;
        if (path.extname(filename).toLowerCase() === '.json') {
          const messages = msgs.map(({ fileChanges: _checkpoint, ...message }) => message);
          fs.writeFileSync(filename, JSON.stringify({ ...sessionManager.getSession(), messages }, null, 2), 'utf-8');
          return { handled: true, output: `Exported transcript to ${path.resolve(filename)}` };
        }
        let content = `# Ruqenai Session Export (${sessionManager.getSession().id})\n\n`;
        for (const m of msgs) {
          content += `### ${m.role.toUpperCase()} (${new Date(m.timestamp).toLocaleTimeString()})\n\n${m.content}\n\n`;
          if (m.reasoningContent) {
            content += `> **Model reasoning**\n> ${m.reasoningContent.replace(/\n/g, '\n> ')}\n\n`;
          }
          if (m.error) {
            content += `**Error**\n\n${m.error}\n\n`;
          }
        }
        fs.writeFileSync(filename, content, 'utf-8');
        return { handled: true, output: `Exported transcript to ${path.resolve(filename)}` };
      }

      // ---------------- MODEL & PARAMS ----------------
      case 'model': {
        if (!argStr) return { handled: true, view: { kind: 'models' } };
        if (argStr.toLowerCase() === 'all') return { handled: true, view: { kind: 'models', providerId: 'all' } };
        const requested = ProviderCatalog.get(argStr.toLowerCase());
        if (requested) return { handled: true, view: { kind: 'models', providerId: requested.id } };
        const separator = argStr.indexOf(' ');
        const provider = separator > 0 ? ProviderCatalog.get(argStr.slice(0, separator)) : undefined;
        const model = provider ? argStr.slice(separator + 1).trim() : argStr;
        configManager.update({ activeProvider: provider?.id ?? configManager.get().activeProvider, activeModel: model });
        return { handled: true, quiet: true, output: `Model set to ${configManager.get().activeProvider} / ${model}` };
      }

      case 'provider': {
        if (!argStr) return { handled: true, view: { kind: 'providers' } };
        const meta = ProviderCatalog.get(argStr.toLowerCase());
        if (!meta) {
          return { handled: true, output: `Unknown provider "${argStr}". Use /provider to list provider IDs.` };
        }
        const connection = ProviderCatalog.connection(meta.id);
        if (connection === 'catalog' || (connection === 'endpoint' && !configManager.get().customEndpoints[meta.id])
          || (meta.requiresKey !== false && meta.id !== 'ollama' && !configManager.getApiKey(meta.id, meta.envKey))) {
          return { handled: true, view: { kind: 'provider-setup', providerId: meta.id } };
        }
        if (configManager.get().activeProvider === meta.id) return { handled: true, view: { kind: 'models', providerId: meta.id } };
        const discovered = await ProviderManager.discoverModels(meta.id);
        const selectable = discovered.models.find((model) => model.chatSupport !== 'unsupported' && !model.deprecated)
          ?? discovered.models.find((model) => model.chatSupport !== 'unsupported');
        if (!selectable) return { handled: true, view: { kind: 'models', providerId: meta.id } };
        configManager.update({ activeProvider: meta.id, activeModel: selectable.id });
        return { handled: true, quiet: true, output: `Provider set to ${meta.id} / ${configManager.get().activeModel}` };
      }

      case 'effort': {
        if (!argStr) return { handled: true, view: { kind: 'effort' } };
        const val = argStr.toLowerCase();
        if (val === 'ultracode') {
          configManager.update({ theme: 'ultracode', ultracodeMode: true, thinkingEffort: 'XHigh', thinkingEnabled: true });
          return { handled: true, quiet: true, output: 'Effort set to UltraCode' };
        }
        const effort = effortLevels[val];
        if (effort) {
          configManager.update({ theme: 'dark', ultracodeMode: false, thinkingEffort: effort, thinkingEnabled: true });
          return { handled: true, quiet: true, output: `Thinking effort set to ${val}` };
        }
        if (val === 'off' || val === 'false') {
          configManager.update({ theme: 'dark', ultracodeMode: false, thinkingEnabled: false });
          return { handled: true, quiet: true, output: 'Thinking disabled.' };
        }
        if (val === 'on' || val === 'true') {
          configManager.update({ thinkingEnabled: true });
          return { handled: true, quiet: true, output: `Thinking effort set to ${configManager.get().thinkingEffort.toLowerCase()}` };
        }
        return { handled: true, output: 'Usage: /effort <Off|Low|Medium|High|XHigh|UltraCode>' };
      }

      case 'eco': {
        const flag = argStr.toLowerCase();
        const session = sessionManager.getSession();
        const on = flag === 'on' || flag === 'true' ? true
          : flag === 'off' || flag === 'false' ? false
          : session.ecoMode !== true;
        if (!sessionManager.setEcoMode(on)) return { handled: true, error: true, output: 'Could not save eco mode.' };
        applyEcoMode(on);
        return { handled: true, quiet: true,
          output: on ? `Eco mode on for "${session.name}" — green theme, terse replies, thinking off.`
            : `Eco mode off for "${session.name}".` };
      }

      case 'temp': {
        if (!argStr) {
          return { handled: true, output: `Temperature: ${configManager.get().temperature}` };
        }
        const num = Number(argStr);
        if (Number.isFinite(num) && num >= 0 && num <= 2) {
          configManager.update({ temperature: num });
          return { handled: true, output: `Temperature set to ${num}` };
        }
        return { handled: true, output: 'Please provide a number between 0.0 and 2.0' };
      }

      case 'params': {
        const cfg = configManager.get();
        const out = `Model settings
  Provider      ${cfg.activeProvider}
  Model         ${cfg.activeModel}
  Thinking      ${cfg.thinkingEnabled ? cfg.thinkingEffort.toLowerCase() : 'off'}
  Temperature   ${cfg.temperature}
  Accent        ${cfg.ultracodeMode ? 'mint' : sessionManager.getSession().ecoMode ? 'eco green' : 'slate'}
  Eco mode      ${sessionManager.getSession().ecoMode ? 'on (this chat)' : 'off'}
  Permissions   ${cfg.permissionMode}
  Ollama host   ${ollamaAddress()}`;
        return { handled: true, output: out };
      }

      case 'status': {
        const ollamaCheck = await ollamaClient.detect();
        const cfg = configManager.get();
        const out = `Session status
  Workspace     ${process.cwd()}
  Model         ${cfg.activeProvider} / ${cfg.activeModel}
  Permissions   ${cfg.permissionMode}
  Ollama        ${ollamaCheck.isOnline ? `online (${ollamaCheck.models.length} installed)` : `offline · ${ollamaAddress()}`}
  Node.js       ${process.version}`;
        return { handled: true, output: out };
      }

      case 'usage': {
        const { totalTokens, usage } = sessionManager.getSession();
        const total = totalTokens ? Math.max(totalTokens, usage?.totalTokens ?? 0) : usage?.totalTokens;
        const tokens = (value?: number) => value?.toLocaleString() ?? 'Unavailable';
        const { label, value, unpriced } = costSummary(usage);
        const note = unpriced ? `\n  Unpriced requests  ${unpriced.toLocaleString()} (excluded from cost)` : '';
        return { handled: true, output: `Session usage\n  Input tokens    ${tokens(usage?.inputTokens)}\n  Output tokens   ${tokens(usage?.outputTokens)}\n  Total tokens    ${tokens(total)}\n  ${label.padEnd(16)}${value}${note}` };
      }

      // ---------------- FILES & WORKSPACE ----------------
      case 'attach': {
        if (!argStr) return { handled: true, output: 'Usage: /attach <path/to/file>' };
        const full = path.resolve(argumentPath(argStr));
        if (!fs.statSync(full, { throwIfNoEntry: false })?.isFile()) return { handled: true, output: `File not found: ${argStr}` };
        sessionManager.attachFile(full);
        return { handled: true, quiet: true, output: `Attached ${path.basename(full)}` };
      }

      case 'drop': {
        if (!argStr) return { handled: true, output: 'Usage: /drop <path/to/file>' };
        const full = path.resolve(argumentPath(argStr));
        const dropped = sessionManager.dropFile(full);
        return { handled: true, quiet: dropped, output: dropped ? `Removed ${argStr} from context` : `File is not attached: ${argStr}` };
      }

      case 'ls': {
        const files = fs.readdirSync(process.cwd(), { withFileTypes: true });
        return { handled: true, output: files.map((file) => file.name + (file.isDirectory() ? '/' : '')).join('\n') || 'Directory is empty.' };
      }

      case 'pwd':
        return { handled: true, output: process.cwd() };

      case 'workspace': {
        if (!argStr) return { handled: true, view: { kind: 'workspace' } };
        return switchWorkspace(argStr);
      }

      case 'cd': {
        if (!argStr) return { handled: true, output: 'Usage: /cd <directory>' };
        return switchWorkspace(argStr);
      }

      case 'diff': {
        const res = await AgentEngine.executeShellCommand('git diff', { signal });
        return { handled: true, output: res.stdout || res.stderr || 'No changes.' };
      }

      // ---------------- EXECUTION & AUTONOMY ----------------
      case 'run': {
        if (!argStr) return { handled: true, output: 'Usage: /run <command>' };
        const res = await AgentEngine.executeShellCommand(argStr, { signal });
        const output = [res.stdout, res.stderr].filter(Boolean).join('\n');
        return { handled: true, error: res.exitCode !== 0,
          output: res.denied ? output : res.exitCode === 0 ? output || 'Command finished without output.'
            : [`Command exited with code ${res.exitCode}.`, output].filter(Boolean).join('\n') };
      }

      case 'init': {
        const saved = configManager.saveWorkspace();
        return { handled: true, output: saved ? 'Initialized ruqenai.json' : 'Could not write ruqenai.json in this workspace.' };
      }

      case 'mode': {
        if (!argStr) return { handled: true, view: { kind: 'permissions' } };
        const m = argStr.toLowerCase();
        if (permissionModes.has(m)) {
          permissionManager.setMode(m as PermissionMode);
          return { handled: true, quiet: true, output: `Permission mode set to ${m}` };
        }
        return { handled: true, output: 'Usage: /mode <ask|approve|full>' };
      }

      case 'approvals': {
        const cfg = configManager.get();
        return {
          handled: true,
          output: `Approved commands\n${cfg.approvedCommands.map((c) => '  ' + c).join('\n') || '  None'}\n\nApproved paths\n${cfg.approvedPaths.map((p) => '  ' + p).join('\n') || '  None'}`,
        };
      }

      // ---------------- TOOLS, MCP, SKILLS, SUBAGENTS ----------------
      case 'tools': {
        const run = argStr.match(/^run\s+(\S+)(?:\s+([\s\S]+))?$/i);
        if (run) {
          const result = await AgentEngine.runTool(run[1], parseArguments(run[2]), { signal });
          return { handled: true, output: result.text };
        }
        const list = AgentEngine.listTools().map(({ name, description }) => `  ${name}  ${description}`).join('\n');
        return { handled: true, output: `Tools\n${list}\n\n/tools run <name> [json]` };
      }

      case 'mcp': {
        const invocation = argStr.match(/^(\S+)(?:\s+(\S+)(?:\s+([\s\S]+))?)?$/);
        if (!invocation || argStr === 'list') {
          const servers = mcpClient.listServers();
          const names = servers.map(({ name, description }) => `  ${name}${description ? '  ' + description : ''}`);
          return { handled: true, output: names.length ? `MCP servers\n${names.join('\n')}` : 'No MCP servers configured in ~/.ruqenai/mcp.json.' };
        }
        const [, server, tool, json] = invocation;
        if (tool) {
          const result = await AgentEngine.runTool('mcp_invoke', { server, tool, arguments: parseArguments(json) }, { signal });
          return { handled: true, output: result.text };
        }
        const tools = await mcpClient.listTools(server, signal);
        return { handled: true, output: tools.length ? `MCP tools · ${server}\n${tools.map(({ name, description }) => `  ${name}${description ? '  ' + description : ''}`).join('\n')}` : `No tools available from ${server}.` };
      }

      case 'plugins': {
        const plugins = await mcpClient.listPlugins();
        return { handled: true, output: plugins.length ? `Plugins\n${plugins.map(({ name, description, servers }) => `  ${name}${description ? '  ' + description : ''}${servers.length ? ` (${servers.join(', ')})` : ''}`).join('\n')}` : 'No plugin manifests configured in ~/.ruqenai/plugins/.' };
      }

      case 'skills': {
        const run = argStr.match(/^run\s+(\S+)\s+([\s\S]+)$/i);
        if (run) {
          await AgentEngine.execute(run[2], callbacks, { skill: run[1], signal, mode });
          return { handled: true };
        }
        const create = argStr.match(/^create\s+([\w-]+)\s+([\s\S]+)$/i);
        if (create) {
          const [, name, instructions] = create;
          skillsManager.createSkill(name, `User-defined ${name} skill`, instructions, ['custom']);
          return { handled: true, output: `Created skill ${name} at ~/.ruqenai/skills/${name}.md` };
        }
        if (args[0] === 'reload') {
          skillsManager.reload();
          return { handled: true, output: `Reloaded ${skillsManager.list().length} skills.` };
        }
        const list = skillsManager.list();
        const out = list.map((s) => `  ${s.name}  ${s.description}`).join('\n');
        return { handled: true, output: `Skills\n${out}\n\n/skills run <name> <prompt>\n/skills create <name> <instructions>` };
      }

      case 'agents': {
        const run = argStr.match(/^run\s+(\S+)\s+([\s\S]+)$/i);
        if (run) {
          await AgentEngine.execute(run[2], callbacks, { profile: run[1], signal, mode });
          return { handled: true };
        }
        const list = subagentManager.list();
        const out = list.map((a) => `  ${a.name}  ${a.role}`).join('\n');
        return { handled: true, output: `Subagent profiles\n${out}\n\n/agents run <profile> <prompt>` };
      }

      // ---------------- AUTH & CONFIG ----------------
      case 'config': {
        if (!argStr) return { handled: true, view: { kind: 'settings' } };
        const cfg = configManager.get();
        const customEndpoints = Object.keys(cfg.customEndpoints);
        return { handled: true, output: JSON.stringify({ ...cfg, ollamaHost: ollamaAddress(), apiKeys: Object.keys(KeyStore.listConfigured()), customEndpoints }, null, 2) };
      }

      case 'animations': {
        const value = argStr.toLowerCase();
        if (value && value !== 'on' && value !== 'off') return { handled: true, output: 'Usage: /animations [on|off]' };
        const enabled = value ? value === 'on' : !configManager.get().animationsEnabled;
        configManager.update({ animationsEnabled: enabled });
        return { handled: true, quiet: true, output: `Animations ${enabled ? 'on' : 'off'}` };
      }

      case 'copy': {
        if (argStr.toLowerCase() === 'path') {
          const copied = await copyToClipboard(process.cwd());
          return { handled: true, quiet: copied, output: copied ? 'Copied the workspace path.' : 'No clipboard command is available in this terminal.' };
        }
        if (argStr) return { handled: true, output: 'Usage: /copy [path]' };
        const latest = [...sessionManager.getSession().messages].reverse().find((message) => message.role === 'assistant' && message.content);
        if (!latest) return { handled: true, output: 'No response to copy.' };
        const copied = await copyToClipboard(latest.content);
        return { handled: true, quiet: copied, output: copied ? 'Copied the last response.' : 'No clipboard command is available in this terminal.' };
      }

      case 'editor': {
        const result = await AgentEngine.executeShellCommand('code .', { signal });
        return { handled: true, output: result.exitCode === 0 ? 'Opened workspace in VS Code.' : result.stderr || `VS Code exited with code ${result.exitCode}.` };
      }

      case 'logs': {
        const events = sessionManager.getSession().messages.flatMap((message) => {
          const time = new Date(message.timestamp).toLocaleTimeString();
          const activity = message.tasks?.filter((task) => task.kind === 'tool').map((task) => `  ${time}  ${task.status}  ${task.title}`) ?? [];
          return message.error ? [...activity, `  ${time}  error  ${message.error}`] : activity;
        });
        return { handled: true, output: events.length ? `Recent session activity\n${events.slice(-15).join('\n')}` : 'No tool activity or errors recorded in this session.' };
      }

      case 'doctor': {
        const ollamaCheck = await ollamaClient.detect();
        const out = `Diagnostics
  Node.js       ${process.version}
  Ollama        ${ollamaCheck.isOnline ? `online (${ollamaCheck.models.length} installed)` : 'offline'}
  Providers     ${ProviderCatalog.count()}
  Skills        ${skillsManager.list().length}
  Subagents     ${subagentManager.list().length}
  Workspace     ${process.cwd()}`;
        return { handled: true, output: out };
      }

      case 'update':
        return { handled: true, view: { kind: 'update' } };

      default:
        return { handled: false };
    }
  }
}
