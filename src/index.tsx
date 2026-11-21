#!/usr/bin/env node
/**
 * Ruqenai CLI Entry Point.
 */

import { Command, Option } from 'commander';
import { registerConnectorCommands } from './commands/connectors.js';

const program = new Command();
registerConnectorCommands(program);

program
  .name('ruqenai')
  .description('Coding assistant for the terminal')
  .version('1.0.0')
  .showHelpAfterError('(See ruqenai --help for usage.)');

program.action(async () => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Ruqenai needs an interactive terminal. Use `ruqenai run "prompt"` for headless output.');
    process.exitCode = 1;
    return;
  }

  const [{ render }, { createElement }, { App }] = await Promise.all([
    import('ink'),
    import('react'),
    import('./ui/App.js'),
  ]);
  const useAlternateScreen = process.env.TERM !== 'dumb';
  const [{ createTerminalInput }, { createFrameOutput }, { sessionManager }] = await Promise.all([
    import('./ui/MouseListener.js'), import('./ui/FrameOutput.js'), import('./agent/context.js'),
  ]);
  sessionManager.startFreshSession();
  const input = useAlternateScreen ? createTerminalInput(process.stdin) : undefined;
  const frames = useAlternateScreen ? createFrameOutput(process.stdout) : undefined;
  if (useAlternateScreen) process.stdout.write('\x1b[?1049h\x1b[H\x1b[?2004h');
  try {
    await render(createElement(App, { onPaste: input?.onPaste }), { stdin: input?.stdin ?? process.stdin, stdout: frames?.stdout ?? process.stdout, debug: useAlternateScreen }).waitUntilExit();
  } finally {
    frames?.stop();
    if (useAlternateScreen) process.stdout.write('\x1b[?2004l\x1b[?1049l');
  }
});

program
  .command('run <prompt>')
  .description('Run a prompt and write the response to stdout')
  .option('-p, --provider <provider>', 'Provider ID')
  .option('-m, --model <model>', 'Model name')
  .option('--profile <profile>', 'Select a built-in agent profile')
  .option('--skill <skill>', 'Apply a reusable workflow')
  .addOption(new Option('--permission <mode>', 'Permission mode for this run').choices(['ask', 'approve', 'full']))
  .option('--yolo', 'Enable full access for this run')
  .action(async (prompt, options) => {
    const [{ AgentEngine }, { permissionManager }] = await Promise.all([
      import('./agent/engine.js'),
      import('./agent/permissions.js'),
    ]);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel);

    if (process.stdin.isTTY && process.stderr.isTTY) {
      const { createInterface } = await import('node:readline/promises');
      permissionManager.setRequestListener((request) => {
        if (!request) return;
        const terminal = createInterface({ input: process.stdin, output: process.stderr });
        terminal.once('SIGINT', cancel);
        void terminal.question(request.description + '\nAllow once? [y/N] ', { signal: controller.signal })
          .then((answer) => request.onDecide(/^y(?:es)?$/i.test(answer.trim())), () => request.onDecide(false))
          .finally(() => terminal.close());
      });
    }

    let written = 0;
    let response;
    try {
      response = await AgentEngine.execute(prompt, {
        onContentUpdate: (content) => {
          process.stdout.write(content.slice(written));
          written = content.length;
        },
      }, {
        provider: options.provider,
        model: options.model,
        profile: options.profile,
        skill: options.skill,
        permissionMode: options.yolo ? 'full' : options.permission,
        signal: controller.signal,
      });
    } finally {
      permissionManager.setRequestListener(undefined);
      process.off('SIGINT', cancel);
    }

    if (response.content && !response.content.endsWith('\n')) process.stdout.write('\n');
    if (response.error) {
      console.error(`ruqenai: ${response.error}`);
      process.exitCode = controller.signal.aborted ? 130 : 1;
    }
  });

program
  .command('providers')
  .description('List known providers and their IDs')
  .action(async () => {
    const { ProviderCatalog } = await import('./providers/catalog.js');
    console.log(`Providers (${ProviderCatalog.count()})\n`);
    for (const p of ProviderCatalog.all()) {
      const connection = ProviderCatalog.connection(p.id);
      const status = { native: 'chat', compatible: 'chat', endpoint: 'configured endpoint', catalog: 'catalog reference' }[connection];
      console.log(`  ${p.id.padEnd(20)} ${p.name} / ${status}`);
      console.log(`  ${' '.repeat(21)}${p.description}`);
    }
  });

program
  .command('models [provider]')
  .description('List installed and configured provider models')
  .action(async (selected?: string) => {
    const [{ configManager }, { ProviderCatalog }, { ProviderManager }] = await Promise.all([
      import('./config/settings.js'), import('./providers/catalog.js'), import('./providers/manager.js'),
    ]);
    if (selected && !ProviderCatalog.get(selected)) {
      console.error('Unknown provider. Use `ruqenai providers` to list IDs.');
      process.exitCode = 1;
      return;
    }
    const config = configManager.get();
    const ids = selected ? [selected] : [...new Set(['ollama', config.activeProvider, ...ProviderCatalog.all()
      .filter(({ id, envKey }) => ProviderCatalog.connection(id) !== 'catalog'
        && (configManager.getApiKey(id, envKey) || config.customEndpoints[id]))
      .map(({ id }) => id)])].filter((id) => !config.disconnectedProviders.includes(id));
    const groups = await Promise.all(ids.map((id) => ProviderManager.discoverModels(id)));
    const output = groups.map(({ provider, models, status, detail }) => {
      const label = provider?.id === 'ollama' ? 'Ollama' : provider?.name ?? 'Provider';
      const rows = status === 'unavailable' ? [] : models.map(({ id }) => '  ' + id);
      const title = label + (status === 'live' ? ` models (${models.length})` : ` · ${status}`);
      return [title, ...(detail ? ['  ' + detail] : []), ...rows].join('\n');
    });
    console.log(output.join('\n\n'));
  });

program
  .command('doctor')
  .description('Check the runtime, workspace, and Ollama connection')
  .action(async () => {
    const [{ ollamaClient }, { ProviderCatalog }, { skillsManager }, { subagentManager }] = await Promise.all([
      import('./providers/ollama.js'),
      import('./providers/catalog.js'),
      import('./skills/manager.js'),
      import('./agent/subagents.js'),
    ]);
    const ollama = await ollamaClient.detect();
    console.log('Ruqenai doctor\n');
    console.log(`  Node        ${process.version}`);
    console.log(`  Ollama      ${ollama.isOnline ? `online (${ollama.models.length} models)` : 'offline'}`);
    console.log(`  Providers   ${ProviderCatalog.count()}`);
    console.log(`  Skills      ${skillsManager.list().length}`);
    console.log(`  Subagents   ${subagentManager.list().length}`);
    console.log(`  Workspace   ${process.cwd()}`);
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(`ruqenai: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
