/**
 * Embedded MCP Server for Dev Life Mini Apps
 *
 * Runs as an HTTP server inside the Electron main process.
 * Uses StreamableHTTP transport — compatible with Cursor, Claude Desktop, etc.
 *
 * MCP Config:
 * {
 *   "mcpServers": {
 *     "dev-life-miniapps": {
 *       "url": "http://localhost:24816/mcp"
 *     }
 *   }
 * }
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { is } from '@electron-toolkit/utils'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { handleTool, TOOLS } from './mcp/index'

const MCP_PORT = is.dev ? 24817 : 24816

// ─── MCP Server Setup ────────────────────────────────────────────────────────

function createMcpServer(): Server {
  const server = new Server(
    { name: 'dev-life-miniapps', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    try {
      const result = await handleTool(name, args || {})
      return { content: [{ type: 'text' as const, text: result }] }
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      }
    }
  })

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'miniapp://guide/development',
        name: 'Mini App Development Guide',
        description: 'Complete guide for developing mini apps',
        mimeType: 'text/markdown',
      },
    ],
  }))

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === 'miniapp://guide/development') {
      const text = await handleTool('get_miniapp_guide', {})
      return {
        contents: [{ uri: request.params.uri, mimeType: 'text/markdown', text }],
      }
    }
    throw new Error(`Unknown resource: ${request.params.uri}`)
  })

  return server
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────

let httpServer: ReturnType<typeof createServer> | null = null
const sessions = new Map<string, StreamableHTTPServerTransport>()

export function startMcpServer(): void {
  httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id')
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://localhost:${MCP_PORT}`)

    // Health check
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({ status: 'ok', server: 'dev-life-miniapps', sessions: sessions.size }),
      )
      return
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    // ── MCP endpoint ──────────────────────────────────────────────────
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    // Existing session
    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)!
      await transport.handleRequest(req, res)
      return
    }

    // New session (initialization request — no session ID yet)
    if (!sessionId && req.method === 'POST') {
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => require('node:crypto').randomUUID(),
        })

        const server = createMcpServer()
        await server.connect(transport)

        // handleRequest generates the session ID
        await transport.handleRequest(req, res)

        // NOW sessionId is available — track it
        const sid = transport.sessionId
        if (sid) {
          sessions.set(sid, transport)
          transport.onclose = () => {
            sessions.delete(sid)
            server.close()
          }
        }
      } catch (e: any) {
        console.error('[mcp] Failed to create session:', e)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      }
      return
    }

    // Invalid: has session ID but not found, or GET without session
    if (sessionId) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found' }))
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Bad request' }))
    }
  })

  httpServer.listen(MCP_PORT, '127.0.0.1', () => {
    console.log(`[mcp] Mini App MCP server listening on http://127.0.0.1:${MCP_PORT}/mcp`)
  })

  httpServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[mcp] Port ${MCP_PORT} in use, MCP server not started`)
    } else {
      console.error('[mcp] MCP server error:', err)
    }
  })
}

export function stopMcpServer(): void {
  // Detach onclose handlers before closing to prevent infinite recursion
  // (transport.close → onclose → server.close → transport.close → ∞)
  for (const [, transport] of sessions) {
    transport.onclose = undefined as any
    transport.close()
  }
  sessions.clear()

  if (httpServer) {
    httpServer.close()
    httpServer = null
    console.log('[mcp] MCP server stopped')
  }
}
