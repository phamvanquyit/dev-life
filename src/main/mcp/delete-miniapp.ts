import { deleteMiniApp, getMiniApp } from '../mini-app-runtime'
import type { ToolModule } from './types'

export const deleteMiniappTool: ToolModule = {
  definition: {
    name: 'delete_miniapp',
    description: 'Delete a mini app and all its stored data permanently',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'string', description: 'Mini app ID' } },
      required: ['id'],
    },
  },

  handler: async (args: any) => {
    const existing = getMiniApp(args.id)
    const deleted = await deleteMiniApp(args.id)
    return JSON.stringify({
      success: deleted,
      message: deleted ? `Deleted "${existing?.name}".` : 'Not found.',
    })
  },
}
