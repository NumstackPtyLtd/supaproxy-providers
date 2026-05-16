// Types
export type {
  ProviderPlugin,
  AIMessage,
  AIContentBlock,
  AIToolSpec,
  AIUsage,
  AIResponse,
  ConfigField,
  EmbeddingResponse,
  ProviderModelInfo,
  ProviderTestResult,
} from './types.js'

// Registry
export { registry } from './registry.js'

// Plugins
export { anthropicPlugin } from './anthropic/index.js'
export { openaiPlugin } from './openai/index.js'

// Auto-register all built-in plugins
import { registry } from './registry.js'
import { anthropicPlugin } from './anthropic/index.js'
import { openaiPlugin } from './openai/index.js'

registry.register(anthropicPlugin)
registry.register(openaiPlugin)
