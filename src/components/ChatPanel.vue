<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport
} from 'reka-ui'
import { refAutoReset, useClipboard } from '@vueuse/core'
import { computed, markRaw, nextTick, ref, watch } from 'vue'

import { getACPDebugText, clearACPDebugLog, hasACPDebugEntries } from '@/app/ai/acp/transport'
import { copyChatLog } from '@/app/ai/debug'
import {
  analyzeAttachedImages,
  designMessageWithImageFindings
} from '@/app/ai/attachment/image/analyze'
import {
  createImagePreviewURL,
  isImageAttachmentMediaType,
  prepareImageAttachment,
  revokeImagePreviewURL
} from '@/app/ai/attachment/image/prepare'
import {
  clearImageAttachmentPresentations,
  setImageAttachmentPresentations
} from '@/app/ai/attachment/image/presentation'
import type { ImageAttachmentDraft } from '@/app/ai/attachment/image/types'
import { clearToolLogEntries, didHitStepLimit } from '@/app/ai/tools'
import { designDocActive, designDocEnabled, designDocFileName } from '@/app/ai/design-doc/store'
import { activeTab } from '@/app/tabs'
import { getActiveEditorStore } from '@/app/editor/active-store'
import ACPPermissionDialog from '@/components/chat/ACPPermissionDialog.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import ChatMessage from '@/components/chat/ChatMessage.vue'
import AppPlaceholder from '@/components/ui/AppPlaceholder.vue'
import AppTextButton from '@/components/ui/AppTextButton.vue'
import Tip from '@/components/ui/Tip.vue'
import { menuItem, useMenuUI } from '@/components/ui/menu'
import ProviderSetup from '@/components/chat/ProviderSetup.vue'
import { useAIChat } from '@/app/ai/chat/use'
import { toast } from '@/app/shell/ui'
import { useI18n } from '@open-pencil/vue'

import type { Chat } from '@ai-sdk/vue'
import type { UIMessage } from 'ai'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

const IS_DEV = import.meta.env.DEV

const {
  isConfigured,
  ensureChat,
  conversations,
  activeConversationTitle,
  newConversation,
  switchConversation,
  deleteConversation,
  chatFailure,
  clearChatFailure,
  resetChat
} = useAIChat()
const { copy } = useClipboard()
const { dialogs } = useI18n()

const chat = ref<Chat<UIMessage> | null>(null)
const isPreparingImages = ref(false)
let attachmentOperationVersion = 0
const menuCls = useMenuUI({ content: 'min-w-56' })
const itemCls = menuItem({ justify: 'start' })

void ensureChat()
  .then((c) => {
    if (c) chat.value = markRaw(c)
    return undefined
  })
  .catch((error: unknown) => {
    toast.error(error instanceof Error ? error.message : 'Failed to initialize chat')
  })
const messagesEnd = ref<HTMLDivElement>()
const debugCopied = refAutoReset(false, 1500)
const acpLogCopied = refAutoReset(false, 1500)

const designDocLabel = computed(() =>
  designDocActive.value
    ? designDocFileName.value || dialogs.value.designDoc
    : dialogs.value.designDoc
)

const messages = computed(() => chat.value?.messages ?? [])
const failureMessage = computed(() => {
  switch (chatFailure.value?.reason) {
    case 'insufficient-credit':
      return dialogs.value.chatInsufficientCredit
    case 'output-limit':
      return dialogs.value.chatOutputLimit
    case 'request-failed':
      return dialogs.value.chatRequestFailed
    default:
      return null
  }
})
const status = computed(() => chat.value?.status ?? 'ready')
const isThinking = computed(() => {
  const s = status.value
  if (s !== 'submitted' && s !== 'streaming') return false
  if (messages.value.length === 0) return true
  const last = messages.value[messages.value.length - 1]
  if (last.role !== 'assistant') return true
  const parts = last.parts
  if (parts.length === 0) return true
  const lastPart = parts[parts.length - 1] as JSONObject
  if (lastPart.type === 'step-start') return true
  if ('toolCallId' in lastPart && lastPart.state === 'output-available') return true
  if ('toolCallId' in lastPart && lastPart.state === 'output-error') return true
  return s === 'submitted'
})

const showContinue = computed(() => {
  if (status.value !== 'ready') return false
  if (messages.value.length === 0) return false
  const last = messages.value[messages.value.length - 1]
  return last.role === 'assistant' && didHitStepLimit()
})

function scrollToBottom() {
  nextTick(() => {
    messagesEnd.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  })
}

watch(messages, scrollToBottom, { deep: true })
watch(
  () => chatFailure.value?.reason,
  (reason) => {
    if (reason) toast.error(failureMessage.value ?? dialogs.value.chatRequestFailed)
  }
)
watch(
  () => activeTab.value?.id,
  async () => {
    attachmentOperationVersion += 1
    isPreparingImages.value = false
    clearImageAttachmentPresentations()
    const nextChat = await ensureChat()
    chat.value = nextChat ? markRaw(nextChat) : null
  }
)

async function rebuildChat() {
  const nextChat = await ensureChat()
  chat.value = nextChat ? markRaw(nextChat) : null
}

function handleNewConversation() {
  newConversation()
  clearToolLogEntries()
  clearACPDebugLog()
  void rebuildChat()
}

function handleSwitchConversation(conversationId: string) {
  switchConversation(conversationId)
  void rebuildChat()
}

function handleDeleteConversation(conversationId: string) {
  deleteConversation(conversationId)
  clearToolLogEntries()
  clearACPDebugLog()
  void rebuildChat()
}

function handleToggleDesignDoc() {
  designDocEnabled.value = !designDocEnabled.value
}

async function handleSubmit(text: string, images: ImageAttachmentDraft[] = []) {
  if (status.value === 'streaming' || status.value === 'submitted' || isPreparingImages.value) {
    for (const image of images) revokeImagePreviewURL(image.previewURL)
    if (images.length > 0) toast.error(dialogs.value.chatRequestFailed)
    return
  }
  const operationVersion = ++attachmentOperationVersion
  if (images.length > 0) isPreparingImages.value = true
  clearChatFailure()
  try {
    const currentChat = chat.value ?? (await ensureChat())
    if (currentChat) chat.value = markRaw(currentChat)
    if (!currentChat || operationVersion !== attachmentOperationVersion) return
    if (images.length === 0) {
      await currentChat.sendMessage({ text })
      return
    }
    const messageId = crypto.randomUUID()
    currentChat.messages = [
      ...currentChat.messages,
      { id: messageId, role: 'user', parts: [{ type: 'text', text }] }
    ]
    setImageAttachmentPresentations(
      messageId,
      images.map((image) => ({
        id: crypto.randomUUID(),
        messageId,
        name: image.file.name,
        mediaType: isImageAttachmentMediaType(image.file.type) ? image.file.type : 'image/png',
        originalWidth: 0,
        originalHeight: 0,
        previewWidth: 0,
        previewHeight: 0,
        previewURL: image.previewURL,
        displayText: text
      }))
    )
    const preparedImages = await Promise.all(
      images.map((image) => prepareImageAttachment(image.file))
    )
    const findings = await analyzeAttachedImages(getActiveEditorStore(), text, preparedImages)
    if (operationVersion !== attachmentOperationVersion || chat.value !== currentChat) return
    setImageAttachmentPresentations(
      messageId,
      preparedImages.map((prepared, index) => ({
        id: crypto.randomUUID(),
        messageId,
        name: images[index]?.file.name ?? `Image ${index + 1}`,
        mediaType: prepared.mediaType,
        originalWidth: prepared.originalWidth,
        originalHeight: prepared.originalHeight,
        previewWidth: prepared.width,
        previewHeight: prepared.height,
        previewURL: createImagePreviewURL(prepared.blob),
        displayText: text
      }))
    )
    await currentChat.sendMessage({
      messageId,
      text: designMessageWithImageFindings(
        text,
        images.map((image) => image.file.name),
        findings
      )
    })
  } catch (e) {
    console.error('Chat error:', e)
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    if (operationVersion === attachmentOperationVersion) isPreparingImages.value = false
  }
}

function handleStop() {
  chat.value?.stop()
}

async function handleCopyDebug() {
  await copyChatLog(messages.value, chatFailure.value)
  debugCopied.value = true
}

async function handleCopyAcpLog() {
  const text = getACPDebugText()
  if (!text) return
  await copy(text)
  acpLogCopied.value = true
}

function handleClearChat(): void {
  attachmentOperationVersion += 1
  isPreparingImages.value = false
  clearChatFailure()
  clearImageAttachmentPresentations()
  chat.value = null
  void resetChat().catch((error: unknown) => console.error('Chat reset error:', error))
  clearToolLogEntries()
  clearACPDebugLog()
}
</script>

<template>
  <div data-test-id="chat-panel" class="flex min-w-0 flex-1 flex-col overflow-hidden select-text">
    <ProviderSetup v-if="!isConfigured" />

    <template v-else>
      <!-- Conversation header -->
      <div
        class="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5"
        data-test-id="chat-conversation-header"
      >
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child>
            <button
              data-test-id="chat-conversation-trigger"
              class="flex min-w-0 max-w-[220px] items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-surface hover:bg-hover"
            >
              <icon-lucide-messages-square class="size-3 shrink-0 text-muted" />
              <span class="truncate">{{ activeConversationTitle }}</span>
              <icon-lucide-chevron-down class="size-3 shrink-0 text-muted" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent side="bottom" :side-offset="4" :class="menuCls.content">
              <DropdownMenuItem
                :class="itemCls"
                data-test-id="chat-new-conversation"
                @select="handleNewConversation"
              >
                <icon-lucide-plus class="size-3 text-muted" />
                <span class="flex-1">{{ dialogs.newConversation }}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator :class="menuCls.separator" />
              <div v-if="conversations.length" class="max-h-56 overflow-y-auto">
                <DropdownMenuItem
                  v-for="conversation in conversations"
                  :key="conversation.id"
                  :class="itemCls"
                  data-test-id="chat-conversation-item"
                  @select="handleSwitchConversation(conversation.id)"
                >
                  <span class="min-w-0 flex-1 truncate">{{ conversation.title }}</span>
                  <button
                    type="button"
                    class="rounded p-0.5 text-muted hover:bg-hover hover:text-surface"
                    :aria-label="dialogs.deleteConversation"
                    @click.stop="handleDeleteConversation(conversation.id)"
                  >
                    <icon-lucide-trash-2 class="size-3" />
                  </button>
                </DropdownMenuItem>
              </div>
              <div v-else class="px-2 py-1.5 text-[10px] text-muted">
                {{ dialogs.noConversations }}
              </div>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>

        <div class="ml-auto flex items-center gap-1">
          <Tip :label="designDocLabel">
            <button
              type="button"
              data-test-id="chat-design-doc-toggle"
              :aria-label="dialogs.designDoc"
              class="rounded p-1 text-muted hover:bg-hover hover:text-surface"
              :class="designDocActive ? 'text-accent' : ''"
              @click="handleToggleDesignDoc"
            >
              <icon-lucide-file-text class="size-3.5" />
            </button>
          </Tip>
        </div>
      </div>

      <ScrollAreaRoot class="min-h-0 flex-1">
        <ScrollAreaViewport class="h-full px-3 py-3 [&>div]:h-full">
          <AppPlaceholder
            v-if="messages.length === 0"
            data-test-id="chat-empty-state"
            :label="dialogs.describeCreateOrChange"
            :ui="{ root: 'h-full' }"
          >
            <template #icon>
              <icon-lucide-message-circle class="size-5" />
            </template>
          </AppPlaceholder>

          <!-- Messages -->
          <div v-else data-test-id="chat-messages" class="flex flex-col gap-3">
            <ChatMessage v-for="msg in messages" :key="msg.id" :message="msg" />

            <!-- Thinking indicator: shown when AI is working but no visible activity -->
            <div v-if="isThinking" data-test-id="chat-typing-indicator" class="flex gap-2">
              <div
                class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/20 text-[10px] font-bold text-muted"
              >
                AI
              </div>
              <div class="flex items-center gap-1 py-2">
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 0ms"
                />
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 150ms"
                />
                <span
                  class="size-1.5 animate-bounce rounded-full bg-muted"
                  style="animation-delay: 300ms"
                />
              </div>
            </div>

            <!-- Continue button when step limit reached -->
            <div v-if="showContinue" class="flex justify-center py-2">
              <button
                class="flex items-center gap-1.5 rounded-full bg-accent/10 px-4 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
                @click="handleSubmit('Continue where you left off')"
              >
                <icon-lucide-play class="size-3" />
                Continue
              </button>
            </div>

            <div ref="messagesEnd" />
          </div>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="vertical" class="flex w-1.5 touch-none p-px select-none">
          <ScrollAreaThumb class="relative flex-1 rounded-full bg-muted/30" />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>

      <!-- Chat toolbar -->
      <div
        v-if="messages.length > 0"
        class="flex shrink-0 items-center gap-1 border-t border-border px-3 py-1"
      >
        <AppTextButton
          v-if="IS_DEV"
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleCopyDebug"
        >
          <icon-lucide-clipboard-copy v-if="!debugCopied" class="size-3" />
          <icon-lucide-check v-else class="size-3 text-green-400" />
          {{ debugCopied ? 'Copied' : 'Copy log' }}
        </AppTextButton>
        <AppTextButton
          v-if="IS_DEV && hasACPDebugEntries()"
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleCopyAcpLog"
        >
          <icon-lucide-bug v-if="!acpLogCopied" class="size-3" />
          <icon-lucide-check v-else class="size-3 text-green-400" />
          {{ acpLogCopied ? 'Copied' : 'ACP log' }}
        </AppTextButton>
        <AppTextButton
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleNewConversation"
        >
          <icon-lucide-plus class="size-3" />
          {{ dialogs.newConversation }}
        </AppTextButton>
        <AppTextButton
          color="error"
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover' }"
          @click="handleClearChat"
        >
          <icon-lucide-trash-2 class="size-3" />
          Clear
        </AppTextButton>
      </div>

      <ChatInput
        :status="status"
        :disabled="isPreparingImages"
        @submit="handleSubmit"
        @stop="handleStop"
        @error="toast.error"
      />

      <ACPPermissionDialog />
    </template>
  </div>
</template>
