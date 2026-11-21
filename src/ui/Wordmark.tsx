import fs from 'node:fs';
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';

let rows: string[] = [];
try {
  rows = fs.readFileSync(new URL('../../asciilogoart.txt', import.meta.url), 'utf8')
    .split(/\r?\n/).map((row) => row.trimEnd()).filter(Boolean);
} catch {
  // A package without the artwork can still show its name.
}
const logoWidth = Math.max(0, ...rows.map((row) => stringWidth(row)));
const sweepColors = ['#9E8A78', '#AC9682', '#BEA58E', '#D5BBA3', '#E8D1B8', '#F8EADD'];
const suffixSweep = ['#C4B4A5', '#CFBBA8', '#D9C3AF', '#E4CEB8', '#EDDCCB', '#FAF0E6'];
const sweepStep = 38;
const sweepInterval = 7500;

export function Wordmark({ width, height, animate }: { width: number; height: number; animate: boolean }) {
  const fullSize = rows.length > 0 && width >= logoWidth && height >= rows.length;
  const display = fullSize ? rows : [width >= 7 ? 'Ruqenai' : 'R'];
  const [phase, setPhase] = useState(-6);
  useEffect(() => {
    if (!animate) return;
    const start = Date.now();
    const end = (fullSize ? logoWidth : 7) + 6;
    const timer = setInterval(() => setPhase(Math.min(end, Math.floor(((Date.now() - start) % sweepInterval) / sweepStep) - 6)), sweepStep);
    return () => clearInterval(timer);
  }, [animate, fullSize]);
  return (
    <Box width={width} height={height} flexDirection="column" alignItems="center" justifyContent="center">
      <Box flexDirection="column">
        {display.map((row, index) => <Text key={index} bold={!fullSize}>{[...row].map((character, column) => {
          const light = animate ? Math.max(0, 6 - Math.abs(column - phase)) : 0;
          const suffix = column >= (fullSize ? logoWidth - 11 : 5);
          const base = suffix ? '#BDB0A3' : '#928274';
          const glow = light ? (suffix ? suffixSweep : sweepColors)[light - 1] : base;
          return <Text key={column} color={character === ' ' ? undefined : glow}>{character}</Text>;
        })}</Text>)}
      </Box>
    </Box>
  );
}
