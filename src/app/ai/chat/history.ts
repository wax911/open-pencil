import { useLocalStorage, StorageSerializers } from '@vueuse/core'
import type { UIMessage } from 'ai'

const STORAGE_PREFIX = 'open-pencil:'
const CHAT_HISTORY_KEY = `${STORAGE_PREFIX}ai-chat-history`

const MAX_MESSAGES_PER_CONVERSATION = 200
const MAX_CONVERSATIONS = 50
const TITLE_MAX_LENGTH = 40
const UNTITLED_DOCUMENT_KEY = 'untitled'

export type StoredConversation = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  documentKey: string
  messages: UIMessage[]
}

export type ChatHistory = {
  version: 1
  activeByDocument: Record<string, string | undefined>
  conversations: Record<string, StoredConversation | undefined>
}

export type ChatDocumentKeySource = {
  state: { documentName: string }
  getStorageBinding: () => { providerId: string; documentId: string } | null
}

const chatHistoryStorage = useLocalStorage<ChatHistory | null>(CHAT_HISTORY_KEY, null, {
  serializer: StorageSerializers.object,
  writeDefaults: false
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseConversation(value: unknown): StoredConversation | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id : ''
  const documentKey = typeof value.documentKey === 'string' ? value.documentKey : ''
  if (!id || !documentKey) return null
  return {
    id,
    title: typeof value.title === 'string' ? value.title : 'New conversation',
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    documentKey,
    messages: Array.isArray(value.messages) ? (value.messages as UIMessage[]) : []
  }
}

function parseHistory(value: unknown): ChatHistory | null {
  if (!isRecord(value) || value.version !== 1) return null
  const rawConversations = isRecord(value.conversations) ? value.conversations : {}
  const conversations: Record<string, StoredConversation | undefined> = {}
  for (const [id, entry] of Object.entries(rawConversations)) {
    const conversation = parseConversation(entry)
    if (conversation && conversation.id === id) conversations[id] = conversation
  }
  if (Object.keys(conversations).length === 0) return null
  const activeByDocument: Record<string, string | undefined> = {}
  if (isRecord(value.activeByDocument)) {
    for (const [documentKey, conversationId] of Object.entries(value.activeByDocument)) {
      if (typeof conversationId === 'string' && conversations[conversationId]) {
        activeByDocument[documentKey] = conversationId
      }
    }
  }
  return { version: 1, activeByDocument, conversations }
}

export function documentKeyForStore(store: ChatDocumentKeySource): string {
  const binding = store.getStorageBinding()
  if (binding) return `storage:${binding.providerId}:${binding.documentId}`
  const name = store.state.documentName.trim()
  return name && name !== 'Untitled' ? name : UNTITLED_DOCUMENT_KEY
}

export function loadChatHistory(): ChatHistory {
  const parsed = parseHistory(chatHistoryStorage.value)
  if (parsed) return parsed
  const fresh: ChatHistory = { version: 1, activeByDocument: {}, conversations: {} }
  chatHistoryStorage.value = fresh
  return fresh
}

export function activeConversationId(history: ChatHistory, documentKey: string): string | null {
  const id = history.activeByDocument[documentKey]
  return id && history.conversations[id] ? id : null
}

export function conversationsForDocument(
  history: ChatHistory,
  documentKey: string
): StoredConversation[] {
  return Object.values(history.conversations)
    .filter(
      (conversation): conversation is StoredConversation =>
        conversation !== undefined && conversation.documentKey === documentKey
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function conversationById(
  history: ChatHistory,
  conversationId: string
): StoredConversation | null {
  return history.conversations[conversationId] ?? null
}

function conversationTitle(messages: UIMessage[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = message.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join(' ')
      .trim()
    if (text) return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH)}…` : text
  }
  return 'New conversation'
}

export function createConversation(history: ChatHistory, documentKey: string): StoredConversation {
  const now = Date.now()
  const conversation: StoredConversation = {
    id: `conversation-${crypto.randomUUID()}`,
    title: 'New conversation',
    createdAt: now,
    updatedAt: now,
    documentKey,
    messages: []
  }
  history.conversations[conversation.id] = conversation
  history.activeByDocument[documentKey] = conversation.id
  return conversation
}

export function saveConversationSnapshot(
  history: ChatHistory,
  conversationId: string,
  messages: UIMessage[]
): void {
  const conversation = history.conversations[conversationId]
  if (!conversation) return
  conversation.messages = messages.slice(-MAX_MESSAGES_PER_CONVERSATION)
  conversation.updatedAt = Date.now()
  conversation.title = conversationTitle(conversation.messages)
  pruneHistory(history)
}

function pruneHistory(history: ChatHistory): void {
  const entries = Object.values(history.conversations)
    .filter((conversation): conversation is StoredConversation => conversation !== undefined)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  if (entries.length <= MAX_CONVERSATIONS) return
  const keep = new Set(entries.slice(0, MAX_CONVERSATIONS).map((conversation) => conversation.id))
  history.conversations = Object.fromEntries(
    Object.entries(history.conversations).filter(([id]) => keep.has(id))
  )
  history.activeByDocument = Object.fromEntries(
    Object.entries(history.activeByDocument).filter(
      ([, conversationId]) => conversationId !== undefined && keep.has(conversationId)
    )
  )
}

export function deleteConversation(history: ChatHistory, conversationId: string): void {
  const conversation = history.conversations[conversationId]
  if (!conversation) return
  history.conversations = Object.fromEntries(
    Object.entries(history.conversations).filter(([id]) => id !== conversationId)
  )
  if (history.activeByDocument[conversation.documentKey] === conversationId) {
    history.activeByDocument = Object.fromEntries(
      Object.entries(history.activeByDocument).filter(
        ([documentKey]) => documentKey !== conversation.documentKey
      )
    )
  }
}

export function switchActiveConversation(
  history: ChatHistory,
  documentKey: string,
  conversationId: string
): void {
  if (!history.conversations[conversationId]) return
  history.activeByDocument[documentKey] = conversationId
}

export function persistChatHistory(history: ChatHistory): void {
  chatHistoryStorage.value = history
}
