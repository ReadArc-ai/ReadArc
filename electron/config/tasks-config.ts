/**
 * 按任务路由：ReadArc 自己的 tasks: 块，只存于 ~/.readarc/config.yaml。
 * 默认全 auto（= 回落默认模型）——新用户填一个密钥就能用。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { removeYamlBlock, upsertYamlMap } from './yaml-patch'
import { defaultRoots, type ConfigRoots } from './providers-config'

import type { TaskRoute, TaskSlot } from '../../shared/models'

export const TASK_SLOTS: readonly TaskSlot[] = ['translate', 'summary', 'notes', 'ask', 'glossary', 'outline', 'compare']
export type { TaskRoute, TaskSlot }

export type TaskRoutes = Record<TaskSlot, TaskRoute>

export const DEFAULT_ROUTES: TaskRoutes = {
  translate: { provider: 'auto' },
  summary: { provider: 'auto' },
  notes: { provider: 'auto' },
  ask: { provider: 'auto' },
  glossary: { provider: 'auto' },
  outline: { provider: 'auto' },
  compare: { provider: 'auto' }
}

export function loadTaskRoutes(roots: ConfigRoots = defaultRoots()): TaskRoutes {
  const path = join(roots.readarcDir, 'config.yaml')
  let doc: unknown
  try {
    doc = parseYaml(readFileSync(path, 'utf8'))
  } catch {
    return { ...DEFAULT_ROUTES }
  }
  const tasks = (doc as { tasks?: Record<string, { provider?: unknown; model?: unknown }> } | null)
    ?.tasks
  const routes = { ...DEFAULT_ROUTES }
  if (!tasks || typeof tasks !== 'object') return routes
  for (const slot of TASK_SLOTS) {
    const entry = tasks[slot]
    if (!entry || typeof entry !== 'object') continue
    const provider = typeof entry.provider === 'string' ? entry.provider : 'auto'
    const model = typeof entry.model === 'string' ? entry.model : undefined
    routes[slot] = model ? { provider, model } : { provider }
  }
  return routes
}

export function saveTaskRoute(
  slot: TaskSlot,
  route: TaskRoute,
  roots: ConfigRoots = defaultRoots()
): boolean {
  const path = join(roots.readarcDir, 'config.yaml')
  const src = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const entries: Record<string, string> = { provider: route.provider }
  if (route.model) entries['model'] = route.model
  let { text, changed } = upsertYamlMap(src, ['tasks', slot], entries)
  // 不带 model 的路由要清掉残留的旧 model 行（auto 残留具体模型会误导路由）
  if (!route.model) {
    const removed = removeYamlBlock(text, ['tasks', slot, 'model'])
    if (removed.changed) {
      text = removed.text
      changed = true
    }
  }
  if (!changed) return false
  mkdirSync(roots.readarcDir, { recursive: true })
  writeFileSync(path, text, 'utf8')
  return true
}
