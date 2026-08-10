import type { AIProviderID, ModelOption, ModelReasoningOption } from '@open-pencil/core/constants'

import { readCacheJSON, writeCacheJSON } from '@/app/cache'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const MODELS_DEV_CACHE_KEY = 'models-dev/catalog'
const MODELS_DEV_CACHE_TTL_MS = 24 * 60 * 60 * 1000

const PROVIDER_KEYS: Partial<Record<AIProviderID, readonly string[]>> = {
  openrouter: ['openrouter'],
  anthropic: ['anthropic'],
  openai: ['openai'],
  google: ['google'],
  deepseek: ['deepseek'],
  zai: ['zhipuai'],
  minimax: ['minimax']
}

type ModelsDevModel = {
  id?: unknown
  name?: unknown
  attachment?: unknown
  tool_call?: unknown
  reasoning?: unknown
  reasoning_options?: unknown
  limit?: { output?: unknown }
}

type ModelsDevProvider = {
  models?: Record<string, ModelsDevModel>
}

type ModelsDevCatalog = Record<string, ModelsDevProvider>

let catalogPromise: Promise<ModelsDevCatalog | null> | null = null

type ModelsDevReasoningOption = {
  type?: unknown
  values?: unknown
  min?: unknown
}

function isReasoningOption(value: unknown): value is ModelReasoningOption {
  if (typeof value !== 'object' || value === null) return false
  const record = value as ModelsDevReasoningOption
  if (record.type === 'toggle') return true
  if (record.type === 'effort') {
    return Array.isArray(record.values) && record.values.every((entry) => typeof entry === 'string')
  }
  if (record.type === 'budget_tokens') {
    return record.min === undefined || typeof record.min === 'number'
  }
  return false
}

function normalizeReasoningOptions(value: unknown): ModelReasoningOption[] | undefined {
  if (!Array.isArray(value)) return undefined
  const options = value.filter(isReasoningOption)
  return options.length > 0 ? options : undefined
}

function normalizeModel(id: string, model: ModelsDevModel): ModelOption {
  const capabilities: ('tools' | 'vision')[] = []
  if (model.tool_call === true) capabilities.push('tools')
  if (model.attachment === true) capabilities.push('vision')
  const output = model.limit?.output
  const reasoningOptions = normalizeReasoningOptions(model.reasoning_options)
  return {
    id,
    name: typeof model.name === 'string' && model.name ? model.name : id,
    capabilities,
    ...(model.reasoning === true ? { reasoning: true } : {}),
    ...(reasoningOptions ? { reasoningOptions } : {}),
    ...(typeof output === 'number' && Number.isFinite(output)
      ? { recommendedMaxOutputTokens: Math.min(128_000, Math.max(1024, output)) }
      : {})
  }
}

async function loadCatalog(
  fetcher: typeof fetch,
  options: { useCache: boolean }
): Promise<ModelsDevCatalog | null> {
  if (options.useCache) {
    const cached = await readCacheJSON<ModelsDevCatalog>(
      MODELS_DEV_CACHE_KEY,
      MODELS_DEV_CACHE_TTL_MS
    )
    if (cached) return cached
  }
  try {
    const response = await fetcher(MODELS_DEV_URL)
    if (!response.ok) throw new Error(`models.dev catalog request failed: ${response.status}`)
    const catalog = (await response.json()) as ModelsDevCatalog
    if (options.useCache) await writeCacheJSON(MODELS_DEV_CACHE_KEY, catalog)
    return catalog
  } catch {
    return null
  }
}

function modelIDCandidates(providerKey: string, modelID: string): string[] {
  const unprefixed = modelID.startsWith(`${providerKey}/`)
    ? modelID.slice(providerKey.length + 1)
    : modelID
  return [
    ...new Set([
      modelID,
      unprefixed,
      unprefixed.replace(/-\d{8}$/, ''),
      unprefixed.replace(/:[a-z0-9-]+$/, '')
    ])
  ]
}

export async function resolveModelsDevModel(
  providerID: AIProviderID,
  modelID: string,
  fetcher?: typeof fetch
): Promise<ModelOption | null> {
  const providerKeys = PROVIDER_KEYS[providerID]
  if (!providerKeys?.length || !modelID) return null
  const nativeFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined
  const resolvedFetcher = fetcher ?? nativeFetch
  if (!resolvedFetcher) return null
  const useCache = resolvedFetcher === nativeFetch
  const catalog = await (useCache
    ? (catalogPromise ??= loadCatalog(resolvedFetcher, { useCache: true }))
    : loadCatalog(resolvedFetcher, { useCache: false }))
  if (!catalog) return null

  for (const providerKey of providerKeys) {
    const models = catalog[providerKey]?.models
    for (const candidate of modelIDCandidates(providerKey, modelID)) {
      const matched = models?.[candidate]
      if (matched) return normalizeModel(modelID, matched)
    }
  }
  return null
}

export function resetModelsDevCatalogForTests(): void {
  catalogPromise = null
}
