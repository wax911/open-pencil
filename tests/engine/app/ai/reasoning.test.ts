import { describe, expect, test } from 'bun:test'

import type { ModelReasoningOption } from '@open-pencil/core/constants'

import {
  defaultReasoningLevel,
  mergeProviderOptions,
  reasoningBudgetTokens,
  reasoningProviderOptions,
  reasoningSelectorOptions
} from '@/app/ai/reasoning'

describe('reasoningSelectorOptions', () => {
  test('returns empty for models without reasoning', () => {
    expect(reasoningSelectorOptions(undefined)).toEqual([])
    expect(reasoningSelectorOptions([])).toEqual([])
  })

  test('exposes effort values with Off first', () => {
    const options: ModelReasoningOption[] = [
      { type: 'effort', values: ['low', 'medium', 'high'] }
    ]
    expect(reasoningSelectorOptions(options)).toEqual([
      { value: 'off', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' }
    ])
  })

  test('maps none to the Off entry', () => {
    const options: ModelReasoningOption[] = [
      { type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }
    ]
    expect(reasoningSelectorOptions(options).map((option) => option.value)).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh'
    ])
  })

  test('toggle-only models get Off/On', () => {
    expect(reasoningSelectorOptions([{ type: 'toggle' }])).toEqual([
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' }
    ])
  })

  test('budget-token models get normalized levels', () => {
    expect(reasoningSelectorOptions([{ type: 'budget_tokens', min: 1024 }])).toEqual([
      { value: 'off', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' }
    ])
  })

  test('default level is off unless none is supported', () => {
    expect(defaultReasoningLevel(undefined)).toBe('off')
    expect(defaultReasoningLevel([{ type: 'effort', values: ['low', 'high'] }])).toBe('off')
    expect(defaultReasoningLevel([{ type: 'effort', values: ['none', 'low'] }])).toBe('none')
  })
})

describe('reasoningProviderOptions', () => {
  test('openai family maps to reasoningEffort', () => {
    expect(reasoningProviderOptions('openai', undefined, 'high')).toEqual({
      openai: { reasoningEffort: 'high' }
    })
    expect(reasoningProviderOptions('openrouter', undefined, 'max')).toEqual({
      openai: { reasoningEffort: 'max' }
    })
    expect(reasoningProviderOptions('openai-compatible', undefined, 'low')).toEqual({
      openai: { reasoningEffort: 'low' }
    })
  })

  test('openai off omits options unless none is declared', () => {
    expect(reasoningProviderOptions('openai', undefined, 'off')).toBeNull()
    expect(
      reasoningProviderOptions('openai', [{ type: 'effort', values: ['none', 'low'] }], 'none')
    ).toEqual({ openai: { reasoningEffort: 'none' } })
  })

  test('deepseek enables thinking with effort and disables on off', () => {
    expect(reasoningProviderOptions('deepseek', undefined, 'high')).toEqual({
      deepseek: { thinking: { type: 'enabled' }, reasoningEffort: 'high' }
    })
    expect(reasoningProviderOptions('deepseek', undefined, 'off')).toEqual({
      deepseek: { thinking: { type: 'disabled' } }
    })
  })

  test('anthropic uses adaptive effort by default', () => {
    expect(reasoningProviderOptions('anthropic', undefined, 'high')).toEqual({
      anthropic: { thinking: { type: 'adaptive' }, effort: 'high' }
    })
    expect(reasoningProviderOptions('zai', undefined, 'low')).toEqual({
      anthropic: { thinking: { type: 'adaptive' }, effort: 'low' }
    })
    expect(reasoningProviderOptions('anthropic', undefined, 'off')).toEqual({
      anthropic: { thinking: { type: 'disabled' } }
    })
  })

  test('anthropic budget models map levels to budget tokens', () => {
    expect(
      reasoningProviderOptions('anthropic', [{ type: 'budget_tokens', min: 1024 }], 'medium')
    ).toEqual({ anthropic: { thinking: { type: 'enabled', budgetTokens: 8192 } } })
  })

  test('google uses thinkingLevel for effort models and thinkingBudget for budget models', () => {
    expect(
      reasoningProviderOptions('google', [{ type: 'effort', values: ['low', 'high'] }], 'high')
    ).toEqual({
      google: { thinkingConfig: { thinkingLevel: 'high', includeThoughts: true } }
    })
    expect(reasoningProviderOptions('google', [{ type: 'budget_tokens' }], 'low')).toEqual({
      google: { thinkingConfig: { thinkingBudget: 2048, includeThoughts: true } }
    })
  })

  test('unsupported providers return null', () => {
    expect(reasoningProviderOptions('minimax', undefined, 'high')).toBeNull()
  })
})

describe('reasoningBudgetTokens', () => {
  test('maps levels to token budgets', () => {
    expect(reasoningBudgetTokens('low')).toBe(2048)
    expect(reasoningBudgetTokens('medium')).toBe(8192)
    expect(reasoningBudgetTokens('high')).toBe(16_384)
    expect(reasoningBudgetTokens('max')).toBe(65_536)
    expect(reasoningBudgetTokens('unknown')).toBe(8192)
  })
})

describe('mergeProviderOptions', () => {
  test('merges namespaces and nested objects', () => {
    expect(
      mergeProviderOptions(
        { anthropic: { cacheControl: { type: 'ephemeral' } } },
        { anthropic: { thinking: { type: 'adaptive' }, effort: 'high' } }
      )
    ).toEqual({
      anthropic: {
        cacheControl: { type: 'ephemeral' },
        thinking: { type: 'adaptive' },
        effort: 'high'
      }
    })
  })

  test('returns base when extra is null and extra when base is missing', () => {
    const base = { openai: { reasoningEffort: 'low' } }
    expect(mergeProviderOptions(base, null)).toEqual(base)
    expect(mergeProviderOptions(undefined, base)).toEqual(base)
    expect(mergeProviderOptions(undefined, null)).toBeUndefined()
  })
})
