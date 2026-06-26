import { randomUUID } from 'node:crypto'
import { dialog, ipcMain } from 'electron'
import { runAgent } from './orchestrator'

// ── Active sessions ───────────────────────────────────────────────────────────

const activeSessions = new Map<string, AbortController>()

// ── IPC setup ─────────────────────────────────────────────────────────────────

export function setupAiAgentIPC() {
  // Start a new agent turn.
  // Returns { success, requestId } immediately; events are pushed via 'agent:event'.
  ipcMain.handle(
    'agent:send-message',
    async (
      event,
      data: {
        requestId?: string
        providerId: string
        modelId: string
        workspacePath: string
        projectContext?: string
        conversationHistory: { role: 'user' | 'assistant'; content: string }[]
        userMessage: string
      },
    ) => {
      const requestId = data.requestId || randomUUID()
      const abortController = new AbortController()
      activeSessions.set(requestId, abortController)
      const senderWebContentsId = event.sender.id

      // Run agent in background — don't block the IPC response

      ;(async () => {
        try {
          await runAgent({
            requestId,
            providerId: data.providerId,
            modelId: data.modelId,
            workspacePath: data.workspacePath,
            projectContext: data.projectContext,
            conversationHistory: data.conversationHistory,
            userMessage: data.userMessage,
            abortSignal: abortController.signal,
            senderWebContentsId,
          })
        } catch (err: any) {
          // Send error event back to the requesting webContents only
          const { webContents } = await import('electron')
          const wc = webContents.fromId(senderWebContentsId)
          if (wc && !wc.isDestroyed()) {
            wc.send('agent:event', {
              requestId,
              type: 'error',
              error: err.message || String(err),
            })
          }
        } finally {
          activeSessions.delete(requestId)
        }
      })()

      return { success: true, requestId }
    },
  )

  // Cancel an active agent session
  ipcMain.handle('agent:cancel', async (_event, requestId: string) => {
    const ctrl = activeSessions.get(requestId)
    if (ctrl) {
      ctrl.abort()
      activeSessions.delete(requestId)
      return { success: true }
    }
    return { success: false, error: 'Session not found' }
  })

  // Open a native directory-picker dialog
  ipcMain.handle('agent:open-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select workspace directory',
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false }
    return { success: true, path: result.filePaths[0] }
  })
}
