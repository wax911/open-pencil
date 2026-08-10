import type { AIProviderID, ModelReasoningOption } from '@open-pencil/core/constants'

import { effortValuesOf } from '@/app/ai/reasoning/options'

// Structurally mirrors the AI SDK `ProviderOptions` type (Record of JSON objects)
// so the options can be passed straight to language model provider options.
type JSONLikeValue =
  | string
  | number
  | boolean
  | null
  | JSONLikeValue[]
  | { [key: string]: JSONLikeValue }
type JSONLikeObject = { [key: string]: JSONLikeValue }

export type ReasoningProviderOptions = Record<string, JSONLikeObject> | null
type ReasoningProviderOptionsObject = Record<string, JSONLikeObject>

const BUDGET_BY_LEVEL: Record<string, number> = {
  none: 1024,
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16_384,
  xhigh: 32_768,
  max: 65_536
}

const DEFAULT_BUDGET = 8192

export function reasoningBudgetTokens(level: string): number {
  return BUDGET_BY_LEVEL[level] ?? DEFAULT_BUDGET
}

function isOpenAIFamily(providerID: AIProviderID): boolean {
  return (
    providerID === 'openai' || providerID === 'openai-compatible' || providerID === 'openrouter'
  )
}

function isAnthropicFamily(providerID: AIProviderID): boolean {
  return providerID === 'anthropic' || providerID === 'anthropic-compatible' || providerID === 'zai'
}

function hasBudgetOnly(options: readonly ModelReasoningOption[] | undefined): boolean {
  return Boolean(options?.length && options.every((option) => option.type === 'budget_tokens'))
}

function offProviderOptions(
  providerID: AIProviderID,
  options: readonly ModelReasoningOption[] | undefined
): ReasoningProviderOptions {
  if (isOpenAIFamily(providerID)) {
    // Only send an explicit `none` when the model declares it; otherwise omit so
    // the provider default applies.
    if (effortValuesOf(options).includes('none')) return { openai: { reasoningEffort: 'none' } }
    return null
  }
  if (providerID === 'deepseek') return { deepseek: { thinking: { type: 'disabled' } } }
  if (isAnthropicFamily(providerID)) return { anthropic: { thinking: { type: 'disabled' } } }
  return null
}

/**
 * Builds provider-specific provider options for a reasoning level.
 *
 * Verified provider SDK mappings:
 * - openai / openai-compatible / openrouter → `openai.reasoningEffort`
 * - deepseek → `deepseek.thinking` + `deepseek.reasoningEffort`
 * - anthropic / anthropic-compatible / zai → adaptive `effort` or budget `budgetTokens`
 * - google → `thinkingLevel` (Gemini 3+) or `thinkingBudget` (Gemini 2.5)
 */
export function reasoningProviderOptions(
  providerID: AIProviderID,
  options: readonly ModelReasoningOption[] | undefined,
  level: string
): ReasoningProviderOptions {
  if (!level || level === 'off' || level === '') {
    return offProviderOptions(providerID, options)
  }
  if (isOpenAIFamily(providerID)) {
    return { openai: { reasoningEffort: level } }
  }
  if (providerID === 'deepseek') {
    return {
      deepseek: {
        thinking: { type: 'enabled' },
        ...(level === 'low' || level === 'medium' || level === 'high'
          ? { reasoningEffort: level }
          : {})
      }
    }
  }
  if (isAnthropicFamily(providerID)) {
    if (hasBudgetOnly(options)) {
      return {
        anthropic: { thinking: { type: 'enabled', budgetTokens: reasoningBudgetTokens(level) } }
      }
    }
    return { anthropic: { thinking: { type: 'adaptive' }, effort: level } }
  }
  if (providerID === 'google') {
    if (hasBudgetOnly(options)) {
      return {
        google: {
          thinkingConfig: {
            thinkingBudget: reasoningBudgetTokens(level),
            includeThoughts: true
          }
        }
      }
    }
    return {
      google: { thinkingConfig: { thinkingLevel: level, includeThoughts: true } }
    }
  }
  return null
}

/**
 * Merges the Anthropic cache-control provider options with reasoning options.
 * Provider namespaces are merged shallowly (e.g. both `anthropic` entries).
 */
export function mergeProviderOptions(
  base: ReasoningProviderOptionsObject | undefined,
  extra: ReasoningProviderOptionsObject | null | undefined
): ReasoningProviderOptionsObject | undefined {
  if (!extra) return base
  if (!base) return extra
  const merged: ReasoningProviderOptionsObject = { ...base }
  for (const [key, value] of Object.entries(extra)) {
    merged[key] = { ...merged[key], ...value }
  }
  return merged
}
