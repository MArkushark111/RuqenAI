let phoneBusy = false;
let cliHolders = 0;

export function acquireChatLock(source: 'phone' | 'cli' = 'phone'): (() => void) | undefined {
  if (source === 'phone') {
    if (phoneBusy || cliHolders > 0) return;
    phoneBusy = true;
    return () => { phoneBusy = false; };
  }
  if (phoneBusy) return;
  cliHolders++;
  return () => { cliHolders--; };
}
