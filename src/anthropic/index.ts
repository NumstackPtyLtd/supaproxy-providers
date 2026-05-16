import Anthropic from '@anthropic-ai/sdk'
import type { TextBlock } from '@anthropic-ai/sdk/resources/messages.js'
import type { ProviderPlugin, AIMessage, AIToolSpec, AIResponse, AIContentBlock, AIUsage, ProviderModelInfo, ProviderTestResult } from '../types.js'
import pino from 'pino'

const log = pino({ name: 'anthropic-provider' })

/**
 * Anthropic pricing per million tokens.
 * Source: https://docs.anthropic.com/en/docs/about-claude/pricing
 *
 * When Anthropic updates pricing or adds models, update this table.
 * The provider owns its pricing — no external dependency needed.
 */
const PRICING: Record<string, { input: number; output: number; cacheWrite?: number; cacheRead?: number }> = {
  'claude-opus-4':         { input: 15,   output: 75,   cacheWrite: 18.75, cacheRead: 1.50  },
  'claude-sonnet-4':       { input: 3,    output: 15,   cacheWrite: 3.75,  cacheRead: 0.30  },
  'claude-3-5-sonnet':     { input: 3,    output: 15,   cacheWrite: 3.75,  cacheRead: 0.30  },
  'claude-3-5-haiku':      { input: 0.80, output: 4,    cacheWrite: 1.00,  cacheRead: 0.08  },
  'claude-3-opus':         { input: 15,   output: 75,   cacheWrite: 18.75, cacheRead: 1.50  },
  'claude-3-sonnet':       { input: 3,    output: 15 },
  'claude-3-haiku':        { input: 0.25, output: 1.25 },
}

function resolvePrice(model: string): { input: number; output: number; cacheWrite: number; cacheRead: number } {
  for (const [prefix, pricing] of Object.entries(PRICING)) {
    if (model.startsWith(prefix)) {
      return {
        input: pricing.input,
        output: pricing.output,
        cacheWrite: pricing.cacheWrite ?? pricing.input * 1.25,
        cacheRead: pricing.cacheRead ?? pricing.input * 0.1,
      }
    }
  }
  log.warn({ model }, 'Unknown model for pricing — defaulting to Sonnet rates')
  return { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 }
}

function calculateUsage(model: string, raw: Anthropic.Messages.Usage): AIUsage {
  const price = resolvePrice(model)
  const cacheCreation = raw.cache_creation_input_tokens ?? 0
  const cacheRead = raw.cache_read_input_tokens ?? 0

  const cost =
    (raw.input_tokens * price.input +
     raw.output_tokens * price.output +
     cacheCreation * price.cacheWrite +
     cacheRead * price.cacheRead) / 1_000_000

  return {
    input_tokens: raw.input_tokens,
    output_tokens: raw.output_tokens,
    cache_creation_tokens: cacheCreation || undefined,
    cache_read_tokens: cacheRead || undefined,
    cost_usd: cost,
  }
}

function toAnthropicBlock(block: AIContentBlock): Anthropic.ContentBlockParam {
  if (block.type === 'tool_result') {
    return { type: 'tool_result', tool_use_id: block.id!, content: block.text || '', is_error: false } as Anthropic.ToolResultBlockParam
  }
  if (block.type === 'tool_use') {
    return { type: 'tool_use', id: block.id!, name: block.name!, input: block.input || {} } as Anthropic.ToolUseBlockParam
  }
  return { type: 'text', text: block.text || '' } as Anthropic.TextBlockParam
}

function fromAnthropicBlock(block: Anthropic.ContentBlock): AIContentBlock {
  if (block.type === 'text') return { type: 'text', text: block.text }
  if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: block.input as Record<string, unknown> }
  return { type: block.type }
}

class AnthropicProviderPlugin implements ProviderPlugin {
  readonly type = 'anthropic' as const
  readonly name = 'Anthropic'
  readonly description = 'Claude AI models by Anthropic'

  readonly capabilities = {
    chat: true,
    embedding: false,
    listModels: true,
  }

  readonly configSchema = {
    fields: [
      { name: 'api_key', label: 'API Key', type: 'password' as const, required: true, placeholder: 'sk-ant-...', helpText: 'Anthropic API key' },
    ],
  }

  readonly models = [
    { id: 'claude-sonnet-4-20250514', label: 'Claude 4 Sonnet', default: true },
    { id: 'claude-opus-4-20250514', label: 'Claude 4 Opus' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  ]

  private client: Anthropic | null = null
  private currentApiKey: string | null = null

  private getClient(apiKey: string): Anthropic {
    if (this.client && this.currentApiKey === apiKey) return this.client
    this.client = new Anthropic({ apiKey })
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

    const anthropicMessages = params.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: Array.isArray(m.content)
        ? m.content.map(block => toAnthropicBlock(block))
        : m.content as string,
    }))

    const toolDefs = (params.tools ?? []).map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool['input_schema'],
    }))

    const response = await client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
      messages: anthropicMessages,
    })

    return {
      content: response.content.map(block => fromAnthropicBlock(block)),
      usage: calculateUsage(params.model, response.usage),
      stop_reason: response.stop_reason,
    }
  }

  async createSimpleMessage(params: { apiKey: string; model: string; maxTokens: number; prompt: string }): Promise<string> {
    const client = this.getClient(params.apiKey)
    const response = await client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      messages: [{ role: 'user', content: params.prompt }],
    })
    return response.content
      .filter((b): b is TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
  }

  async listModels(apiKey: string): Promise<ProviderModelInfo[]> {
    const client = this.getClient(apiKey)
    const response = await client.models.list({ limit: 100 })
    const models: ProviderModelInfo[] = []

    for await (const model of response) {
      const capabilities: string[] = ['chat']
      models.push({
        id: model.id,
        name: model.display_name || model.id,
        capabilities,
        owned_by: 'anthropic',
      })
    }

    return models.sort((a, b) => a.id.localeCompare(b.id))
  }

  async testConnection(apiKey: string): Promise<ProviderTestResult> {
    const result: ProviderTestResult = { ok: false, chat: false, embedding: false }

    try {
      const client = this.getClient(apiKey)
      await client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      })
      result.chat = true
      result.ok = true
    } catch (err) {
      result.error = (err as Error).message
    }

    // Anthropic does not support embedding
    result.embedding = false

    try {
      result.models = await this.listModels(apiKey)
    } catch { /* models listing is optional */ }

    return result
  }
}

export const anthropicPlugin = new AnthropicProviderPlugin()
