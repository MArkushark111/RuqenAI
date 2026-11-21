import { configManager } from '../config/settings.js';
import { mcpClient, McpPermissionError } from '../mcp/client.js';
import { skillsManager } from '../skills/manager.js';
import { TaskItem, ToolDefinition } from '../types/index.js';
import { permissionManager } from './permissions.js';
import { subagentManager } from './subagents.js';
import {
  ActionDeniedError, editWorkspaceFile, listWorkspaceDirectory, readWorkspaceFile, runShellCommand,
  searchWorkspace, WorkspaceActionOptions, writeWorkspaceFile,
} from './workspace.js';

type ToolArguments = Record<string, unknown>;
export type PlanEntry = Pick<TaskItem, 'id' | 'title'> & { status: 'pending' | 'in_progress' | 'completed' };

export interface ToolResult {
  status: 'completed' | 'failed' | 'denied';
  text: string;
  changes?: TaskItem['changes'];
  exitCode?: number;
}

export interface ToolContext extends WorkspaceActionOptions {
  updatePlan?: (entries: PlanEntry[]) => void;
  delegate?: (profile: string, prompt: string) => Promise<ToolResult>;
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
    description: 'Search the live web with TinyFish for current information. Returns ranked titles, URLs, and snippets.',
    inputSchema: objectSchema({
      query: stringSchema('Search query.'),
      max_results: { type: 'integer', minimum: 1, maximum: 10, description: 'How many results to return. Defaults to 5.' },
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
        text: ['Exit code: ' + result.exitCode, result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join('\n'),
      };
    },
  },
  {
    name: 'update_plan',
    title: 'Update plan',
    description: 'Replace the visible plan with pending and in-progress work. Omit completed or obsolete steps. Use an empty list to clear an existing plan.',
    inputSchema: objectSchema({
      tasks: {
        type: 'array', maxItems: 15,
        items: objectSchema({
          id: stringSchema('Stable short identifier. Letters, digits, hyphens, and underscores.'),
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
    name: 'delegate',
    title: 'Delegate to subagent',
    subject: 'profile',
    description: 'Send a focused workspace task to a separate agent context. Available profiles: architect, coder, debugger, reviewer, researcher.',
    inputSchema: objectSchema({
      profile: stringSchema('Subagent profile name.'),
      prompt: stringSchema('A specific task and its relevant context.'),
    }, ['profile', 'prompt']),
    async run(args, context) {
      if (!context.delegate) throw new Error('Delegation requires a top-level agent turn.');
      const profile = stringArg(args, 'profile');
      if (!subagentManager.get(profile)) throw new Error('Unknown agent profile ' + profile);
      return context.delegate(profile, stringArg(args, 'prompt'));
    },
  },
  {
    name: 'use_skill',
    title: 'Load skill',
    subject: 'name',
    description: 'Load the exact installed skill requested by the user. Use this only when a skill is needed for an active task.',
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
    description: 'Write a reusable skill with real instructions when the user requests one. This requires approval unless full access was selected.',
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
    description: 'Invoke a tool on an explicitly configured MCP server using the argument schema returned by mcp_list.',
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
    list_directory: 'List', read_file: 'Read', search_files: 'Find', write_file: 'Write', edit_file: 'Edit',
    run_shell: 'Run', delegate: 'Delegate to', use_skill: 'Load skill', create_skill: 'Create skill',
    mcp_list: 'List tools on', mcp_invoke: 'MCP', web_search: 'Search web',
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
    return result;
  } catch (error) {
    const denied = error instanceof ActionDeniedError || error instanceof McpPermissionError;
    return { status: denied ? 'denied' : 'failed', text: error instanceof Error ? error.message : String(error) };
  }
}
