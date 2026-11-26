import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
await build({ entryPoints: ['android/scenes/background.js'], outfile: 'android/app/src/main/assets/scenes.js', bundle: true, minify: true, platform: 'browser' });
await copyFile('node_modules/ascii.rest/LICENSE', 'android/app/src/main/assets/ascii-rest-LICENSE.txt');
