import SYSTEM_PROMPT from '@/app/ai/chat/system-prompt.md?raw'
import { designDocActive, designDocContent } from '@/app/ai/design-doc/store'

/**
 * Builds the system prompt for the AI chat, appending the loaded DESIGN.md
 * content as design context when enabled and non-empty.
 */
export function buildSystemPrompt(): string {
  if (designDocActive.value) {
    const content = designDocContent.value.trim()
    return `${SYSTEM_PROMPT}\n\n## Design context (DESIGN.md)\n\n${content}`
  }
  return SYSTEM_PROMPT
}
