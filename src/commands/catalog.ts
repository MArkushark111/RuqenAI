export type CommandView =
  | { kind: 'commands' | 'effort' | 'permissions' | 'settings' | 'sessions' | 'agent-mode' | 'host' | 'workspace' | 'theme'; providerId?: undefined }
  | { kind: 'attachments' | 'prompt-actions' | 'rewind-prompt'; providerId?: undefined }
  | { kind: 'providers' | 'models'; providerId?: string }
  | { kind: 'provider-setup'; providerId: string }
  | { kind: 'update'; release?: string; providerId?: undefined }
  | { kind: 'subagent-detail'; taskId: string; providerId?: undefined }
  | { kind: 'session-menu' | 'session-rename'; sessionId: string; fromSessions?: boolean; providerId?: undefined };

interface CommandEntry {
  name: string;
  aliases?: string[];
  summary: string;
  usage?: string;
  prefill?: boolean;
}

interface CommandGroup {
  name: string;
  commands: CommandEntry[];
}

export const commandGroups: CommandGroup[] = [
  { name: 'Models and settings', commands: [
    { name: 'provider', aliases: ['providers'], summary: 'Browse, configure, or switch providers', usage: '[id]' },
    { name: 'model', summary: 'Choose a model or browse all providers', usage: '[all | provider [model]]' },
    { name: 'effort', summary: 'Choose reasoning effort' },
    { name: 'eco', summary: 'Eco mode: green theme, terse low-cost replies', usage: '[on|off]' },
    { name: 'host', summary: 'Host the Android companion', usage: '[on|off]' },
    { name: 'mode', summary: 'Set action permissions', usage: '[ask|approve|full]' },
    { name: 'temp', aliases: ['temperature'], summary: 'Set sampling temperature', usage: '[number]' },
    { name: 'params', aliases: ['options'], summary: 'Show model parameters' },
    { name: 'config', aliases: ['settings'], summary: 'Open settings', usage: '[show]' },
    { name: 'animations', summary: 'Toggle motion effects', usage: '[on|off]' },
  ] },
  { name: 'Workspace', commands: [
    { name: 'attach', aliases: ['add', 'file'], summary: 'Attach a file by path or from the Windows clipboard', usage: '[path]' },
    { name: 'drop', aliases: ['remove'], summary: 'Remove a file from context', usage: '<path>', prefill: true },
    { name: 'ls', summary: 'List workspace entries' },
    { name: 'pwd', summary: 'Show the working directory' },
    { name: 'workspace', aliases: ['ws'], summary: 'Show or change the workspace folder and its chats', usage: '[path]' },
    { name: 'cd', summary: 'Change the working directory', usage: '<directory>', prefill: true },
    { name: 'diff', summary: 'Show Git changes' },
    { name: 'run', aliases: ['shell', 'exec'], summary: 'Run a shell command', usage: '<command>', prefill: true },
    { name: 'editor', summary: 'Open the workspace in VS Code' },
    { name: 'init', summary: 'Write workspace settings' },
    { name: 'approvals', summary: 'List remembered permissions' },
  ] },
  { name: 'Session', commands: [
    { name: 'new', aliases: ['reset'], summary: 'Start a session' },
    { name: 'sessions', aliases: ['history', 'resume', 'continue'], summary: 'Browse or resume saved sessions', usage: '[id]' },
    { name: 'undo', aliases: ['rewind'], summary: 'Undo the last turn and restore tracked edits', usage: '[chat]' },
    { name: 'compact', aliases: ['summarize'], summary: 'Compact context (runs automatically when large)' },
    { name: 'fork', aliases: ['branch'], summary: 'Branch the current session', usage: '[name]' },
    { name: 'export', aliases: ['save'], summary: 'Export the conversation', usage: '[path]' },
    { name: 'copy', summary: 'Copy the last response or workspace path', usage: '[path]' },
    { name: 'clear', summary: 'Clear the conversation' },
    { name: 'cleartasks', summary: 'Clear plan tasks for this chat' },
    { name: 'exit', aliases: ['quit'], summary: 'Exit Ruqenai' },
  ] },
  { name: 'Tools and diagnostics', commands: [
    { name: 'tools', summary: 'List or run tools', usage: '[run <name> [json]]' },
    { name: 'skills', summary: 'List, create, or run skills', usage: '[run <name> <prompt>]' },
    { name: 'agents', aliases: ['subagents'], summary: 'List or run agent profiles', usage: '[run <profile> <prompt>]' },
    { name: 'mcp', summary: 'Inspect or run configured MCP tools', usage: '[server [tool [json]]]' },
    { name: 'plugins', summary: 'List installed plugin manifests' },
    { name: 'status', aliases: ['info'], summary: 'Show current session status' },
    { name: 'usage', aliases: ['tokens', 'cost'], summary: 'Show token usage and API cost' },
    { name: 'logs', aliases: ['debug'], summary: 'Show recent errors and tool activity' },
    { name: 'doctor', summary: 'Check runtime and connections' },
    { name: 'update', aliases: ['upgrade'], summary: 'Check npm for a new release' },
    { name: 'help', aliases: ['commands'], summary: 'Open the command palette', usage: '[all]' },
  ] },
];

const aliases = new Map(commandGroups.flatMap(({ commands }) => commands.flatMap(({ name, aliases }) =>
  (aliases ?? []).map((alias) => [alias, name] as const),
)));

export function canonicalCommand(name: string): string {
  return aliases.get(name) ?? name;
}

export function listCommands(): string {
  return commandGroups.map(({ name, commands }) => [name, ...commands.map((entry) =>
    `  /${entry.name}${entry.usage ? ` ${entry.usage}` : ''}  ${entry.summary}`,
  )].join('\n')).join('\n\n');
}
