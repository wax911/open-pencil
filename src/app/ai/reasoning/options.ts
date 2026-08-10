import type { ModelReasoningOption } from '@open-pencil/core/constants'

export type ReasoningSelectorOption = {
  value: string
  label: string
}

const EFFORT_LABELS: Record<string, string> = {
  off: 'Off',
  on: 'On',
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
}

export function effortValuesOf(options: readonly ModelReasoningOption[] | undefined): string[] {
  if (!options) return []
  return [
    ...new Set(
      options
        .filter(
          (option): option is Extract<ModelReasoningOption, { type: 'effort' }> =>
            option.type === 'effort'
        )
        .flatMap((option) => option.values)
    )
  ]
}

function hasToggle(options: readonly ModelReasoningOption[] | undefined): boolean {
  return Boolean(options?.some((option) => option.type === 'toggle'))
}

function hasBudgetOnly(options: readonly ModelReasoningOption[] | undefined): boolean {
  return Boolean(options?.length && options.every((option) => option.type === 'budget_tokens'))
}

/**
 * Derives the selectable reasoning levels for a model from its declared
 * reasoning options (models.dev). Returns an empty list when the model does
 * not support reasoning.
 *
 * - `effort` models: `Off` first, then the model's effort values verbatim
 *   (`none` becomes the `Off` entry when the model supports it).
 * - budget-token models: normalized `Off` / `Low` / `Medium` / `High`.
 * - toggle-only models: `Off` / `On`.
 */
export function reasoningSelectorOptions(
  options: readonly ModelReasoningOption[] | undefined
): ReasoningSelectorOption[] {
  if (!options?.length) return []
  const effortValues = effortValuesOf(options)
  if (effortValues.length > 0) {
    const offValue = effortValues.includes('none') ? 'none' : 'off'
    return [
      { value: offValue, label: EFFORT_LABELS.off },
      ...effortValues
        .filter((value) => value !== 'none')
        .map((value) => ({ value, label: EFFORT_LABELS[value] ?? value }))
    ]
  }
  if (hasBudgetOnly(options)) {
    return [
      { value: 'off', label: EFFORT_LABELS.off },
      { value: 'low', label: EFFORT_LABELS.low },
      { value: 'medium', label: EFFORT_LABELS.medium },
      { value: 'high', label: EFFORT_LABELS.high }
    ]
  }
  if (hasToggle(options)) {
    return [
      { value: 'off', label: EFFORT_LABELS.off },
      { value: 'on', label: EFFORT_LABELS.on }
    ]
  }
  return []
}

/** The default level for a model (its "as configured" baseline). */
export function defaultReasoningLevel(
  options: readonly ModelReasoningOption[] | undefined
): string {
  if (!options?.length) return 'off'
  const effortValues = effortValuesOf(options)
  if (effortValues.length > 0) return effortValues.includes('none') ? 'none' : 'off'
  return 'off'
}
