import { exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { MINIAPP_GUIDE } from '../../mcp/guide'

const execAsync = promisify(exec)

export interface ToolResult {
  success: boolean
  output: string
}

// ── Security: sandbox all paths to workspace root ─────────────────────────────

function safePath(workspaceRoot: string, relativePath: string): string {
  const abs = path.resolve(workspaceRoot, relativePath)
  if (!abs.startsWith(path.resolve(workspaceRoot))) {
    throw new Error(`Access denied: "${relativePath}" escapes workspace root`)
  }
  return abs
}

// ── Tool implementations ──────────────────────────────────────────────────────

function readFile(args: Record<string, any>, workspaceRoot: string): ToolResult {
  const filePath = safePath(workspaceRoot, args.path)
  if (!fs.existsSync(filePath)) {
    return { success: false, output: `File not found: ${args.path}` }
  }
  const stat = fs.statSync(filePath)
  if (stat.isDirectory()) {
    return { success: false, output: `"${args.path}" is a directory, not a file` }
  }
  if (stat.size > 512_000) {
    return {
      success: false,
      output: `File too large (${Math.round(stat.size / 1024)} KB). Use search_code to find specific sections.`,
    }
  }
  const content = fs.readFileSync(filePath, 'utf8')
  return { success: true, output: content }
}

function writeFile(args: Record<string, any>, workspaceRoot: string): ToolResult {
  const filePath = safePath(workspaceRoot, args.path)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, args.content, 'utf8')
  const lines = (args.content as string).split('\n').length
  return {
    success: true,
    output: `Wrote ${args.content.length} bytes (${lines} lines) → ${args.path}`,
  }
}

function editFile(args: Record<string, any>, workspaceRoot: string): ToolResult {
  const filePath = safePath(workspaceRoot, args.path)
  if (!fs.existsSync(filePath)) {
    return { success: false, output: `File not found: ${args.path}` }
  }
  const content = fs.readFileSync(filePath, 'utf8')
  if (!content.includes(args.old_text)) {
    const preview = (args.old_text as string).slice(0, 80).replace(/\n/g, '↵')
    return {
      success: false,
      output: `old_text not found in ${args.path}. Check spacing/indentation exactly.\nSearched for: "${preview}"`,
    }
  }
  const updated = content.replace(args.old_text, args.new_text)
  fs.writeFileSync(filePath, updated, 'utf8')
  return {
    success: true,
    output: `Edited ${args.path}: replaced ${(args.old_text as string).length} chars with ${(args.new_text as string).length} chars`,
  }
}

function listFiles(args: Record<string, any>, workspaceRoot: string): ToolResult {
  const dirPath = safePath(workspaceRoot, args.path || '.')
  if (!fs.existsSync(dirPath)) {
    return { success: false, output: `Not found: ${args.path}` }
  }
  if (!fs.statSync(dirPath).isDirectory()) {
    return { success: false, output: `"${args.path}" is a file, not a directory` }
  }

  const maxDepth = Math.min(Number(args.depth) || 3, 5)
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv'])
  const lines: string[] = []

  function walk(dir: string, prefix: string, depth: number) {
    if (depth > maxDepth) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    const sorted = entries
      .filter((e) => !e.name.startsWith('.') && !SKIP.has(e.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i]
      const isLast = i === sorted.length - 1
      const connector = isLast ? '└── ' : '├── '
      const childPrefix = isLast ? '    ' : '│   '
      lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? '/' : ''}`)
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), prefix + childPrefix, depth + 1)
      }
    }
  }

  walk(dirPath, '', 1)
  return {
    success: true,
    output: lines.length > 0 ? lines.join('\n') : '(empty)',
  }
}

function searchCode(args: Record<string, any>, workspaceRoot: string): ToolResult {
  const searchRoot = safePath(workspaceRoot, args.path || '.')
  const pattern = (args.pattern as string).toLowerCase()
  const glob = (args.file_glob as string) || ''

  const results: string[] = []
  const MAX_RESULTS = 60
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next'])

  function matchGlob(name: string): boolean {
    if (!glob) return true
    // simple glob: "*.ts" → /^.*\.ts$/
    const re = glob.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.')
    return new RegExp(`^${re}$`).test(name)
  }

  function walkSearch(dir: string) {
    if (results.length >= MAX_RESULTS) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) return
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walkSearch(full)
      } else if (matchGlob(entry.name)) {
        try {
          const text = fs.readFileSync(full, 'utf8')
          const rel = path.relative(workspaceRoot, full)
          text.split('\n').forEach((line, i) => {
            if (results.length < MAX_RESULTS && line.toLowerCase().includes(pattern)) {
              results.push(`${rel}:${i + 1}: ${line.trim()}`)
            }
          })
        } catch {
          // skip binary files
        }
      }
    }
  }

  const stat = fs.existsSync(searchRoot) ? fs.statSync(searchRoot) : null
  if (!stat) return { success: false, output: `Path not found: ${args.path}` }

  if (stat.isDirectory()) {
    walkSearch(searchRoot)
  } else {
    const text = fs.readFileSync(searchRoot, 'utf8')
    const rel = path.relative(workspaceRoot, searchRoot)
    text.split('\n').forEach((line, i) => {
      if (line.toLowerCase().includes(pattern)) {
        results.push(`${rel}:${i + 1}: ${line.trim()}`)
      }
    })
  }

  if (results.length === 0) {
    return { success: true, output: `No matches found for "${args.pattern}"` }
  }
  const suffix = results.length >= MAX_RESULTS ? `\n(showing first ${MAX_RESULTS} results)` : ''
  return { success: true, output: results.join('\n') + suffix }
}

async function runCommand(args: Record<string, any>, workspaceRoot: string): Promise<ToolResult> {
  const timeout = Math.min(Number(args.timeout_ms) || 30_000, 120_000)
  try {
    const { stdout } = await execAsync(args.command as string, {
      cwd: workspaceRoot,
      timeout,
      maxBuffer: 2 * 1024 * 1024,
    })
    return { success: true, output: stdout.trim() || '(no output)' }
  } catch (err: any) {
    const out = [err.stdout?.toString().trim(), err.stderr?.toString().trim()]
      .filter(Boolean)
      .join('\n')
    return { success: false, output: out || err.message || 'Command failed' }
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, any>,
  workspaceRoot: string,
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'read_file':
        return readFile(args, workspaceRoot)
      case 'write_file':
        return writeFile(args, workspaceRoot)
      case 'edit_file':
        return editFile(args, workspaceRoot)
      case 'list_files':
        return listFiles(args, workspaceRoot)
      case 'search_code':
        return searchCode(args, workspaceRoot)
      case 'run_command':
        return runCommand(args, workspaceRoot)
      case 'get_miniapp_guide':
        return { success: true, output: MINIAPP_GUIDE }
      default:
        return { success: false, output: `Unknown tool: ${name}` }
    }
  } catch (err: any) {
    return { success: false, output: err.message || String(err) }
  }
}

// Which tools mutate the filesystem (used to trigger onFilesChanged)
export const FILE_MUTATING_TOOLS = new Set(['write_file', 'edit_file'])
