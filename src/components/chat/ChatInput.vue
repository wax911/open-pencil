<script setup lang="ts">
import { useFileDialog } from '@vueuse/core'
import { TooltipProvider } from 'reka-ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import ChatProfileSelect from '@/components/chat/ChatProfileSelect.vue'
import ProviderModelSelect from '@/components/chat/ProviderModelSelect.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import Tip from '@/components/ui/Tip.vue'
import { useButtonUI } from '@/components/ui/button'
import { useAIChat } from '@/app/ai/chat/use'
import { designModelConnection, designModelProfile, designModelProfiles } from '@/app/ai/models'
import { resolveModelsDevModel } from '@/app/ai/models/catalog'
import { defaultReasoningLevel, reasoningSelectorOptions } from '@/app/ai/reasoning'
import {
  createImagePreviewURL,
  revokeImagePreviewURL,
  validateImageAttachmentFile
} from '@/app/ai/attachment/image/prepare'
import { MAX_IMAGE_ATTACHMENTS, type ImageAttachmentDraft } from '@/app/ai/attachment/image/types'
import { openSettingsDialog } from '@/app/settings/dialog'
import { useI18n } from '@open-pencil/vue'

import { ACP_AGENTS } from '@open-pencil/core/constants'
import type { ModelReasoningOption } from '@open-pencil/core/constants'

const { providerID, providerDef, modelID, customModelID, reasoningOverride, setReasoningOverride } =
  useAIChat()
const { dialogs } = useI18n()

const { status, disabled = false } = defineProps<{
  status: 'ready' | 'submitted' | 'streaming' | 'error'
  disabled?: boolean
}>()

const emit = defineEmits<{
  submit: [text: string, images: ImageAttachmentDraft[]]
  stop: []
  error: [message: string]
}>()

const input = ref('')
const images = ref<ImageAttachmentDraft[]>([])
const { open: openImageDialog, reset: resetImageDialog, onChange: onImageChange } = useFileDialog({
  accept: 'image/png,image/jpeg,image/webp',
  multiple: true,
  reset: true
})

function addImageFiles(files: File[]): void {
  const available = MAX_IMAGE_ATTACHMENTS - images.value.length
  if (available <= 0) {
    emit('error', `You can attach up to ${MAX_IMAGE_ATTACHMENTS} images.`)
    resetImageDialog()
    return
  }
  for (const file of files.slice(0, available)) {
    const validationError = validateImageAttachmentFile(file)
    if (validationError) emit('error', validationError)
    else images.value.push({ file, previewURL: createImagePreviewURL(file) })
  }
  if (files.length > available) emit('error', `You can attach up to ${MAX_IMAGE_ATTACHMENTS} images.`)
  resetImageDialog()
}

function removeImage(index: number): void {
  const image = images.value[index]
  if (image) revokeImagePreviewURL(image.previewURL)
  images.value.splice(index, 1)
  resetImageDialog()
}

function clearImages(): void {
  for (const image of images.value) revokeImagePreviewURL(image.previewURL)
  images.value = []
  resetImageDialog()
}

function handlePaste(event: ClipboardEvent): void {
  const files = event.clipboardData?.files
  const imageFiles = files ? [...files].filter((file) => file.type.startsWith('image/')) : []
  if (imageFiles.length === 0) return
  event.preventDefault()
  addImageFiles(imageFiles)
}

onImageChange((files) => {
  if (files) addImageFiles([...files])
})
onBeforeUnmount(clearImages)

const reasoningOptions = ref<readonly ModelReasoningOption[] | undefined>(undefined)
const reasoningSelector = computed(() => reasoningSelectorOptions(reasoningOptions.value))
const canSelectReasoning = computed(
  () => !isACPProvider.value && reasoningSelector.value.length > 0
)
const profileReasoningEffort = computed(() => designModelProfile.value?.reasoningEffort ?? 'off')
const selectedReasoning = computed({
  get: () => {
    const values = reasoningSelector.value.map((option) => option.value)
    const current = reasoningOverride.value ?? profileReasoningEffort.value
    return current && values.includes(current)
      ? current
      : defaultReasoningLevel(reasoningOptions.value)
  },
  set: (value: string) => {
    setReasoningOverride(value === profileReasoningEffort.value ? null : value)
  }
})

async function refreshReasoningOptions(): Promise<void> {
  const connection = designModelConnection.value
  const profile = designModelProfile.value
  if (!connection || !profile || connection.providerID.startsWith('acp:')) {
    reasoningOptions.value = undefined
    return
  }
  const modelID = profile.customModelID.trim() || profile.modelID
  const catalogModel = await resolveModelsDevModel(connection.providerID, modelID)
  reasoningOptions.value = catalogModel?.reasoningOptions
}

watch(
  () => [
    designModelConnection.value?.providerID,
    designModelProfile.value?.modelID,
    designModelProfile.value?.customModelID
  ],
  () => void refreshReasoningOptions(),
  { immediate: true }
)

const isStreaming = computed(() => disabled || status === 'streaming' || status === 'submitted')
const isAgentProvider = computed(
  () => providerID.value.startsWith('acp:') || providerID.value === 'harness:pi'
)
const isACPProvider = computed(() => providerID.value.startsWith('acp:'))
const acpAgentName = computed(() => {
  if (providerID.value === 'harness:pi') return 'Pi'
  const agentId = providerID.value.replace('acp:', '')
  return ACP_AGENTS.find((a) => a.id === agentId)?.name ?? agentId
})
const isCustomProvider = computed(
  () => providerID.value === 'openai-compatible' || providerID.value === 'anthropic-compatible'
)
const stopButton = useButtonUI({
  tone: 'ghost',
  shape: 'rounded',
  size: 'sm',
  ui: { base: 'shrink-0 border border-border px-2 py-1.5' }
})
const sendButton = useButtonUI({
  tone: 'accent',
  shape: 'rounded',
  size: 'sm',
  ui: { base: 'shrink-0 px-2.5 py-1.5 font-medium' }
})
const customModelName = computed(() => customModelID.value.trim())
const usesCustomModel = computed(
  () => !!providerDef.value.supportsCustomModel && !!customModelName.value
)

const selectedModelName = computed(() => {
  if (usesCustomModel.value) return customModelName.value
  if (isCustomProvider.value) return 'No model'
  return providerDef.value.models.find((m) => m.id === modelID.value)?.name ?? modelID.value
})

// Switching between saved profiles only makes sense once more than one can drive the design agent.
const switchableProfiles = computed(designModelProfiles)
const canSwitchProfile = computed(() => switchableProfiles.value.length > 1)
const selectedProfileName = computed(
  () => designModelProfile.value?.name ?? selectedModelName.value
)

function handleSubmit(e: Event) {
  e.preventDefault()
  const text = input.value.trim()
  if (!text) return
  const submittedImages = images.value
  images.value = []
  resetImageDialog()
  emit('submit', text, submittedImages)
  input.value = ''
}

function handleInputKeydown(event: KeyboardEvent): void {
  if (event.code !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  const target = event.currentTarget
  if (target instanceof HTMLElement) target.closest('form')?.requestSubmit()
}
</script>

<template>
  <TooltipProvider>
    <div class="shrink-0 border-t border-border p-2.5">
      <form @submit="handleSubmit" @paste.stop="handlePaste">
        <div v-if="images.length" class="mb-2 flex flex-wrap gap-1.5">
          <div
            v-for="(image, index) in images"
            :key="image.previewURL"
            class="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-border bg-canvas p-1.5 shadow-xs"
          >
            <img
              :src="image.previewURL"
              :alt="image.file.name"
              width="40"
              height="40"
              class="size-10 shrink-0 rounded-md border border-border object-cover"
            />
            <span class="min-w-0 flex-1 truncate text-[10px] text-surface">{{ image.file.name }}</span>
            <button
              type="button"
              class="rounded p-1 text-muted hover:bg-hover hover:text-surface"
              :aria-label="`Remove image ${image.file.name}`"
              @click="removeImage(index)"
            >
              <icon-lucide-x class="size-3" />
            </button>
          </div>
        </div>

        <!-- Model selector & settings -->
        <div class="mb-1.5 flex items-center gap-1">
          <template v-if="isAgentProvider">
            <div class="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted">
              <icon-lucide-bot class="size-3" />
              {{ acpAgentName }}
            </div>
          </template>
          <ChatProfileSelect v-else-if="canSwitchProfile && (isCustomProvider || usesCustomModel)">
            <template #value>
              <span class="min-w-0 truncate">{{ selectedProfileName }}</span>
            </template>
          </ChatProfileSelect>
          <template v-else-if="isCustomProvider || usesCustomModel">
            <div
              class="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted"
              data-test-id="chat-custom-model-label"
            >
              <icon-lucide-bot class="size-3" />
              {{ selectedModelName }}
            </div>
          </template>
          <ProviderModelSelect v-else>
            <template #value>{{ selectedModelName }}</template>
          </ProviderModelSelect>

          <AppSelect
            v-if="canSelectReasoning"
            v-model="selectedReasoning"
            :label="dialogs.reasoningEffort"
            data-test-id="chat-reasoning-select"
            class="ml-2"
            :options="reasoningSelector"
            :ui="{
              trigger:
                'flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[10px] text-muted hover:bg-hover',
              content: 'min-w-28',
              item: 'rounded px-2 py-1 text-[11px]'
            }"
          />

          <div class="ml-auto">
            <Tip :label="dialogs.providerSettings">
              <button
                type="button"
                data-test-id="provider-settings-trigger"
                :aria-label="dialogs.providerSettings"
                class="rounded p-0.5 text-muted hover:bg-hover hover:text-surface"
                @click="openSettingsDialog('ai')"
              >
                <icon-lucide-settings class="size-3" />
              </button>
            </Tip>
          </div>
        </div>

        <!-- Input form -->
        <div class="flex gap-1.5">
          <button
            type="button"
            class="shrink-0 rounded p-1.5 text-muted hover:bg-hover hover:text-surface disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="isStreaming || images.length >= MAX_IMAGE_ATTACHMENTS"
            aria-label="Attach images"
            @click="openImageDialog()"
          >
            <icon-lucide-image-plus class="size-4" />
          </button>
          <textarea
            v-model="input"
            data-test-id="chat-input"
            :placeholder="dialogs.describeChange"
            :disabled="isStreaming"
            rows="2"
            aria-label="Describe a change"
            class="block min-h-12 min-w-0 flex-1 resize-none bg-transparent px-2 pt-1.5 text-xs leading-relaxed text-surface outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60"
            @keydown="handleInputKeydown"
            @copy.stop
            @cut.stop
          />
          <Tip v-if="isStreaming" :label="dialogs.stopGenerating">
            <button
              type="button"
              data-test-id="chat-stop-button"
              :class="stopButton.base"
              @click="emit('stop')"
            >
              <icon-lucide-square class="size-3" />
            </button>
          </Tip>
          <Tip v-else :label="dialogs.sendMessage">
            <button
              type="submit"
              data-test-id="chat-send-button"
              :class="sendButton.base"
              :disabled="!input.trim()"
            >
              <icon-lucide-send class="size-3" />
            </button>
          </Tip>
        </div>
      </form>
    </div>
  </TooltipProvider>
</template>
