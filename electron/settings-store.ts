/**
 * userData/settings.json 的读写。手写而非 electron-store：零依赖，且在 CJS/MAS 沙箱环境下行为可控。
 * 写入原子化（tmp + rename）并去抖，进程退出前 flush。
 */
import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, type PersistedSettings } from '../shared/ipc'

let cache: PersistedSettings | null = null
let flushTimer: NodeJS.Timeout | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): PersistedSettings {
  if (cache) return cache
  let loaded: PersistedSettings
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    loaded = { ...DEFAULT_SETTINGS, ...raw }
  } catch {
    loaded = { ...DEFAULT_SETTINGS }
  }
  cache = loaded
  return loaded
}

export function patchSettings(patch: Partial<PersistedSettings>): PersistedSettings {
  cache = { ...loadSettings(), ...patch }
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flushSettings, 400)
  return cache
}

export function flushSettings(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!cache) return
  const path = settingsPath()
  const tmp = path + '.tmp'
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8')
    renameSync(tmp, path)
  } catch (err) {
    console.error('settings flush failed:', err)
  }
}
