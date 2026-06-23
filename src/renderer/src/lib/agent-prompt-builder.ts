// ─── Agent Prompt Builder v2 ─────────────────────────────────────────────────
// Redesigned 3-layer prompt architecture:
// - Layer 1: System Prompt (invariant — identity + hard rules + output contract)
// - Layer 2: Developer Prompt (semi-dynamic — guide + context + grounding)
// - Layer 3: User Prompt (dynamic — task + error analysis)
//
// Key improvements over v1:
// - All internal prompts in English
// - State extraction for conversation memory
// - Dynamic token allocation
// - Error analysis engine for self-healing retry
// - Priority-based guide compression
// - Robust XML parser with last-closing-tag strategy
// ─────────────────────────────────────────────────────────────────────────────

import {
  CODE_PATTERN_REFERENCE,
  EDIT_FIX_BUG,
  EDIT_MAJOR,
  EDIT_SMALL,
  FALLBACK_GUIDE,
  GROUNDING_RULES,
  SYSTEM_HARD_RULES,
  SYSTEM_IDENTITY,
  SYSTEM_OUTPUT_CONTRACT,
} from './prompt-templates'

// ─── Types ───────────────────────────────────────────────────────────────────

export type TaskType = 'create' | 'edit-small' | 'edit-major' | 'fix-bug'

export interface CodeContext {
  appName: string
  appDescription: string
  appIcon: string
  appVersion: string
  frontendCode: string
  backendCode: string
  panelCode: string
}

export interface ParsedAgentResponse {
  analysis: string
  metadata: { name: string; description: string; icon: string }
  frontendCode: string
  backendCode: string
  panelCode: string
}

export interface ErrorAnalysis {
  type: 'syntax' | 'structure' | 'banned_pattern' | 'api_surface' | 'parse_failure'
  message: string
  rootCause: string
  fixHint: string
}

export interface ConversationState {
  appName: string
  frontendFeatures: string[]
  backendFeatures: string[]
  panelFeatures: string[]
  previousDecisions: string[]
}

// ─── Token Estimation ────────────────────────────────────────────────────────
// Lightweight char-based heuristic (~3.5 chars/token for mixed code + English).
// Avoids adding tiktoken dependency while providing reasonable estimates.

function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.5)
}

interface TokenBudget {
  total: number
  systemUsed: number
  guideAvailable: number
  codeAvailable: number
  outputReserved: number
}

function calculateTokenBudget(
  modelMaxTokens: number,
  taskType: TaskType,
  existingCodeLength: number,
): TokenBudget {
  const systemUsed = 800
  const outputReserved = taskType === 'create' ? 8000 : 5000
  const codeTokens = estimateTokens('x'.repeat(existingCodeLength))
  // Cap code at 30% of total to leave room for guide
  const codeAvailable = Math.min(codeTokens + 500, modelMaxTokens * 0.3)
  const guideAvailable = modelMaxTokens - systemUsed - outputReserved - codeAvailable

  return {
    total: modelMaxTokens,
    systemUsed,
    guideAvailable: Math.max(guideAvailable, 1000),
    codeAvailable,
    outputReserved,
  }
}

// ─── Task Detection (Multi-signal, Score-based) ──────────────────────────────

const BUG_SIGNALS = [
  /\b(lỗi|bug|fix|sửa lỗi|crash|error|broken|failed)\b/i,
  /\b(không (hoạt động|chạy|hiển thị|load|render|mở|đóng))\b/i,
  /\b(bị (hỏng|lỗi|treo|crash|sập|die))\b/i,
  /\b(throw|exception|undefined is not|null pointer|NaN|TypeError|ReferenceError)\b/i,
]

const SMALL_EDIT_SIGNALS = [
  /\b(thêm (nút|button|icon|tooltip)|đổi (màu|tên|text|placeholder|font))\b/i,
  /\b(sửa (padding|margin|border|style|text|typo)|thay đổi nhỏ)\b/i,
  /\b(rename|change colou?r|update (label|text)|fix (alignment|spacing|typo))\b/i,
  /\b(add (button|icon|tooltip|border|animation)|đổi placeholder)\b/i,
]

const MAJOR_EDIT_SIGNALS = [
  /\b(thêm (tính năng|feature|tab|page|section|form|table|modal|chức năng))\b/i,
  /\b(refactor|redesign|restructure|rewrite|overhaul|làm lại)\b/i,
  /\b(add (feature|section|component|api|endpoint|database|screen))\b/i,
  /\b(tích hợp|integrate|connect|hook up|xây dựng|build)\b/i,
]

export function detectTaskType(userPrompt: string, existingCode: CodeContext): TaskType {
  const hasCode = existingCode.frontendCode.trim().length > 0

  if (!hasCode) return 'create'

  // Score-based detection
  const scores: Record<string, number> = { 'fix-bug': 0, 'edit-small': 0, 'edit-major': 0 }

  for (const signal of BUG_SIGNALS) {
    if (signal.test(userPrompt)) scores['fix-bug'] += 2
  }
  for (const signal of SMALL_EDIT_SIGNALS) {
    if (signal.test(userPrompt)) scores['edit-small'] += 2
  }
  for (const signal of MAJOR_EDIT_SIGNALS) {
    if (signal.test(userPrompt)) scores['edit-major'] += 2
  }

  // Length heuristic: long prompts tend to describe major edits
  if (userPrompt.length > 200) scores['edit-major'] += 1
  if (userPrompt.length < 50) scores['edit-small'] += 1

  // Find highest score
  const entries = Object.entries(scores) as [string, number][]
  entries.sort((a, b) => b[1] - a[1])

  if (entries[0][1] > 0) return entries[0][0] as TaskType
  return 'edit-major'
}

// ─── Conversation State Extraction ───────────────────────────────────────────
// Extracts structured state from existing code + chat history
// for multi-turn conversation memory management.

export function extractConversationState(
  codeContext: CodeContext,
  chatHistory: Array<{ role: string; content: string }>,
): ConversationState {
  const state: ConversationState = {
    appName: codeContext.appName || 'Unnamed App',
    frontendFeatures: [],
    backendFeatures: [],
    panelFeatures: [],
    previousDecisions: [],
  }

  // Lightweight static analysis of existing code
  if (codeContext.frontendCode) {
    const fc = codeContext.frontendCode
    if (/useState/.test(fc)) state.frontendFeatures.push('stateful component')
    if (/ctx\.ipc/.test(fc)) state.frontendFeatures.push('IPC communication')
    if (/ctx\.storage/.test(fc)) state.frontendFeatures.push('local storage')
    if (/ctx\.ui\.Modal/.test(fc)) state.frontendFeatures.push('modal dialogs')
    if (/ctx\.ui\.Table/.test(fc)) state.frontendFeatures.push('data table')
    if (/ctx\.ui\.Tabs/.test(fc)) state.frontendFeatures.push('tabbed interface')
    if (/ctx\.ui\.Card/.test(fc)) state.frontendFeatures.push('card layout')
    if (/ctx\.ui\.Drawer/.test(fc)) state.frontendFeatures.push('drawer panel')
    if (/ctx\.notify/.test(fc)) state.frontendFeatures.push('notifications')
    if (/overflow-y-auto/.test(fc)) state.frontendFeatures.push('scrollable content')
    if (/ctx\.ui\.message/.test(fc)) state.frontendFeatures.push('toast messages')
  }

  if (codeContext.backendCode) {
    const bc = codeContext.backendCode
    if (/ctx\.storage/.test(bc)) state.backendFeatures.push('storage enabled')
    if (/ctx\.db/.test(bc)) state.backendFeatures.push('SQLite database')
    if (/ctx\.fetch/.test(bc)) state.backendFeatures.push('external API calls')
    if (/ctx\.fs/.test(bc)) state.backendFeatures.push('filesystem access')
    if (/ctx\.shell/.test(bc)) state.backendFeatures.push('shell commands')
    if (/ctx\.require/.test(bc)) state.backendFeatures.push('npm packages')
    if (/ctx\.childProcess/.test(bc)) state.backendFeatures.push('child processes')
    if (/ctx\.clipboard/.test(bc)) state.backendFeatures.push('clipboard access')
  }

  if (codeContext.panelCode && codeContext.panelCode.trim().length > 0) {
    state.panelFeatures.push('tray panel widget')
    if (/ctx\.ipc/.test(codeContext.panelCode)) state.panelFeatures.push('panel IPC')
  }

  // Extract decisions from recent chat (last 5 messages)
  const recentMessages = chatHistory.slice(-5)
  for (const msg of recentMessages) {
    if (msg.role === 'user') {
      if (/tailwind/i.test(msg.content)) state.previousDecisions.push('use Tailwind CSS')
      if (/local\s*storage|localStorage/i.test(msg.content))
        state.previousDecisions.push('use local storage')
      if (/database|sqlite|db\b/i.test(msg.content))
        state.previousDecisions.push('use SQLite database')
      if (/dark\s*(mode|theme)/i.test(msg.content)) state.previousDecisions.push('dark theme only')
      if (/panel|tray/i.test(msg.content)) state.previousDecisions.push('has tray panel')
    }
  }

  return state
}

function formatConversationState(state: ConversationState): string {
  const parts: string[] = ['<conversation_state>', `Current App: ${state.appName}`]

  if (state.frontendFeatures.length > 0) {
    parts.push(`\nFrontend:\n${state.frontendFeatures.map((f) => `- ${f}`).join('\n')}`)
  }
  if (state.backendFeatures.length > 0) {
    parts.push(`\nBackend:\n${state.backendFeatures.map((f) => `- ${f}`).join('\n')}`)
  }
  if (state.panelFeatures.length > 0) {
    parts.push(`\nPanel:\n${state.panelFeatures.map((f) => `- ${f}`).join('\n')}`)
  }
  if (state.previousDecisions.length > 0) {
    const unique = [...new Set(state.previousDecisions)]
    parts.push(`\nPrevious Decisions:\n${unique.map((d) => `- ${d}`).join('\n')}`)
  }

  parts.push('</conversation_state>')
  return parts.join('\n')
}

// ─── Guide Compression (Priority-based) ──────────────────────────────────────

/**
 * Split guide text by H2 headings into a map of heading → content.
 */
function splitGuideByHeading(guide: string): Map<string, string> {
  const sections = new Map<string, string>()
  const lines = guide.split('\n')
  let currentHeading = '_INTRO_'
  let currentContent: string[] = []

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)$/)
    if (h2Match) {
      if (currentContent.length > 0) {
        sections.set(currentHeading, currentContent.join('\n').trim())
      }
      currentHeading = h2Match[1].trim()
      currentContent = []
    } else {
      currentContent.push(line)
    }
  }
  if (currentContent.length > 0) {
    sections.set(currentHeading, currentContent.join('\n').trim())
  }

  return sections
}

// Section keywords by priority tier
const PRIORITY_HIGH = ['Architecture', 'JavaScript Rules', 'Styling', 'Layout']
const PRIORITY_MEDIUM_CREATE = [
  'Frontend',
  'Backend',
  'Panel',
  'UI Component',
  'MCP API',
  'Complete Example',
]
const PRIORITY_MEDIUM_EDIT = ['Frontend', 'Backend', 'UI Component']
const PRIORITY_LOW = ['Checklist']

/**
 * Compress guide to fit within a token budget, selecting sections by priority.
 */
export function compressGuide(
  guide: string,
  taskType: TaskType,
  userPrompt: string,
  tokenBudget: number,
): string {
  if (!guide || guide.trim().length < 100) return FALLBACK_GUIDE
  if (estimateTokens(guide) <= tokenBudget) return guide

  const sections = splitGuideByHeading(guide)
  const lower = userPrompt.toLowerCase()
  const selected: Array<{ heading: string; content: string; priority: number }> = []

  const addMatchingSections = (keywords: string[], priority: number) => {
    for (const keyword of keywords) {
      for (const [heading, content] of sections) {
        if (heading.toLowerCase().includes(keyword.toLowerCase())) {
          if (!selected.some((s) => s.heading === heading)) {
            selected.push({ heading, content, priority })
          }
        }
      }
    }
  }

  // Always include high-priority
  addMatchingSections(PRIORITY_HIGH, 1)

  // Task-specific
  if (taskType === 'create') {
    addMatchingSections(PRIORITY_MEDIUM_CREATE, 2)
  } else {
    addMatchingSections(PRIORITY_MEDIUM_EDIT, 2)
    if (lower.includes('panel') || lower.includes('tray')) addMatchingSections(['Panel'], 2)
    if (
      lower.includes('backend') ||
      lower.includes('api') ||
      lower.includes('database') ||
      lower.includes('db')
    )
      addMatchingSections(['Backend'], 2)
    if (
      lower.includes('table') ||
      lower.includes('modal') ||
      lower.includes('form') ||
      lower.includes('ui')
    )
      addMatchingSections(['UI Component'], 2)
  }

  // Low priority
  addMatchingSections(PRIORITY_LOW, 3)

  // Sort by priority, pack within budget
  selected.sort((a, b) => a.priority - b.priority)

  const result: string[] = []
  let usedTokens = 0

  for (const section of selected) {
    const sectionText = `## ${section.heading}\n${section.content}`
    const sectionTokens = estimateTokens(sectionText)
    if (usedTokens + sectionTokens <= tokenBudget) {
      result.push(sectionText)
      usedTokens += sectionTokens
    }
  }

  return result.length > 0 ? result.join('\n\n---\n\n') : FALLBACK_GUIDE
}

// ─── Layer 1: System Prompt (Invariant) ──────────────────────────────────────

export function buildSystemPrompt(): string {
  return `<identity>
${SYSTEM_IDENTITY}
</identity>

<hard_rules>
${SYSTEM_HARD_RULES}
</hard_rules>

<output_contract>
${SYSTEM_OUTPUT_CONTRACT}
</output_contract>`
}

// ─── Layer 2: Developer Prompt (Semi-dynamic) ────────────────────────────────

export function buildDeveloperPrompt(
  guide: string,
  codeContext: CodeContext,
  taskType: TaskType,
  userPrompt: string,
  chatHistory?: Array<{ role: string; content: string }>,
  modelMaxTokens?: number,
): string {
  const maxTokens = modelMaxTokens || 16000

  // Calculate token budget
  const totalCodeLength =
    (codeContext.frontendCode?.length || 0) +
    (codeContext.backendCode?.length || 0) +
    (codeContext.panelCode?.length || 0)
  const budget = calculateTokenBudget(maxTokens, taskType, totalCodeLength)

  // Compress guide within budget
  const compressedGuide = compressGuide(guide, taskType, userPrompt, budget.guideAvailable)

  // Determine which guide to use (with fallback)
  const guideContent =
    compressedGuide && compressedGuide.trim().length > 100 ? compressedGuide : FALLBACK_GUIDE

  // Edit instructions (placed first for recency bias mitigation)
  const editInstructions = getEditInstructions(taskType)

  // Code context section
  const codeSection = buildCodeContextSection(codeContext, taskType)

  // Conversation state (multi-turn memory)
  const stateSection =
    chatHistory && chatHistory.length > 0
      ? formatConversationState(extractConversationState(codeContext, chatHistory))
      : ''

  // Code pattern reference (only for create and edit-major)
  const patternRef =
    taskType === 'create' || taskType === 'edit-major' ? CODE_PATTERN_REFERENCE : ''

  // ─── Assemble prompt with strategic ordering ───
  // Attention is highest at beginning and end (primacy + recency bias).
  // Place critical instructions at both positions.
  const parts: string[] = []

  // HIGH PRIORITY (beginning): edit mode instructions
  if (editInstructions) parts.push(editInstructions)

  // MEDIUM: guide
  parts.push(`## MINI APP DEVELOPMENT GUIDE\n<guide>\n${guideContent}\n</guide>`)

  // MEDIUM: current app info
  parts.push(`## CURRENT APP INFO
Name: "${codeContext.appName}"
Description: "${codeContext.appDescription}"
Icon: "${codeContext.appIcon}"
Version: "${codeContext.appVersion}"`)

  // MEDIUM: code context
  parts.push(codeSection)

  // MEDIUM: conversation state
  if (stateSection) parts.push(stateSection)

  // MEDIUM-LOW: pattern reference
  if (patternRef) parts.push(patternRef)

  // HIGH PRIORITY (end): grounding rules — placed last for recency in attention
  parts.push(GROUNDING_RULES)

  return parts.join('\n\n')
}

function getEditInstructions(taskType: TaskType): string {
  switch (taskType) {
    case 'fix-bug':
      return EDIT_FIX_BUG
    case 'edit-small':
      return EDIT_SMALL
    case 'edit-major':
      return EDIT_MAJOR
    case 'create':
      return ''
  }
}

function buildCodeContextSection(codeContext: CodeContext, taskType: TaskType): string {
  if (taskType === 'create') {
    return '## CURRENT SOURCE CODE\nNo existing code — creating from scratch.'
  }

  const parts: string[] = ['## CURRENT SOURCE CODE']

  if (codeContext.frontendCode) {
    const lineCount = codeContext.frontendCode.split('\n').length
    parts.push(
      `### Frontend (${lineCount} lines)\n\`\`\`javascript\n${codeContext.frontendCode}\n\`\`\``,
    )
  }

  if (codeContext.backendCode) {
    const lineCount = codeContext.backendCode.split('\n').length
    parts.push(
      `### Backend (${lineCount} lines)\n\`\`\`javascript\n${codeContext.backendCode}\n\`\`\``,
    )
  }

  if (codeContext.panelCode) {
    const lineCount = codeContext.panelCode.split('\n').length
    parts.push(`### Panel (${lineCount} lines)\n\`\`\`javascript\n${codeContext.panelCode}\n\`\`\``)
  }

  return parts.join('\n\n')
}

// ─── Layer 3: User Prompt (Dynamic) ──────────────────────────────────────────

export function buildUserPrompt(
  userMessage: string,
  _codeContext: CodeContext,
  taskType: TaskType,
  errorAnalysis?: ErrorAnalysis,
  attempt?: number,
): string {
  if (errorAnalysis) {
    return `<task attempt="${attempt ?? 1}" max_attempts="3">
<request>${userMessage}</request>
<task_type>${taskType}</task_type>
<previous_error>
<type>${errorAnalysis.type}</type>
<message>${errorAnalysis.message}</message>
<root_cause>${errorAnalysis.rootCause}</root_cause>
<fix_hint>${errorAnalysis.fixHint}</fix_hint>
</previous_error>
</task>

Analyze the error above carefully. Fix ONLY the identified issue and regenerate the complete corrected code.`
  }

  return `<task>
<request>${userMessage}</request>
<task_type>${taskType}</task_type>
</task>`
}

// ─── Error Analysis Engine ───────────────────────────────────────────────────
// Categorizes validation errors and provides structured root cause + fix hints
// for the self-healing retry loop.

export function analyzeValidationError(error: string, _code: string): ErrorAnalysis {
  // Structure violations — module.exports
  if (/module\.exports|missing module/i.test(error)) {
    return {
      type: 'structure',
      message: error,
      rootCause:
        'The LLM likely used ES module syntax (export default) instead of CommonJS (module.exports).',
      fixHint:
        'Replace any export/import with module.exports = function. Use CommonJS pattern ONLY. Rule R1/R2.',
    }
  }

  // Structure violations — import/export
  if (/import\s+|export\s+(default)?/i.test(error) && !/api/i.test(error)) {
    return {
      type: 'structure',
      message: error,
      rootCause:
        'import/export statements are not supported. Mini app code runs via Function constructor, not a module bundler.',
      fixHint:
        'Remove all import/export. Get everything from ctx: hooks from ctx, icons from ctx.icons, UI from ctx.ui. Rule R4.',
    }
  }

  // Banned patterns — createElement / h()
  if (/React\.createElement|ctx\.h\(\)|createElement|manual/i.test(error)) {
    return {
      type: 'banned_pattern',
      message: error,
      rootCause:
        'The LLM fell back to React.createElement instead of JSX. Sucrase handles JSX transpilation automatically.',
      fixHint:
        'Write JSX directly: <div> instead of React.createElement("div"). The runtime transpiler handles it. Rule R3.',
    }
  }

  // API surface violations
  if (/Frontend.*Backend|Backend.*Frontend|only exists in|chỉ có ở/i.test(error)) {
    const isFrontendError = /Frontend/i.test(error)
    return {
      type: 'api_surface',
      message: error,
      rootCause: isFrontendError
        ? 'Backend-only API was used in frontend code. These APIs require Node.js and are not available in the browser renderer.'
        : 'Frontend-only API was used in backend code. UI/rendering APIs only exist in the renderer process.',
      fixHint: isFrontendError
        ? 'Move this logic to backend code. Use ctx.ipc.send/on to communicate between frontend and backend.'
        : 'This API only exists in frontend. Backend cannot render UI — send data via ctx.ipc.send instead.',
    }
  }

  // JSX transpile errors
  if (/JSX|Transpile|sucrase/i.test(error)) {
    return {
      type: 'syntax',
      message: error,
      rootCause:
        'JSX syntax is malformed — likely unclosed tags, mismatched brackets, or invalid expressions inside JSX.',
      fixHint:
        'Check for: unclosed JSX tags, mismatched < >, expressions not wrapped in {}. Ensure every <Tag> has a matching </Tag> or is self-closing <Tag />.',
    }
  }

  // Hook source violations
  if (/React\.(useState|useEffect|useRef)/i.test(error)) {
    return {
      type: 'structure',
      message: error,
      rootCause:
        'Hooks were accessed directly from React instead of from ctx. In the mini app runtime, React is not directly importable.',
      fixHint: 'Use: const { useState, useEffect } = ctx — NOT React.useState. Rule R5.',
    }
  }

  // JS syntax errors
  if (/syntax|SyntaxError|Unexpected token/i.test(error)) {
    return {
      type: 'syntax',
      message: error,
      rootCause:
        'JavaScript syntax error — likely unterminated string, missing bracket, or invalid expression.',
      fixHint:
        'Check for: unterminated strings, missing }, ), or ]. Verify all async/await pairs are valid.',
    }
  }

  // Parse failure (XML format)
  if (/format|XML|parse|không theo đúng/i.test(error)) {
    return {
      type: 'parse_failure',
      message: error,
      rootCause: 'LLM output did not follow the required XML-tagged format.',
      fixHint:
        'Return code inside XML tags: <frontend>...</frontend>, <backend>...</backend>, <panel>...</panel>, <metadata>...</metadata>. Do NOT use ``` code blocks inside tags.',
    }
  }

  // Generic fallback
  return {
    type: 'syntax',
    message: error,
    rootCause: 'Validation error occurred.',
    fixHint: `Fix the reported error: ${error}. Ensure all hard rules R1-R10 are followed.`,
  }
}

// ─── XML Response Parser (Robust) ────────────────────────────────────────────
// Uses last-closing-tag strategy to handle code containing strings
// that resemble closing tags (e.g. "</frontend>" in a string literal).

/**
 * Extract content inside an XML tag.
 * Strategy: find the FIRST opening tag and the LAST closing tag
 * to handle edge cases where code contains closing-tag-like strings.
 */
function extractXmlTag(raw: string, tag: string): string {
  const openPattern = new RegExp(`<${tag}>`, 'i')
  const closePattern = new RegExp(`</${tag}>`, 'gi')

  const openMatch = openPattern.exec(raw)
  if (!openMatch) return ''

  const startIdx = openMatch.index + openMatch[0].length

  // Find the LAST occurrence of the closing tag (greedy)
  let lastCloseIdx = -1
  let match: RegExpExecArray | null
  while ((match = closePattern.exec(raw)) !== null) {
    lastCloseIdx = match.index
  }

  if (lastCloseIdx === -1 || lastCloseIdx <= startIdx) return ''

  return raw.substring(startIdx, lastCloseIdx).trim()
}

/**
 * Remove markdown code block wrapper if LLM wraps code despite instructions.
 */
function cleanCodeBlock(code: string): string {
  if (!code) return ''
  return code
    .replace(/^```(?:javascript|jsx|js|typescript|tsx)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim()
}

/**
 * Parse metadata in key: value format (simple YAML-like).
 */
function parseMetadata(raw: string): { name: string; description: string; icon: string } {
  const defaults = { name: '', description: '', icon: 'Box' }
  if (!raw) return defaults

  const result = { ...defaults }
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([\w]+)\s*:\s*(.+)\s*$/)
    if (match) {
      const key = match[1].toLowerCase()
      const value = match[2].trim()
      if (key === 'name') result.name = value
      else if (key === 'description') result.description = value
      else if (key === 'icon') result.icon = value
    }
  }

  return result
}

/**
 * Main response parser: XML format primary, JSON fallback.
 */
export function parseAgentResponse(raw: string): ParsedAgentResponse | null {
  // === Try XML format first ===
  const frontendXml = extractXmlTag(raw, 'frontend')
  const metadataXml = extractXmlTag(raw, 'metadata')
  const hasXmlFormat = frontendXml.length > 0 || metadataXml.length > 0

  if (hasXmlFormat) {
    const analysis = extractXmlTag(raw, 'analysis')
    const metadata = parseMetadata(metadataXml)
    const frontendCode = cleanCodeBlock(frontendXml)
    const backendCode = cleanCodeBlock(extractXmlTag(raw, 'backend'))
    const panelCode = cleanCodeBlock(extractXmlTag(raw, 'panel'))

    // Validate: at least frontend code or metadata name must exist
    if (frontendCode || metadata.name) {
      return { analysis, metadata, frontendCode, backendCode, panelCode }
    }
  }

  // === Fallback: JSON format (backward compatibility) ===
  return parseJsonFallback(raw)
}

/**
 * Fallback parser: extract and parse JSON from response.
 * Preserved from v1 for backward compatibility with older LLM outputs.
 */
function parseJsonFallback(raw: string): ParsedAgentResponse | null {
  try {
    const jsonText = extractJsonFromText(raw)
    if (!jsonText) return null

    let parsed: any
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      const repaired = repairJson(jsonText)
      parsed = JSON.parse(repaired)
    }

    if (!parsed || typeof parsed !== 'object') return null

    return {
      analysis: parsed.thought || parsed.analysis || '',
      metadata: {
        name: parsed.name || '',
        description: parsed.description || '',
        icon: parsed.icon || 'Box',
      },
      frontendCode: parsed.frontendCode || '',
      backendCode: parsed.backendCode || '',
      panelCode: parsed.panelCode || '',
    }
  } catch {
    return null
  }
}

// ─── JSON Utilities (preserved for fallback) ─────────────────────────────────

function extractJsonFromText(str: string): string | null {
  let cleaned = str.trim()
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.substring(7)
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.substring(3)
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.substring(0, cleaned.length - 3)
  }
  cleaned = cleaned.trim()

  const firstOpen = cleaned.indexOf('{')
  const lastClose = cleaned.lastIndexOf('}')
  if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
    return cleaned.substring(firstOpen, lastClose + 1)
  }
  return null
}

/**
 * Repair common JSON errors from LLMs:
 * - Trailing commas
 * - Unclosed brackets
 * - Unclosed strings
 * - Invalid control characters
 */
function repairJson(raw: string): string {
  let json = raw

  // 1. Remove invalid control characters
  json = json.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')

  // 2. Fix trailing commas before } or ]
  json = json.replace(/,\s*([}\]])/g, '$1')

  // 3. Count brackets to fix truncated JSON
  let braceOpen = 0
  let bracketOpen = 0
  let inString = false
  let isEscaped = false

  for (let i = 0; i < json.length; i++) {
    const ch = json[i]
    if (isEscaped) {
      isEscaped = false
      continue
    }
    if (ch === '\\') {
      if (inString) isEscaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') braceOpen++
    else if (ch === '}') braceOpen--
    else if (ch === '[') bracketOpen++
    else if (ch === ']') bracketOpen--
  }

  if (inString) json += '"'
  json = json.replace(/,\s*$/, '')

  while (bracketOpen > 0) {
    json += ']'
    bracketOpen--
  }
  while (braceOpen > 0) {
    json += '}'
    braceOpen--
  }

  json = json.replace(/,\s*([}\]])/g, '$1')

  return json
}
