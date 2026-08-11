import type { AIProviderID, ModelReasoningOption } from '@open-pencil/core/constants'

// Default reasoning controls for providers whose models generally support
// reasoning. Used when the models.dev catalog is unreachable or does not list
// the configured model (e.g. openai-compatible / anthropic-compatible custom
// endpoints), so the reasoning-effort selector and defaults still work.
const REASONING_FALLBACK: readonly ModelReasoningOption[] = [
  { type: 'effort', values: ['low', 'medium', 'high'] }
]

const REASONING_FALLBACK_PROVIDERS: ReadonlySet<AIProviderID> = new Set<AIProviderID>([
  'openai',
  'openrouter',
  'deepseek',
  'google',
  'anthropic',
  'zai',
  'openai-compatible',
  'anthropic-compatible'
])

export function fallbackReasoningOptions(
  providerID: AIProviderID
): readonly ModelReasoningOption[] | undefined {
  return REASONING_FALLBACK_PROVIDERS.has(providerID) ? REASONING_FALLBACK : undefined
}
