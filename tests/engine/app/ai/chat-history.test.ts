import { describe, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import {
  activeConversationId,
  conversationById,
  conversationsForDocument,
  createConversation,
  deleteConversation,
  documentKeyForStore,
  saveConversationSnapshot,
  switchActiveConversation,
  type ChatHistory
} from '@/app/ai/chat/history'

function emptyHistory(): ChatHistory {
  return { version: 1, activeByDocument: {}, conversations: {} }
}

function userMessage(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] }
}

describe('documentKeyForStore', () => {
  test('prefers the storage binding identity', () => {
    expect(
      documentKeyForStore({
        state: { documentName: 'Poster' },
        getStorageBinding: () => ({ providerId: 's3', documentId: 'doc-1' })
      })
    ).toBe('storage:s3:doc-1')
  })

  test('falls back to the document name', () => {
    expect(
      documentKeyForStore({
        state: { documentName: 'Poster' },
        getStorageBinding: () => null
      })
    ).toBe('Poster')
  })

  test('falls back to untitled for new documents', () => {
    expect(
      documentKeyForStore({
        state: { documentName: 'Untitled' },
        getStorageBinding: () => null
      })
    ).toBe('untitled')
  })
})

describe('conversation lifecycle', () => {
  test('creates a conversation and tracks it as active for the document', () => {
    const history = emptyHistory()
    const conversation = createConversation(history, 'Poster')
    expect(conversation.messages).toEqual([])
    expect(activeConversationId(history, 'Poster')).toBe(conversation.id)
    expect(conversationById(history, conversation.id)?.title).toBe('New conversation')
  })

  test('saveConversationSnapshot stores messages and derives the title', () => {
    const history = emptyHistory()
    const conversation = createConversation(history, 'Poster')
    saveConversationSnapshot(history, conversation.id, [
      userMessage('m1', 'Create a landing page'),
      userMessage('m2', 'Make it dark themed')
    ])
    const stored = conversationById(history, conversation.id)
    expect(stored?.messages).toHaveLength(2)
    expect(stored?.title).toBe('Create a landing page')
  })

  test('listing conversations for a document is newest first', async () => {
    const history = emptyHistory()
    const first = createConversation(history, 'Poster')
    const second = createConversation(history, 'Poster')
    saveConversationSnapshot(history, first.id, [userMessage('m1', 'Old conversation')])
    await new Promise((resolve) => {
      setTimeout(resolve, 2)
    })
    saveConversationSnapshot(history, second.id, [userMessage('m2', 'Recent conversation')])
    expect(conversationsForDocument(history, 'Poster').map((c) => c.id)).toEqual([
      second.id,
      first.id
    ])
    expect(conversationsForDocument(history, 'Other')).toEqual([])
  })

  test('switchActiveConversation changes the active conversation per document', () => {
    const history = emptyHistory()
    const first = createConversation(history, 'Poster')
    const second = createConversation(history, 'Poster')
    switchActiveConversation(history, 'Poster', first.id)
    expect(activeConversationId(history, 'Poster')).toBe(first.id)
    switchActiveConversation(history, 'Poster', second.id)
    expect(activeConversationId(history, 'Poster')).toBe(second.id)
  })

  test('deleting a conversation clears the active reference for its document', () => {
    const history = emptyHistory()
    const conversation = createConversation(history, 'Poster')
    deleteConversation(history, conversation.id)
    expect(conversationById(history, conversation.id)).toBeNull()
    expect(activeConversationId(history, 'Poster')).toBeNull()
  })

  test('deleting a non-active conversation keeps the active reference', () => {
    const history = emptyHistory()
    const active = createConversation(history, 'Poster')
    const other = createConversation(history, 'Poster')
    switchActiveConversation(history, 'Poster', active.id)
    deleteConversation(history, other.id)
    expect(activeConversationId(history, 'Poster')).toBe(active.id)
  })
})
