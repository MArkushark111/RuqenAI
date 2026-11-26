import { contextBridge, ipcRenderer, webUtils } from 'electron';

// Types the renderer relies on (kept loose here; renderer is plain JS).
export interface ChatMeta {
  id: string;
  name: string;
  updatedAt: number;
  messageCount: number;
  project: string | null;
  active: boolean;
}

const api = {
  init: () => ipcRenderer.invoke('app:init'),
  updateState: () => ipcRenderer.invoke('updates:state'),
  checkUpdate: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  homeGet: () => ipcRenderer.invoke('home:get'),
  homePick: () => ipcRenderer.invoke('home:pick'),
  homeSetScene: (enabled: boolean) => ipcRenderer.invoke('home:setScene', enabled),
  homeSetDisplay: (value: { darkDotsColored?: boolean; chatVisible?: boolean; chatOpacity?: number; suggestionsVisible?: boolean }) =>
    ipcRenderer.invoke('home:setDisplay', value),
  setCustomCss: (css: string) => ipcRenderer.invoke('config:setCustomCss', css),
  homeClear: () => ipcRenderer.invoke('home:clear'),
  homeSetSceneName: (scene: string) => ipcRenderer.invoke('home:setSceneName', scene),
  setMode: (mode: string) => ipcRenderer.invoke('config:setMode', mode),
  setEffort: (level: string) => ipcRenderer.invoke('config:setEffort', level),
  readManage: () => ipcRenderer.invoke('config:manage'),
  setTemperature: (value: number) => ipcRenderer.invoke('config:setTemperature', value),
  setCompact: (payload: { autoCompact?: boolean; compactThreshold?: number }) =>
    ipcRenderer.invoke('config:setCompact', payload),
  listModels: () => ipcRenderer.invoke('model:list'),
  setModel: (provider: string, model: string) => ipcRenderer.invoke('model:set', provider, model),

  listProviders: () => ipcRenderer.invoke('providers:list'),
  connectProvider: (id: string, payload: { apiKey?: string; endpoint?: string }) =>
    ipcRenderer.invoke('providers:connect', id, payload),
  disconnectProvider: (id: string) => ipcRenderer.invoke('providers:disconnect', id),

  setTitlebarTone: (theme: string) => ipcRenderer.send('window:tone', theme),
  suggestMentions: (token: string, root?: string) => ipcRenderer.invoke('mention:suggest', token, root),
  gitInfo: (root?: string) => ipcRenderer.invoke('workspace:git', root),
  compact: (payload?: { sessionId?: string }) => ipcRenderer.invoke('session:compact', payload),
  listExtensions: () => ipcRenderer.invoke('extensions:list'),
  removeExtension: (kind: string, name: string) => ipcRenderer.invoke('extensions:remove', kind, name),
  previewArtifact: (sessionId: string, filePath: string) => ipcRenderer.invoke('artifact:preview', sessionId, filePath),

  createChat: (projectPath?: string) => ipcRenderer.invoke('chat:create', projectPath),
  openChat: (id: string) => ipcRenderer.invoke('chat:open', id),
  sendPrompt: (sessionId: string, prompt: string) => ipcRenderer.invoke('chat:send', sessionId, prompt),
  stop: () => ipcRenderer.invoke('chat:stop'),
  clearTasks: (id: string) => ipcRenderer.invoke('chat:clearTasks', id),
  deleteChat: (id: string) => ipcRenderer.invoke('chat:delete', id),
  renameChat: (id: string, name: string) => ipcRenderer.invoke('chat:rename', id, name),
  attachPick: () => ipcRenderer.invoke('attach:pick'),
    attachFile: (sessionId: string, filePath: string) => ipcRenderer.invoke('attach:file', sessionId, filePath),
    attachRaw: (sessionId: string, payload: { name: string; data: string }) =>
      ipcRenderer.invoke('attach:raw', sessionId, payload),
    attachList: (sessionId: string) => ipcRenderer.invoke('attach:list', sessionId),
    attachRemove: (sessionId: string, filePath: string) => ipcRenderer.invoke('attach:remove', sessionId, filePath),
    pathForFile: (file: File) => webUtils.getPathForFile(file),

  listChats: () => ipcRenderer.invoke('chat:list'),
  listProjects: () => ipcRenderer.invoke('project:list'),
  addProject: () => ipcRenderer.invoke('project:add'),
  setActiveProject: (p: string) => ipcRenderer.invoke('project:setActive', p),
  removeProject: (p: string) => ipcRenderer.invoke('project:remove', p),

  answerQuestion: (answer: string | undefined) => ipcRenderer.send('answer:question', answer),
  answerPermission: (requestId: string, allowed: boolean, alwaysAllow: boolean) =>
    ipcRenderer.send('answer:permission', requestId, allowed, alwaysAllow),

  onEvent: (cb: (event: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on('event', listener);
    return () => ipcRenderer.removeListener('event', listener);
  },
};

contextBridge.exposeInMainWorld('ruqenai', api);
export type RuqenaiApi = typeof api;
