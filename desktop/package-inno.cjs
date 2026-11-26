const { build, Platform } = require('electron-builder');
const { rcedit } = require('rcedit');
const path = require('node:path');

build({
  targets: Platform.WINDOWS.createTarget('dir'),
  config: {
    appId: 'ai.ruqenai.desktop',
    productName: 'Ruqenai',
    directories: { output: 'release' },
    extraMetadata: { main: 'dist-desktop/main.js' },
    npmRebuild: false,
    win: { signAndEditExecutable: false },
    files: [
      'dist-desktop/**/*',
      'dist/**/*',
      'bin/**/*',
      'asciilogoart.txt',
      'package.json',
    ],
  },
}).then(async () => {
  await rcedit(path.resolve('release/win-unpacked/Ruqenai.exe'), {
    icon: path.resolve('desktop/assets/icon.ico'),
    'version-string': { ProductName: 'Ruqenai', FileDescription: 'Ruqenai' },
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
