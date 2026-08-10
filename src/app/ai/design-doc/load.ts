import { isTauri } from '@/app/tauri/env'

export type LoadedDesignDoc = {
  content: string
  fileName: string
}

async function loadViaTauriDialog(): Promise<LoadedDesignDoc | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await open({
    filters: [{ name: 'Design doc', extensions: ['md', 'markdown', 'txt'] }],
    multiple: false
  })
  if (typeof path !== 'string') return null
  const content = await readTextFile(path)
  return { content, fileName: path.split('/').pop() ?? 'DESIGN.md' }
}

function loadViaBrowserInput(): Promise<LoadedDesignDoc | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain'
    input.onchange = () => {
      const file = input.files?.[0] ?? null
      if (!file) {
        resolve(null)
        return
      }
      void file
        .text()
        .then((content) => resolve({ content, fileName: file.name }))
        .catch(() => resolve(null))
    }
    input.click()
  })
}

/** Opens a DESIGN.md-style markdown file and returns its content. */
export async function loadDesignDocFromFile(): Promise<LoadedDesignDoc | null> {
  if (isTauri()) return loadViaTauriDialog()
  return loadViaBrowserInput()
}
