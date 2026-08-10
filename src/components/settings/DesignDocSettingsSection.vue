<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '@open-pencil/vue'

import {
  clearDesignDoc,
  designDocContent,
  designDocEnabled,
  designDocFileName,
  setDesignDoc
} from '@/app/ai/design-doc/store'
import { loadDesignDocFromFile } from '@/app/ai/design-doc/load'
import AppSwitch from '@/components/ui/AppSwitch.vue'

const { dialogs } = useI18n()
const loadError = ref<string | null>(null)

async function handleLoad(): Promise<void> {
  loadError.value = null
  try {
    const loaded = await loadDesignDocFromFile()
    if (!loaded) return
    setDesignDoc(loaded.content, loaded.fileName)
  } catch (reason) {
    loadError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

function handleClear(): void {
  clearDesignDoc()
  loadError.value = null
}
</script>

<template>
  <section
    class="flex flex-col gap-2.5 rounded-lg border border-border bg-panel-field p-3"
    data-test-id="settings-design-doc"
  >
    <div class="flex items-center justify-between gap-3">
      <div>
        <h4 class="text-xs font-semibold text-surface">{{ dialogs.designDoc }}</h4>
        <p class="mt-0.5 text-[10px] text-muted">{{ dialogs.designDocDescription }}</p>
      </div>
      <AppSwitch
        v-model="designDocEnabled"
        :label="dialogs.designDoc"
        :disabled="!designDocContent.trim()"
      />
    </div>

    <textarea
      v-model="designDocContent"
      data-test-id="settings-design-doc-content"
      :placeholder="dialogs.designDocContentPlaceholder"
      class="scrollbar-thin h-40 min-w-0 resize-y rounded border border-border bg-input px-2.5 py-2 font-mono text-[11px] leading-relaxed text-surface placeholder:text-muted focus:border-panel-focus focus:outline-none"
    />

    <div class="flex items-center gap-2">
      <button
        type="button"
        data-test-id="settings-design-doc-load"
        class="flex items-center gap-1 rounded bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90"
        @click="handleLoad"
      >
        <icon-lucide-folder-open class="size-3" />
        {{ dialogs.loadDesignDoc }}
      </button>
      <button
        v-if="designDocFileName"
        type="button"
        data-test-id="settings-design-doc-clear"
        class="flex items-center gap-1 rounded px-2.5 py-1.5 text-[11px] text-muted hover:bg-hover hover:text-surface"
        @click="handleClear"
      >
        <icon-lucide-trash-2 class="size-3" />
        {{ dialogs.clearDesignDoc }}
      </button>
      <span v-if="designDocFileName" class="ml-auto truncate text-[10px] text-muted">
        {{ designDocFileName }}
      </span>
    </div>

    <p v-if="loadError" class="text-[10px] text-danger" role="alert">{{ loadError }}</p>
  </section>
</template>
