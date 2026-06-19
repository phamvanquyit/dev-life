import { createMiniApp } from '../mini-app-runtime'
import type { ToolModule } from './types'

export const createMiniappTool: ToolModule = {
  definition: {
    name: 'create_miniapp',
    description:
      'Create a new mini app. Disabled by default. Use get_miniapp_guide first to learn the API.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'App name' },
        description: { type: 'string', description: 'Short description' },
        icon: { type: 'string', description: 'Lucide icon name (e.g. Key, Hash, Globe)' },
        category: { type: 'string', description: 'Category: Dev Tools, Productivity, etc.' },
        version: { type: 'string', description: 'Version string' },
        frontendCode: { type: 'string', description: 'Frontend JS code' },
        backendCode: { type: 'string', description: 'Backend JS code (optional)' },
        panelCode: { type: 'string', description: 'Tray panel JS code (optional)' },
      },
      required: ['name', 'frontendCode'],
    },
  },

  handler: async (args: any) => {
    const app = createMiniApp(args)
    return JSON.stringify({
      success: true,
      message: `Created "${app?.name}" (id: ${app?.id}). DISABLED by default — user enables in Mini App Manager.`,
      id: app?.id,
      name: app?.name,
    })
  },
}
