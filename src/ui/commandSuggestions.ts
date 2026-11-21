import { commandGroups } from '../commands/catalog.js';

const commands = commandGroups.flatMap(({ commands }) => commands.map(({ name, aliases, summary }) => ({
  command: name, summary, aliases: aliases ?? [],
})));

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let earlier = previous;
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], earlier[j - 2] + 1);
      }
    }
    earlier = previous;
    previous = row;
  }
  return previous[b.length];
}

export function suggestCommands(value: string) {
  if (!/^\/[a-z]{0,24}$/i.test(value)) return [];
  const query = value.slice(1).toLowerCase();
  const prefix = commands.filter(({ command, aliases }) =>
    command.startsWith(query) || aliases.some((alias) => alias.startsWith(query)));
  if (prefix.length) {
    return prefix.sort((a, b) => Number(b.command === query) - Number(a.command === query));
  }
  if (query.length < 3) return [];

  return commands.map((entry) => ({ ...entry, distance: editDistance(query, entry.command) }))
    .filter(({ distance }) => distance <= (query.length >= 5 ? 2 : 1))
    .sort((a, b) => a.distance - b.distance);
}
