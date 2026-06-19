import { listMiniApps, readAppCode } from '../mini-app-runtime'
import type { ToolModule } from './types'

export const listMiniappsTool: ToolModule = {
  definition: {
    name: 'list_miniapps',
    description:
      'List all installed mini apps with their metadata (id, name, description, icon, category, version, enabled status)',
    inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
  },

  handler: async () => {
    const apps = listMiniApps()
    return JSON.stringify(
      apps.map((a) => {
        const code = readAppCode(a.id)
        return {
          id: a.id,
          name: a.name,
          description: a.description,
          icon: a.icon,
          category: a.category,
          version: a.version,
          enabled: !!a.enabled,
          hasBackend: !!code.backendCode.trim(),
          hasFrontend: !!code.frontendCode.trim(),
          hasPanel: !!code.panelCode,
        }
      }),
      null,
      2,
    )
  },
}
