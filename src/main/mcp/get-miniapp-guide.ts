import { MINIAPP_GUIDE } from './guide'
import type { ToolModule } from './types'

export const getMiniappGuideTool: ToolModule = {
  definition: {
    name: 'get_miniapp_guide',
    description:
      'Get the full Mini App development guide. ALWAYS read this before creating or editing a mini app.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
  },

  handler: async () => {
    return MINIAPP_GUIDE
  },
}
