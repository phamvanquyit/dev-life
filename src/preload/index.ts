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

  // v2: Read code from filesystem
  readMiniAppCode: (
    id: string,
  ): Promise<{ backendCode: string; frontendCode: string; panelCode: string | null }> =>
    ipcRenderer.invoke('miniapp:read-code', id),

  getMiniAppGuide: (): Promise<string> => ipcRenderer.invoke('miniapp:get-guide'),
  getMiniAppWorkspacePath: (id: string): Promise<string> =>
    ipcRenderer.invoke('miniapp:workspace-path', id),

  getMiniAppAiAssistant: (
    appId: string,
  ): Promise<{
    providerId: string
    modelId: string
    chatHistory: any[]
  }> => ipcRenderer.invoke('miniapp:get-ai-assistant', appId),

  saveMiniAppAiAssistant: (
    appId: string,
    data: {
      providerId: string
      modelId: string
      chatHistory: any[]
    },
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('miniapp:save-ai-assistant', appId, data),

  callMiniAppAgent: (data: {
    appId: string
    appName: string
    appDescription: string
    appIcon: string
    appVersion: string
    providerId: string
    modelId: string
    messages: { role: 'user' | 'assistant'; content: string }[]
    requestId: string
  }): Promise<{ success: boolean; proposedChanges?: any; responseText?: string; error?: string }> =>
    ipcRenderer.invoke('miniapp:call-agent', data),

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
  callLlmCompletion: (data: {
    providerId: string
    modelId: string
    systemPrompt: string
    messages: { role: 'user' | 'assistant'; content: string }[]
    temperature?: number
  }): Promise<{ success: boolean; text?: string; error?: string }> =>
    ipcRenderer.invoke('llm:call-completion', data),
  formatCode: (code: string): Promise<{ success: boolean; formatted?: string; error?: string }> =>
    ipcRenderer.invoke('llm:format-code', code),

  // LLM Streaming
  callLlmCompletionStream: (data: {
    providerId: string
    modelId: string
    systemPrompt: string
    messages: { role: 'user' | 'assistant'; content: string }[]
    temperature?: number
    tools?: any[]
  }): Promise<{ success: boolean; requestId?: string; error?: string }> =>
    ipcRenderer.invoke('llm:call-completion-stream', data),
  cancelLlmStream: (requestId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('llm:cancel-stream', requestId),
  onLlmStreamChunk: (
    callback: (chunk: {
      requestId: string
      type: 'token' | 'tool_call' | 'done' | 'error'
      token?: string
      toolCall?: { id: string; name: string; arguments: string }
      fullText?: string
      error?: string
    }) => void,
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: any) => callback(chunk)
    ipcRenderer.on('llm:stream-chunk', handler)
    return () => ipcRenderer.removeListener('llm:stream-chunk', handler)
  },

  // AI Coding Agent
  sendAgentMessage: (data: {
    requestId?: string
    providerId: string
    modelId: string
    workspacePath: string
    projectContext?: string
    conversationHistory: { role: 'user' | 'assistant'; content: string }[]
    userMessage: string
  }): Promise<{ success: boolean; requestId?: string; error?: string }> =>
    ipcRenderer.invoke('agent:send-message', data),

  cancelAgent: (requestId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('agent:cancel', requestId),

  openDirectoryDialog: (): Promise<{ success: boolean; path?: string }> =>
    ipcRenderer.invoke('agent:open-directory'),

  onAgentEvent: (
    callback: (ev: {
      requestId: string
      type: 'token' | 'tool-start' | 'tool-result' | 'done' | 'error'
      token?: string
      toolName?: string
      toolArgs?: Record<string, any>
      toolResult?: string
      toolSuccess?: boolean
      fullText?: string
      filesChanged?: boolean
      error?: string
    }) => void,
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, ev: any) => callback(ev)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.removeListener('agent:event', handler)
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
