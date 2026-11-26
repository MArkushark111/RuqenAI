import fs from 'node:fs/promises';
import path from 'node:path';
import { configManager } from '../config/settings.js';
import { ProviderCatalog } from '../providers/catalog.js';
import { ProviderManager } from '../providers/manager.js';
import { mcpClient, McpPermissionError, prepareMcpPlugin, saveMcpPlugin, updateMcpServer } from '../mcp/client.js';
import { skillsManager } from '../skills/manager.js';
import { TaskItem, ToolDefinition, ChatMessage } from '../types/index.js';
import { permissionManager } from './permissions.js';
import { subagentManager } from './subagents.js';
import { computerAction, type ComputerAction } from './computer.js';
import {
  ActionDeniedError, editWorkspaceFile, imageMediaType, listWorkspaceDirectory, readWorkspaceFile, runShellCommand,
  searchWorkspace, WorkspaceActionOptions, workspacePath, writeWorkspaceFile,
} from './workspace.js';

type ToolArguments = Record<string, unknown>;
export type PlanEntry = Pick<TaskItem, 'id' | 'title'> & { status: 'pending' | 'in_progress' | 'completed' };
export interface AgentQuestion {
  question: string;
  choices: string[];
}

export interface ToolResult {
  status: 'completed' | 'failed' | 'denied';
  text: string;
  modelText?: string;
  changes?: TaskItem['changes'];
  diff?: TaskItem['diff'];
  exitCode?: number;
  shellOutput?: Pick<NonNullable<TaskItem['shellLog']>, 'stdout' | 'stderr'>;
  images?: ChatMessage['images'];
  attachment?: { name: string; path: string };
}

export interface ToolContext extends WorkspaceActionOptions {
  updatePlan?: (entries: PlanEntry[]) => void;
  askQuestion?: (question: AgentQuestion) => Promise<string | undefined>;
  delegate?: (profile: string, prompt: string, taskId?: string, provider?: string, model?: string) => Promise<ToolResult>;
  taskId?: string;
  inspectSubagent?: (id: string | undefined, offset: number) => string;
  provider?: string;
  model?: string;
}

export interface ConfiguredProvider {
  id: string;
  name: string;
  active: boolean;
  models: string[];
}

/** Chat providers with a saved key, custom endpoint, or local runtime. Never includes credentials. */
export function configuredChatProviders(): ConfiguredProvider[] {
  const cfg = configManager.get();
  const providers: ConfiguredProvider[] = ProviderCatalog.all()
    .filter((provider) => ProviderManager.hasChatConnection(provider))
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      active: provider.id === cfg.activeProvider,
      models: provider.popularModels
        .filter((model) => model.capabilities.includes('text') || model.capabilities.includes('code'))
        .map((model) => model.id),
    }));
  const active = providers.find((provider) => provider.active);
  if (active && cfg.activeModel && !active.models.some((model) => model.toLowerCase() === cfg.activeModel.toLowerCase())) {
    active.models.unshift(cfg.activeModel);
  }
  return providers;
}

interface Tool extends ToolDefinition {
  title: string;
  subject?: string;
  run: (args: ToolArguments, context: ToolContext) => Promise<string | ToolResult>;
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false };
}

function stringSchema(description: string): Record<string, unknown> {
  return { type: 'string', description };
}

function stringArg(args: ToolArguments, name: string, allowEmpty = false): string {
  const value = args[name];
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new Error('Provide a string for ' + name);
  return value;
}

function positiveInt(args: ToolArguments, name: string): number | undefined {
  const value = args[name];
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(name + ' must be a positive integer');
  return value;
}

const TINYFISH_SEARCH_URL = 'https://api.search.tinyfish.ai';

async function webSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<string> {
  const apiKey = configManager.getApiKey('tinyfish');
  if (!apiKey) {
    throw new Error('Web search needs a TinyFish API key. Set the TINYFISH_API_KEY environment variable '
      + 'or add TINYFISH_API_KEY to ~/.ruqenai/.env.');
  }
  const url = new URL(TINYFISH_SEARCH_URL);
  url.searchParams.set('query', query);
  const response = await fetch(url, { headers: { 'X-API-Key': apiKey, Accept: 'application/json' }, signal });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300);
    throw new Error('TinyFish search failed (HTTP ' + response.status + ')' + (detail ? ': ' + detail : ''));
  }
  const payload = await response.json().catch(() => undefined) as { results?: unknown; total_results?: unknown } | undefined;
  const raw: unknown[] = payload && Array.isArray(payload.results) ? payload.results : [];
  const results = raw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .filter((item) => typeof item.url === 'string' && item.url)
    .slice(0, maxResults);
  if (!results.length) return 'No web results for "' + query + '".';
  const total = payload && typeof payload.total_results === 'number' ? payload.total_results : results.length;
  const lines = results.map((item, index) => {
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : String(item.url);
    const site = typeof item.site_name === 'string' ? item.site_name.trim() : '';
    const snippet = typeof item.snippet === 'string' ? item.snippet.replace(/\s+/g, ' ').trim() : '';
    return `${index + 1}. ${title}${site ? ' — ' + site : ''}\n${item.url}${snippet ? '\n' + snippet : ''}`;
  });
  return `Web results for "${query}" (showing ${results.length} of ${total}):\n\n${lines.join('\n\n')}`;
}

export function objectArg(value: unknown): ToolArguments {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be a JSON object.');
  return value as ToolArguments;
}

function readPlan(args: ToolArguments): PlanEntry[] {
  const plan = args.tasks;
  if (!Array.isArray(plan) || plan.length > 15) throw new Error('Provide up to 15 plan tasks.');
  const ids = new Set<string>();
  return plan.map((value) => {
    const entry = objectArg(value);
    const id = stringArg(entry, 'id');
    const title = stringArg(entry, 'title').trim();
    const status = entry.status;
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(id) || ids.has(id) || title.length > 180
      || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) {
      throw new Error('Each plan task needs a unique id, a short title, and a valid status.');
    }
    ids.add(id);
    return { id, title, status };
  });
}

const tools: Tool[] = [
  {
    name: 'computer_use',
    title: 'Use computer',
    subject: 'action',
    description: 'Control the visible Windows desktop and inspect a fresh screenshot after every action. Use screenshot first, then move/click/double_click/drag/scroll/key/type. Coordinates refer to the returned full desktop screenshot. Esc cancels computer control. Do not enter or reveal secrets, or send messages to other people without explicit user authorization.',
    inputSchema: objectSchema({
      action: { type: 'string', enum: ['screenshot', 'move', 'click', 'double_click', 'mouse_down', 'mouse_up', 'drag', 'scroll', 'key', 'key_down', 'key_up', 'type'] },
      x: { type: 'integer', description: 'Screen X coordinate for mouse actions.' },
      y: { type: 'integer', description: 'Screen Y coordinate for mouse actions.' },
      toX: { type: 'integer', description: 'Drag destination X.' },
      toY: { type: 'integer', description: 'Drag destination Y.' },
      button: { type: 'string', enum: ['left', 'right', 'middle'] },
      amount: { type: 'integer', description: 'Scroll wheel notches; positive scrolls up, negative scrolls down.' },
      key: { type: 'string', description: 'Key or shortcut, for example Ctrl+Shift+S.' },
      text: { type: 'string', description: 'Text to type into the focused control.' },
    }, ['action']),
    async run(args, context) {
      const action = stringArg(args, 'action') as ComputerAction;
      const allowedActions = ['screenshot', 'move', 'click', 'double_click', 'mouse_down', 'mouse_up', 'drag', 'scroll', 'key', 'key_down', 'key_up', 'type'];
      if (!allowedActions.includes(action)) throw new Error('Unknown computer action.');
      const model = ProviderCatalog.get(context.provider ?? '')?.popularModels.find((item) => item.id.toLowerCase() === context.model?.toLowerCase());
      if (model && !model.capabilities.includes('vision')) throw new Error(`${context.model} cannot inspect screenshots. Switch to a vision-capable model.`);
      const allowed = await permissionManager.checkPermission('shell', 'computer-use', 'Control the Windows desktop and view screenshots for this task.', context.signal, context.permissionMode);
      if (!allowed) throw new ActionDeniedError('Computer control was not allowed.');
      const input = {
        action,
        x: args.x === undefined ? undefined : Number(args.x), y: args.y === undefined ? undefined : Number(args.y),
        toX: args.toX === undefined ? undefined : Number(args.toX), toY: args.toY === undefined ? undefined : Number(args.toY),
        button: args.button as 'left' | 'right' | 'middle' | undefined,
        amount: args.amount === undefined ? undefined : Number(args.amount), key: args.key as string | undefined,
        text: args.text as string | undefined,
      };
      for (const number of [input.x, input.y, input.toX, input.toY, input.amount]) {
        if (number !== undefined && (!Number.isSafeInteger(number) || Math.abs(number) > 100_000)) throw new Error('Invalid computer coordinate or scroll amount.');
      }
      if (['move', 'click', 'double_click', 'mouse_down', 'drag'].includes(action) && (input.x === undefined || input.y === undefined)) throw new Error('Mouse action requires x and y.');
      if (action === 'drag' && (input.toX === undefined || input.toY === undefined)) throw new Error('Drag requires toX and toY.');
      if (['key', 'key_down', 'key_up'].includes(action) && (!input.key || input.key.length > 40)) throw new Error('Key action requires a short key name.');
      if (action === 'type' && (typeof input.text !== 'string' || input.text.length > 3000)) throw new Error('Type action requires up to 3000 characters of text.');
      const frame = await computerAction(input, context.signal);
      return { status: 'completed', text: `${action} completed. Screenshot: ${frame.width}×${frame.height}. Inspect this image before acting again.`, images: [{ mediaType: 'image/png', data: frame.data }] };
    },
  },
  {
    name: 'list_directory',
    title: 'List directory',
    subject: 'path',
    description: 'List files and subdirectories in a workspace directory.',
    inputSchema: objectSchema({ path: stringSchema('Workspace directory. Defaults to the current workspace.') }),
    async run(args, context) {
      return listWorkspaceDirectory(args.path === undefined ? '.' : stringArg(args, 'path'), context);
    },
  },
  {
    name: 'read_file',
    title: 'Read file',
    subject: 'path',
    description: 'Read lines from a UTF-8 text file within the workspace.',
    inputSchema: objectSchema({
      path: stringSchema('Path to a workspace file.'),
      start_line: { type: 'integer', minimum: 1, description: 'First line to read. Defaults to 1.' },
      end_line: { type: 'integer', minimum: 1, description: 'Last line to read, inclusive.' },
    }, ['path']),
    async run(args, context) {
      const start = positiveInt(args, 'start_line') ?? 1;
      const end = positiveInt(args, 'end_line');
      if (end !== undefined && end < start) throw new Error('end_line must be at least start_line.');
      return readWorkspaceFile(stringArg(args, 'path'), start, end, context);
    },
  },
  {
    name: 'view_image',
    title: 'View image',
    subject: 'path',
    description: 'Load a PNG, JPEG, GIF, or WebP image from the workspace so you can see it. Use this to inspect screenshots, diagrams, or generated images before describing or editing them.',
    inputSchema: objectSchema({
      path: stringSchema('Workspace path to an image file.'),
    }, ['path']),
    async run(args, context) {
      const target = await workspacePath(context.cwd ?? process.cwd(), stringArg(args, 'path'));
      context.signal?.throwIfAborted();
      const info = await fs.stat(target);
      if (!info.isFile()) throw new Error('Path is not a regular file: ' + target);
      const maxBytes = 7 * 1024 * 1024;
      if (info.size > maxBytes) throw new Error('Image exceeds 7 MiB. Resize or crop it and try again.');
      const data = await fs.readFile(target, { signal: context.signal });
      const mediaType = imageMediaType(data.subarray(0, 4000));
      if (!mediaType) throw new Error('Not a supported image. Use PNG, JPEG, GIF, or WebP.');
      const provider = context.provider ? ProviderCatalog.get(context.provider) : undefined;
      const model = context.model?.toLowerCase();
      const known = provider?.popularModels.find((candidate) => candidate.id.toLowerCase() === model);
      if (known && !known.capabilities.includes('vision')) {
        throw new Error(`${provider!.name} model ${context.model} has no vision support. Switch to a vision-capable model to view images.`);
      }
      const relative = path.relative(context.cwd ?? process.cwd(), target) || target;
      return {
        status: 'completed',
        text: `Image ${relative} attached (${mediaType}, ${Math.round(info.size / 1024)} KB). Inspect it and continue the task.`,
        images: [{ mediaType, data: data.toString('base64') }],
      };
    },
  },
  {
    name: 'attach_file',
    title: 'Attach file',
    subject: 'path',
    description: 'Attach a finished file (build, video, document) to your reply so the user can open it. Call after the file exists.',
    inputSchema: objectSchema({
      path: stringSchema('Workspace path to the finished file.'),
    }, ['path']),
    async run(args, context) {
      const target = await workspacePath(context.cwd ?? process.cwd(), stringArg(args, 'path'));
      context.signal?.throwIfAborted();
      const info = await fs.stat(target);
      if (!info.isFile()) throw new Error('Path is not a regular file: ' + target);
      return {
        status: 'completed',
        attachment: { name: path.basename(target), path: target },
        text: `Attached ${path.basename(target)} to the reply.`,
      };
    },
  },
  {
    name: 'search_files',
    title: 'Search files',
    subject: 'query',
    description: 'Find exact text in workspace files and report matching line numbers.',
    inputSchema: objectSchema({
      query: stringSchema('Literal text to search for.'),
      path: stringSchema('Workspace file or directory to search. Defaults to the workspace.'),
    }, ['query']),
    async run(args, context) {
      return searchWorkspace(stringArg(args, 'query'), args.path === undefined ? '.' : stringArg(args, 'path'), context);
    },
  },
  {
    name: 'web_search',
    title: 'Web search',
    subject: 'query',
    description: 'Search the live web with TinyFish. Returns ranked titles, URLs, and snippets.',
    inputSchema: objectSchema({
      query: stringSchema('Search query.'),
      max_results: { type: 'integer', minimum: 1, maximum: 10, description: 'Results to return. Default 5.' },
    }, ['query']),
    async run(args, context) {
      const maxResults = positiveInt(args, 'max_results') ?? 5;
      if (maxResults > 10) throw new Error('max_results must be 10 or fewer.');
      return webSearch(stringArg(args, 'query'), maxResults, context.signal);
    },
  },
  {
    name: 'write_file',
    title: 'Write file',
    subject: 'path',
    description: 'Create or replace a UTF-8 text file within the workspace after any required approval.',
    inputSchema: objectSchema({
      path: stringSchema('Workspace path to write.'),
      content: stringSchema('Complete file contents.'),
    }, ['path', 'content']),
    async run(args, context) {
      return { status: 'completed', ...await writeWorkspaceFile(stringArg(args, 'path'), stringArg(args, 'content', true), context) };
    },
  },
  {
    name: 'edit_file',
    title: 'Edit file',
    subject: 'path',
    description: 'Replace one exact span of text within a workspace file after any required approval.',
    inputSchema: objectSchema({
      path: stringSchema('Path to the workspace file.'),
      old_text: stringSchema('Exact text to replace. Include context if it is ambiguous.'),
      new_text: stringSchema('Replacement text.'),
      replace_all: { type: 'boolean', description: 'Allow replacement of every match.' },
    }, ['path', 'old_text', 'new_text']),
    async run(args, context) {
      if (args.replace_all !== undefined && typeof args.replace_all !== 'boolean') throw new Error('replace_all must be true or false.');
      return { status: 'completed', ...await editWorkspaceFile(stringArg(args, 'path'), stringArg(args, 'old_text', true),
        stringArg(args, 'new_text', true), args.replace_all === true, context) };
    },
  },
  {
    name: 'run_shell',
    title: 'Run command',
    subject: 'command',
    description: 'Run a shell command from the workspace after any required approval. Output and exit status are reported.',
    inputSchema: objectSchema({ command: stringSchema('Shell command to run.') }, ['command']),
    async run(args, context) {
      const result = await runShellCommand(stringArg(args, 'command'), context);
      return {
        status: result.denied ? 'denied' : result.exitCode === 0 ? 'completed' : 'failed',
        exitCode: result.denied ? undefined : result.exitCode,
        shellOutput: { stdout: result.stdout, stderr: result.stderr },
        text: ['Exit code: ' + result.exitCode, result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join('\n'),
      };
    },
  },
  {
    name: 'ask_question',
    title: 'Ask a question',
    description: 'Ask the user one question with 2–5 choices. The UI also offers a write-in answer. Wait for the answer before asking a follow-up.',
    inputSchema: objectSchema({
      question: stringSchema('A clear question, up to 300 characters'),
      choices: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string', maxLength: 100 } },
    }, ['question', 'choices']),
    run: async (args, context) => {
      if (!context.askQuestion) throw new Error('This tool requires an interactive chat.');
      const question = stringArg(args, 'question').trim();
      if (!question || question.length > 300) throw new Error('Enter a question up to 300 characters.');
      if (!Array.isArray(args.choices) || args.choices.length < 2 || args.choices.length > 5
        || args.choices.some((choice) => typeof choice !== 'string' || !choice.trim() || choice.length > 100)) {
        throw new Error('Provide 2–5 nonempty choices of up to 100 characters each.');
      }
      const choices = (args.choices as string[]).map((choice) => choice.trim());
      if (new Set(choices).size !== choices.length) throw new Error('Use distinct choices.');
      const answer = await context.askQuestion({ question, choices });
      return answer === undefined
        ? { status: 'denied', text: 'The user skipped the question.' }
        : JSON.stringify({ answer });
    },
  },
  {
    name: 'update_plan',
    title: 'Update plan',
    description: 'Start or update this turn’s plan with stable step IDs. A new plan replaces the previous one; completed steps stay visible. Mark finished steps completed and omit obsolete ones. An empty list clears the plan.',
    inputSchema: objectSchema({
      tasks: {
        type: 'array', maxItems: 15,
        items: objectSchema({
          id: stringSchema('Stable short identifier.'),
          title: stringSchema('Description of a specific task.'),
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
        }, ['id', 'title', 'status']),
      },
    }, ['tasks']),
    async run(args, context) {
      if (!context.updatePlan) throw new Error('update_plan requires an active agent turn.');
      context.updatePlan(readPlan(args));
      return 'Plan updated.';
    },
  },
  {
    name: 'inspect_subagent',
    title: 'Inspect subagent',
    description: 'List recorded delegations in this chat, or read one by ID. The record includes the assignment, provider reasoning, tool calls and results, and outcome. Follow nextOffset to read more.',
    inputSchema: objectSchema({
      id: stringSchema('Delegation ID. Omit to list recent delegations.'),
      offset: { type: 'integer', minimum: 0, description: 'Start offset from the previous page.' },
    }),
    async run(args, context) {
      if (!context.inspectSubagent) throw new Error('Subagent inspection requires an active chat.');
      const offset = args.offset ?? 0;
      if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid offset.');
      const id = args.id === undefined ? undefined : stringArg(args, 'id');
      return context.inspectSubagent(id, offset);
    },
  },
  {
    name: 'list_providers',
    title: 'List configured providers',
    description: 'List chat providers with a saved key, custom endpoint, or local runtime, plus known model IDs and the active provider/model. Never returns keys or endpoints. Use before delegating when another provider might help.',
    inputSchema: objectSchema({ provider: stringSchema('Optional provider ID to list its live models.') }),
    async run(args, context) {
      const cfg = configManager.get();
      const providers = configuredChatProviders();
      if (args.provider !== undefined) {
        const id = stringArg(args, 'provider').toLowerCase();
        if (!providers.some((provider) => provider.id === id)) throw new Error('Provider is not configured for chat.');
        const result = await ProviderManager.discoverModels(id);
        context.signal?.throwIfAborted();
        return JSON.stringify({ provider: id, source: result.status, models: result.models
          .filter((model) => model.chatSupport !== 'unsupported').map(({ id }) => id) });
      }
      return JSON.stringify({
        activeProvider: cfg.activeProvider,
        activeModel: cfg.activeModel,
        providers,
      }, null, 2);
    },
  },
  {
    name: 'delegate',
    title: 'Delegate to subagent',
    subject: 'profile',
    description: 'Send a focused workspace task to a separate agent context. Defaults to the current provider and model. Optional provider/model target a different configured provider and require user approval. Profiles: architect, coder, debugger, reviewer, researcher.',
    inputSchema: objectSchema({
      profile: stringSchema('Subagent profile name.'),
      prompt: stringSchema('A specific task and its relevant context.'),
      provider: stringSchema('Optional configured provider ID, such as zai or deepseek. Defaults to current.'),
      model: stringSchema('Optional model ID from that provider. Defaults to current.'),
    }, ['profile', 'prompt']),
    async run(args, context) {
      if (!context.delegate) throw new Error('Delegation requires a top-level agent turn.');
      const profile = stringArg(args, 'profile');
      if (!subagentManager.get(profile)) throw new Error('Unknown agent profile ' + profile);
      const provider = args.provider === undefined ? undefined : stringArg(args, 'provider');
      const model = args.model === undefined ? undefined : stringArg(args, 'model');
      return context.delegate(profile, stringArg(args, 'prompt'), context.taskId, provider, model);
    },
  },
  {
    name: 'use_skill',
    title: 'Load skill',
    subject: 'name',
    description: 'Load an installed skill by name. Use only when a skill is needed for the active task.',
    inputSchema: objectSchema({ name: stringSchema('Name of a skill listed in the available skills.') }, ['name']),
    async run(args) {
      const name = stringArg(args, 'name');
      const skill = skillsManager.get(name);
      if (!skill) throw new Error('Unknown skill ' + name);
      return skill.instructions;
    },
  },
  {
    name: 'create_skill',
    title: 'Create skill',
    subject: 'name',
    description: 'Write a reusable skill when the user requests one. Requires approval unless full access was selected.',
    inputSchema: objectSchema({
      name: stringSchema('Short skill name.'),
      description: stringSchema('When to apply the workflow.'),
      instructions: stringSchema('Complete workflow instructions in Markdown.'),
    }, ['name', 'description', 'instructions']),
    async run(args, context) {
      const name = stringArg(args, 'name');
      const description = stringArg(args, 'description');
      const instructions = stringArg(args, 'instructions');
      const target = skillsManager.targetPath(name);
      const allowed = await permissionManager.checkPermission('file_write', target, 'Create reusable skill ' + name + '\n' + target,
        context.signal, context.permissionMode);
      context.signal?.throwIfAborted();
      if (!allowed) throw new ActionDeniedError('Skill creation denied by permission settings.');
      const skill = skillsManager.createSkill(name, description, instructions);
      return 'Created skill ' + skill.name + ' at ' + skill.filePath;
    },
  },
  {
    name: 'mcp_add',
    title: 'Register MCP server',
    subject: 'name',
    description: 'Register a local stdio MCP server when explicitly requested. Shows the command and arguments for approval. Use absolute paths for local scripts.',
    inputSchema: objectSchema({
      name: stringSchema('Server identifier, e.g. project-tools.'),
      command: stringSchema('Executable, e.g. node or npx.'),
      args: { type: 'array', items: { type: 'string' }, description: 'Arguments for the executable. No credentials.' },
    }, ['name', 'command']),
    async run(args, context) {
      const name = stringArg(args, 'name');
      const command = stringArg(args, 'command');
      const argv = args.args ?? [];
      if (!/^[a-zA-Z0-9._-]+$/.test(name) || !Array.isArray(argv) || argv.some((arg) => typeof arg !== 'string')) {
        throw new Error('Provide a valid server name and an array of string arguments.');
      }
      if (mcpClient.listServers().some((server) => server.name === name)) throw new Error('Server already exists: ' + name);
      const preview = `Register local MCP server ${name}\nCommand: ${JSON.stringify(command)}\nArguments: ${JSON.stringify(argv)}`;
      const allowed = await permissionManager.checkPermission('network', name, preview, context.signal, 'ask',
        ['register-server', command, argv]);
      context.signal?.throwIfAborted();
      if (!allowed) throw new McpPermissionError('MCP registration declined.');
      updateMcpServer(name, { command, args: argv });
      return `Registered ${name}. Use mcp_list to discover its tools or @mcp:${name} to mention it.`;
    },
  },
  {
    name: 'plugin_install',
    title: 'Install MCP plugin',
    subject: 'source',
    description: 'Install a local MCP plugin from a workspace JSON manifest or plugin folder, only when explicitly requested. Shows server commands for approval.',
    inputSchema: objectSchema({ source: stringSchema('Path to the local plugin inside the workspace.') }, ['source']),
    async run(args, context) {
      const source = await workspacePath(context.cwd ?? process.cwd(), stringArg(args, 'source'));
      const plugin = prepareMcpPlugin(source, true);
      const preview = [`Install MCP plugin ${plugin.name}`, ...Object.entries(plugin.mcpServers).flatMap(([name, server]) => [
        name + ': ' + JSON.stringify(server.command),
        'Arguments: ' + JSON.stringify(server.args ?? []),
        ...Object.keys(server.env ?? {}).map((key) => 'Environment variable: ' + JSON.stringify(key)),
      ])].join('\n');
      const allowed = await permissionManager.checkPermission('network', plugin.name, preview, context.signal, 'ask',
        ['install-plugin', source, plugin.mcpServers]);
      context.signal?.throwIfAborted();
      if (!allowed) throw new McpPermissionError('Plugin installation declined.');
      saveMcpPlugin(plugin);
      return `Installed ${plugin.name}. Mention it with @plugin:${plugin.name}.`;
    },
  },
  {
    name: 'mcp_list',
    title: 'List MCP tools',
    subject: 'server',
    description: 'Discover tools exposed by a configured MCP server. Without a server name, list configured servers.',
    inputSchema: objectSchema({ server: stringSchema('Configured MCP server name.') }),
    async run(args, context) {
      if (args.server === undefined) {
        const servers = mcpClient.listServers();
        return servers.length ? JSON.stringify(servers, null, 2) : 'No MCP servers configured.';
      }
      return JSON.stringify(await mcpClient.listTools(stringArg(args, 'server'), context.signal, context.permissionMode), null, 2);
    },
  },
  {
    name: 'mcp_invoke',
    title: 'Call MCP tool',
    subject: 'tool',
    description: 'Invoke a tool on a configured MCP server using the schema returned by mcp_list.',
    inputSchema: objectSchema({
      server: stringSchema('Configured MCP server name.'),
      tool: stringSchema('Tool name advertised by the server.'),
      arguments: { type: 'object', description: 'Arguments accepted by the server tool.' },
    }, ['server', 'tool']),
    async run(args, context) {
      const result = await mcpClient.callTool(stringArg(args, 'server'), stringArg(args, 'tool'),
        args.arguments === undefined ? {} : objectArg(args.arguments), context.signal, context.permissionMode);
      const lines = result.content?.map((item) => item.type === 'text' ? String(item.text ?? '') : '[' + item.type + ' content]') ?? [];
      if (result.structuredContent !== undefined) lines.push(JSON.stringify(result.structuredContent, null, 2));
      return { status: result.isError ? 'failed' : 'completed', text: lines.filter(Boolean).join('\n') || 'No text returned.' };
    },
  },
];

const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

export function listTools(): ToolDefinition[] {
  const available = configManager.getApiKey('tinyfish') ? tools : tools.filter(({ name }) => name !== 'web_search');
  return available.map(({ name, description, inputSchema }) => ({
    name, description,
    inputSchema: name === 'use_skill'
      ? objectSchema({ name: { type: 'string', enum: skillsManager.list().map((skill) => skill.name) } }, ['name'])
      : inputSchema,
  }));
}

export function describeTool(name: string, args: ToolArguments): Pick<TaskItem, 'title' | 'detail'> {
  const tool = toolByName.get(name);
  const subject = tool?.subject && args[tool.subject];
  const detail = typeof subject === 'string' ? subject.replace(/[\r\n]+/g, ' ').slice(0, 180) : undefined;
  const shortLabels: Record<string, string> = {
    list_directory: 'List', read_file: 'Read', view_image: 'View', attach_file: 'Attach', search_files: 'Find', write_file: 'Write', edit_file: 'Edit',
    run_shell: 'Run', list_providers: 'List providers', delegate: 'Delegate to', use_skill: 'Load skill', create_skill: 'Create skill',
    mcp_list: 'List tools on', mcp_invoke: 'MCP', web_search: 'Search web', computer_use: 'Computer',
  };
  return {
    title: detail ? (shortLabels[name] ?? tool?.title ?? name) + ' ' + detail : tool?.title ?? name,
    detail,
  };
}

export async function runTool(name: string, args: ToolArguments, context: ToolContext): Promise<ToolResult> {
  try {
    context.signal?.throwIfAborted();
    const tool = toolByName.get(name);
    if (!tool) throw new Error('Unknown tool ' + name);
    const output = await tool.run(objectArg(args), context);
    const result = typeof output === 'string' ? { status: 'completed' as const, text: output } : output;
    if (result.text.length > 20_000) result.text = result.text.slice(0, 20_000) + '\n… output truncated.';
    if (result.modelText && result.modelText.length > 20_000) result.modelText = result.modelText.slice(0, 20_000) + '\n… output truncated.';
    return result;
  } catch (error) {
    const denied = error instanceof ActionDeniedError || error instanceof McpPermissionError;
    return { status: denied ? 'denied' : 'failed', text: error instanceof Error ? error.message : String(error) };
  }
}
