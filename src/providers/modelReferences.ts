// Historical and documented IDs are displayed separately from account discovery.
// https://api-docs.deepseek.com/updates/
// https://platform.kimi.ai/docs/models
// https://docs.z.ai/guides/overview/pricing
const glm = [
  'glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx', 'glm-5.3-flashx-legal',
  'glm-5.2', 'glm-5.1', 'glm-5', 'glm-4.7', 'glm-4.7-flash', 'glm-4.7-flashx',
  'glm-4.6', 'glm-4.6v', 'glm-4.6v-flash', 'glm-4.6v-flashx',
  'glm-4.5', 'glm-4.5-x', 'glm-4.5-air', 'glm-4.5-airx', 'glm-4.5-flash', 'glm-4.5v',
  'glm-4-32b-0414-128k',
];
const kimi = [
  'kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3',
  'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6', 'kimi-k2.5',
  'kimi-k2-thinking', 'kimi-k2-thinking-turbo', 'kimi-k2-0905-preview', 'kimi-k2-0711-preview',
  'kimi-k2-turbo-preview', 'kimi-latest', 'kimi-thinking-preview', 'moonshot-v1-auto',
  ...['8k', '32k', '128k'].flatMap((size) => [`moonshot-v1-${size}`, `moonshot-v1-${size}-vision-preview`]),
];
const references = new Map<string, ReadonlyArray<readonly [string, string, string?]>>([
  ['deepseek', [
    ['deepseek-flash', 'DeepSeek V4.1 Flash'], ['deepseek-v4-pro', 'DeepSeek V4 Pro'],
    ['deepseek-v4-flash', 'DeepSeek V4 Flash', 'Alias → V4.1'],
    ['deepseek-v4-flash-vision-exp', 'DeepSeek V4 Flash Vision Exp', 'Alias → V4.1'],
    ['deepseek-chat', 'DeepSeek V3 / V3.1 / V3.2', 'Retired API ID'],
    ['deepseek-reasoner', 'DeepSeek R1 / V3.1 / V3.2', 'Retired API ID'],
  ]],
  ['moonshot', kimi.map((id) => [id, id, id.startsWith('kimi-k3') ? undefined : 'Legacy'])],
  ['zai', glm.map((id) => [id, id.toUpperCase()])],
  ['zhipu', [...glm, 'glm-4-plus'].map((id) => [id, id.toUpperCase()])],
]);

export const modelReferenceProviders = [...references.keys()];

export function modelReferenceRows(provider: string, listed: ReadonlySet<string>) {
  return (references.get(provider) ?? []).filter(([id]) => !listed.has(id.toLowerCase()));
}
