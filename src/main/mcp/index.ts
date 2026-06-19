import { createMiniappTool } from './create-miniapp'
import { deleteMiniappTool } from './delete-miniapp'
import { getMiniappTool } from './get-miniapp'
import { getMiniappGuideTool } from './get-miniapp-guide'
import { listMiniappsTool } from './list-miniapps'
import { toggleMiniappTool } from './toggle-miniapp'
import type { ToolModule } from './types'
import { updateMiniappTool } from './update-miniapp'

// ─── Tool Registry ───────────────────────────────────────────────────────────

const toolModules: ToolModule[] = [
  listMiniappsTool,
  getMiniappTool,
  createMiniappTool,
  updateMiniappTool,
  deleteMiniappTool,
  toggleMiniappTool,
  getMiniappGuideTool,
]

const handlerMap = new Map(toolModules.map((t) => [t.definition.name, t.handler]))

/** All tool definitions for MCP ListTools */
export const TOOLS = toolModules.map((t) => t.definition)

/** Route a tool call to the correct handler */
export async function handleTool(name: string, args: any): Promise<string> {
  const handler = handlerMap.get(name)
  if (!handler) {
    return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
  return handler(args)
}
