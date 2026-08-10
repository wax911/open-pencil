import { StorageSerializers, useLocalStorage } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

const STORAGE_PREFIX = 'open-pencil:'
const DESIGN_DOC_KEY = `${STORAGE_PREFIX}design-doc`

type DesignDocSettings = {
  version: 1
  enabled: boolean
  content: string
  fileName: string
}

const designDocStorage = useLocalStorage<unknown>(DESIGN_DOC_KEY, null, {
  serializer: StorageSerializers.object,
  writeDefaults: false
})

function isDesignDocSettings(value: unknown): value is DesignDocSettings {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<DesignDocSettings>
  return candidate.version === 1 && typeof candidate.content === 'string'
}

function loadSettings(): DesignDocSettings {
  const stored = designDocStorage.value
  if (isDesignDocSettings(stored)) {
    return {
      version: 1,
      enabled: stored.enabled,
      content: stored.content,
      fileName: typeof stored.fileName === 'string' ? stored.fileName : ''
    }
  }
  return { version: 1, enabled: false, content: '', fileName: '' }
}

const settings = ref<DesignDocSettings>(loadSettings())

watch(
  settings,
  (value) => {
    designDocStorage.value = value
  },
  { deep: true }
)

export const designDocEnabled = computed({
  get: () => settings.value.enabled,
  set: (enabled: boolean) => {
    settings.value.enabled = enabled
  }
})

export const designDocContent = computed({
  get: () => settings.value.content,
  set: (content: string) => {
    settings.value.content = content
  }
})

export const designDocFileName = computed({
  get: () => settings.value.fileName,
  set: (fileName: string) => {
    settings.value.fileName = fileName
  }
})

/** Whether a design doc is loaded AND enabled for the AI system prompt. */
export const designDocActive = computed(
  () => settings.value.enabled && settings.value.content.trim().length > 0
)

export function setDesignDoc(content: string, fileName = 'DESIGN.md'): void {
  settings.value.content = content
  settings.value.fileName = fileName
  settings.value.enabled = Boolean(content.trim())
}

export function clearDesignDoc(): void {
  settings.value.content = ''
  settings.value.fileName = ''
  settings.value.enabled = false
}

export function resetDesignDocForTests(): void {
  clearDesignDoc()
  settings.value = { version: 1, enabled: false, content: '', fileName: '' }
}
