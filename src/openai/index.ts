import OpenAI from 'openai'
import type { ChatCompletionMessageFunctionToolCall } from 'openai/resources/chat/completions/completions.js'
import type { ProviderPlugin, AIMessage, AIToolSpec, AIResponse, AIContentBlock, AIUsage, EmbeddingResponse } from '../types.js'
import pino from 'pino'

const log = pino({ name: 'openai-provider' })

/**
 * OpenAI pricing per million tokens.
 * Source: https://openai.com/api/pricing/
 *
 * When OpenAI updates pricing or adds models, update this table.
 * The provider owns its pricing — no external dependency needed.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o':          { input: 2.50,  output: 10   },
  'gpt-4o-mini':     { input: 0.15,  output: 0.60 },
  'gpt-4-turbo':     { input: 10,    output: 30   },
  'gpt-3.5-turbo':   { input: 0.50,  output: 1.50 },
}

/** Embedding pricing per million tokens. */
const EMBEDDING_PRICING: Record<string, number> = {
  'text-embedding-3-small': 0.02,
  'text-embedding-3-large': 0.13,
  'text-embedding-ada-002': 0.10,
}

function resolvePrice(model: string): { input: number; output: number } {
  for (const [prefix, pricing] of Object.entries(PRICING)) {
    if (model.startsWith(prefix)) {
      return pricing
    }
  }
  log.warn({ model }, 'Unknown model for pricing — defaulting to GPT-4o rates')
  return { input: 2.50, output: 10 }
}

function calculateUsage(model: string, raw: OpenAI.Completions.CompletionUsage | undefined): AIUsage {
  const price = resolvePrice(model)
  const inputTokens = raw?.prompt_tokens ?? 0
  const outputTokens = raw?.completion_tokens ?? 0

  const cost =
    (inputTokens * price.input +
     outputTokens * price.output) / 1_000_000

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: cost,
  }
}

/**
 * Map OpenAI finish_reason to normalized stop_reason.
 */
function mapStopReason(finishReason: string | null): string | null {
  if (!finishReason) return null
  if (finishReason === 'stop') return 'end_turn'
  if (finishReason === 'tool_calls') return 'tool_use'
  return finishReason
}

/**
 * Convert AIMessage to OpenAI chat message format.
 */
function toOpenAIMessage(msg: AIMessage): OpenAI.ChatCompletionMessageParam {
  if (typeof msg.content === 'string') {
    return { role: msg.role, content: msg.content }
  }

  // Handle array content — map tool_result blocks to tool messages
  const parts: OpenAI.ChatCompletionContentPart[] = []
  const toolResults: OpenAI.ChatCompletionToolMessageParam[] = []

  for (const block of msg.content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text || '' })
    } else if (block.type === 'tool_result') {
      toolResults.push({
        role: 'tool',
        tool_call_id: block.id || '',
        content: block.text || '',
      })
    } else if (block.type === 'tool_use') {
      // Tool use blocks are part of assistant messages — handled via tool_calls
      // Include as text for context
      parts.push({ type: 'text', text: `[Tool call: ${block.name}]` })
    }
  }

  if (toolResults.length > 0) {
    // Return tool results as separate messages (handled by caller)
    return toolResults[0]
  }

  if (msg.role === 'user') {
    return { role: 'user', content: parts.length > 0 ? parts : '' }
  }
  return { role: 'assistant', content: parts.length > 0 ? parts.map(p => ('text' in p ? p.text : '')).join('') : '' }
}

/**
 * Convert OpenAI response content to normalized AIContentBlock array.
 */
function fromOpenAIResponse(message: OpenAI.ChatCompletionMessage): AIContentBlock[] {
  const blocks: AIContentBlock[] = []

  if (message.content) {
    blocks.push({ type: 'text', text: message.content })
  }

  if (message.tool_calls) {
    for (const toolCall of message.tool_calls) {
      if (toolCall.type === 'function') {
        const fnCall = toolCall as ChatCompletionMessageFunctionToolCall
        blocks.push({
          type: 'tool_use',
          id: fnCall.id,
          name: fnCall.function.name,
          input: JSON.parse(fnCall.function.arguments || '{}') as Record<string, unknown>,
        })
      }
    }
  }

  return blocks
}

class OpenAIProviderPlugin implements ProviderPlugin {
  readonly type = 'openai' as const
  readonly name = 'OpenAI'
  readonly description = 'GPT models by OpenAI'

  readonly configSchema = {
    fields: [
      { name: 'api_key', label: 'API Key', type: 'password' as const, required: true, placeholder: 'sk-...', helpText: 'OpenAI API key' },
    ],
  }

  readonly models = [
    { id: 'gpt-4o', label: 'GPT-4o', default: true },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  ]

  readonly supportsEmbedding = true

  readonly embeddingModels = [
    { id: 'text-embedding-3-small', label: 'Embedding 3 Small', dimensions: 1536, default: true },
    { id: 'text-embedding-3-large', label: 'Embedding 3 Large', dimensions: 3072 },
  ]

  private client: OpenAI | null = null
  private currentApiKey: string | null = null

  private getClient(apiKey: string): OpenAI {
    if (this.client && this.currentApiKey === apiKey) return this.client
    this.client = new OpenAI({ apiKey })
    this.currentApiKey = apiKey
    return this.client
  }

  setApiKey(apiKey: string): void {
    this.getClient(apiKey)
  }

  async createMessage(params: {
    model: string
    maxTokens: number
    system: string
    tools?: AIToolSpec[]
    messages: AIMessage[]
    apiKey?: string
  }): Promise<AIResponse> {
    const apiKey = params.apiKey || this.currentApiKey
    if (!apiKey) throw new Error('No API key configured')

    const client = this.getClient(apiKey)

    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.system },
    ]

    for (const msg of params.messages) {
      if (typeof msg.content === 'string') {
        openaiMessages.push({ role: msg.role, content: msg.content })
      } else {
        // Handle structured content with tool results
        const textParts: string[] = []
        const toolResults: OpenAI.ChatCompletionToolMessageParam[] = []
        const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = []

        for (const block of msg.content) {
          if (block.type === 'text') {
            textParts.push(block.text || '')
          } else if (block.type === 'tool_result') {
            toolResults.push({
              role: 'tool',
              tool_call_id: block.id || '',
              content: block.text || '',
            })
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id || '',
              type: 'function',
              function: {
                name: block.name || '',
                arguments: JSON.stringify(block.input || {}),
              },
            })
          }
        }

        if (msg.role === 'assistant' && toolCalls.length > 0) {
          openaiMessages.push({
            role: 'assistant',
            content: textParts.join('') || null,
            tool_calls: toolCalls,
          })
        } else if (toolResults.length > 0) {
          // Push tool result messages directly
          for (const tr of toolResults) {
            openaiMessages.push(tr)
          }
        } else if (textParts.length > 0) {
          openaiMessages.push({ role: msg.role, content: textParts.join('') })
        }
      }
    }

    const tools: OpenAI.ChatCompletionTool[] = (params.tools ?? []).map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }))

    const response = await client.chat.completions.create({
      model: params.model,
      max_tokens: params.maxTokens,
      messages: openaiMessages,
      tools: tools.length > 0 ? tools : undefined,
    })

    const choice = response.choices[0]

    return {
      content: fromOpenAIResponse(choice.message),
      usage: calculateUsage(params.model, response.usage),
      stop_reason: mapStopReason(choice.finish_reason),
    }
  }

  async embed(params: { apiKey: string; model?: string; input: string[]; dimensions?: number }): Promise<EmbeddingResponse> {
    if (params.input.length === 0) return { embeddings: [], usage: { tokens: 0, cost_usd: 0 } }

    const client = this.getClient(params.apiKey)
    const model = params.model || 'text-embedding-3-small'

    const response = await client.embeddings.create({
      model,
      input: params.input,
      dimensions: params.dimensions,
    })

    const embeddings = response.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding)

    const tokens = response.usage?.total_tokens ?? 0
    const pricePerMillion = EMBEDDING_PRICING[model] ?? 0.02
    const cost_usd = (tokens * pricePerMillion) / 1_000_000

    return { embeddings, usage: { tokens, cost_usd } }
  }

  async createSimpleMessage(params: { apiKey: string; model: string; maxTokens: number; prompt: string }): Promise<string> {
    const client = this.getClient(params.apiKey)
    const response = await client.chat.completions.create({
      model: params.model,
      max_tokens: params.maxTokens,
      messages: [{ role: 'user', content: params.prompt }],
    })
    return response.choices[0].message.content || ''
  }
}

export const openaiPlugin = new OpenAIProviderPlugin()
