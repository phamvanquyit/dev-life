import * as LucideIcons from 'lucide-react'
import React from 'react'
import { transform } from 'sucrase'
import * as MiniAppUIComponents from '../components/ui/MiniAppUI'

// ─── JSX pragma (used internally by Sucrase transpiler, NOT exposed to mini apps) ──

export function __jsx(type: any, props?: any, ...children: any[]) {
  return React.createElement(type, props, ...children)
}

// ─── Build context object for mini app frontend code ─────────────────────────

export function buildFrontendContext(appId: string) {
  // IPC bridge for frontend ↔ backend communication
  const ipc = {
    send(channel: string, data: any) {
      window.api?.sendMiniAppIpc(appId, channel, data)
    },
    on(channel: string, handler: (data: any) => void) {
      const cleanup = window.api?.onMiniAppIpcMessage((msg: any) => {
        if (msg.appId === appId && msg.channel === channel) {
          handler(msg.data)
        }
      })
      return cleanup || (() => {})
    },
  }

  // Scoped storage
  const storage = {
    get: (key: string) => window.api?.miniAppStorageGet(appId, key),
    set: (key: string, value: string) => window.api?.miniAppStorageSet(appId, key, value),
    delete: (key: string) => window.api?.miniAppStorageDelete(appId, key),
    getAll: () => window.api?.miniAppStorageGetAll(appId),
  }

  // Media APIs
  const media = {
    getDesktopSources: (opts?: any) => window.api?.miniAppGetDesktopSources(opts),
    getMediaAccess: (type: string) => window.api?.getMediaAccess(type),
    askMediaAccess: (type: string) => window.api?.askMediaAccess(type),
  }

  return {
    appId,
    React,
    useState: React.useState,
    useEffect: React.useEffect,
    useRef: React.useRef,
    useCallback: React.useCallback,
    useMemo: React.useMemo,
    ui: MiniAppUIComponents,
    icons: LucideIcons,
    ipc,
    storage,
    media,
    notify: (title: string, body?: string, opts?: { silent?: boolean }) =>
      window.api?.miniAppNotify({ title, body, silent: opts?.silent }),
  }
}

// ─── Source Code Validation ──────────────────────────────────────────────────

const BANNED_PATTERNS = [
  { pattern: /\bctx\.h\s*\(/, label: 'ctx.h()' },
  { pattern: /\bReact\.createElement\s*\(/, label: 'React.createElement()' },
  // Detect standalone h() calls — but only at word boundary (not in variable names like 'width')
  // Match: h(, h (, but not: Math(, path(, width(
  { pattern: /(?:^|[^a-zA-Z0-9_$.])h\s*\(/, label: 'h()' },
]

function validateSourceCode(code: string): void {
  for (const { pattern, label } of BANNED_PATTERNS) {
    if (pattern.test(code)) {
      throw new Error(
        `❌ Manual createElement detected: ${label}\n` +
          'Mini apps MUST use JSX syntax (auto-transpiled by Sucrase).\n' +
          'Example: return (<div className="p-6">Hello</div>)\n' +
          'Do NOT use ctx.h(), h(), or React.createElement().',
      )
    }
  }
}

// ─── JSX + Imports Transpiler ────────────────────────────────────────────────

export function transpileCode(code: string): string {
  // Always apply 'imports' transform so ES module import/export syntax is
  // converted to require()/module.exports before wrapping in new Function().
  // Add 'jsx' only when JSX elements are detected.
  const transforms: ('jsx' | 'imports')[] = ['imports']
  if (/<[A-Za-z]/.test(code)) transforms.push('jsx')

  try {
    const result = transform(code, {
      transforms,
      jsxPragma: '__jsx',
      jsxFragmentPragma: 'React.Fragment',
      production: true,
    })
    return result.code
  } catch (e: any) {
    const msg = e?.message || String(e)
    console.error('[MiniApp] Transpile failed:', msg)
    throw new Error(`Syntax error: ${msg}`)
  }
}

// ─── Evaluate mini app code and return component ─────────────────────────────

export function evaluateComponent(
  code: string,
  ctx: ReturnType<typeof buildFrontendContext>,
): React.ComponentType<any> | null {
  if (!code || code.trim() === '') return null

  try {
    // Validate: reject ctx.h(), h(), React.createElement() in source
    validateSourceCode(code)

    const transpiledCode = transpileCode(code)

    // Mock require() so that import statements converted by sucrase resolve
    // to the context values already available in the sandbox.
    const mockRequire = (mod: string): any => {
      if (mod === 'react') return ctx.React
      if (mod === 'lucide-react') return ctx.icons
      if (mod === 'react/jsx-runtime') return { jsx: __jsx, jsxs: __jsx, Fragment: React.Fragment }
      throw new Error(
        `Cannot import "${mod}" in a mini app. ` +
          'Use ctx.React, ctx.icons, ctx.ui, etc. instead.',
      )
    }

    const moduleObj = { exports: {} as any }
    // Inject 'require' so sucrase-converted imports work inside new Function
    const wrappedCode = `(function(module, exports, ctx, __jsx, React, require) {\n${transpiledCode}\n})`
    const fn = new Function(`return ${wrappedCode}`)()
    fn(moduleObj, moduleObj.exports, ctx, __jsx, React, mockRequire)

    // Support both module.exports = Fn (CJS) and export default Fn (ESM via sucrase)
    const exp = moduleObj.exports
    const component = typeof exp === 'function' ? exp : (exp as any)?.default
    if (typeof component === 'function') {
      return component
    }
    return null
  } catch (e) {
    console.error('[MiniApp] Failed to evaluate code:', e)
    throw e
  }
}
