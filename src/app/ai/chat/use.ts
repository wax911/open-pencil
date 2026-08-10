import { ref, watch } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'

import {
  apiKeyStatus,
  browserCredentialsRemembered,
  credentialsReady,
  customAPIType,
  customBaseURL,
  customModelID,
  isACPProvider,
  isHarnessProvider,
  isConfigured,
  maxOutputTokens,
  modelID,
  pexelsKeyStatus,
  providerDef,
  providerID,
  registerAIChatEffects,
  resolveAPIKey,
  setAPIKey,
  setPexelsKey,
  setRememberCredentials,
  setUnsplashKey,
  unsplashKeyStatus
} from '@/app/ai/chat/storage'
import { createChatSessionManager } from '@/app/ai/chat/transports'
import { designDocContent, designDocEnabled } from '@/app/ai/design-doc/store'
import { exposeChatTransportOverride } from '@/app/browser-bridge'
import { getActiveEditorStore } from '@/app/editor/active-store'

const activeTab = ref<'design' | 'code' | 'ai'>('design')

const chatSession = createChatSessionManager({
  isConfigured,
  isACPProvider,
  isHarnessProvider,
  providerID,
  credentialsReady,
  getActiveEditorStore
})

registerAIChatEffects(chatSession.markTransportDirty)

// Rebuild the transport when the DESIGN.md context changes so the next turn
// carries the updated system prompt.
watch([designDocEnabled, designDocContent], () => chatSession.markTransportDirty())

if (IS_BROWSER) {
  exposeChatTransportOverride((factory) => {
    chatSession.setOverrideTransport(factory)
  })
}

export function useAIChat() {
  return {
    providerID,
    providerDef,
    apiKeyStatus,
    browserCredentialsRemembered,
    setAPIKey,
    resolveAPIKey,
    modelID,
    customBaseURL,
    customModelID,
    customAPIType,
    maxOutputTokens,
    pexelsKeyStatus,
    setPexelsKey,
    setRememberCredentials,
    unsplashKeyStatus,
    setUnsplashKey,
    activeTab,
    isConfigured,
    ensureChat: chatSession.ensureChat,
    resetChat: chatSession.resetChat,
    chatFailure: chatSession.failure,
    conversations: chatSession.conversations,
    newConversation: chatSession.newConversation,
    switchConversation: chatSession.switchConversation,
    deleteConversation: chatSession.deleteConversation,
    clearChatFailure: chatSession.clearFailure,
    activeConversationTitle: chatSession.activeConversationTitle,
    reasoningOverride: chatSession.reasoningOverride,
    setReasoningOverride: chatSession.setReasoningOverride
  }
}
