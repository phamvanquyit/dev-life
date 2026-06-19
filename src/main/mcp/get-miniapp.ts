import { getMiniApp, readAppCode } from '../mini-app-runtime'
import type { ToolModule } from './types'

export const getMiniappTool: ToolModule = {
  definition: {
    name: 'get_miniapp',
    description:
      'Get full details of a mini app including its source code (frontendCode, backendCode, panelCode)',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'string', description: 'Mini app ID' } },
      required: ['id'],
    },
  },

  handler: async (args: any) => {
    const app = getMiniApp(args.id)
    if (!app) return JSON.stringify({ error: `Mini app "${args.id}" not found` })
    const code = readAppCode(app.id)
    return JSON.stringify(
      {
        id: app.id,
        name: app.name,
        description: app.description,
        icon: app.icon,
        category: app.category,
        version: app.version,
        enabled: !!app.enabled,
        frontendCode: code.frontendCode,
        backendCode: code.backendCode,
        panelCode: code.panelCode,
        createdAt: app.created_at,
        updatedAt: app.updated_at,
      },
      null,
      2,
    )
  },
}
