import * as LucideIcons from 'lucide-react'
import React from 'react'
import { transform } from 'sucrase'
import * as MiniAppUIComponents from '../components/ui/MiniAppUI'

// ─── createElement helper (h) for writing mini app UI concisely ──────────────

export function h(type: any, props?: any, ...children: any[]) {
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
    h, // hyperscript-style createElement helper
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

// ─── JSX Transpiler ──────────────────────────────────────────────────────────

export function transpileCode(code: string): string {
  // Detect JSX syntax: look for <Component or <tag patterns
  if (/<[A-Za-z]/.test(code)) {
    try {
      const result = transform(code, {
        transforms: ['jsx'],
        jsxPragma: 'h',
        jsxFragmentPragma: 'React.Fragment',
        production: true,
      })
      return result.code
    } catch (e) {
      console.error('[MiniApp] JSX transpile failed, using raw code:', e)
      return code
    }
  }
  return code
}

// ─── Evaluate mini app code and return component ─────────────────────────────

export function evaluateComponent(
  code: string,
  ctx: ReturnType<typeof buildFrontendContext>,
): React.ComponentType<any> | null {
  if (!code || code.trim() === '') return null

  try {
    const transpiledCode = transpileCode(code)
    const moduleObj = { exports: {} as any }
    const wrappedCode = `(function(module, exports, ctx, h, React) { ${transpiledCode} \n})`
    const fn = new Function(`return ${wrappedCode}`)()
    fn(moduleObj, moduleObj.exports, ctx, h, React)

    const component = moduleObj.exports
    if (typeof component === 'function') {
      return component
    }
    return null
  } catch (e) {
    console.error('[MiniApp] Failed to evaluate code:', e)
    return null
  }
}
