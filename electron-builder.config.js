const { name, version, description, author, license } = require('./package.json');

module.exports = {
  appId: 'ai.ruqenai.desktop',
  productName: 'RuqenAI',
  copyright: `Copyright (c) ${new Date().getFullYear()} ${author}`,
  directories: {
    output: 'release',
    buildResources: 'desktop/resources',
  },
  files: [
    'dist/**/*',
    'bin/**/*',
    'dist-desktop/**/*',
    'asciilogoart.txt',
    'package.json',
  ],
  // node-pty is a native module; electron-builder rebuilds it for Electron.
  asarUnpack: ['node_modules/node-pty/**/*'],
  mac: {
    category: 'public.app-category.developer-tools',
    target: ['dmg', 'zip'],
  },
  win: {
    target: ['nsis'],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
  },
  linux: {
    category: 'Development',
    target: ['AppImage', 'deb'],
  },
  publish: null,
};
