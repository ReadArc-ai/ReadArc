/**
 * 默认模型：~/.readarc/config.yaml 的 main: 块。
 * 对话框底部的切换器改的就是它；对话、摘要、笔记、翻译默认都走它，
 * 只有全文翻译可以在设置里单独指定另一个模型（tasks.translate）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { removeYamlBlock, upsertYamlMap } from './yaml-patch'
import { defaultRoots, type ConfigRoots } from './providers-config'
import { loadTaskRoutes, saveTaskRoute } from './tasks-config'

export interface MainModel {
  provider: string
  /** 空串 = 该来源的默认模型（运行时取端点模型列表的第一个） */
  model: string
}

function readYaml(path: string): unknown {
  try {
    return parseYaml(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function saveMainModel(m: MainModel, roots: ConfigRoots = defaultRoots()): void {
  const path = join(roots.readarcDir, 'config.yaml')
  const src = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const entries: Record<string, string> = { provider: m.provider }
  if (m.model) entries['model'] = m.model
  let { text } = upsertYamlMap(src, ['main'], entries)
  // 没指定模型就不留 model 行：残留的旧模型名会让路由用错模型
  if (!m.model) text = removeYamlBlock(text, ['main', 'model']).text
  mkdirSync(roots.readarcDir, { recursive: true })
  writeFileSync(path, text, 'utf8')
}

export function loadMainModel(roots: ConfigRoots = defaultRoots()): MainModel | null {
  const readarc = readYaml(join(roots.readarcDir, 'config.yaml')) as {
    main?: { provider?: unknown; model?: unknown }
  } | null
  const provider = readarc?.main?.provider
  if (typeof provider !== 'string' || !provider) return null
  const model = readarc?.main?.model
  return { provider, model: typeof model === 'string' ? model : '' }
}

/**
 * 老配置迁移：早期版本把「问答」单独路由（tasks.ask），面板右上角的切换器改的是它，
 * 设置里另有一个「主模型」兜底——两个概念叠在一起。现在只剩「默认模型」（main:），
 * 问答不再单独路由。用户在面板里最近一次选的模型存在 tasks.ask 里，那才是他们
 * 明确要的：并入 main: 再把 ask 复位为 auto，用户看到的模型不变。
 * tasks.ask 本来就是 auto 时不碰文件。
 */
export function absorbAskRouteIntoMain(roots: ConfigRoots = defaultRoots()): boolean {
  const ask = loadTaskRoutes(roots).ask
  if (!ask || ask.provider === 'auto') return false
  saveMainModel({ provider: ask.provider, model: ask.model ?? '' }, roots)
  saveTaskRoute('ask', { provider: 'auto' }, roots)
  return true
}
