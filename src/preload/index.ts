import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  getActiveBrowserURL: (): Promise<{ url: string; domain: string; browser: string } | null> =>
    ipcRenderer.invoke('get-active-browser-url'),
  // Password history
  savePasswordHistory: (
    entries: { password: string; domain: string; url: string; browser: string }[],
  ): Promise<unknown[]> => ipcRenderer.invoke('password-history:save', entries),
  getPasswordHistory: (): Promise<unknown[]> => ipcRenderer.invoke('password-history:get'),
  deletePasswordHistory: (id: number): Promise<unknown[]> =>
    ipcRenderer.invoke('password-history:delete', id),
  clearPasswordHistory: (): Promise<unknown[]> => ipcRenderer.invoke('password-history:clear'),
  // Antigravity Standalone
  listAntigravityConversations: (): Promise<unknown[]> =>
    ipcRenderer.invoke('antigravity:list-conversations'),
  getAntigravityTranscript: (
    conversationId: string,
    options?: { maxSteps?: number; onlyChat?: boolean },
  ): Promise<unknown[]> =>
    ipcRenderer.invoke('antigravity:get-transcript', conversationId, options),
  sendAntigravityMessage: (
    conversationId: string,
    content: string,
    workspacePath?: string,
  ): Promise<{ success: boolean; messageId: string; error?: string }> =>
    ipcRenderer.invoke('antigravity:send-message', conversationId, content, workspacePath),
  listAntigravityProjects: (): Promise<{ name: string; path: string }[]> =>
    ipcRenderer.invoke('antigravity:list-projects'),
  listAntigravityProjectsCDP: (): Promise<
    {
      name: string
      conversationCount: number
      conversations: { title: string; time: string; id: string }[]
    }[]
  > => ipcRenderer.invoke('antigravity:list-projects-cdp'),
  sendMessageCDP: (
    projectName: string,
    message: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('antigravity:send-message-cdp', projectName, message),
  resolveConversationCDP: (convTitle: string): Promise<{ id: string; error?: string }> =>
    ipcRenderer.invoke('antigravity:resolve-conversation-cdp', convTitle),
  typeMessageCDP: (message: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('antigravity:type-message-cdp', message),
  openAntigravityApp: (): Promise<void> => ipcRenderer.invoke('antigravity:open-app'),
  ensureAntigravityRunning: (): Promise<{ status: 'already-running' | 'launched' }> =>
    ipcRenderer.invoke('antigravity:ensure-running'),
  syncAntigravityProjects: (): Promise<{ success: boolean; count: number; error?: string }> =>
    ipcRenderer.invoke('antigravity:sync-projects'),
  getAntigravityProjectsFromDb: (): Promise<
    { name: string; projectId: string; path: string; syncedAt: string }[]
  > => ipcRenderer.invoke('antigravity:get-projects-db'),
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
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('antigravity:select-folder'),
  // System Cleaner
  getDiskOverview: (): Promise<{
    total: string
    used: string
    available: string
    percentUsed: number
  }> => ipcRenderer.invoke('system:disk-overview'),
  scanDiskUsage: (): Promise<any[]> => ipcRenderer.invoke('system:scan-usage'),
  systemClean: (cleanId: string): Promise<{ success: boolean; message: string; freed: string }> =>
    ipcRenderer.invoke('system:clean', cleanId),
  // AI Proxy
  startProxy: (): Promise<{ success: boolean; port?: number; error?: string }> =>
    ipcRenderer.invoke('proxy:start'),
  stopProxy: (): Promise<{ success: boolean }> => ipcRenderer.invoke('proxy:stop'),
  getProxyStatus: (): Promise<any> => ipcRenderer.invoke('proxy:status'),
  refreshProxyToken: (): Promise<{ success: boolean }> => ipcRenderer.invoke('proxy:refresh-token'),
  refreshProxyModels: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('proxy:refresh-models'),
  refreshProxyQuota: (): Promise<{ success: boolean }> => ipcRenderer.invoke('proxy:refresh-quota'),
  // Audio Translator
  setAudioTranslatorApiKey: (key: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('audio-translator:set-api-key', key),
  getAudioTranslatorApiKey: (): Promise<string | null> =>
    ipcRenderer.invoke('audio-translator:get-api-key'),
  transcribeAudio: (
    audioBase64: string,
    mimeType: string,
  ): Promise<{ success: boolean; english: string; vietnamese: string; error?: string }> =>
    ipcRenderer.invoke('audio-translator:transcribe', audioBase64, mimeType),
  getDesktopSources: (): Promise<
    { id: string; name: string; thumbnail: string; appIcon: string | null }[]
  > => ipcRenderer.invoke('audio-translator:get-sources'),
  checkAudioPermissions: (): Promise<{ microphone: string; screen: string }> =>
    ipcRenderer.invoke('audio-translator:check-permissions'),
  requestMicPermission: (): Promise<boolean> =>
    ipcRenderer.invoke('audio-translator:request-mic-permission'),
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
