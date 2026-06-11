import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { dialog, ipcMain } from 'electron'
import WebSocket from 'ws'
import { getSqlite } from './db'

const ANTIGRAVITY_BASE = join(homedir(), '.gemini', 'antigravity')
const BRAIN_DIR = join(ANTIGRAVITY_BASE, 'brain')
const CDP_PORT = 9333

export interface ConversationSummary {
  id: string
  title: string
  firstMessage: string
  createdAt: string
  lastModified: string
  hasMessages: boolean
  project: string
  workspacePath: string
  model?: string
}

/**
 * Extract workspace/project info from transcript content
 * Looks for file:// URIs in tool calls and content to determine the workspace path
 */
function extractWorkspace(lines: string[]): { project: string; workspacePath: string } {
  const pathRegex = /(?:file:\/\/)?(\/(Users|home)\/[a-zA-Z0-9_\-.]+\/[^\s'")(,\\]+)/g

  const BASE_DIRS = [
    join(homedir(), 'working', 'vnx-devzone'),
    join(homedir(), 'working', 'vnx-antigravity-agents'),
    join(homedir(), 'Documents', 'antigravity'),
    join(homedir(), 'working'),
    join(homedir(), 'zobite'),
    join(homedir(), 'scripts'),
    join(homedir(), 'Documents'),
    homedir(),
  ]

  for (const line of lines) {
    const matches = line.matchAll(pathRegex)
    for (const match of matches) {
      let fullPath = match[1]
      fullPath = fullPath.replace(/[\u0000-\u001F'")(,\\;.`\s?]+$/, '')

      for (const baseDir of BASE_DIRS) {
        if (fullPath.startsWith(baseDir)) {
          const relative = fullPath.substring(baseDir.length)
          const parts = relative
            .split('/')
            .filter(Boolean)
            .map((p) => p.replace(/[.`]+$/, ''))
          if (parts.length > 0) {
            let projectName = parts[0]
            if (
              baseDir === homedir() &&
              !['obs', 'scripts', 'tmp', 'working', 'zobite', 'Documents'].includes(projectName)
            ) {
              projectName = homedir()
            }
            return {
              project: projectName,
              workspacePath: join(baseDir, projectName === homedir() ? '' : projectName),
            }
          }
          const projectName =
            baseDir === homedir() ? homedir() : baseDir.split('/').pop() || 'Other'
          return {
            project: projectName,
            workspacePath: baseDir,
          }
        }
      }
    }
  }

  return { project: 'Other', workspacePath: '' }
}

export interface TranscriptStep {
  step_index: number
  source: string
  type: string
  status: string
  created_at: string
  content: string
}

/**
 * Read last N lines from a file efficiently (tail-like)
 */
async function readLastLines(filePath: string, maxLines: number): Promise<string[]> {
  const lines: string[] = []
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  })

  for await (const line of rl) {
    lines.push(line)
    if (lines.length > maxLines * 2) {
      lines.splice(0, lines.length - maxLines)
    }
  }

  return lines.slice(-maxLines)
}

/**
 * Extract a readable title from the first user message in transcript
 */
function extractTitle(firstUserContent: string): string {
  const match = firstUserContent.match(/<USER_REQUEST>\s*\n?([\s\S]*?)\n?\s*<\/USER_REQUEST>/)
  if (match?.[1]) {
    const text = match[1].trim()
    return text.length > 80 ? `${text.substring(0, 80)}...` : text
  }

  const firstLine = firstUserContent.split('\n')[0]?.trim() || 'Untitled Conversation'
  return firstLine.length > 80 ? `${firstLine.substring(0, 80)}...` : firstLine
}

/**
 * List all Antigravity Standalone conversations
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  const conversations: ConversationSummary[] = []

  const dbMappings = new Map<string, string>()
  try {
    const sqlite = getSqlite()
    const rows = sqlite
      .prepare('SELECT conversation_id, project_name FROM antigravity_conversations')
      .all() as {
      conversation_id: string
      project_name: string
    }[]
    for (const row of rows) {
      dbMappings.set(row.conversation_id, row.project_name)
    }
  } catch (err) {
    console.error('Failed to query conversation mappings from DB:', err)
  }

  try {
    const dirs = await readdir(BRAIN_DIR, { withFileTypes: true })

    const uuidDirs = dirs.filter(
      (d) =>
        d.isDirectory() &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(d.name),
    )

    const batchSize = 20
    for (let i = 0; i < uuidDirs.length; i += batchSize) {
      const batch = uuidDirs.slice(i, i + batchSize)
      const results = await Promise.allSettled(
        batch.map(async (dir) => {
          const convId = dir.name
          const convPath = join(BRAIN_DIR, convId)
          const transcriptPath = join(convPath, '.system_generated', 'logs', 'transcript.jsonl')
          const messagesPath = join(convPath, '.system_generated', 'messages')

          let transcriptExists = false
          try {
            await stat(transcriptPath)
            transcriptExists = true
          } catch {
            // No transcript
          }

          const dirStat = await stat(convPath)

          let hasMessages = false
          try {
            await stat(messagesPath)
            hasMessages = true
          } catch {
            // No messages dir
          }

          if (!transcriptExists && !hasMessages) {
            return null
          }

          let title = 'Untitled Conversation'
          let firstMessage = ''
          let createdAt = dirStat.birthtime.toISOString()
          let project = dbMappings.get(convId) || 'Other'
          let workspacePath = ''
          let model = ''

          if (transcriptExists) {
            try {
              const rl = createInterface({
                input: createReadStream(transcriptPath, { encoding: 'utf-8' }),
                crlfDelay: Number.POSITIVE_INFINITY,
              })

              const firstLines: string[] = []
              let lineCount = 0
              let foundTitle = false
              for await (const line of rl) {
                if (lineCount > 100) break
                lineCount++
                firstLines.push(line)

                try {
                  const step = JSON.parse(line)
                  if (step.type === 'USER_INPUT' && step.source === 'USER_EXPLICIT') {
                    if (!foundTitle) {
                      title = extractTitle(step.content || '')
                      firstMessage = step.content?.substring(0, 200) || ''
                      createdAt = step.created_at || createdAt
                      foundTitle = true
                    }

                    const modelMatch = step.content?.match(
                      /The user changed setting `Model Selection` from \S+ to ([^.]+)\./,
                    )
                    if (modelMatch?.[1]) {
                      model = modelMatch[1].trim()
                    }
                  }
                } catch {
                  // Skip malformed lines
                }
              }

              rl.close()

              const ws = extractWorkspace(firstLines)
              if (!dbMappings.has(convId)) {
                project = ws.project
              }
              workspacePath = ws.workspacePath
            } catch {
              // Failed to read transcript
            }
          }

          return {
            id: convId,
            title,
            firstMessage,
            createdAt,
            lastModified: dirStat.mtime.toISOString(),
            hasMessages,
            project,
            workspacePath,
            model,
          } as ConversationSummary
        }),
      )

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value !== null) {
          conversations.push(result.value)
        }
      }
    }

    conversations.sort(
      (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
    )
  } catch (error) {
    console.error('Failed to list Antigravity conversations:', error)
  }

  return conversations
}

/**
 * Read transcript for a specific conversation
 */
export async function getTranscript(
  conversationId: string,
  options: { maxSteps?: number; onlyChat?: boolean } = {},
): Promise<TranscriptStep[]> {
  const { maxSteps = 100, onlyChat = true } = options
  const cleanId = conversationId.replace(/['"]/g, '').trim()
  const transcriptPath = join(BRAIN_DIR, cleanId, '.system_generated', 'logs', 'transcript.jsonl')

  const steps: TranscriptStep[] = []

  try {
    const lines = await readLastLines(transcriptPath, maxSteps * 3)

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const step = JSON.parse(line) as TranscriptStep

        if (onlyChat) {
          const isUserInput = step.type === 'USER_INPUT'
          const isAgentResponse = step.type === 'PLANNER_RESPONSE'
          if (!isUserInput && !isAgentResponse) continue
        }

        if (step.content && step.content.length > 5000) {
          step.content = `${step.content.substring(0, 5000)}\n\n... [truncated]`
        }

        steps.push(step)

        if (steps.length >= maxSteps) break
      } catch {
        // Skip malformed lines
      }
    }
  } catch (error) {
    console.error(`Failed to read transcript for ${conversationId}:`, error)
  }

  return steps
}

/**
 * Send a message to an Antigravity Standalone conversation via agentapi CLI.
 */
export async function sendMessage(
  conversationId: string,
  content: string,
  workspacePath?: string,
): Promise<{ success: boolean; messageId: string; error?: string }> {
  const cleanId = conversationId.replace(/['"]/g, '').trim()
  // Primary: CDP — navigate to conversation and type message
  try {
    await cdpSession(async (send) => {
      await send('Runtime.enable')

      // Navigate to conversation
      await send('Runtime.evaluate', {
        expression: `window.location.href = '/c/${cleanId}'`,
        returnByValue: true,
      })

      // Wait for page to load
      await new Promise((r) => setTimeout(r, 2000))

      // Focus the Lexical input
      const focusRes = await send('Runtime.evaluate', {
        expression: `(function() {
          var input = document.querySelector('[contenteditable="true"]');
          if (!input) return 'no_input';
          input.focus(); return 'focused';
        })()`,
        returnByValue: true,
      })

      if (focusRes.result?.result?.value === 'no_input') {
        throw new Error('Chat input not found')
      }

      // Clear existing text: Cmd+A then Backspace
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        modifiers: 2,
      })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' })
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Backspace',
        code: 'Backspace',
      })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' })
      await new Promise((r) => setTimeout(r, 100))

      // Type message
      await send('Input.insertText', { text: content })

      // Force Lexical/React state update by dispatching input event
      await send('Runtime.evaluate', {
        expression: `(function() {
          var input = document.querySelector('[contenteditable="true"]');
          if (!input) return 'no_input';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return 'dispatched';
        })()`,
        returnByValue: true,
      })

      await new Promise((r) => setTimeout(r, 200))

      // Press Enter to send
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' })
    })

    console.log(`[sendMessage] Sent via CDP to ${cleanId}`)
    return { success: true, messageId: cleanId }
  } catch (cdpError) {
    console.error(`[sendMessage] CDP failed for ${cleanId}:`, cdpError)
  }

  // Fallback 1: agentapi CLI
  const agentApiPath = join(ANTIGRAVITY_BASE, 'bin', 'agentapi')

  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)

    const options: any = { timeout: 10000 }
    if (workspacePath && existsSync(workspacePath)) {
      options.cwd = workspacePath
    }

    const { stdout } = await execFileAsync(
      agentApiPath,
      ['send-message', cleanId, content],
      options,
    )

    const result = JSON.parse(stdout.toString())

    if (result.error) {
      return { success: false, messageId: '', error: result.error }
    }

    return {
      success: true,
      messageId: cleanId,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[sendMessage] agentapi failed for ${cleanId}:`, errorMessage)

    // Fallback 2: write message file
    try {
      const messagesDir = join(BRAIN_DIR, cleanId, '.system_generated', 'messages')
      await mkdir(messagesDir, { recursive: true })
      const messageId = randomUUID()
      const message = {
        id: messageId,
        recipient: cleanId,
        sender: 'user',
        priority: 'MESSAGE_PRIORITY_HIGH',
        timestamp: new Date().toISOString(),
        content,
      }
      await writeFile(
        join(messagesDir, `${messageId}.json`),
        JSON.stringify(message, null, 2),
        'utf-8',
      )
      return {
        success: true,
        messageId,
        error: 'Sent via fallback (queued). Agent will receive when active.',
      }
    } catch (_fallbackError) {
      return { success: false, messageId: '', error: `All methods failed: ${errorMessage}` }
    }
  }
}

/**
 * Create a new Antigravity conversation via CDP.
 * Navigates Antigravity to /c/new?section=<projectId>, then types the message.
 */
export async function newConversation(
  prompt: string,
  _workspacePath: string,
  projectName: string,
  _model?: string,
): Promise<{ success: boolean; conversationId?: string; error?: string }> {
  // Get project section ID from DB
  const dbProjects = getProjectsFromDb()
  const project = dbProjects.find((p) => p.name === projectName)
  const sectionId = project?.projectId

  if (!sectionId) {
    return {
      success: false,
      error: `Project "${projectName}" not found in DB or has no section ID. Run sync first.`,
    }
  }

  try {
    let conversationId = ''

    await cdpSession(async (send) => {
      await send('Runtime.enable')

      // Try to click the project's "+" button on sidebar to navigate via React Router (SPA)
      const clickRes = await send('Runtime.evaluate', {
        expression: `(function() {
          var cards = document.querySelectorAll('[data-project-card="true"]');
          for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var textDiv = card.querySelector('div.text-sm.font-medium.truncate');
            if (textDiv && (textDiv.textContent || '').trim() === ${JSON.stringify(projectName)}) {
              var btns = card.querySelectorAll('button');
              for (var j = 0; j < btns.length; j++) {
                var svg = btns[j].querySelector('svg');
                if (svg) {
                  var path = svg.querySelector('path');
                  var d = path ? path.getAttribute('d') || '' : '';
                  if (d.includes('M450-450')) {
                    btns[j].click();
                    return 'clicked_plus';
                  }
                }
              }
              return 'plus_not_found_in_card';
            }
          }
          return 'project_card_not_found';
        })()`,
        returnByValue: true,
      })

      const clickStatus = clickRes.result?.result?.value
      console.log(`[newConversation] Click project "+" button result: ${clickStatus}`)

      if (clickStatus !== 'clicked_plus') {
        console.warn(
          `[newConversation] Could not click "+" button (status: ${clickStatus}). Falling back to window.location.href.`,
        )
        // Fallback: Navigate to new conversation for this project directly
        await send('Runtime.evaluate', {
          expression: `window.location.href = '/c/new?section=${sectionId}'`,
          returnByValue: true,
        })
      }

      // Wait for page to load (up to 5s for editor to appear)
      let editorReady = false
      for (let i = 0; i < 10; i++) {
        const checkRes = await send('Runtime.evaluate', {
          expression: `!!document.querySelector('[contenteditable="true"]')`,
          returnByValue: true,
        })
        if (checkRes.result?.result?.value === true) {
          editorReady = true
          break
        }
        await new Promise((r) => setTimeout(r, 500))
      }

      console.log(`[newConversation] Editor ready state: ${editorReady}`)

      if (!editorReady) {
        throw new Error('Lexical editor not found in DOM after 5s')
      }

      // Wait for model selector button to appear and switch if needed to avoid quota issues
      let modelBtnFound = false
      let currentModelName = ''
      for (let i = 0; i < 15; i++) {
        const checkRes = await send('Runtime.evaluate', {
          expression: `(function() {
            var btn = document.querySelector('[aria-label*="Select model"]');
            if (btn) {
              return btn.textContent || btn.getAttribute('aria-label') || 'found';
            }
            return '';
          })()`,
          returnByValue: true,
        })
        if (checkRes.result?.result?.value) {
          currentModelName = checkRes.result.result.value.trim()
          modelBtnFound = true
          break
        }
        await new Promise((r) => setTimeout(r, 500))
      }

      console.log(
        `[newConversation] Model selector check: found=${modelBtnFound}, name="${currentModelName}"`,
      )

      if (
        modelBtnFound &&
        (currentModelName.includes('Claude') || currentModelName.includes('Claude Opus'))
      ) {
        console.log(
          `[newConversation] Found model selector: "${currentModelName}". Clicking to open dropdown...`,
        )

        // Open dropdown by clicking the model selector button
        const clickSelectorRes = await send('Runtime.evaluate', {
          expression: `(function() {
            var btn = document.querySelector('[aria-label*="Select model"]');
            if (btn) {
              btn.click();
              return 'clicked_selector';
            }
            return 'selector_not_found';
          })()`,
          returnByValue: true,
        })
        console.log(
          `[newConversation] Click selector result: ${clickSelectorRes.result?.result?.value}`,
        )

        await new Promise((r) => setTimeout(r, 1200))

        // Select Gemini 3.5 Flash (Medium) from dropdown
        const selectModelRes = await send('Runtime.evaluate', {
          expression: `(function() {
            var btns = document.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {
              var text = btns[i].textContent || '';
              if (text.includes('Gemini 3.5 Flash (Medium)')) {
                btns[i].click();
                return 'selected_gemini';
              }
            }
            return 'gemini_option_not_found';
          })()`,
          returnByValue: true,
        })
        console.log(
          `[newConversation] Select model result: ${selectModelRes.result?.result?.value}`,
        )

        // Wait for switch setup and quota warning to disappear
        await new Promise((r) => setTimeout(r, 2000))
      }

      // Focus the Lexical input
      const focusRes = await send('Runtime.evaluate', {
        expression: `(function() {
          var input = document.querySelector('[contenteditable="true"]');
          if (!input) return 'no_input';
          input.focus(); return 'focused';
        })()`,
        returnByValue: true,
      })

      console.log(`[newConversation] Focus input result: ${focusRes.result?.result?.value}`)

      if (focusRes.result?.result?.value === 'no_input') {
        throw new Error('Chat input not found')
      }

      // Clear existing text: Cmd+A then Backspace
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        modifiers: 2,
      })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' })
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Backspace',
        code: 'Backspace',
      })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' })
      await new Promise((r) => setTimeout(r, 100))

      // Type using Input.insertText
      console.log(`[newConversation] Inserting text: "${prompt}"`)
      await send('Input.insertText', { text: prompt })

      // Force Lexical/React state update by dispatching input event
      await send('Runtime.evaluate', {
        expression: `(function() {
          var input = document.querySelector('[contenteditable="true"]');
          if (!input) return 'no_input';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return 'dispatched';
        })()`,
        returnByValue: true,
      })

      await new Promise((r) => setTimeout(r, 300))

      // Press Enter to send
      console.log('[newConversation] Pressing Enter to send...')
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      })
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      })

      // Wait for conversation to be created and read the URL (up to 7 seconds)
      let match: RegExpMatchArray | null = null
      for (let attempt = 0; attempt < 14; attempt++) {
        await new Promise((r) => setTimeout(r, 500))
        const urlRes = await send('Runtime.evaluate', {
          expression: 'window.location.href',
          returnByValue: true,
        })
        const url = urlRes.result?.result?.value || ''
        console.log(`[newConversation] URL poll attempt ${attempt + 1}: ${url}`)
        match = url.match(/\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)
        if (match) break
      }

      if (match) {
        conversationId = match[1]
        try {
          const sqlite = getSqlite()
          sqlite
            .prepare(`
            INSERT INTO antigravity_conversations (conversation_id, project_name, synced_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(conversation_id) DO UPDATE SET project_name = excluded.project_name, synced_at = datetime('now')
          `)
            .run(conversationId, projectName)
        } catch (dbErr) {
          console.error('[newConversation] Failed to save conversation mapping to DB:', dbErr)
        }
      }

      console.log(`[newConversation] Created in project ${projectName}, convId: ${conversationId}`)
    })

    return { success: true, conversationId }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    console.error('[newConversation] CDP failed:', errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * Check if Antigravity process is currently running
 */
async function isAntigravityProcessRunning(): Promise<boolean> {
  try {
    const { execSync } = await import('node:child_process')
    execSync('pgrep -x Antigravity', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Kill the running Antigravity process
 */
async function killAntigravityProcess(): Promise<void> {
  try {
    const { execSync } = await import('node:child_process')
    execSync('pkill -x Antigravity', { stdio: 'ignore' })
    // Wait for process to fully exit
    await new Promise((r) => setTimeout(r, 1500))
  } catch {
    // Process may have already exited
  }
}

/**
 * Open the Antigravity Standalone app with CDP debug port.
 * If already running without debug mode, kill and relaunch.
 */
async function openAntigravityApp(): Promise<void> {
  try {
    const isRunning = await isAntigravityProcessRunning()
    if (isRunning) {
      // Process is running but caller determined CDP is not available,
      // so kill it first to relaunch with debug port
      console.log('[antigravity] App running without CDP, killing to relaunch with debug port...')
      await killAntigravityProcess()
    }
    const { exec } = await import('node:child_process')
    exec(`open -a "Antigravity" --args --remote-debugging-port=${CDP_PORT}`)
  } catch (error) {
    console.error('Failed to open Antigravity app:', error)
  }
}

/**
 * Get all known projects/workspaces from Antigravity Standalone's SQLite database
 * and common project directories on disk.
 */
export async function getKnownProjects(): Promise<{ name: string; path: string }[]> {
  const dbPaths = [
    join(homedir(), 'Library/Application Support/Antigravity IDE/User/globalStorage/state.vscdb'),
    join(homedir(), 'Library/Application Support/Antigravity/User/globalStorage/state.vscdb'),
  ]

  const pathsSet = new Set<string>()

  // Common parent folders
  const standardPaths = [
    join(homedir(), 'working'),
    join(homedir(), 'zobite'),
    join(homedir(), 'scripts'),
    join(homedir(), 'Documents/antigravity'),
  ]

  for (const p of standardPaths) {
    try {
      const subdirs = await readdir(p, { withFileTypes: true })
      for (const subdir of subdirs) {
        if (subdir.isDirectory() && !subdir.name.startsWith('.')) {
          pathsSet.add(join(p, subdir.name))
        }
      }
    } catch {
      // ignore
    }
  }

  pathsSet.add(homedir())

  // Query Antigravity Standalone database
  try {
    const { exec } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execAsync = promisify(exec)

    const query = `
      SELECT key, value FROM ItemTable 
      WHERE key IN ('history.recentlyOpenedPathsList', 'antigravityUnifiedStateSync.sidebarWorkspaces', 'antigravityUnifiedStateSync.scratchWorkspaces');
    `

    for (const dbPath of dbPaths) {
      try {
        const { stdout } = await execAsync(`sqlite3 "${dbPath}" "${query}"`, {
          encoding: 'buffer',
          maxBuffer: 1024 * 1024 * 10,
        })
        const stdoutStr = stdout.toString('utf-8')
        const rows = stdoutStr.split('\n')

        for (const row of rows) {
          const idx = row.indexOf('|')
          if (idx === -1) continue
          const key = row.substring(0, idx)
          const val = row.substring(idx + 1)

          if (key === 'history.recentlyOpenedPathsList') {
            try {
              const list = JSON.parse(val)
              const entries = list.entries ? list.entries : list
              for (const e of entries) {
                if (e.folderUri?.startsWith('file://')) {
                  const cleanedPath = decodeURIComponent(e.folderUri.replace('file://', ''))
                  pathsSet.add(cleanedPath)
                }
              }
            } catch (_e) {}
          } else {
            let decoded = val
            try {
              decoded = Buffer.from(val, 'base64').toString('binary')
            } catch (_e) {}

            const matches = decoded.match(/(?:file:\/\/)[^\s'"\u0000-\u001F]+/g)
            if (matches) {
              for (const m of matches) {
                const cleanedPath = decodeURIComponent(m.replace('file://', ''))
                pathsSet.add(cleanedPath)
              }
            }
          }
        }
      } catch (_err) {
        // ignore
      }
    }
  } catch (_err) {
    // ignore
  }

  const projects: { name: string; path: string }[] = []
  const BASE_DIRS = [
    join(homedir(), 'working', 'vnx-devzone'),
    join(homedir(), 'working', 'vnx-antigravity-agents'),
    join(homedir(), 'Documents', 'antigravity'),
    join(homedir(), 'working'),
    join(homedir(), 'zobite'),
    join(homedir(), 'scripts'),
    join(homedir(), 'Documents'),
  ]

  for (const p of pathsSet) {
    if (!existsSync(p)) continue

    let projectName = ''
    let matchedBase = false

    for (const baseDir of BASE_DIRS) {
      if (p.startsWith(baseDir)) {
        const relative = p.substring(baseDir.length)
        const parts = relative.split('/').filter(Boolean)
        if (parts.length > 0) {
          projectName = parts[0]
        } else {
          projectName = baseDir.split('/').pop() || ''
        }
        matchedBase = true
        break
      }
    }

    if (!projectName && matchedBase === false) {
      if (p === homedir()) {
        projectName = homedir()
      } else {
        projectName = p.split('/').pop() || ''
      }
    }

    if (projectName && projectName !== 'Other' && !projectName.startsWith('.')) {
      projects.push({
        name: projectName,
        path: p,
      })
    }
  }

  const finalProjects: Record<string, { name: string; path: string }> = {}
  for (const proj of projects) {
    if (!finalProjects[proj.name] || finalProjects[proj.name].path.length > proj.path.length) {
      finalProjects[proj.name] = proj
    }
  }

  const sorted = Object.values(finalProjects).sort((a, b) => {
    if (a.name === homedir()) return -1
    if (b.name === homedir()) return 1
    return a.name.localeCompare(b.name)
  })

  return sorted
}

/**
 * HTTP GET helper for CDP
 */
function httpGet(url: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => (data += chunk))
      res.on('end', () => resolve(data))
    })
    req.on('error', (err) => reject(err))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('HTTP request timed out'))
    })
  })
}

/**
 * Resolve CDP targets from Antigravity Standalone running on CDP_PORT.
 */
async function resolveCDPTarget(): Promise<{ id: string; wsUrl: string } | null> {
  try {
    const raw = await httpGet(`http://127.0.0.1:${CDP_PORT}/json`)
    const targets = JSON.parse(raw) as any[]
    const page = targets.find(
      (t) =>
        t.type === 'page' &&
        t.webSocketDebuggerUrl &&
        !t.url?.includes('devtools://') &&
        t.title !== 'Manager',
    )
    if (page) {
      return { id: page.id, wsUrl: page.webSocketDebuggerUrl }
    }
  } catch {
    // CDP not available
  }
  return null
}

/**
 * Evaluate a JavaScript expression in the Antigravity Standalone page via CDP.
 */
export async function cdpEvaluate(expression: string, timeoutMs = 10000): Promise<any> {
  const target = await resolveCDPTarget()
  if (!target)
    throw new Error(
      'Antigravity CDP target not found. Is the app running with --remote-debugging-port=9333?',
    )

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.wsUrl)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('CDP evaluate timed out'))
    }, timeoutMs)

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
    })

    ws.on('message', (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString())
      if (msg.id === 1) {
        ws.send(
          JSON.stringify({
            id: 2,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true },
          }),
        )
      }
      if (msg.id === 2) {
        clearTimeout(timer)
        const value = msg.result?.result?.value
        ws.close()
        resolve(value)
      }
    })

    ws.on('error', (err: Error) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * Resolve a conversation UUID by its display title.
 * Scans CONVERSATION_HISTORY entries in transcripts which contain exact
 * "## Conversation UUID: Title" mappings generated by Antigravity.
 */
const titleToIdCache = new Map<string, string>()
const MAX_TITLE_CACHE_SIZE = 500
let titleCachePopulated = false

async function populateTitleCache(): Promise<void> {
  if (titleCachePopulated) return
  titleCachePopulated = true

  try {
    const dirs = await readdir(BRAIN_DIR, { withFileTypes: true })
    const uuidDirs = dirs.filter(
      (d) =>
        d.isDirectory() &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(d.name),
    )

    // Find most recent transcripts to scan for CONVERSATION_HISTORY
    const dirStats = await Promise.all(
      uuidDirs.map(async (d) => {
        const tp = join(BRAIN_DIR, d.name, '.system_generated', 'logs', 'transcript.jsonl')
        try {
          const s = await stat(tp)
          return { name: d.name, path: tp, mtime: s.mtimeMs }
        } catch {
          return { name: d.name, path: tp, mtime: 0 }
        }
      }),
    )

    // Sort by recency, scan most recent transcripts first (they have the fullest history)
    const sorted = dirStats.filter((d) => d.mtime > 0).sort((a, b) => b.mtime - a.mtime)

    // Regex to extract "## Conversation UUID: Title" from CONVERSATION_HISTORY
    const convPattern =
      /## Conversation ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}): (.+)/g

    // Scan all transcripts — CONVERSATION_HISTORY has up to ~20 mappings each
    for (let i = 0; i < sorted.length; i++) {
      try {
        const rl = createInterface({
          input: createReadStream(sorted[i].path, { encoding: 'utf-8' }),
          crlfDelay: Number.POSITIVE_INFINITY,
        })

        for await (const line of rl) {
          if (!line.includes('CONVERSATION_HISTORY')) continue
          try {
            const entry = JSON.parse(line)
            if (entry.type !== 'CONVERSATION_HISTORY') continue

            const content = entry.content || ''
            let match: RegExpExecArray | null
            convPattern.lastIndex = 0
            while ((match = convPattern.exec(content)) !== null) {
              const [, uuid, convTitle] = match
              titleToIdCache.set(convTitle.trim(), uuid)
            }
          } catch {
            // skip malformed line
          }
        }

        rl.close()
      } catch {
        // skip unreadable transcript
      }

      // If we've found enough mappings, stop scanning
      if (titleToIdCache.size > 200) break
    }
  } catch (err) {
    console.error('populateTitleCache error:', err)
  }
}

async function findConversationIdByTitle(title: string): Promise<string | null> {
  if (!title) return null

  await populateTitleCache()

  // Exact match
  if (titleToIdCache.has(title)) return titleToIdCache.get(title)!

  // Case-insensitive match
  const lowerTitle = title.toLowerCase()
  for (const [cachedTitle, uuid] of titleToIdCache) {
    if (cachedTitle.toLowerCase() === lowerTitle) return uuid
  }

  return null
}

/**
 * List projects from Antigravity Standalone via CDP.
 * Scrapes project names from sidebar DOM, resolves section IDs by clicking.
 */
async function listProjectsViaCDP(): Promise<
  {
    name: string
    projectId: string
    conversationCount: number
    conversations: { title: string; time: string; id: string }[]
  }[]
> {
  const t0 = Date.now()
  // Step 1: Scrape project list from DOM
  console.log('[listProjectsCDP] Step 1: Scraping project list from DOM...')
  const scrapeJs = `
    (function() {
      var nodes = document.querySelectorAll('div.text-sm.font-medium.truncate.m-0');
      var results = [];
      for (var i = 0; i < nodes.length; i++) {
        var name = (nodes[i].textContent || '').trim();
        if (!name) continue;
        var container = nodes[i];
        for (var d = 0; d < 5; d++) { if (container.parentElement) container = container.parentElement; }
        var convSpans = container.querySelectorAll('span.truncate.inline-block.text-sm.text-left');
        var conversations = [];
        for (var j = 0; j < convSpans.length; j++) {
          var title = (convSpans[j].textContent || '').trim();
          var testId = convSpans[j].getAttribute('data-testid') || '';
          var idMatch = testId.match(/^convo-pill-(.+)$/);
          var id = idMatch ? idMatch[1] : '';
          conversations.push({ title: title, time: '', id: id });
        }
        results.push({ name: name, conversationCount: conversations.length, conversations: conversations });
      }
      return JSON.stringify(results);
    })()
  `
  try {
    const rawResult = await cdpEvaluate(scrapeJs)
    const scraped = JSON.parse(rawResult) as {
      name: string
      conversationCount: number
      conversations: { title: string; time: string; id: string }[]
    }[]
    console.log(
      `[listProjectsCDP] Step 1 done in ${Date.now() - t0}ms — found ${scraped.length} projects: ${scraped.map((p) => p.name).join(', ')}`,
    )

    if (scraped.length === 0) {
      console.warn(
        '[listProjectsCDP] No projects found in DOM. Antigravity sidebar may not be loaded or DOM selectors changed.',
      )
      return []
    }

    // Step 2: Map projects directly — conversation IDs come from DOM data-testid only
    const projects = scraped.map((proj) => ({
      ...proj,
      projectId: '',
      conversations: proj.conversations,
    }))

    // Step 3: Resolve project section IDs by clicking first conversation of each project
    const t2 = Date.now()
    const projectsWithConvs = projects.filter((p) => p.conversations.length > 0)
    console.log(
      `[listProjectsCDP] Step 3: Resolving section IDs for ${projectsWithConvs.length} projects...`,
    )

    for (const proj of projects) {
      if (proj.conversations.length === 0) continue
      const tp = Date.now()
      try {
        const convTitle = proj.conversations[0].title
        // Timeout per project: 8s (instead of default 30s)
        await cdpSession(async (send) => {
          await send('Runtime.enable')
          await send('Runtime.evaluate', {
            expression: `(function() {
              var spans = document.querySelectorAll('span.truncate.inline-block.text-sm.text-left');
              for (var i = 0; i < spans.length; i++) {
                if ((spans[i].textContent || '').trim() === ${JSON.stringify(convTitle)}) {
                  var row = spans[i].closest('.select-none.cursor-pointer') || spans[i].parentElement;
                  if (row) { row.click(); return 'clicked'; }
                }
              }
              return 'not_found';
            })()`,
            returnByValue: true,
          })
          await new Promise((r) => setTimeout(r, 800))
          const urlRes = await send('Runtime.evaluate', {
            expression: 'window.location.href',
            returnByValue: true,
          })
          const url = urlRes.result?.result?.value || ''
          const m = url.match(/section=([0-9a-f-]+)/)
          if (m) {
            proj.projectId = m[1]
          }
        }, 8000)
        console.log(
          `[listProjectsCDP]   ${proj.name} -> section: ${proj.projectId || '(none)'} (${Date.now() - tp}ms)`,
        )
      } catch (err) {
        console.warn(
          `[listProjectsCDP]   ${proj.name} -> FAILED (${Date.now() - tp}ms):`,
          err instanceof Error ? err.message : err,
        )
      }
    }
    console.log(`[listProjectsCDP] Step 3 done in ${Date.now() - t2}ms`)
    console.log(
      `[listProjectsCDP] Total: ${Date.now() - t0}ms — ${projects.length} projects synced`,
    )

    return projects
  } catch (err) {
    console.error(`[listProjectsCDP] FAILED after ${Date.now() - t0}ms:`, err)
    return []
  }
}

/**
 * Click a conversation in Antigravity sidebar by title, then extract its UUID from the URL.
 */
async function resolveConversationIdViaCDP(
  convTitle: string,
): Promise<{ id: string; error?: string }> {
  console.log('[resolveConvCDP] Resolving title:', convTitle)
  try {
    let resolvedId = ''

    await cdpSession(async (send) => {
      await send('Runtime.enable')

      // Click the conversation by its title in the sidebar
      const clickRes = await send('Runtime.evaluate', {
        expression: `(function() {
          var convSpans = document.querySelectorAll('span.truncate.inline-block.text-sm.text-left');
          var titles = [];
          for (var i = 0; i < convSpans.length; i++) {
            var t = (convSpans[i].textContent || '').trim();
            titles.push(t);
            if (t === ${JSON.stringify(convTitle)}) {
              var row = convSpans[i].closest('.select-none.cursor-pointer') || convSpans[i].parentElement;
              if (row) { row.click(); return JSON.stringify({status:'clicked', allTitles: titles}); }
            }
          }
          return JSON.stringify({status:'not_found', allTitles: titles});
        })()`,
        returnByValue: true,
      })

      const clickResult = JSON.parse(clickRes.result?.result?.value || '{}')
      console.log(
        '[resolveConvCDP] Click result:',
        clickResult.status,
        'found',
        clickResult.allTitles?.length,
        'titles',
      )

      if (clickResult.status === 'not_found') {
        console.log('[resolveConvCDP] Titles in sidebar:', clickResult.allTitles?.slice(0, 5))
        return
      }

      // Wait for URL to update
      await new Promise((r) => setTimeout(r, 800))

      // Extract UUID from URL: /c/UUID?section=...
      const urlRes = await send('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true,
      })

      const url = urlRes.result?.result?.value || ''
      console.log('[resolveConvCDP] URL after click:', url)
      const match = url.match(/\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)
      if (match) {
        resolvedId = match[1]
        titleToIdCache.set(convTitle, resolvedId)
        // Evict oldest entries when cache grows too large
        while (titleToIdCache.size > MAX_TITLE_CACHE_SIZE) {
          const firstKey = titleToIdCache.keys().next().value
          if (firstKey) titleToIdCache.delete(firstKey)
          else break
        }
        console.log('[resolveConvCDP] Resolved ID:', resolvedId)
      } else {
        console.log('[resolveConvCDP] No UUID in URL')
      }
    })

    return { id: resolvedId }
  } catch (err) {
    console.error('[resolveConvCDP] Error:', err)
    return { id: '', error: String(err) }
  }
}

/**
 * Setup all Antigravity-related IPC handlers
 */
export function setupAntigravityIPC(): void {
  ipcMain.handle('antigravity:list-conversations', async () => {
    try {
      const convs = await listConversations()
      return convs
    } catch (err) {
      console.error('IPC handler antigravity:list-conversations error:', err)
      return []
    }
  })

  ipcMain.handle('antigravity:list-projects', async () => {
    try {
      const [dbProjects, conversations] = await Promise.all([
        getProjectsFromDb(),
        listConversations(),
      ])
      const convByProject = new Map<string, typeof conversations>()
      for (const conv of conversations) {
        const key = conv.project || 'Other'
        if (!convByProject.has(key)) convByProject.set(key, [])
        convByProject.get(key)!.push(conv)
      }
      return dbProjects.map((p) => ({
        projectId: p.projectId,
        name: p.name,
        path: p.path,
        conversations: (convByProject.get(p.name) || []).slice(0, 5),
      }))
    } catch (err) {
      console.error('IPC handler antigravity:list-projects error:', err)
      return []
    }
  })

  ipcMain.handle('antigravity:list-projects-cdp', async () => {
    try {
      return await listProjectsViaCDP()
    } catch (err) {
      console.error('IPC handler antigravity:list-projects-cdp error:', err)
      return []
    }
  })

  ipcMain.handle(
    'antigravity:get-transcript',
    async (_event, conversationId: string, options?: { maxSteps?: number; onlyChat?: boolean }) => {
      return getTranscript(conversationId, options)
    },
  )

  ipcMain.handle(
    'antigravity:send-message',
    async (_event, conversationId: string, content: string, workspacePath?: string) => {
      return sendMessage(conversationId, content, workspacePath)
    },
  )

  ipcMain.handle('antigravity:resolve-conversation-cdp', async (_event, convTitle: string) => {
    return resolveConversationIdViaCDP(convTitle)
  })

  ipcMain.handle('antigravity:type-message-cdp', async (_event, message: string) => {
    return typeMessageViaCDP(message)
  })

  ipcMain.handle('antigravity:open-app', async () => {
    return openAntigravityApp()
  })

  ipcMain.handle('antigravity:ensure-running', async () => {
    try {
      const target = await resolveCDPTarget()
      if (target) {
        return { status: 'already-running' as const }
      }
      await openAntigravityApp()
      return { status: 'launched' as const }
    } catch {
      await openAntigravityApp()
      return { status: 'launched' as const }
    }
  })

  ipcMain.handle('antigravity:select-folder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Project Directory',
        buttonLabel: 'Select Folder',
      })
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      return result.filePaths[0]
    } catch (err) {
      console.error('Failed to open directory dialog:', err)
      return null
    }
  })

  ipcMain.handle(
    'antigravity:send-message-cdp',
    async (_event, projectName: string, message: string) => {
      try {
        return await sendMessageViaCDP(projectName, message)
      } catch (err) {
        console.error('IPC handler antigravity:send-message-cdp error:', err)
        return { success: false, error: String(err) }
      }
    },
  )

  ipcMain.handle('antigravity:sync-projects', async () => {
    return syncProjectsToDb()
  })

  ipcMain.handle('antigravity:get-projects-db', () => {
    return getProjectsFromDb()
  })

  // On startup: ensure Antigravity is running with CDP, then sync projects
  setTimeout(async () => {
    try {
      let target = await resolveCDPTarget()
      if (!target) {
        console.log('[startup] Antigravity not running, launching with CDP port...')
        await openAntigravityApp()
        // Poll for CDP to become available (up to 15s)
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 500))
          target = await resolveCDPTarget()
          if (target) break
        }
      }
      if (target) {
        console.log('[startup] Antigravity CDP ready, syncing projects...')
        await syncProjectsToDb()
      } else {
        console.warn('[startup] Antigravity CDP not available after waiting, skipping sync')
      }
    } catch (err) {
      console.error('[startup] Failed to ensure Antigravity running:', err)
    }
  }, 2000)
}

/**
 * Sync Antigravity projects into the Dev Life database.
 * Uses CDP to read real projects from Antigravity sidebar.
 * Falls back to extracting unique projects from conversations if CDP fails.
 */
export async function syncProjectsToDb(): Promise<{
  success: boolean
  count: number
  error?: string
}> {
  try {
    const sqlite = getSqlite()
    let projects: { name: string; projectId: string; path: string }[] = []
    let cdpProjects: any[] = []

    // Read real project list from Antigravity sidebar via CDP
    try {
      cdpProjects = await listProjectsViaCDP()
      if (cdpProjects && cdpProjects.length > 0) {
        const knownProjects = await getKnownProjects()
        projects = cdpProjects.map((p) => {
          const known = knownProjects.find((kp) => kp.name === p.name)
          return { name: p.name, projectId: p.projectId, path: known ? known.path : '' }
        })
      }
    } catch {
      // CDP failed — auto-open Antigravity and retry
      await openAntigravityApp()
      await new Promise((r) => setTimeout(r, 5000))
      try {
        cdpProjects = await listProjectsViaCDP()
        if (cdpProjects && cdpProjects.length > 0) {
          const knownProjects = await getKnownProjects()
          projects = cdpProjects.map((p) => {
            const known = knownProjects.find((kp) => kp.name === p.name)
            return { name: p.name, projectId: p.projectId, path: known ? known.path : '' }
          })
        }
      } catch {
        // Still failed
      }
    }

    if (projects.length === 0) {
      return { success: false, count: 0, error: 'Could not read projects from Antigravity' }
    }

    const upsert = sqlite.prepare(`
      INSERT INTO antigravity_projects (name, project_id, path, synced_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET project_id = excluded.project_id, path = excluded.path, synced_at = datetime('now')
    `)

    const upsertConv = sqlite.prepare(`
      INSERT INTO antigravity_conversations (conversation_id, project_name, synced_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(conversation_id) DO UPDATE SET project_name = excluded.project_name, synced_at = datetime('now')
    `)

    const syncMany = sqlite.transaction(
      (
        projectItems: { name: string; projectId: string; path: string }[],
        rawCdpProjects: typeof cdpProjects,
      ) => {
        sqlite.prepare('DELETE FROM antigravity_projects').run()
        for (const item of projectItems) {
          upsert.run(item.name, item.projectId, item.path)
        }

        // Save conversation mappings
        for (const p of rawCdpProjects) {
          for (const c of p.conversations) {
            if (c.id) {
              upsertConv.run(c.id, p.name)
            }
          }
        }
      },
    )

    syncMany(projects, cdpProjects)
    console.log(`[antigravity] Synced ${projects.length} projects and conversation mappings to DB`)
    return { success: true, count: projects.length }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.error('[antigravity] Failed to sync projects:', msg)
    return { success: false, count: 0, error: msg }
  }
}

/**
 * Read projects from the Dev Life database (cached from last sync).
 */
export function getProjectsFromDb(): {
  name: string
  projectId: string
  path: string
  syncedAt: string
}[] {
  try {
    const sqlite = getSqlite()
    const rows = sqlite
      .prepare('SELECT name, project_id, path, synced_at FROM antigravity_projects ORDER BY name')
      .all() as { name: string; project_id: string; path: string; synced_at: string }[]
    return rows.map((r) => ({
      name: r.name,
      projectId: r.project_id,
      path: r.path,
      syncedAt: r.synced_at,
    }))
  } catch {
    return []
  }
}

/**
 * CDP session helper for multi-command WebSocket scenarios.
 */
async function cdpSession(
  fn: (send: (method: string, params?: Record<string, unknown>) => Promise<any>) => Promise<void>,
  timeoutMs = 30000,
): Promise<void> {
  const target = await resolveCDPTarget()
  if (!target) throw new Error('Antigravity CDP target not found')

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.wsUrl)
    let cmdId = 0
    const pending = new Map<number, { resolve: (v: any) => void }>()
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('CDP session timed out'))
    }, timeoutMs)

    const send = (method: string, params: Record<string, unknown> = {}): Promise<any> =>
      new Promise((res) => {
        const id = ++cmdId
        pending.set(id, { resolve: res })
        ws.send(JSON.stringify({ id, method, params }))
      })

    ws.on('open', async () => {
      try {
        await fn(send)
        clearTimeout(timer)
        ws.close()
        resolve()
      } catch (err) {
        clearTimeout(timer)
        ws.close()
        reject(err)
      }
    })

    ws.on('message', (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString())
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)!.resolve(msg)
        pending.delete(msg.id)
      }
    })

    ws.on('error', (err: Error) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * Type a message into Antigravity chat using native CDP key events and press Enter.
 * Antigravity uses Lexical editor which only responds to native Input.dispatchKeyEvent.
 */
export async function sendMessageViaCDP(
  projectName: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    let result: { success: boolean; error?: string } = { success: false, error: '' }

    await cdpSession(async (send) => {
      await send('Runtime.enable')

      // Step 1: Click the project name to SELECT it first
      const selectRes = await send('Runtime.evaluate', {
        expression: `(function() {
          var nodes = document.querySelectorAll('div.text-sm.font-medium.truncate.m-0');
          for (var i = 0; i < nodes.length; i++) {
            if ((nodes[i].textContent || '').trim() === ${JSON.stringify(projectName)}) {
              var t = nodes[i].closest('button') || nodes[i];
              t.click();
              return 'selected';
            }
          }
          return 'not_found';
        })()`,
        returnByValue: true,
      })

      if (selectRes.result?.result?.value === 'not_found') {
        result = { success: false, error: `Project "${projectName}" not found` }
        return
      }

      // Wait for project to be selected
      await new Promise((r) => setTimeout(r, 500))

      // Step 2: Click the "+" (New Conversation) button for this project
      await send('Runtime.evaluate', {
        expression: `(function() {
          var nodes = document.querySelectorAll('div.text-sm.font-medium.truncate.m-0');
          for (var i = 0; i < nodes.length; i++) {
            if ((nodes[i].textContent || '').trim() === ${JSON.stringify(projectName)}) {
              var header = nodes[i];
              for (var d = 0; d < 5; d++) { if (header.parentElement) header = header.parentElement; }
              var btns = header.querySelectorAll('button');
              for (var j = 0; j < btns.length; j++) {
                var path = btns[j].querySelector('path');
                if (path && (path.getAttribute('d') || '').startsWith('M450-450')) {
                  var parent = btns[j].parentElement;
                  if (parent) parent.style.display = 'flex';
                  btns[j].click();
                  return 'new_conv_clicked';
                }
              }
              return 'plus_not_found';
            }
          }
          return 'not_found';
        })()`,
        returnByValue: true,
      })

      // Wait for new conversation UI to load
      await new Promise((r) => setTimeout(r, 1000))

      // Focus the Lexical input
      const focusRes = await send('Runtime.evaluate', {
        expression: `(function() {
          var input = document.querySelector('[contenteditable="true"]');
          if (!input) return 'no_input';
          input.focus(); return 'focused';
        })()`,
        returnByValue: true,
      })

      if (focusRes.result?.result?.value === 'no_input') {
        result = { success: false, error: 'Chat input not found' }
        return
      }

      // Clear existing text: Cmd+A then Backspace
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        modifiers: 2,
      })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' })
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Backspace',
        code: 'Backspace',
      })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' })
      await new Promise((r) => setTimeout(r, 100))

      // Type using Input.insertText (avoids double-char issue with keyDown+char)
      await send('Input.insertText', { text: message })

      // Force Lexical/React state update by dispatching input event
      await send('Runtime.evaluate', {
        expression: `(function() {
          var input = document.querySelector('[contenteditable="true"]');
          if (!input) return 'no_input';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return 'dispatched';
        })()`,
        returnByValue: true,
      })

      await new Promise((r) => setTimeout(r, 200))

      // Press Enter to send
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' })

      result = { success: true }
    })

    return result
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

/**
 * Type a message into the currently active Antigravity conversation via CDP.
 * Assumes conversation is already open (e.g. via resolveConversationIdViaCDP).
 */
async function typeMessageViaCDP(message: string): Promise<{ success: boolean; error?: string }> {
  try {
    let result: { success: boolean; error?: string } = { success: false, error: '' }

    await cdpSession(async (send) => {
      await send('Runtime.enable')

      // Focus the Lexical input
      const focusRes = await send('Runtime.evaluate', {
        expression: `(function() {
          var input = document.querySelector('[contenteditable="true"]');
          if (!input) return 'no_input';
          input.focus(); return 'focused';
        })()`,
        returnByValue: true,
      })

      if (focusRes.result?.result?.value === 'no_input') {
        result = { success: false, error: 'Chat input not found' }
        return
      }

      // Clear + type
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        modifiers: 2,
      })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA' })
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Backspace',
        code: 'Backspace',
      })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' })
      await new Promise((r) => setTimeout(r, 100))

      await send('Input.insertText', { text: message })

      // Force Lexical/React state update by dispatching input event
      await send('Runtime.evaluate', {
        expression: `(function() {
          var input = document.querySelector('[contenteditable="true"]');
          if (!input) return 'no_input';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return 'dispatched';
        })()`,
        returnByValue: true,
      })

      await new Promise((r) => setTimeout(r, 200))

      // Press Enter to send
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' })

      result = { success: true }
    })

    return result
  } catch (err) {
    return { success: false, error: String(err) }
  }
}
