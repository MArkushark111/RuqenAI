import fs from 'node:fs';
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { colors, ecoActive, mixHex } from './terminal.js';

let rows: string[] = [];
try {
  rows = fs.readFileSync(new URL('../../asciilogoart.txt', import.meta.url), 'utf8')
    .split(/\r?\n/).map((row) => row.trimEnd()).filter(Boolean);
} catch {
  // A package without the artwork can still show its name.
}
const logoWidth = Math.max(0, ...rows.map((row) => stringWidth(row)));
// The shine sweeps from the accent toward white, so every theme (and eco) recolors the logo.
const sweepTints = [0.2, 0.4, 0.6, 0.78, 0.9, 1];
const suffixTints = [0.35, 0.52, 0.68, 0.82, 0.92, 1];
const sweepStep = 38;
const sweepInterval = 7500;

export function Wordmark({ width, height, animate }: { width: number; height: number; animate: boolean }) {
  const fullSize = rows.length > 0 && width >= logoWidth && height >= rows.length;
  const display = fullSize ? rows : [width >= 7 ? 'Ruqenai' : 'R'];
  const [phase, setPhase] = useState(-6);
  const eco = ecoActive();
  const speed = eco ? 2 : 1;
  useEffect(() => {
    if (!animate) return;
    const start = Date.now();
    const end = (fullSize ? logoWidth : 7) + 6;
    const step = sweepStep / speed;
    const interval = sweepInterval / speed;
    const timer = setInterval(() => setPhase(Math.min(end, Math.floor(((Date.now() - start) % interval) / step) - 6)), step);
    return () => clearInterval(timer);
  }, [animate, fullSize, speed]);
  const sweep = sweepTints.map((t) => mixHex(colors.coffee, '#FFF7EE', t));
  const suffixSweep = suffixTints.map((t) => mixHex(colors.coffee, '#FFF7EE', t));
  const base = mixHex(colors.muted, colors.coffee, 0.35);
  const suffixBase = mixHex(colors.muted, colors.coffee, 0.6);
  return (
    <Box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center">
      <Box flexDirection="column">
        {display.map((row, index) => <Text key={index} bold={!fullSize}>{[...row].map((character, column) => {
          const light = animate ? Math.max(0, 6 - Math.abs(column - phase)) : 0;
          const suffix = column >= (fullSize ? logoWidth - 11 : 5);
          const glow = light ? (suffix ? suffixSweep : sweep)[light - 1] : suffix ? suffixBase : base;
          return <Text key={column} color={character === ' ' ? undefined : glow}>{character}</Text>;
        })}</Text>)}
      </Box>
    </Box>
  );
}
