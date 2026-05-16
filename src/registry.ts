import pino from 'pino'
import type { ProviderPlugin } from './types.js'

const log = pino({ name: 'provider-registry' })

/**
 * Plugin registry — discovers and manages provider plugins.
 *
 * Usage:
 *   import { registry } from '@supaproxy/providers'
 *   registry.list()              // all registered plugins
 *   registry.get('anthropic')    // get a specific plugin
 *   registry.schemas()           // config schemas for dashboard
 */
class PluginRegistry {
  /** @internal */
  readonly plugins = new Map<string, ProviderPlugin>()

  /** Register a provider plugin. Called automatically by each plugin module. */
  register(plugin: ProviderPlugin): void {
    if (this.plugins.has(plugin.type)) {
      log.warn({ type: plugin.type }, 'Plugin already registered, replacing')
    }
    this.plugins.set(plugin.type, plugin)
    log.info({ type: plugin.type, name: plugin.name }, 'Provider plugin registered')
  }

  /** Get a plugin by type. Throws if not found. */
  get(type: string): ProviderPlugin {
    const plugin = this.plugins.get(type)
    if (!plugin) {
      throw new Error(`Provider plugin not found: ${type}`)
    }
    return plugin
  }

  /** Check if a plugin type is registered. */
  has(type: string): boolean {
    return this.plugins.has(type)
  }

  /** List all registered plugin types. */
  types(): string[] {
    return Array.from(this.plugins.keys())
  }

  /** List all registered plugins. */
  list(): ProviderPlugin[] {
    return Array.from(this.plugins.values())
  }

  /**
   * Return config schemas for all plugins — used by
   * GET /api/providers/types to drive dashboard form rendering.
   */
  schemas(): Array<{
    type: string
    name: string
    description: string
    configSchema: ProviderPlugin['configSchema']
    models: ProviderPlugin['models']
    capabilities?: ProviderPlugin['capabilities']
    embeddingModels?: ProviderPlugin['embeddingModels']
  }> {
    return this.list().map((p) => ({
      type: p.type,
      name: p.name,
      description: p.description,
      configSchema: p.configSchema,
      models: p.models,
      capabilities: p.capabilities,
      embeddingModels: p.embeddingModels,
    }))
  }
}

/** Singleton registry instance. */
export const registry = new PluginRegistry()
