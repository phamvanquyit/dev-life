// Tool definitions in OpenAI function-calling format.
// The orchestrator converts these to Anthropic / Google format before calling those APIs.

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, any>
      required?: string[]
    }
  }
}

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read the full contents of a file in the workspace. Returns the file text. ' +
        'Always read a file before editing it.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to workspace root (e.g. "src/index.ts").',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write content to a file, creating it (and parent dirs) if needed. Overwrites existing content. ' +
        'Use for new files or when rewriting a file from scratch.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to workspace root.',
          },
          content: {
            type: 'string',
            description: 'Full content to write.',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Apply a targeted text replacement in a file. ' +
        'old_text must appear verbatim in the file. Use for small surgical edits.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path relative to workspace root.',
          },
          old_text: {
            type: 'string',
            description: 'The exact text to replace (must exist in the file).',
          },
          new_text: {
            type: 'string',
            description: 'The replacement text.',
          },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        'List files and directories in a directory tree. Hidden files and node_modules are excluded.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to workspace root. Use "." for the root.',
          },
          depth: {
            type: 'number',
            description: 'Tree depth to list (1–5, default 3).',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description:
        'Search for a text pattern across files in the workspace. Returns matching lines with file path and line number.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Text pattern to search for (case-insensitive substring).',
          },
          path: {
            type: 'string',
            description:
              'Directory or file to search within, relative to workspace root. Defaults to ".".',
          },
          file_glob: {
            type: 'string',
            description: 'Filename glob filter, e.g. "*.ts", "*.jsx", "*.json".',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Execute a shell command in the workspace directory. Use for builds, tests, installs, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Shell command to run.',
          },
          timeout_ms: {
            type: 'number',
            description: 'Timeout in milliseconds (default 30 000, max 120 000).',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_miniapp_guide',
      description:
        'Returns the full Dev Life mini app development guide: architecture, ctx API, styling rules, and a complete example. Call this once before writing any mini app code.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
]

// ── Format converters ─────────────────────────────────────────────────────────

/** Convert to Anthropic tools format */
export function toAnthropicTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }))
}

/** Convert to Google Gemini functionDeclarations format */
export function toGoogleTools(tools: ToolDefinition[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    },
  ]
}
