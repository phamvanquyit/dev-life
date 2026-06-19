import { updateMiniApp } from '../mini-app-runtime'
import type { ToolModule } from './types'

export const updateMiniappTool: ToolModule = {
  definition: {
    name: 'update_miniapp',
    description: 'Update an existing mini app. Auto-disables when code changes for user review.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Mini app ID' },
        name: { type: 'string' },
        description: { type: 'string' },
        icon: { type: 'string' },
        category: { type: 'string' },
        version: { type: 'string' },
        frontendCode: { type: 'string' },
        backendCode: { type: 'string' },
        panelCode: { type: 'string' },
      },
      required: ['id'],
    },
  },

  handler: async (args: any) => {
    const { id, ...data } = args
    if (data.frontendCode || data.backendCode || data.panelCode) {
      data.enabled = false
    }
    const app = await updateMiniApp(id, data)
    if (!app) return JSON.stringify({ error: `Mini app "${id}" not found` })
    return JSON.stringify({
      success: true,
      message: `Updated "${app.name}".`,
      id: app.id,
    })
  },
}
