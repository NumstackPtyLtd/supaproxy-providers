import { describe, it, expect, beforeEach } from 'vitest'
import { registry } from './registry.js'
import type { ProviderPlugin, AIResponse } from './types.js'

// ── Helpers ──

function makeMockPlugin(type: string, overrides?: Partial<ProviderPlugin>): ProviderPlugin {
  return {
    type,
    name: `${type} Provider`,
    description: `Mock ${type} provider`,
    configSchema: {
      fields: [
        { name: 'api_key', label: 'API key', type: 'password', required: true },
      ],
    },
    models: [
      { id: `${type}-model-1`, label: 'Model 1', default: true },
      { id: `${type}-model-2`, label: 'Model 2' },
    ],
    setApiKey: () => {},
    createMessage: async (): Promise<AIResponse> => ({
      content: [{ type: 'text', text: 'Hello' }],
      usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0.001 },
      stop_reason: 'end_turn',
    }),
    createSimpleMessage: async () => 'Simple response',
    ...overrides,
  }
}

// ── Registry tests ──

describe('ProviderRegistry', () => {
  beforeEach(() => {
    // Clear registry for isolation (registry is a singleton)
    registry.plugins.clear()
  })

  describe('register', () => {
    it('registers a plugin', () => {
      const plugin = makeMockPlugin('test-provider')
      registry.register(plugin)
      expect(registry.has('test-provider')).toBe(true)
    })

    it('replaces an existing plugin with the same type', () => {
      const plugin1 = makeMockPlugin('dup', { name: 'Version 1' })
      const plugin2 = makeMockPlugin('dup', { name: 'Version 2' })
      registry.register(plugin1)
      registry.register(plugin2)
      expect(registry.get('dup').name).toBe('Version 2')
    })
  })

  describe('get', () => {
    it('returns the registered plugin', () => {
      const plugin = makeMockPlugin('fetch-me')
      registry.register(plugin)
      expect(registry.get('fetch-me')).toBe(plugin)
    })

    it('throws for an unknown type', () => {
      expect(() => registry.get('nonexistent')).toThrow('Provider plugin not found: nonexistent')
    })
  })

  describe('has', () => {
    it('returns true for registered types', () => {
      registry.register(makeMockPlugin('exists'))
      expect(registry.has('exists')).toBe(true)
    })

    it('returns false for unregistered types', () => {
      expect(registry.has('missing')).toBe(false)
    })
  })

  describe('types', () => {
    it('returns empty array when no plugins registered', () => {
      expect(registry.types()).toEqual([])
    })

    it('returns all registered type strings', () => {
      registry.register(makeMockPlugin('alpha'))
      registry.register(makeMockPlugin('beta'))
      expect(registry.types()).toEqual(['alpha', 'beta'])
    })
  })

  describe('list', () => {
    it('returns empty array when no plugins registered', () => {
      expect(registry.list()).toEqual([])
    })

    it('returns all registered plugins', () => {
      const a = makeMockPlugin('a')
      const b = makeMockPlugin('b')
      registry.register(a)
      registry.register(b)
      expect(registry.list()).toEqual([a, b])
    })
  })

  describe('schemas', () => {
    it('returns empty array when no plugins registered', () => {
      expect(registry.schemas()).toEqual([])
    })

    it('returns config schemas for all plugins', () => {
      registry.register(makeMockPlugin('schema-test'))
      const schemas = registry.schemas()
      expect(schemas).toHaveLength(1)
      expect(schemas[0].type).toBe('schema-test')
      expect(schemas[0].name).toBe('schema-test Provider')
      expect(schemas[0].description).toBeDefined()
      expect(schemas[0].configSchema.fields).toHaveLength(1)
      expect(schemas[0].models).toHaveLength(2)
    })

    it('includes all schema fields', () => {
      registry.register(makeMockPlugin('full'))
      const schema = registry.schemas()[0]
      expect(schema).toHaveProperty('type')
      expect(schema).toHaveProperty('name')
      expect(schema).toHaveProperty('description')
      expect(schema).toHaveProperty('configSchema')
      expect(schema).toHaveProperty('models')
    })
  })
})

// ── Plugin contract compliance ──

describe('ProviderPlugin contract', () => {
  it('mock plugin satisfies the full interface', () => {
    const plugin = makeMockPlugin('contract-test')
    expect(typeof plugin.type).toBe('string')
    expect(typeof plugin.name).toBe('string')
    expect(typeof plugin.description).toBe('string')
    expect(Array.isArray(plugin.configSchema.fields)).toBe(true)
    expect(Array.isArray(plugin.models)).toBe(true)
    expect(typeof plugin.setApiKey).toBe('function')
    expect(typeof plugin.createMessage).toBe('function')
    expect(typeof plugin.createSimpleMessage).toBe('function')
  })

  it('createMessage returns normalised AIResponse shape', async () => {
    const plugin = makeMockPlugin('response-test')
    const response = await plugin.createMessage({
      model: 'test',
      maxTokens: 100,
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'Hello' }],
    })
    expect(response.content).toBeDefined()
    expect(Array.isArray(response.content)).toBe(true)
    expect(response.usage).toBeDefined()
    expect(typeof response.usage.input_tokens).toBe('number')
    expect(typeof response.usage.output_tokens).toBe('number')
    expect(typeof response.usage.cost_usd).toBe('number')
    expect(response.stop_reason).toBeDefined()
  })

  it('createMessage works without tools (optional param)', async () => {
    const plugin = makeMockPlugin('no-tools')
    const response = await plugin.createMessage({
      model: 'test',
      maxTokens: 100,
      system: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })
    expect(response.action).toBeUndefined()
    expect(response.content).toBeDefined()
  })

  it('createSimpleMessage returns a string', async () => {
    const plugin = makeMockPlugin('simple')
    const result = await plugin.createSimpleMessage({
      apiKey: 'key',
      model: 'test',
      maxTokens: 100,
      prompt: 'Summarise this.',
    })
    expect(typeof result).toBe('string')
  })

  it('models array has at least one entry with id and label', () => {
    const plugin = makeMockPlugin('models-check')
    expect(plugin.models.length).toBeGreaterThan(0)
    for (const model of plugin.models) {
      expect(typeof model.id).toBe('string')
      expect(typeof model.label).toBe('string')
    }
  })

  it('models array has exactly one default', () => {
    const plugin = makeMockPlugin('default-model')
    const defaults = plugin.models.filter(m => m.default)
    expect(defaults.length).toBe(1)
  })
})
