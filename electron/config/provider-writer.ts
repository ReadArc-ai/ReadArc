/**
 * 供应商写回：一律写 ~/.readarc/config.yaml。永远走 yaml-patch 原地拼接；
 * 写前留一次备份；无变化不落盘。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { removeYamlBlock, upsertYamlMap } from './yaml-patch'
import { defaultRoots, type ConfigRoots } from './providers-config'

export interface ProviderInput {
  slug: string
  name: string
  baseUrl: string
  keyEnv?: string | null
  transport?: string
  /** true = 本地模型服务，false = 网关 / 中转；不传则沿用地址猜测 */
  local?: boolean
}

function configPathFor(_slug: string, roots: ConfigRoots): string {
  return join(roots.readarcDir, 'config.yaml')
}

/** 删除自定义供应商：移除 readarc config 的 providers.<slug> 块。 */
export function deleteProvider(slug: string, roots: ConfigRoots = defaultRoots()): boolean {
  const path = join(roots.readarcDir, 'config.yaml')
  if (!existsSync(path)) return false
  const src = readFileSync(path, 'utf8')
  const { text, changed } = removeYamlBlock(src, ['providers', slug])
  if (!changed) return false
  copyFileSync(path, path + '.readarc-backup')
  writeFileSync(path, text, 'utf8')
  return true
}

export function saveProvider(input: ProviderInput, roots: ConfigRoots = defaultRoots()): boolean {
  const path = configPathFor(input.slug, roots)
  const src = existsSync(path) ? readFileSync(path, 'utf8') : ''

  const entries: Record<string, string> = {
    name: input.name,
    base_url: input.baseUrl
  }
  if (input.keyEnv) entries['key_env'] = input.keyEnv
  if (input.transport && input.transport !== 'openai_chat') entries['transport'] = input.transport
  if (input.local !== undefined) entries['kind'] = input.local ? 'local' : 'gateway'

  const { text, changed } = upsertYamlMap(src, ['providers', input.slug], entries)
  if (!changed) return false // 无变化不重写文件

  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) {
    // 每次修改前备份最近一版，弄坏了有得救
    copyFileSync(path, path + '.readarc-backup')
  }
  writeFileSync(path, text, 'utf8')
  return true
}
