import { Command, Option } from 'commander';
import { installMcpPlugin, mcpClient, updateMcpPlugin, updateMcpServer } from '../mcp/client.js';

export function registerConnectorCommands(program: Command) {
  const mcp = program.command('mcp').description('Manage local MCP servers');
  mcp.command('add <name> <command> [args...]').description('Register a stdio server. Put -- before its launch command.')
    .addOption(new Option('-t, --transport <transport>', 'Server transport').choices(['stdio']).default('stdio'))
    .option('-e, --env <key=value>', 'Pass a server environment value (repeatable)', (entry, previous: string[]) => [...previous, entry], [])
    .action((name: string, command: string, args: string[], options: { env: string[] }) => {
      const entries = options.env.map((entry) => {
        const separator = entry.indexOf('=');
        if (separator < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.slice(0, separator))) {
          throw new Error('Use --env KEY=value for each environment variable.');
        }
        return [entry.slice(0, separator), entry.slice(separator + 1)];
      });
      updateMcpServer(name, { command, args, env: Object.fromEntries(entries) });
      console.log('Added MCP server ' + name);
    });
  mcp.command('add-json <name> <json>').description('Register a stdio server from a JSON object')
    .action((name: string, json: string) => {
      let spec: unknown;
      try { spec = JSON.parse(json); }
      catch { throw new Error('Invalid server JSON.'); }
      updateMcpServer(name, spec);
      console.log('Added MCP server ' + name);
    });
  mcp.command('list').description('List configured servers').action(() => {
    console.log(mcpClient.listServers().map(({ name }) => name).join('\n') || 'No MCP servers configured.');
  });
  mcp.command('get <name>').description('Show a server configuration').action((name) => {
    console.log(JSON.stringify(mcpClient.getServer(name), null, 2));
  });
  mcp.command('remove <name>').description('Remove a directly configured server').action((name) => {
    updateMcpServer(name);
    console.log('Removed MCP server ' + name);
  });

  const plugin = program.command('plugin').alias('plugins').description('Manage local MCP plugins');
  plugin.command('install <path>').description('Install a local manifest or Claude plugin folder with stdio MCP servers')
    .action((source) => console.log('Installed plugin ' + installMcpPlugin(source)));
  plugin.command('list').description('List installed plugins').action(() => {
    console.log(mcpClient.listPlugins().map(({ name, enabled }) => name + (enabled ? '  enabled' : '  disabled')).join('\n') || 'No plugins installed.');
  });
  for (const [command, enabled] of [['enable', true], ['disable', false], ['uninstall', undefined]] as const) {
    const action = plugin.command(command + ' <name>').action((name) => {
      updateMcpPlugin(name, enabled);
      console.log(`${name} ${enabled === undefined ? 'uninstalled' : enabled ? 'enabled' : 'disabled'}`);
    });
    if (command === 'uninstall') action.alias('remove');
  }
}
