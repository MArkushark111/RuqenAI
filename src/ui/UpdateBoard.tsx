import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import stringWidth from 'string-width';
import { copyToClipboard } from '../commands/router.js';
import { canInstallUpdate, checkForUpdate, installedFromPackage, installedVersion, installUpdate } from '../updates.js';
import { ActionRow, type Action } from './ActionRow.js';
import { colors, fill, fit, wrapLines } from './terminal.js';

export function UpdateBoard({ release, width, height, onClose }: {
  release?: string;
  width: number;
  height: number;
  onClose: () => void;
}) {
  const [latest, setLatest] = useState<string>();
  const [globalInstall, setGlobalInstall] = useState(false);
  const [status, setStatus] = useState('');
  const [checking, setChecking] = useState(true);
  const [phase, setPhase] = useState<'ready' | 'installing' | 'installed'>('ready');
  const [selected, select] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const found = release ?? await checkForUpdate(controller.signal);
      const global = found ? await canInstallUpdate() : false;
      if (controller.signal.aborted) return;
      setLatest(found);
      setGlobalInstall(global);
    }
    void load().catch(() => {
      if (!controller.signal.aborted) setStatus('Could not reach npm. Run /update to try again.');
    }).finally(() => {
      if (!controller.signal.aborted) setChecking(false);
    });
    return () => controller.abort();
  }, [release]);

  async function update(target: string) {
    setPhase('installing');
    setStatus('');
    try {
      if (await installUpdate(target)) {
        setPhase('installed');
        return;
      }
      setGlobalInstall(false);
    } catch {
      setStatus('Update failed. Choose Install update to retry.');
    }
    setPhase('ready');
  }

  const command = latest ? `${process.platform === 'win32' ? 'npm.cmd' : 'npm'} install -g ruqenai@${latest}` : '';
  async function copyCommand() {
    setStatus(await copyToClipboard(command) ? 'Command copied. Paste it into your shell.' : 'Could not copy. Run the command shown above.');
  }
  const actions: Action[] = phase === 'installing' ? []
    : latest && phase === 'ready' ? [
      { label: globalInstall ? 'Install update' : width >= 26 ? 'Copy npm command' : 'Copy command',
        run: globalInstall ? () => void update(latest) : () => void copyCommand() },
      { label: 'Later', run: onClose },
    ] : [{ label: 'Close', run: onClose }];
  const index = Math.min(selected, actions.length - 1);
  const compact = actions.reduce((cells, action) => cells + stringWidth(action.label), 3 * Math.max(0, actions.length - 1)) > width;
  const visibleActions = compact ? actions.slice(index, index + 1) : actions;

  useInput((_input, key) => {
    if (phase === 'installing') return;
    if (key.escape) onClose();
    if (actions.length > 1 && (key.tab || key.leftArrow || key.rightArrow)) select((value) => 1 - value);
    if (key.return) actions[index]?.run();
  });

  const title = phase === 'installed' ? 'Update installed' : latest ? 'Update available' : 'Ruqenai updates';
  const versions = latest
    ? width >= 36 ? `Current ${installedVersion}  →  Available ${latest}` : `${installedVersion} → ${latest}`
    : `Current version ${installedVersion}`;
  const detail = checking ? 'Checking npm…'
    : phase === 'installing' ? 'Installing from npm…'
    : phase === 'installed' ? 'Restart Ruqenai to use the new version.'
    : !latest ? status || 'You’re up to date.'
    : globalInstall ? 'Installs the release from npm. Close Ruqenai first on Windows (files are locked while it runs), then restart after.'
    : installedFromPackage ? 'Install the new release globally with npm:'
    : width >= 53 ? 'Running from source. To switch to the global npm release:'
    : 'Source checkout · npm install';
  const body = [
    ...(height <= 5 ? [fit(detail, width)] : wrapLines(detail, width)),
    ...(latest && !globalInstall && phase === 'ready' ? wrapLines(command, width, true) : []),
    ...(status && latest ? wrapLines(status, width) : []),
  ];
  const showHelp = height >= body.length + 5;
  return <Box flexDirection="column" width={width} height={height}>
    <Text bold color={colors.surface} backgroundColor={colors.coffee}>{fill(' ' + title, width)}</Text>
    {height >= 3 && <Text color={colors.ink}>{fit(versions, width)}</Text>}
    {showHelp && <Text>{' '}</Text>}
    {body.slice(0, Math.max(0, height - 2 - Number(actions.length > 0) - 2 * Number(showHelp)))
      .map((line, i) => <Text key={i} color={line === command ? colors.coffee : colors.ink}>{line}</Text>)}
    {visibleActions.length > 0 && <ActionRow actions={visibleActions.map((action) => ({
      ...action, label: fit(action.label, width), selected: action === actions[index],
    }))} width={width} x={0} y={0} background={colors.board} />}
    {showHelp && <Text color={colors.muted}>{fit(actions.length > 1 ? '← → Select   Enter Confirm   Esc Close' : 'Esc Close', width)}</Text>}
  </Box>;
}
