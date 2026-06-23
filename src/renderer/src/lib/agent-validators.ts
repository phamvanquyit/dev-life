// ─── Agent Validators ────────────────────────────────────────────────────────
// Module chứa các validator cho code sinh bởi AI Agent.
// Bao gồm: syntax check, banned patterns, API surface, icon validation.
// ─────────────────────────────────────────────────────────────────────────────

import { transpileCode } from './miniapp-helpers'

// ─── Banned Patterns ─────────────────────────────────────────────────────────
// LLM không được sử dụng các hàm tạo phần tử thủ công.

const BANNED_PATTERNS = [
  { pattern: /\bctx\.h\s*\(/, label: 'ctx.h()' },
  { pattern: /\bReact\.createElement\s*\(/, label: 'React.createElement()' },
  { pattern: /(?:^|[^a-zA-Z0-9_$.])h\s*\(/, label: 'h()' },
]

// ─── Valid Icon Names ────────────────────────────────────────────────────────
// Top 120+ icon names phổ biến trong lucide-react.

const VALID_ICONS = new Set([
  'Activity',
  'AlertCircle',
  'AlertTriangle',
  'Archive',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Award',
  'BarChart',
  'BarChart2',
  'Battery',
  'Bell',
  'Bluetooth',
  'Bold',
  'Book',
  'Bookmark',
  'Box',
  'Briefcase',
  'Calendar',
  'Camera',
  'Check',
  'CheckCircle',
  'CheckSquare',
  'ChevronDown',
  'ChevronLeft',
  'ChevronRight',
  'ChevronUp',
  'Circle',
  'Clipboard',
  'Clock',
  'Cloud',
  'Code',
  'Code2',
  'Coffee',
  'Command',
  'Compass',
  'Copy',
  'Cpu',
  'CreditCard',
  'Crosshair',
  'Database',
  'Download',
  'Droplet',
  'Edit',
  'Edit2',
  'ExternalLink',
  'Eye',
  'EyeOff',
  'File',
  'FileCode',
  'FileJson',
  'FileText',
  'Film',
  'Filter',
  'Flag',
  'Flame',
  'Folder',
  'Gauge',
  'Gift',
  'GitBranch',
  'Globe',
  'Grid',
  'HardDrive',
  'Hash',
  'Heart',
  'HelpCircle',
  'Home',
  'Image',
  'Inbox',
  'Info',
  'Key',
  'Layers',
  'Layout',
  'LifeBuoy',
  'Link',
  'List',
  'ListTodo',
  'Loader2',
  'Lock',
  'LogIn',
  'LogOut',
  'Mail',
  'Map',
  'MapPin',
  'Menu',
  'MessageCircle',
  'MessageSquare',
  'Mic',
  'Monitor',
  'Moon',
  'MoreHorizontal',
  'MoreVertical',
  'Music',
  'Navigation',
  'Package',
  'Palette',
  'Paperclip',
  'Pause',
  'Pen',
  'Phone',
  'PieChart',
  'Pin',
  'Play',
  'Plus',
  'Power',
  'Printer',
  'Radio',
  'RefreshCw',
  'Repeat',
  'RotateCw',
  'Rss',
  'Save',
  'Scissors',
  'Search',
  'Send',
  'Server',
  'Settings',
  'Share',
  'Shield',
  'ShoppingBag',
  'ShoppingCart',
  'Sidebar',
  'Smartphone',
  'Sparkles',
  'Speaker',
  'Square',
  'Star',
  'StickyNote',
  'Sun',
  'Table',
  'Tag',
  'Target',
  'Terminal',
  'Thermometer',
  'ThumbsUp',
  'Timer',
  'ToggleLeft',
  'Tool',
  'Trash',
  'Trash2',
  'TrendingDown',
  'TrendingUp',
  'Truck',
  'Tv',
  'Type',
  'Umbrella',
  'Upload',
  'User',
  'UserPlus',
  'Users',
  'Video',
  'Volume2',
  'Wallet',
  'Watch',
  'Wifi',
  'Wind',
  'X',
  'XCircle',
  'Zap',
  'ZoomIn',
  'ZoomOut',
])

// ─── Frontend Forbidden APIs ─────────────────────────────────────────────────
// API chỉ tồn tại ở Backend, nếu xuất hiện trong Frontend → LLM ảo giác.

const FRONTEND_FORBIDDEN_APIS = [
  { pattern: /ctx\.db\b/, label: 'ctx.db (chỉ có ở Backend)' },
  { pattern: /ctx\.require\b/, label: 'ctx.require (chỉ có ở Backend)' },
  { pattern: /ctx\.fs\b/, label: 'ctx.fs (chỉ có ở Backend)' },
  { pattern: /ctx\.path\b/, label: 'ctx.path (chỉ có ở Backend)' },
  { pattern: /ctx\.childProcess\b/, label: 'ctx.childProcess (chỉ có ở Backend)' },
  { pattern: /ctx\.shell\b/, label: 'ctx.shell (chỉ có ở Backend)' },
  { pattern: /ctx\.dialog\b/, label: 'ctx.dialog (chỉ có ở Backend)' },
  { pattern: /ctx\.clipboard\b/, label: 'ctx.clipboard (chỉ có ở Backend)' },
]

// ─── Backend Forbidden APIs ──────────────────────────────────────────────────
// API chỉ tồn tại ở Frontend, nếu xuất hiện trong Backend → LLM ảo giác.

const BACKEND_FORBIDDEN_APIS = [
  { pattern: /ctx\.icons\b/, label: 'ctx.icons (chỉ có ở Frontend)' },
  { pattern: /ctx\.ui\b/, label: 'ctx.ui (chỉ có ở Frontend)' },
  { pattern: /ctx\.media\b/, label: 'ctx.media (chỉ có ở Frontend)' },
  { pattern: /ctx\.notify\b/, label: 'ctx.notify (chỉ có ở Frontend)' },
  { pattern: /ctx\.React\b/, label: 'ctx.React (chỉ có ở Frontend)' },
]

// ─── Structural Validators (new — catch common LLM mistakes early) ────────────

/**
 * Validate module export structure.
 * Frontend/Panel must export a function component.
 * Backend must export an async setup function.
 */
function validateModuleStructure(
  code: string,
  type: 'frontend' | 'backend' | 'panel',
): string | null {
  if (!code.trim()) return null

  if (!code.includes('module.exports')) {
    return (
      `${type} code is missing module.exports. ` +
      (type === 'backend'
        ? 'Backend must use: module.exports = async function setup(ctx) { ... return () => {} }'
        : `${type} must use: module.exports = function Name({ ctx }) { ... }`)
    )
  }

  if (type === 'frontend' || type === 'panel') {
    if (!/module\.exports\s*=\s*function/.test(code)) {
      return `${type} must export a function component: module.exports = function Name({ ctx }) { ... }`
    }
  }

  return null
}

/**
 * Detect import/export statements that are not supported in mini app runtime.
 * Only checks top-level patterns, not strings/comments.
 */
function validateNoImportExport(code: string, type: string): string | null {
  const importMatch = code.match(/^\s*(import\s+[\s\S]*?from\s+['"]|import\s*\()/m)
  if (importMatch) {
    return `Detected "${importMatch[0].trim()}" in ${type} — Mini Apps do NOT support import/export. Use ctx object instead.`
  }
  const exportMatch = code.match(/^\s*(export\s+(default\s+)?)/m)
  if (exportMatch) {
    return `Detected "${exportMatch[0].trim()}" in ${type} — Use module.exports instead of export.`
  }
  return null
}

/**
 * Ensure React hooks are accessed from ctx, not from React directly.
 */
function validateHookSource(code: string, type: string): string | null {
  const directHooks = code.match(/\bReact\.(useState|useEffect|useRef|useCallback|useMemo)\b/)
  if (directHooks) {
    return `Detected "${directHooks[0]}" in ${type} — Hooks must come from ctx, not React directly. Use: const { ${directHooks[1]} } = ctx`
  }
  return null
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Validate cú pháp code (banned patterns + JSX transpile + JS syntax).
 * Trả về null nếu hợp lệ, hoặc chuỗi mô tả lỗi.
 */
export function validateCodeSyntax(
  frontend: string,
  backend: string,
  panel: string,
): string | null {
  // 1. Validate Frontend Banned Patterns + Transpile
  if (frontend) {
    for (const { pattern, label } of BANNED_PATTERNS) {
      if (pattern.test(frontend)) {
        return `Lỗi Frontend: Phát hiện gọi hàm tạo phần tử thủ công bị cấm (${label}). Mini App bắt buộc sử dụng cú pháp JSX.`
      }
    }
    try {
      transpileCode(frontend)
    } catch (e: any) {
      return `Lỗi Frontend (JSX Transpile): ${e.message || String(e)}`
    }
  }

  // 2. Validate Panel Banned Patterns + Transpile
  if (panel) {
    for (const { pattern, label } of BANNED_PATTERNS) {
      if (pattern.test(panel)) {
        return `Lỗi Panel: Phát hiện gọi hàm tạo phần tử thủ công bị cấm (${label}). Panel bắt buộc sử dụng cú pháp JSX.`
      }
    }
    try {
      transpileCode(panel)
    } catch (e: any) {
      return `Lỗi Panel (JSX Transpile): ${e.message || String(e)}`
    }
  }

  // 3. Validate Backend JS Syntax
  if (backend) {
    try {
      new Function(backend)
    } catch (e: any) {
      return `Lỗi Backend (Cú pháp JS): ${e.message || String(e)}`
    }
  }

  return null
}

/**
 * Validate API usage — kiểm tra LLM không gọi API cross-layer.
 * Trả về null nếu hợp lệ, hoặc chuỗi mô tả lỗi.
 */
export function validateApiUsage(frontend: string, backend: string): string | null {
  if (frontend) {
    for (const { pattern, label } of FRONTEND_FORBIDDEN_APIS) {
      if (pattern.test(frontend)) {
        return `Lỗi Frontend: Gọi API không tồn tại ở Frontend — ${label}. Hãy di chuyển logic này sang Backend và giao tiếp qua ctx.ipc.`
      }
    }
  }

  if (backend) {
    for (const { pattern, label } of BACKEND_FORBIDDEN_APIS) {
      if (pattern.test(backend)) {
        return `Lỗi Backend: Gọi API không tồn tại ở Backend — ${label}. API này chỉ có trong Frontend.`
      }
    }
  }

  return null
}

/**
 * Validate và normalize icon name.
 * Trả về icon name hợp lệ (có thể fuzzy match) hoặc 'Box' nếu không tìm thấy.
 */
export function validateIcon(icon: string): string {
  if (!icon || icon.trim().length === 0) return 'Box'

  const trimmed = icon.trim()

  // Exact match
  if (VALID_ICONS.has(trimmed)) return trimmed

  // Case-insensitive match
  const lower = trimmed.toLowerCase()
  for (const valid of VALID_ICONS) {
    if (valid.toLowerCase() === lower) return valid
  }

  // Bỏ khoảng trắng và thử lại (LLM đôi khi viết "Sticky Note" thay vì "StickyNote")
  const noSpace = trimmed.replace(/\s+/g, '')
  if (VALID_ICONS.has(noSpace)) return noSpace
  for (const valid of VALID_ICONS) {
    if (valid.toLowerCase() === noSpace.toLowerCase()) return valid
  }

  // Fallback
  return 'Box'
}

/**
 * Chạy toàn bộ pipeline validation.
 * Trả về null nếu tất cả hợp lệ, hoặc chuỗi mô tả lỗi đầu tiên tìm thấy.
 */
export function runFullValidation(frontend: string, backend: string, panel: string): string | null {
  // 0. Structural checks (module.exports, import/export, hook source)
  if (frontend) {
    const structErr = validateModuleStructure(frontend, 'frontend')
    if (structErr) return structErr
    const importErr = validateNoImportExport(frontend, 'frontend')
    if (importErr) return importErr
    const hookErr = validateHookSource(frontend, 'frontend')
    if (hookErr) return hookErr
  }
  if (backend) {
    const structErr = validateModuleStructure(backend, 'backend')
    if (structErr) return structErr
    const importErr = validateNoImportExport(backend, 'backend')
    if (importErr) return importErr
  }
  if (panel) {
    const structErr = validateModuleStructure(panel, 'panel')
    if (structErr) return structErr
    const importErr = validateNoImportExport(panel, 'panel')
    if (importErr) return importErr
    const hookErr = validateHookSource(panel, 'panel')
    if (hookErr) return hookErr
  }

  // 1. Syntax + banned patterns
  const syntaxError = validateCodeSyntax(frontend, backend, panel)
  if (syntaxError) return syntaxError

  // 2. API surface
  const apiError = validateApiUsage(frontend, backend)
  if (apiError) return apiError

  return null
}
