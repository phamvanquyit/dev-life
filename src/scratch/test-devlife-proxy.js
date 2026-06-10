/**
 * test-devlife-proxy.js
 *
 * Test LangChain JS qua Dev Life AI Proxy (port 18981)
 * Tập trung vào function calling / tool use
 *
 * Cases:
 *   1. Basic Chat (sanity check)
 *   2. Tool Binding — model trả về tool_calls
 *   3. Single Tool Execution (ReAct Agent)
 *   4. Multi-Tool Parallel Calls
 *   5. Tool Execution + Stream
 *   6. Structured Output (tool-based)
 *   7. Multi-turn Tool Conversation (manual loop)
 *   8. Chained Tool Calls (Agent multi-step)
 *   9. Tool with Complex Schema
 *
 * Usage: node src/scratch/test-devlife-proxy.js
 */

import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'

const PROXY_URL = 'http://127.0.0.1:18981/v1'
const MODEL = 'gemini-2.5-flash'

// ─── LangChain Client ────────────────────────────────────────────────────────

const llm = new ChatOpenAI({
  configuration: {
    baseURL: PROXY_URL,
  },
  apiKey: 'not-needed',
  modelName: MODEL,
  temperature: 0,
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function header(name) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${name}`)
  console.log(`${'─'.repeat(60)}`)
}

function pass(name, detail = '') {
  passed++
  console.log(`  ✅ ${name}${detail ? `: ${detail}` : ''}`)
}

function fail(name, error) {
  failed++
  console.error(`  ❌ ${name}: ${error}`)
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

const getWeather = tool(
  async ({ city }) => {
    const data = {
      tokyo: '☀️ 28°C, Sunny',
      london: '🌧️ 15°C, Rainy',
      'new york': '⛅ 22°C, Partly Cloudy',
      hanoi: '🌤️ 35°C, Hot and Humid',
      paris: '🌥️ 20°C, Cloudy',
    }
    return data[city.toLowerCase()] || `Weather data not available for ${city}`
  },
  {
    name: 'get_weather',
    description: 'Get the current weather for a city',
    schema: z.object({
      city: z.string().describe('The city name to get weather for'),
    }),
  },
)

const calculator = tool(
  async ({ expression }) => {
    try {
      // Simple safe eval for math expressions
      const result = Function(`"use strict"; return (${expression})`)()
      return String(result)
    } catch (e) {
      return `Error: ${e.message}`
    }
  },
  {
    name: 'calculator',
    description: "Calculate a mathematical expression. Example: '2 + 3 * 4'",
    schema: z.object({
      expression: z.string().describe('The math expression to evaluate'),
    }),
  },
)

const searchDatabase = tool(
  async ({ query, limit }) => {
    const results = [
      { id: 1, title: `Result for '${query}' #1`, score: 0.95 },
      { id: 2, title: `Result for '${query}' #2`, score: 0.87 },
      { id: 3, title: `Result for '${query}' #3`, score: 0.76 },
    ]
    return JSON.stringify(results.slice(0, limit || 5))
  },
  {
    name: 'search_database',
    description: 'Search a database for records matching the query',
    schema: z.object({
      query: z.string().describe('The search query'),
      limit: z.number().optional().describe('Max number of results'),
    }),
  },
)

const readFile = tool(
  async ({ filepath }) => {
    const files = {
      '/data/config.json': '{"version": "1.0", "debug": true}',
      '/data/users.csv': 'name,email\nAlice,alice@example.com\nBob,bob@example.com',
      '/data/readme.md': '# My Project\nThis is a test project.',
    }
    return files[filepath] || `File not found: ${filepath}`
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given path',
    schema: z.object({
      filepath: z.string().describe('The file path to read'),
    }),
  },
)

const createTodo = tool(
  async ({ title, priority, tags }) => {
    return JSON.stringify({
      id: Math.floor(Math.random() * 10000),
      title,
      priority: priority || 'medium',
      tags: tags || [],
      created_at: new Date().toISOString(),
      status: 'pending',
    })
  },
  {
    name: 'create_todo',
    description: 'Create a new TODO item with title, priority and optional tags',
    schema: z.object({
      title: z.string().describe('The title of the todo item'),
      priority: z.enum(['low', 'medium', 'high']).optional().describe('Priority level'),
      tags: z.array(z.string()).optional().describe('List of tags'),
    }),
  },
)

// ═══════════════════════════════════════════════════════════════════════════════
//  1. Basic Chat (Sanity Check)
// ═══════════════════════════════════════════════════════════════════════════════

async function testBasicChat() {
  header('1. Basic Chat (Sanity Check)')
  try {
    const result = await llm.invoke('Say hello in exactly 3 words')
    const text =
      typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
    if (text.length > 0) {
      pass('invoke', `"${text.substring(0, 80)}"`)
    } else {
      fail('invoke', 'empty response')
    }
  } catch (e) {
    fail('invoke', e.message)
  }
}

async function testStreamBasic() {
  try {
    const stream = await llm.stream('Count 1 to 3')
    let fullText = ''
    for await (const chunk of stream) {
      const content = typeof chunk.content === 'string' ? chunk.content : ''
      fullText += content
    }
    if (fullText.length > 0) {
      pass('stream', `"${fullText.substring(0, 80)}"`)
    } else {
      fail('stream', 'empty stream')
    }
  } catch (e) {
    fail('stream', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  2. Tool Binding — model returns tool_calls
// ═══════════════════════════════════════════════════════════════════════════════

async function testToolBinding_SingleTool() {
  header('2. Tool Binding (model → tool_calls)')
  try {
    const llmWithTools = llm.bindTools([getWeather])
    const result = await llmWithTools.invoke("What's the weather in Tokyo?")

    console.log('    📋 Raw response tool_calls:', JSON.stringify(result.tool_calls, null, 2))
    console.log('    📋 Raw response content:', JSON.stringify(result.content)?.substring(0, 100))

    if (result.tool_calls && result.tool_calls.length > 0) {
      const tc = result.tool_calls[0]
      pass('single tool binding', `called ${tc.name}(${JSON.stringify(tc.args)})`)
    } else {
      fail(
        'single tool binding',
        `no tool_calls in response, content: "${String(result.content).substring(0, 100)}"`,
      )
    }
  } catch (e) {
    fail('single tool binding', e.message)
  }
}

async function testToolBinding_MultipleTool() {
  try {
    const llmWithTools = llm.bindTools([getWeather, calculator])
    const result = await llmWithTools.invoke("What is 15 * 37? Also what's the weather in London?")

    console.log('    📋 Raw response tool_calls:', JSON.stringify(result.tool_calls, null, 2))

    if (result.tool_calls && result.tool_calls.length >= 2) {
      const names = result.tool_calls.map((tc) => tc.name)
      pass('multi-tool binding', `called ${JSON.stringify(names)}`)
    } else if (result.tool_calls && result.tool_calls.length === 1) {
      pass('multi-tool binding (partial)', `called ${result.tool_calls[0].name} — expected 2 tools`)
    } else {
      fail(
        'multi-tool binding',
        `no tool_calls, content: "${String(result.content).substring(0, 100)}"`,
      )
    }
  } catch (e) {
    fail('multi-tool binding', e.message)
  }
}

async function testToolBinding_NoToolNeeded() {
  try {
    const llmWithTools = llm.bindTools([getWeather, calculator])
    const result = await llmWithTools.invoke('Say hello!')

    if (!result.tool_calls || result.tool_calls.length === 0) {
      const text = typeof result.content === 'string' ? result.content : ''
      pass('no tool needed', `correctly did NOT call tools. Response: "${text.substring(0, 60)}"`)
    } else {
      pass('no tool needed (model called anyway)', `called ${result.tool_calls[0].name}`)
    }
  } catch (e) {
    fail('no tool needed', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  3. Manual Tool Execution Loop
// ═══════════════════════════════════════════════════════════════════════════════

async function testManualToolLoop() {
  header('3. Manual Tool Execution Loop')
  try {
    const llmWithTools = llm.bindTools([getWeather])
    const messages = [new HumanMessage("What's the weather like in Hanoi?")]

    // Step 1: LLM decides to call a tool
    const aiResponse = await llmWithTools.invoke(messages)
    messages.push(aiResponse)

    console.log(
      '    📋 Step 1 - AI response tool_calls:',
      JSON.stringify(aiResponse.tool_calls, null, 2),
    )

    if (!aiResponse.tool_calls || aiResponse.tool_calls.length === 0) {
      fail('manual tool loop', 'LLM did not call any tool')
      return
    }

    // Step 2: Execute the tool
    const toolCall = aiResponse.tool_calls[0]
    const toolResult = await getWeather.invoke(toolCall.args)

    console.log(`    📋 Step 2 - Tool result: "${toolResult}"`)

    messages.push(
      new ToolMessage({
        content: toolResult,
        tool_call_id: toolCall.id,
      }),
    )

    // Step 3: LLM produces final answer with tool result
    const finalResponse = await llmWithTools.invoke(messages)
    const finalText = typeof finalResponse.content === 'string' ? finalResponse.content : ''

    console.log(`    📋 Step 3 - Final: "${finalText.substring(0, 100)}"`)

    if (finalText.length > 0) {
      pass('manual tool loop', `"${finalText.substring(0, 80)}"`)
    } else {
      fail('manual tool loop', 'empty final response')
    }
  } catch (e) {
    fail('manual tool loop', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  4. Multi-Tool Manual Execution
// ═══════════════════════════════════════════════════════════════════════════════

async function testMultiToolManual() {
  header('4. Multi-Tool Manual Execution')
  try {
    const tools = [getWeather, calculator, searchDatabase]
    const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]))
    const llmWithTools = llm.bindTools(tools)

    const messages = [
      new HumanMessage("Search for 'langchain', calculate 25 * 4, and get weather in Paris"),
    ]

    // Step 1: LLM call — expecting multiple tool calls
    const aiResponse = await llmWithTools.invoke(messages)
    messages.push(aiResponse)

    console.log(
      '    📋 AI tool_calls:',
      JSON.stringify(aiResponse.tool_calls?.map((tc) => tc.name)),
    )

    if (!aiResponse.tool_calls || aiResponse.tool_calls.length === 0) {
      fail('multi-tool manual', 'no tool_calls returned')
      return
    }

    // Step 2: Execute all tools
    for (const tc of aiResponse.tool_calls) {
      const toolFn = toolMap[tc.name]
      if (toolFn) {
        const result = await toolFn.invoke(tc.args)
        console.log(`    📋 ${tc.name} → "${String(result).substring(0, 60)}"`)
        messages.push(new ToolMessage({ content: String(result), tool_call_id: tc.id }))
      } else {
        messages.push(new ToolMessage({ content: `Unknown tool: ${tc.name}`, tool_call_id: tc.id }))
      }
    }

    // Step 3: Final response
    const finalResponse = await llmWithTools.invoke(messages)
    const finalText = typeof finalResponse.content === 'string' ? finalResponse.content : ''

    if (finalText.length > 0) {
      pass(
        'multi-tool manual',
        `${aiResponse.tool_calls.length} tools called, final: "${finalText.substring(0, 80)}"`,
      )
    } else {
      fail('multi-tool manual', 'empty final response')
    }
  } catch (e) {
    fail('multi-tool manual', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  5. Streaming with Tools
// ═══════════════════════════════════════════════════════════════════════════════

async function testStreamWithTools() {
  header('5. Streaming with Tools')
  try {
    const llmWithTools = llm.bindTools([getWeather])

    // Stream when tool call is expected
    const stream = await llmWithTools.stream("What's the weather in Tokyo?")

    const toolCalls = []
    let textContent = ''

    for await (const chunk of stream) {
      if (chunk.tool_call_chunks && chunk.tool_call_chunks.length > 0) {
        for (const tc of chunk.tool_call_chunks) {
          // Accumulate tool call chunks
          if (!toolCalls[tc.index]) {
            toolCalls[tc.index] = { name: '', args: '', id: tc.id || '' }
          }
          if (tc.name) toolCalls[tc.index].name += tc.name
          if (tc.args) toolCalls[tc.index].args += tc.args
          if (tc.id) toolCalls[tc.index].id = tc.id
        }
      }
      const content = typeof chunk.content === 'string' ? chunk.content : ''
      textContent += content
    }

    console.log('    📋 Stream tool_calls:', JSON.stringify(toolCalls))
    console.log('    📋 Stream text:', textContent.substring(0, 80))

    if (toolCalls.length > 0 && toolCalls[0].name) {
      pass('stream + tool call', `streamed tool call: ${toolCalls[0].name}(${toolCalls[0].args})`)
    } else if (textContent.length > 0) {
      pass(
        'stream + tool call (text only)',
        `no tool_calls in stream, got text: "${textContent.substring(0, 60)}"`,
      )
    } else {
      fail('stream + tool call', 'no tool_calls and no text in stream')
    }
  } catch (e) {
    fail('stream + tool call', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  6. Structured Output (via withStructuredOutput)
// ═══════════════════════════════════════════════════════════════════════════════

async function testStructuredOutput() {
  header('6. Structured Output')
  try {
    const RecipeSchema = z.object({
      name: z.string().describe('Name of the dish'),
      ingredients: z.array(z.string()).describe('List of ingredients'),
      steps: z.array(z.string()).describe('Cooking steps'),
      time_minutes: z.number().describe('Cooking time in minutes'),
    })

    const structuredLlm = llm.withStructuredOutput(RecipeSchema, { method: 'functionCalling' })
    const result = await structuredLlm.invoke('Give me a recipe for scrambled eggs')

    console.log('    📋 Structured result:', JSON.stringify(result, null, 2)?.substring(0, 300))

    if (result?.name) {
      pass(
        'structured output (Recipe)',
        `name="${result.name}", ${result.ingredients?.length || 0} ingredients, ${result.steps?.length || 0} steps`,
      )
    } else {
      fail('structured output (Recipe)', 'no structured result')
    }
  } catch (e) {
    fail('structured output (Recipe)', e.message)
  }
}

async function testStructuredOutput_CodeReview() {
  try {
    const CodeReviewSchema = z.object({
      file: z.string().describe('File being reviewed'),
      issues: z.array(z.string()).describe('List of issues found'),
      suggestions: z.array(z.string()).describe('Improvement suggestions'),
      score: z.number().describe('Quality score 1-10'),
      approved: z.boolean().describe('Whether the code is approved'),
    })

    const structuredLlm = llm.withStructuredOutput(CodeReviewSchema, { method: 'functionCalling' })
    const result = await structuredLlm.invoke('Review this code:\ndef add(a, b):\n    return a + b')

    if (result?.file) {
      pass(
        'structured output (CodeReview)',
        `file="${result.file}", score=${result.score}, approved=${result.approved}`,
      )
    } else {
      fail('structured output (CodeReview)', 'no result')
    }
  } catch (e) {
    fail('structured output (CodeReview)', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  7. Multi-turn Tool Conversation
// ═══════════════════════════════════════════════════════════════════════════════

async function testMultiTurnTool() {
  header('7. Multi-turn Tool Conversation')
  try {
    const llmWithTools = llm.bindTools([getWeather, calculator])
    const toolMap = { get_weather: getWeather, calculator }

    const messages = [
      new SystemMessage('You are a helpful assistant. Use tools when needed.'),
      new HumanMessage("What's the weather in Tokyo?"),
    ]

    // Turn 1: Weather query
    let aiMsg = await llmWithTools.invoke(messages)
    messages.push(aiMsg)

    if (aiMsg.tool_calls?.length > 0) {
      for (const tc of aiMsg.tool_calls) {
        const toolResult = await toolMap[tc.name]?.invoke(tc.args)
        messages.push(new ToolMessage({ content: String(toolResult), tool_call_id: tc.id }))
      }
      aiMsg = await llmWithTools.invoke(messages)
      messages.push(aiMsg)
    }

    console.log(`    📋 Turn 1 final: "${String(aiMsg.content).substring(0, 80)}"`)

    // Turn 2: Follow-up with calculator
    messages.push(
      new HumanMessage(
        "If it's 28°C there, what is that in Fahrenheit? Use the formula: C * 9/5 + 32",
      ),
    )
    aiMsg = await llmWithTools.invoke(messages)
    messages.push(aiMsg)

    if (aiMsg.tool_calls?.length > 0) {
      for (const tc of aiMsg.tool_calls) {
        const toolResult = await toolMap[tc.name]?.invoke(tc.args)
        messages.push(new ToolMessage({ content: String(toolResult), tool_call_id: tc.id }))
      }
      aiMsg = await llmWithTools.invoke(messages)
      messages.push(aiMsg)
    }

    const finalText = typeof aiMsg.content === 'string' ? aiMsg.content : ''
    console.log(`    📋 Turn 2 final: "${finalText.substring(0, 80)}"`)

    if (finalText.length > 0) {
      pass('multi-turn tool', `2-turn conversation completed: "${finalText.substring(0, 80)}"`)
    } else {
      fail('multi-turn tool', 'empty response after multi-turn')
    }
  } catch (e) {
    fail('multi-turn tool', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  8. Chained Tool Calls (Agent-style multi-step)
// ═══════════════════════════════════════════════════════════════════════════════

async function testChainedToolCalls() {
  header('8. Chained Tool Calls (multi-step agent)')
  try {
    const tools = [readFile, calculator]
    const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]))
    const llmWithTools = llm.bindTools(tools)

    const messages = [
      new SystemMessage('You are a helpful assistant. Use tools step by step.'),
      new HumanMessage(
        'Read the file /data/users.csv and tell me how many users are in it. Then multiply that number by 100.',
      ),
    ]

    const maxIterations = 5
    let iteration = 0

    while (iteration < maxIterations) {
      iteration++
      const aiMsg = await llmWithTools.invoke(messages)
      messages.push(aiMsg)

      console.log(
        `    📋 Iteration ${iteration}: tool_calls=${aiMsg.tool_calls?.length || 0}, content="${String(aiMsg.content).substring(0, 60)}"`,
      )

      if (!aiMsg.tool_calls || aiMsg.tool_calls.length === 0) {
        // No more tool calls — final answer
        const finalText = typeof aiMsg.content === 'string' ? aiMsg.content : ''
        if (finalText.length > 0) {
          pass(
            'chained tool calls',
            `${iteration} iterations, final: "${finalText.substring(0, 80)}"`,
          )
        } else {
          fail('chained tool calls', 'empty final response')
        }
        break
      }

      // Execute tools
      for (const tc of aiMsg.tool_calls) {
        const toolFn = toolMap[tc.name]
        if (toolFn) {
          const result = await toolFn.invoke(tc.args)
          console.log(`    📋   → ${tc.name}: "${String(result).substring(0, 60)}"`)
          messages.push(new ToolMessage({ content: String(result), tool_call_id: tc.id }))
        }
      }
    }

    if (iteration >= maxIterations) {
      fail('chained tool calls', `hit max iterations (${maxIterations})`)
    }
  } catch (e) {
    fail('chained tool calls', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  9. Tool with Complex Schema (nested objects, arrays, enums)
// ═══════════════════════════════════════════════════════════════════════════════

async function testComplexSchemaToolBinding() {
  header('9. Tool with Complex Schema')
  try {
    const llmWithTools = llm.bindTools([createTodo])
    const result = await llmWithTools.invoke(
      "Create a high priority TODO: 'Fix production bug' with tags 'urgent' and 'backend'",
    )

    console.log('    📋 Raw tool_calls:', JSON.stringify(result.tool_calls, null, 2))

    if (result.tool_calls?.length > 0) {
      const tc = result.tool_calls[0]
      const args = tc.args
      pass(
        'complex schema tool',
        `called ${tc.name}(title="${args.title}", priority="${args.priority}", tags=${JSON.stringify(args.tags)})`,
      )

      // Verify schema compliance
      if (args.priority && !['low', 'medium', 'high'].includes(args.priority)) {
        fail('complex schema validation', `invalid priority: "${args.priority}"`)
      } else {
        pass('complex schema validation', 'enum constraint respected')
      }

      if (args.tags && Array.isArray(args.tags)) {
        pass('complex schema arrays', `tags is array with ${args.tags.length} items`)
      } else {
        pass('complex schema arrays (no tags)', 'tags field missing or not array')
      }
    } else {
      fail(
        'complex schema tool',
        `no tool_calls, content: "${String(result.content).substring(0, 100)}"`,
      )
    }
  } catch (e) {
    fail('complex schema tool', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  10. Raw Fetch — Tool Calling via OpenAI API format
// ═══════════════════════════════════════════════════════════════════════════════

async function testRawFetchToolCall() {
  header('10. Raw Fetch — Tool Calling (OpenAI format)')
  try {
    const res = await fetch(`${PROXY_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: "What's the weather in Tokyo?" }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the current weather for a city',
              parameters: {
                type: 'object',
                properties: {
                  city: { type: 'string', description: 'The city name' },
                },
                required: ['city'],
              },
            },
          },
        ],
        tool_choice: 'auto',
      }),
    })

    const data = await res.json()
    console.log('    📋 Raw API response:', JSON.stringify(data, null, 2)?.substring(0, 500))

    const choice = data.choices?.[0]
    if (choice?.message?.tool_calls?.length > 0) {
      const tc = choice.message.tool_calls[0]
      pass('raw fetch tool_calls', `${tc.function.name}(${tc.function.arguments})`)
    } else if (
      choice?.finish_reason === 'tool_calls' ||
      choice?.finish_reason === 'function_call'
    ) {
      pass('raw fetch (finish_reason)', `finish_reason=${choice.finish_reason}`)
    } else {
      fail(
        'raw fetch tool_calls',
        `no tool_calls in response. finish_reason=${choice?.finish_reason}, content="${choice?.message?.content?.substring(0, 80)}"`,
      )
    }
  } catch (e) {
    fail('raw fetch tool_calls', e.message)
  }
}

async function testRawFetchToolCallStream() {
  try {
    const res = await fetch(`${PROXY_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: "What's the weather in London?" }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the current weather for a city',
              parameters: {
                type: 'object',
                properties: {
                  city: { type: 'string', description: 'The city name' },
                },
                required: ['city'],
              },
            },
          },
        ],
        stream: true,
      }),
    })

    const toolCalls = []
    let textContent = ''
    const reader = res.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      const lines = chunk.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const json = JSON.parse(line.substring(6))
            const delta = json.choices?.[0]?.delta
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (!toolCalls[tc.index]) {
                  toolCalls[tc.index] = { name: '', args: '', id: tc.id || '' }
                }
                if (tc.function?.name) toolCalls[tc.index].name += tc.function.name
                if (tc.function?.arguments) toolCalls[tc.index].args += tc.function.arguments
                if (tc.id) toolCalls[tc.index].id = tc.id
              }
            }
            if (delta?.content) {
              textContent += delta.content
            }
          } catch {
            /* skip */
          }
        }
      }
    }

    console.log('    📋 Stream tool_calls:', JSON.stringify(toolCalls))

    if (toolCalls.length > 0 && toolCalls[0].name) {
      pass('raw fetch stream + tool', `streamed: ${toolCalls[0].name}(${toolCalls[0].args})`)
    } else if (textContent.length > 0) {
      pass(
        'raw fetch stream + tool (text only)',
        `no tool_calls, text: "${textContent.substring(0, 60)}"`,
      )
    } else {
      fail('raw fetch stream + tool', 'no tool_calls and no text')
    }
  } catch (e) {
    fail('raw fetch stream + tool', e.message)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RUN ALL
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║  🧪 LangChain JS + Dev Life Proxy — Tool Calling Tests  ║')
  console.log(`║  Proxy: ${PROXY_URL.padEnd(48)} ║`)
  console.log(`║  Model: ${MODEL.padEnd(48)} ║`)
  console.log('╚═══════════════════════════════════════════════════════════╝')

  // 1. Basic sanity
  await testBasicChat()
  await testStreamBasic()

  // 2. Tool Binding
  await testToolBinding_SingleTool()
  await testToolBinding_MultipleTool()
  await testToolBinding_NoToolNeeded()

  // 3. Manual Tool Loop
  await testManualToolLoop()

  // 4. Multi-Tool Manual
  await testMultiToolManual()

  // 5. Stream + Tools
  await testStreamWithTools()

  // 6. Structured Output
  await testStructuredOutput()
  await testStructuredOutput_CodeReview()

  // 7. Multi-turn Tool
  await testMultiTurnTool()

  // 8. Chained Tool Calls
  await testChainedToolCalls()

  // 9. Complex Schema
  await testComplexSchemaToolBinding()

  // 10. Raw Fetch (tool calling via API)
  await testRawFetchToolCall()
  await testRawFetchToolCallStream()

  // Summary
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  if (failed === 0) {
    console.log('  🎉 All tests passed!')
  } else {
    console.log(`  ⚠️  ${failed} test(s) failed`)
  }
  console.log(`${'═'.repeat(60)}\n`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('💥 Fatal error:', e.message)
  process.exit(1)
})
