import { Chat } from '@ai-sdk/vue'
import { DirectChatTransport, stepCountIs, ToolLoopAgent } from 'ai'
import type { ChatTransport, FinishReason, LanguageModel, UIMessage } from 'ai'
import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import {
  ACP_AGENTS,
  type ACPAgentID,
  type AIProviderID,
  type ModelReasoningOption
} from '@open-pencil/core/constants'

import {
  activeConversationId,
  conversationById,
  conversationsForDocument,
  createConversation,
  deleteConversation as deleteStoredConversation,
  documentKeyForStore,
  loadChatHistory,
  persistChatHistory,
  saveConversationSnapshot,
  switchActiveConversation,
  type StoredConversation
} from '@/app/ai/chat/history'
import {
  classifyAIChatError,
  classifyAIChatFinish,
  type AIChatFailure
} from '@/app/ai/chat/failure'
import { resolveLanguageModelID } from '@/app/ai/chat/model'
import { buildSystemPrompt } from '@/app/ai/chat/system-prompt'
import { createAIModelRuntime, resolveModelConnectionAPIKey } from '@/app/ai/models'
import { resolveModelsDevModel } from '@/app/ai/models/catalog'
import {
  fallbackReasoningOptions,
  mergeProviderOptions,
  reasoningProviderOptions,
  reasoningSelectorOptions
} from '@/app/ai/reasoning'
import { MAX_AGENT_STEPS, createAITools, recordStep, resetRunSteps } from '@/app/ai/tools'
import {
  recordChatCompleted,
  recordChatFailed,
  recordModelStepCompleted
} from '@/app/diagnostics/events'
import type { getActiveEditorStore } from '@/app/editor/active-store'

type EditorStore = ReturnType<typeof getActiveEditorStore>

type ChatSessionOptions = {
  isConfigured: ComputedRef<boolean>
  isACPProvider: ComputedRef<boolean>
  isHarnessProvider: ComputedRef<boolean>
  providerID: Ref<AIProviderID>
  credentialsReady: Promise<void>
  getActiveEditorStore: () => EditorStore
}

type ToolLoopTransportOptions = {
  store: EditorStore
  providerID: AIProviderID
  model: LanguageModel
  effectiveModelID: string
  maxOutputTokens: number
  reasoningOptions?: readonly ModelReasoningOption[]
  reasoningEffort: string
  systemPrompt: string
}

const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: 'ephemeral' } }
} as const

function supportsAnthropicCaching(providerID: AIProviderID, modelID: string): boolean {
  return (
    providerID === 'anthropic' ||
    providerID === 'anthropic-compatible' ||
    (providerID === 'openrouter' && modelID.startsWith('anthropic/'))
  )
}

export async function createACPTransport(providerID: AIProviderID) {
  const agentId = providerID.replace('acp:', '') as ACPAgentID
  const agentDef = ACP_AGENTS.find((a) => a.id === agentId)
  if (!agentDef) throw new Error(`Unknown ACP agent: ${agentId}`)

  const { ACPChatTransport } = await import('@/app/ai/acp/transport')
  const { homeDir } = await import('@tauri-apps/api/path')
  return new ACPChatTransport({ agentDef, cwd: await homeDir() })
}

export function createToolLoopTransport({
  store,
  providerID,
  model,
  effectiveModelID,
  maxOutputTokens,
  reasoningOptions,
  reasoningEffort,
  systemPrompt
}: ToolLoopTransportOptions) {
  const tools = createAITools(store)
  const cacheProviderOptions = supportsAnthropicCaching(providerID, effectiveModelID)
    ? ANTHROPIC_CACHE_CONTROL
    : undefined
  const reasoning = reasoningProviderOptions(providerID, reasoningOptions, reasoningEffort)
  const providerOptions = mergeProviderOptions(cacheProviderOptions, reasoning)

  const agent = new ToolLoopAgent({
    model,
    instructions: systemPrompt,
    tools,
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    maxOutputTokens,
    providerOptions,
    prepareCall: (options) => {
      resetRunSteps(store)
      return {
        ...options,
        maxOutputTokens,
        providerOptions
      }
    },
    onStepFinish: ({ usage }) => {
      recordStep(store)
      recordModelStepCompleted({
        provider: providerID,
        model: effectiveModelID,
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? null,
        cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? null
      })
    }
  })

  return new DirectChatTransport({ agent }) as ChatTransport<UIMessage>
}

export function createChatSessionManager({
  isConfigured,
  isACPProvider,
  isHarnessProvider,
  providerID,
  credentialsReady,
  getActiveEditorStore
}: ChatSessionOptions) {
  const failure = ref<AIChatFailure | null>(null)
  let transportDirty = false
  let currentChatStore: EditorStore | null = null
  let chat: Chat<UIMessage> | null = null
  let acpTransportInstance: { destroy(): Promise<void> } | null = null
  let harnessTransportInstance: { destroy(): Promise<void> } | null = null
  let overrideTransport: (() => ChatTransport<UIMessage>) | null = null
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let persistenceSetup = false

  const chatHistory = loadChatHistory()
  const currentConversationId = ref<string | null>(null)
  const conversations = ref<StoredConversation[]>([])
  const reasoningOverride = ref<string | null>(null)

  async function destroyAgentTransports(): Promise<void> {
    const acp = acpTransportInstance
    const harness = harnessTransportInstance
    acpTransportInstance = null
    harnessTransportInstance = null
    const results = await Promise.allSettled([acp?.destroy(), harness?.destroy()])
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason)
    if (errors.length) throw new AggregateError(errors, 'Agent transport teardown failed')
  }

  function handleChatFinish({
    finishReason,
    isAbort,
    isDisconnect,
    isError
  }: {
    finishReason?: FinishReason
    isAbort: boolean
    isDisconnect: boolean
    isError: boolean
  }): void {
    if (isAbort || isDisconnect || isError) return
    const classified = classifyAIChatFinish(finishReason)
    if (classified) failure.value = classified
    recordChatCompleted({ finishReason: finishReason ?? null })
  }

  function clearFailure(): void {
    failure.value = null
  }

  const activeConversationTitle = computed(() => {
    const id = currentConversationId.value
    return id
      ? (conversationById(chatHistory, id)?.title ?? 'New conversation')
      : 'New conversation'
  })

  function markTransportDirty() {
    transportDirty = true
    currentChatStore = null
  }

  function currentDocumentKey(): string {
    return documentKeyForStore(getActiveEditorStore())
  }

  function refreshConversations(): void {
    conversations.value = conversationsForDocument(chatHistory, currentDocumentKey())
  }

  function restoreActiveConversation(documentKey: string): StoredConversation {
    const existingId = activeConversationId(chatHistory, documentKey)
    if (existingId) {
      const existing = conversationById(chatHistory, existingId)
      if (existing) return existing
    }
    return createConversation(chatHistory, documentKey)
  }

  function persistCurrentConversation(): void {
    const id = currentConversationId.value
    if (!id || !chat) return
    saveConversationSnapshot(chatHistory, id, chat.messages)
  }

  async function createActiveACPTransport() {
    await destroyAgentTransports()
    const transport = await createACPTransport(providerID.value)
    acpTransportInstance = transport
    return transport as ChatTransport<UIMessage>
  }

  async function createActiveHarnessTransport() {
    await destroyAgentTransports()
    const runtime = await createAIModelRuntime('design')
    if (runtime?.kind !== 'harness') throw new Error('The Design agent is not configured for Pi')
    const [{ HarnessChatTransport }, { buildPiMCPServers }, { getActiveTabId }] = await Promise.all([
      import('@/app/ai/harness/transport'),
      import('@/app/integrations/mcp'),
      import('@/app/tabs')
    ])
    const apiKey = await resolveModelConnectionAPIKey(runtime.role.connection.id)
    if (!apiKey) throw new Error('Credential is unavailable for the Pi agent')
    const model = runtime.role.profile.customModelID || runtime.role.profile.modelID
    const transport = new HarnessChatTransport(
      `tab-${getActiveTabId()}-${runtime.role.profile.id}`,
      {
        adapter: 'pi',
        sandbox: 'just-bash',
        model,
        settings: {
          thinkingLevel: runtime.role.profile.harnessThinkingLevel ?? 'medium',
          permissionMode: runtime.role.profile.harnessPermissionMode ?? 'allow-edits'
        },
        instructions: buildSystemPrompt(),
        mcpServers: await buildPiMCPServers()
      },
      { OPENPENCIL_HARNESS_API_KEY: apiKey }
    )
    harnessTransportInstance = transport
    return transport as ChatTransport<UIMessage>
  }

  async function createTransport(store: EditorStore) {
    if (overrideTransport) return overrideTransport()

    void acpTransportInstance?.destroy()
    acpTransportInstance = null

    const runtime = await createAIModelRuntime('design')
    if (runtime?.kind !== 'direct') {
      throw new Error('The Design model is not configured for direct API access')
    }
    const connection = runtime.role.connection
    const profile = runtime.role.profile
    const effectiveModelID = resolveLanguageModelID({
      providerID: connection.providerID,
      modelID: profile.modelID,
      customModelID: profile.customModelID
    })
    const catalogModel = await resolveModelsDevModel(connection.providerID, effectiveModelID)
    const reasoningOptions =
      catalogModel?.reasoningOptions ?? fallbackReasoningOptions(connection.providerID)
    const override = reasoningOverride.value
    const supportedLevels = reasoningSelectorOptions(reasoningOptions)
    const effectiveEffort =
      override && supportedLevels.some((option) => option.value === override)
        ? override
        : profile.reasoningEffort
    return createToolLoopTransport({
      store,
      providerID: connection.providerID,
      model: runtime.model,
      effectiveModelID,
      maxOutputTokens: profile.maxOutputTokens,
      reasoningOptions,
      reasoningEffort: effectiveEffort,
      systemPrompt: buildSystemPrompt()
    })
  }

  function setupPersistence(): void {
    if (persistenceSetup) return
    persistenceSetup = true
    watch(
      () => chat?.messages,
      () => {
        if (persistTimer) clearTimeout(persistTimer)
        persistTimer = setTimeout(() => {
          persistCurrentConversation()
          persistChatHistory(chatHistory)
          refreshConversations()
        }, 400)
      },
      { deep: true }
    )
  }

  async function ensureChat(): Promise<Chat<UIMessage> | null> {
    await credentialsReady
    if (!isConfigured.value) return null

    const store = getActiveEditorStore()
    const documentKey = currentDocumentKey()

    // Persist the outgoing conversation before any rebuild or tab switch so the
    // debounced watcher cannot lose the tail end of the last exchange.
    if (chat && currentConversationId.value) {
      persistCurrentConversation()
      persistChatHistory(chatHistory)
    }

    if (!chat || transportDirty || currentChatStore !== store) {
      if (currentChatStore !== store || !currentConversationId.value) {
        currentConversationId.value = restoreActiveConversation(documentKey).id
      }
      let transport: ChatTransport<UIMessage>
      if (isACPProvider.value) transport = await createActiveACPTransport()
      else if (isHarnessProvider.value) transport = await createActiveHarnessTransport()
      else transport = await createTransport(store)
      const conversation = conversationById(chatHistory, currentConversationId.value)
      chat = new Chat<UIMessage>({
        transport,
        messages: conversation?.messages ?? [],
        onError: (error) => {
          failure.value = classifyAIChatError(error)
          recordChatFailed({ errorName: error instanceof Error ? error.name : 'unknown' })
        },
        onFinish: handleChatFinish
      })
      currentChatStore = store
      transportDirty = false
      setupPersistence()
    }
    refreshConversations()
    return chat
  }

  async function resetChat() {
    await destroyAgentTransports()
    failure.value = null
    chat = null
    currentChatStore = null
    currentConversationId.value = null
    transportDirty = false
  }

  function newConversation() {
    persistCurrentConversation()
    void chat?.stop()
    const conversation = createConversation(chatHistory, currentDocumentKey())
    currentConversationId.value = conversation.id
    persistChatHistory(chatHistory)
    chat = null
    currentChatStore = null
    transportDirty = true
    refreshConversations()
  }

  function switchConversation(conversationId: string) {
    if (conversationId === currentConversationId.value) return
    persistCurrentConversation()
    void chat?.stop()
    const documentKey = currentDocumentKey()
    switchActiveConversation(chatHistory, documentKey, conversationId)
    currentConversationId.value = conversationId
    persistChatHistory(chatHistory)
    chat = null
    currentChatStore = null
    transportDirty = true
    refreshConversations()
  }

  function deleteConversation(conversationId: string) {
    deleteStoredConversation(chatHistory, conversationId)
    if (conversationId === currentConversationId.value) {
      void chat?.stop()
      chat = null
      currentChatStore = null
      currentConversationId.value = null
      transportDirty = true
    }
    persistChatHistory(chatHistory)
    refreshConversations()
  }

  function setReasoningOverride(level: string | null) {
    if (reasoningOverride.value === level) return
    reasoningOverride.value = level
    if (chat) markTransportDirty()
  }

  function setOverrideTransport(factory: (() => ChatTransport<UIMessage>) | null) {
    overrideTransport = factory
    markTransportDirty()
  }

  return {
    ensureChat,
    resetChat,
    newConversation,
    switchConversation,
    deleteConversation,
    conversations,
    activeConversationTitle,
    reasoningOverride,
    setReasoningOverride,
    markTransportDirty,
    setOverrideTransport,
    failure,
    clearFailure
  }
}
