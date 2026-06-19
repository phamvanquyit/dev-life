import { toggleMiniApp } from '../mini-app-runtime'
import type { ToolModule } from './types'

export const toggleMiniappTool: ToolModule = {
  definition: {
    name: 'toggle_miniapp',
    description: 'Enable or disable a mini app',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'string', description: 'Mini app ID' } },
      required: ['id'],
    },
  },

  handler: async (args: any) => {
    const result = await toggleMiniApp(args.id)
    if (!result.app) return JSON.stringify({ error: 'Not found' })
    return JSON.stringify({
      success: true,
      enabled: !!result.app.enabled,
      message: `"${result.app.name}" is now ${result.app.enabled ? 'ENABLED' : 'DISABLED'}.`,
    })
  },
}
