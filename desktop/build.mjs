// Bundles the desktop app with esbuild.
// - main.ts + preload.ts → CommonJS for Electron (node platform)
// - renderer.ts → IIFE for the browser
// The agent engine (../src/**) is bundled straight from TypeScript source, so this
// does not depend on a prior `tsc` build of dist/.
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const out = (...p) => join(root, 'dist-desktop', ...p);

mkdirSync(out('renderer'), { recursive: true });

async function run() {
  // Main process: bundle the agent core (ESM source) into one CJS file.
  await build({
    entryPoints: [join(root, 'desktop', 'main.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: out('main.js'),
    external: ['electron'],
    sourcemap: true,
    logLevel: 'info',
  });

  // Preload: small CJS bridge.
  await build({
    entryPoints: [join(root, 'desktop', 'preload.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: out('preload.js'),
    external: ['electron'],
    sourcemap: true,
    logLevel: 'info',
  });

  // Renderer: browser bundle.
  await build({
    entryPoints: [join(root, 'desktop', 'renderer', 'renderer.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
    outfile: out('renderer', 'renderer.js'),
    sourcemap: true,
    logLevel: 'info',
  });

  // Static assets.
  copyFileSync(join(root, 'desktop', 'renderer', 'index.html'), out('renderer', 'index.html'));
  copyFileSync(join(root, 'desktop', 'renderer', 'styles.css'), out('renderer', 'styles.css'));
  copyFileSync(join(root, 'node_modules', 'ascii.rest', 'LICENSE'), out('renderer', 'ascii-rest-LICENSE.txt'));
  // Brand mark for the rail.
  copyFileSync(join(root, 'desktop', 'renderer', 'logo.png'), out('renderer', 'logo.png'));
  // Local font files: the window only ever loads its own assets.
  cpSync(join(root, 'desktop', 'renderer', 'fonts'), out('renderer', 'fonts'), { recursive: true });
  // App icon (window, taskbar, installer).
  cpSync(join(root, 'desktop', 'assets'), out('assets'), { recursive: true });
  writeFileSync(out('package.json'), JSON.stringify({ type: 'commonjs' }));

  console.log('desktop build complete');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
