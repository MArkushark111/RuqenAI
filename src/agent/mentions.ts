import { mcpClient } from '../mcp/client.js';
import { skillsManager } from '../skills/manager.js';

interface ExtensionMention {
  label: string;
  summary: string;
  enabled: boolean;
  servers?: string[];
}

function extensionMentions(): ExtensionMention[] {
  const mentions: ExtensionMention[] = [{
    label: '@Computer', summary: 'Control this Windows desktop and inspect screenshots', enabled: true,
  }, ...skillsManager.list().map(({ name, description }) => ({
    label: '@skill:' + name, summary: description, enabled: true,
  }))];
  try {
    for (const { name, description } of mcpClient.listServers()) {
      mentions.push({ label: '@mcp:' + name, summary: description || 'MCP server', enabled: true, servers: [name] });
    }
    for (const { name, description, enabled, servers } of mcpClient.listPlugins()) {
      mentions.push({
        label: '@plugin:' + name, summary: enabled ? description || 'Plugin' : 'Disabled plugin', enabled, servers,
      });
    }
  } catch {
    // A malformed connector config should not break the composer or skill completion.
  }
  return mentions;
}

export function mentionAt(text: string, cursor: number) {
  const token = text.slice(0, cursor).match(/(?:^|\s)(@[\w.:-]*)$/)?.[1];
  if (!token) return;
  const suffix = text.slice(cursor).match(/^[\w.:-]*/)?.[0] ?? '';
  return { token, start: cursor - token.length, end: cursor + suffix.length };
}

export function suggestMentions(token: string) {
  const query = token.slice(1).toLowerCase();
  return extensionMentions()
    .filter(({ label }) => {
      const target = label.slice(1).toLowerCase();
      return target.startsWith(query) || target.split(':')[1].includes(query);
    })
    .sort((a, b) => Number(b.label.toLowerCase() === token.toLowerCase()) - Number(a.label.toLowerCase() === token.toLowerCase())
      || a.label.localeCompare(b.label));
}

export function mentionContext(text: string) {
  const tokens = [...text.matchAll(/(?:^|\s)(@(?:mcp|plugin|skill):[\w.-]+|@Computer\b)/gi)].map((match) => match[1].toLowerCase());
  if (!tokens.length) return '';
  const selected = extensionMentions()
    .filter(({ label }) => tokens.some((token) => token === label.toLowerCase() || token.replace(/\.+$/, '') === label.toLowerCase()))
    .map(({ label, enabled, servers }) => ({ mention: label, enabled, servers: enabled ? servers : undefined }));
  return selected.length ? '\n\nUser-mentioned Ruqenai extensions (data):\n' + JSON.stringify(selected) : '';
}
