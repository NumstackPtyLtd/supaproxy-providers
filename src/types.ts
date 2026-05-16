import type { Logger } from 'pino'

/** A message in a conversation. */
export interface AIMessage {
  role: 'user' | 'assistant'
  content: string | AIContentBlock[]
}

/** A block of content within a message. */
export interface AIContentBlock {
  type: string       // 'text', 'tool_use', 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

/** Tool specification for the AI model. */
export interface AIToolSpec {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** Normalized token usage with cost — same shape regardless of provider. */
export interface AIUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_tokens?: number
  cache_read_tokens?: number
  /** Cost in USD calculated by the provider using its own pricing. */
  cost_usd: number
}

/** Normalized AI response — same shape regardless of provider. */
export interface AIResponse {
  content: AIContentBlock[]
  usage: AIUsage
  stop_reason: string | null
}

/** Configuration schema field for provider settings. */
export interface ConfigField {
  name: string
  label: string
  type: 'text' | 'password' | 'select'
  required: boolean
  placeholder?: string
  helpText?: string
  options?: string[]
}

/**
 * ProviderPlugin — the contract every AI provider must implement.
 *
 * Every provider normalizes its responses to the same AIResponse shape.
 * Cost calculation happens inside the provider — the server never
 * needs to know provider-specific pricing.
 */
export interface ProviderPlugin {
  /** Unique type identifier: 'anthropic', 'openai', etc. */
  readonly type: string

  /** Human-readable name. */
  readonly name: string

  /** Short description. */
  readonly description: string

  /** Config schema for dashboard settings forms. */
  readonly configSchema: { fields: ConfigField[] }

  /** Supported model IDs this provider handles. */
  readonly models: Array<{ id: string; label: string; default?: boolean }>

  /** Set the API key for this provider. */
  setApiKey(apiKey: string): void

  /** Create a message with tool support. Returns normalized AIResponse. */
  createMessage(params: {
    model: string
    maxTokens: number
    system: string
    tools?: AIToolSpec[]
    messages: AIMessage[]
    apiKey?: string
  }): Promise<AIResponse>

  /** Simple single-turn message (for analysis, summaries, etc). */
  createSimpleMessage(params: {
    apiKey: string
    model: string
    maxTokens: number
    prompt: string
  }): Promise<string>

  /** Whether this provider supports embedding. */
  readonly supportsEmbedding?: boolean

  /** Embedding models available from this provider. */
  readonly embeddingModels?: Array<{ id: string; label: string; dimensions: number; default?: boolean }>

  /** Generate embeddings. Only available if supportsEmbedding is true. */
  embed?(params: {
    apiKey: string
    model?: string
    input: string[]
    dimensions?: number
  }): Promise<EmbeddingResponse>
}

/** Normalized embedding response. */
export interface EmbeddingResponse {
  embeddings: number[][]
  usage: { tokens: number; cost_usd: number }
}
