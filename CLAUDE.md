# @supaproxy/providers

Plugin package for SupaProxy AI provider types. Each provider normalizes its responses to a consistent `AIResponse` shape.

## Architecture

```
src/
├── types.ts          Shared interfaces: AIMessage, AIResponse, AIUsage, ProviderPlugin
├── registry.ts       PluginRegistry singleton — register, get, list, schemas
├── anthropic/        Anthropic provider plugin (Claude models)
│   └── index.ts
├── openai/           OpenAI provider plugin (GPT models)
│   └── index.ts
└── index.ts          Re-exports, auto-registers built-in plugins
```

## Usage

```typescript
import { registry } from '@supaproxy/providers'

const provider = registry.get('anthropic')
const response = await provider.createMessage({ ... })
```

## Adding a Provider

1. Create `src/<provider>/index.ts` implementing `ProviderPlugin`.
2. Include a PRICING table and cost calculation — the provider owns its pricing.
3. Normalize responses to `AIResponse` shape.
4. Export the plugin instance.
5. Register it in `src/index.ts`.

## Build

```bash
pnpm install
pnpm build
```

## Code Rules

- Each provider owns its pricing table — no external pricing dependency.
- All responses normalized to `AIResponse` — consumers never see provider-specific shapes.
- Peer dependencies are optional — only install the SDKs you need.
- Follow the same plugin patterns as `@supaproxy/consumers` and `@supaproxy/connections`.
