# @supaproxy/providers

[![npm version](https://img.shields.io/npm/v/@supaproxy/providers)](https://www.npmjs.com/package/@supaproxy/providers)
[![license](https://img.shields.io/npm/l/@supaproxy/providers)](./LICENSE)

Plugin package for [SupaProxy](https://supaproxy.com) AI provider types. Providers normalize different AI APIs (Anthropic, OpenAI, etc.) into a single consistent interface with built-in cost tracking.

Every provider returns the same `AIResponse` shape regardless of the underlying API, and calculates `cost_usd` using its own pricing -- the server never needs to know provider-specific pricing.

## Installation

```bash
npm install @supaproxy/providers
```

### Peer dependencies

Install the SDKs for the providers you plan to use:

```bash
# For Anthropic (Claude)
npm install @anthropic-ai/sdk

# For OpenAI (GPT)
npm install openai
```

## Quick start

```typescript
import { registry } from '@supaproxy/providers'

// All built-in plugins are auto-registered on import.

// List available providers
console.log(registry.types()) // ['anthropic', 'openai']

// Get a provider and set its API key
const anthropic = registry.get('anthropic')
anthropic.setApiKey('sk-ant-...')

// Create a message with tool support
const response = await anthropic.createMessage({
  model: 'claude-sonnet-4-20250514',
  maxTokens: 1024,
  system: 'You are a helpful assistant.',
  tools: [
    {
      name: 'search',
      description: 'Search the knowledge base',
      input_schema: { type: 'object', properties: { query: { type: 'string' } } },
    },
  ],
  messages: [{ role: 'user', content: 'What is SupaProxy?' }],
})

console.log(response.content)       // AIContentBlock[]
console.log(response.usage.cost_usd) // Cost in USD
console.log(response.stop_reason)    // 'end_turn', 'tool_use', etc.

// Simple single-turn message (for summaries, analysis)
const summary = await anthropic.createSimpleMessage({
  apiKey: 'sk-ant-...',
  model: 'claude-sonnet-4-20250514',
  maxTokens: 512,
  prompt: 'Summarize this conversation...',
})
```

## API reference

### `ProviderPlugin`

The interface every AI provider must implement.

```typescript
interface ProviderPlugin {
  readonly type: string          // Unique identifier: 'anthropic', 'openai', etc.
  readonly name: string          // Human-readable name
  readonly description: string   // Short description
  readonly configSchema: { fields: ConfigField[] }
  readonly models: Array<{ id: string; label: string; default?: boolean }>

  setApiKey(apiKey: string): void

  createMessage(params: {
    model: string
    maxTokens: number
    system: string
    tools: AIToolSpec[]
    messages: AIMessage[]
    apiKey?: string
  }): Promise<AIResponse>

  createSimpleMessage(params: {
    apiKey: string
    model: string
    maxTokens: number
    prompt: string
  }): Promise<string>
}
```

### `AIResponse`

Normalized response -- same shape regardless of provider.

```typescript
interface AIResponse {
  content: AIContentBlock[]
  usage: AIUsage
  stop_reason: string | null
}
```

### `AIUsage`

Token usage with cost calculation.

```typescript
interface AIUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_tokens?: number
  cache_read_tokens?: number
  cost_usd: number               // Calculated by the provider using its own pricing
}
```

### `AIMessage`

```typescript
interface AIMessage {
  role: 'user' | 'assistant'
  content: string | AIContentBlock[]
}
```

### `AIContentBlock`

```typescript
interface AIContentBlock {
  type: string       // 'text', 'tool_use', 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}
```

### `AIToolSpec`

```typescript
interface AIToolSpec {
  name: string
  description: string
  input_schema: Record<string, unknown>
}
```

### `ConfigField`

```typescript
interface ConfigField {
  name: string
  label: string
  type: 'text' | 'password' | 'select'
  required: boolean
  placeholder?: string
  helpText?: string
  options?: string[]
}
```

### Registry methods

| Method | Returns | Description |
|--------|---------|-------------|
| `registry.list()` | `ProviderPlugin[]` | All registered plugins |
| `registry.get(type)` | `ProviderPlugin` | Get plugin by type (throws if not found) |
| `registry.has(type)` | `boolean` | Check if a plugin type is registered |
| `registry.types()` | `string[]` | List all registered type identifiers |
| `registry.schemas()` | `Array<{type, name, description, configSchema}>` | Config schemas for dashboard forms |
| `registry.register(plugin)` | `void` | Register a custom plugin |

## Available plugins

| Plugin | Type | Description |
|--------|------|-------------|
| Anthropic | `anthropic` | Claude models (Claude Sonnet, Opus, Haiku). Uses the `@anthropic-ai/sdk`. Includes cache-aware cost calculation. |
| OpenAI | `openai` | GPT models (GPT-4o, GPT-4, etc.). Uses the `openai` SDK. |

## Adding a new provider

Create a file that implements `ProviderPlugin`:

```typescript
import type { ProviderPlugin, AIResponse } from '@supaproxy/providers'

export const myPlugin: ProviderPlugin = {
  type: 'my-provider',
  name: 'My Provider',
  description: 'Custom AI provider',
  configSchema: {
    fields: [
      { name: 'apiKey', label: 'API Key', type: 'password', required: true },
    ],
  },
  models: [
    { id: 'my-model-large', label: 'My Model Large', default: true },
    { id: 'my-model-small', label: 'My Model Small' },
  ],

  setApiKey(apiKey) {
    // Store the API key for subsequent requests
  },

  async createMessage(params): Promise<AIResponse> {
    // Call your provider's API
    // Normalize the response to AIResponse shape
    // Calculate cost_usd using your provider's pricing
    return {
      content: [{ type: 'text', text: 'Hello!' }],
      usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0.001 },
      stop_reason: 'end_turn',
    }
  },

  async createSimpleMessage(params) {
    // Simple single-turn text response
    return 'Response text'
  },
}
```

Then register it:

```typescript
import { registry } from '@supaproxy/providers'
import { myPlugin } from './my-plugin.js'

registry.register(myPlugin)
```

## Contributing

See the [SupaProxy contributing guide](https://github.com/NumstackPtyLtd/supaproxy) for development workflow, code standards, and PR process.

## Documentation

Full documentation at [docs.supaproxy.cloud](https://docs.supaproxy.cloud/plugins/providers).

## License

MIT
