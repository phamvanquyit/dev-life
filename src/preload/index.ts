import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),

  onNavigateTool: (callback: (tool: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tool: string) => callback(tool)
    ipcRenderer.on('navigate-tool', handler)
    return () => ipcRenderer.removeListener('navigate-tool', handler)
  },
  onToggleSidebar: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('toggle-sidebar', handler)
    return () => ipcRenderer.removeListener('toggle-sidebar', handler)
  },

  // Mini Apps
  listMiniApps: (): Promise<any[]> => ipcRenderer.invoke('miniapp:list'),
  getMiniApp: (id: string): Promise<any> => ipcRenderer.invoke('miniapp:get', id),
  createMiniApp: (data: any): Promise<{ success: boolean; id?: string }> =>
    ipcRenderer.invoke('miniapp:create', data),
  updateMiniApp: (id: string, data: any): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('miniapp:update', id, data),
  deleteMiniApp: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('miniapp:delete', id),
  toggleMiniApp: (
    id: string,
  ): Promise<{ success: boolean; enabled: boolean; missingConfigs?: string[] }> =>
    ipcRenderer.invoke('miniapp:toggle', id),
  importMiniAppZip: (
    buffer: ArrayBuffer,
  ): Promise<{ success: boolean; id?: string; error?: string }> =>
    ipcRenderer.invoke('miniapp:import-zip', Buffer.from(buffer)),

  exportMiniApp: (id: string): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> =>
    ipcRenderer.invoke('miniapp:export', id),
  // Mini App IPC (frontend ↔ backend messaging)
  sendMiniAppIpc: (appId: string, channel: string, data: any): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('miniapp:send-ipc', appId, channel, data),
  onMiniAppIpcMessage: (callback: (msg: { appId: string; channel: string; data: any }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: any) => callback(msg)
    ipcRenderer.on('miniapp:ipc-message', handler)
    return () => ipcRenderer.removeListener('miniapp:ipc-message', handler)
  },
  // Mini App Storage
  miniAppStorageGet: (appId: string, key: string): Promise<string | null> =>
    ipcRenderer.invoke('miniapp:storage-get', appId, key),
  miniAppStorageSet: (appId: string, key: string, value: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('miniapp:storage-set', appId, key, value),
  miniAppStorageDelete: (appId: string, key: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('miniapp:storage-delete', appId, key),
  miniAppStorageGetAll: (appId: string): Promise<Record<string, string>> =>
    ipcRenderer.invoke('miniapp:storage-get-all', appId),
  // Media APIs (miniapp-scoped)
  miniAppGetDesktopSources: (opts?: any): Promise<any[]> =>
    ipcRenderer.invoke('miniapp:get-desktop-sources', opts),
  getMediaAccess: (mediaType: string): Promise<string> =>
    ipcRenderer.invoke('miniapp:get-media-access', mediaType),
  askMediaAccess: (mediaType: string): Promise<boolean> =>
    ipcRenderer.invoke('miniapp:ask-media-access', mediaType),
  // Notification
  miniAppNotify: (opts: {
    title: string
    body?: string
    silent?: boolean
  }): Promise<{ success: boolean }> => ipcRenderer.invoke('miniapp:notify', opts),
  // Mini App Config
  getMiniAppConfig: (
    appId: string,
  ): Promise<{ success: boolean; schema: any; values: Record<string, any> }> =>
    ipcRenderer.invoke('miniapp:get-config', appId),
  setMiniAppConfig: (appId: string, key: string, value: any): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('miniapp:set-config', appId, key, value),
  // Mini App Logs
  onMiniAppLog: (
    callback: (msg: { appId: string; appName: string; timestamp: number; args: string[] }) => void,
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: any) => callback(msg)
    ipcRenderer.on('miniapp:log', handler)
    return () => ipcRenderer.removeListener('miniapp:log', handler)
  },

  // LLM Providers
  listLlmProviders: (): Promise<{
    success: boolean
    providers?: any[]
    error?: string
  }> => ipcRenderer.invoke('llm:list-providers'),
  addLlmProvider: (data: {
    name: string
    provider: string
    apiKey: string
    endpoint?: string
  }): Promise<{ success: boolean; id?: string; modelsCount?: number; error?: string }> =>
    ipcRenderer.invoke('llm:add-provider', data),
  deleteLlmProvider: (id: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('llm:delete-provider', id),
  getLlmModels: (
    providerId: string,
  ): Promise<{ success: boolean; models?: any[]; error?: string }> =>
    ipcRenderer.invoke('llm:get-models', providerId),

  // AI Agent
  aiAgentRun: (data: {
    providerId: string
    modelId: string
    messages: Array<{ role: string; content: string }>
    context: {
      appName: string
      appDescription: string
      activeTab: string
      currentCode: string
      allCode: { frontend: string; backend: string; panel: string }
    }
  }): Promise<{ success: boolean; error?: string; aborted?: boolean }> =>
    ipcRenderer.invoke('ai-agent:run', data),
  aiAgentStop: (): Promise<{ success: boolean }> => ipcRenderer.invoke('ai-agent:stop'),
  onAiAgentToken: (callback: (data: { content: string; fullContent: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('ai-agent:token', handler)
    return () => ipcRenderer.removeListener('ai-agent:token', handler)
  },
  onAiAgentToolStart: (callback: (data: { name: string; input: any }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('ai-agent:tool-start', handler)
    return () => ipcRenderer.removeListener('ai-agent:tool-start', handler)
  },
  onAiAgentToolEnd: (callback: (data: { name: string; output: any }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('ai-agent:tool-end', handler)
    return () => ipcRenderer.removeListener('ai-agent:tool-end', handler)
  },
  onAiAgentDone: (callback: (data: { fullContent: string; aborted?: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('ai-agent:done', handler)
    return () => ipcRenderer.removeListener('ai-agent:done', handler)
  },
  onAiAgentError: (callback: (data: { error: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('ai-agent:error', handler)
    return () => ipcRenderer.removeListener('ai-agent:error', handler)
  },
  onAiAgentCodeProposal: (
    callback: (data: { code: string; target: string; description: string }) => void,
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('ai-agent:code-proposal', handler)
    return () => ipcRenderer.removeListener('ai-agent:code-proposal', handler)
  },

  // Config persistence
  getConfig: (key: string): Promise<string | null> => ipcRenderer.invoke('config:get', key),
  setConfig: (key: string, value: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('config:set', key, value),

  // Auto-Update
  checkForUpdate: (): Promise<{ hasUpdate: boolean; info: any }> =>
    ipcRenderer.invoke('update:check-now'),
  getUpdateStatus: (): Promise<{ hasUpdate: boolean; info: any }> =>
    ipcRenderer.invoke('update:get-status'),
  dismissUpdate: (version: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('update:dismiss', version),
  openRelease: (url: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('update:open-release', url),
  installUpdate: (): Promise<{ success: boolean }> => ipcRenderer.invoke('update:install'),
  restartApp: (): Promise<void> => ipcRenderer.invoke('update:restart'),
  onUpdateAvailable: (callback: (info: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: any) => callback(info)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },
  onUpdateProgress: (
    callback: (progress: {
      stage: string
      percent?: number
      message?: string
      error?: string
    }) => void,
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.removeListener('update:progress', handler)
  },

  // Tray visibility
  onTrayVisibilityChange: (callback: (visible: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, visible: boolean) => callback(visible)
    ipcRenderer.on('tray-visibility-change', handler)
    return () => ipcRenderer.removeListener('tray-visibility-change', handler)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
