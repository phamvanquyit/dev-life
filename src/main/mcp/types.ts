/** Shared types for MCP tool definitions and handlers */

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, any>
    required: string[]
  }
}

export interface ToolModule {
  definition: ToolDefinition
  handler: (args: any) => Promise<string>
}
