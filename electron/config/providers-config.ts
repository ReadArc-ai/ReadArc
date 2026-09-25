/**
 * providers 契约——常见 CLI 工具的 YAML 写法都能直接粘过来：
 *   providers.<slug>: { name, base_url|api|url, key_env|api_key_env, transport }
 *
 * 唯一配置源：~/.readarc/config.yaml。
 */
import { parse as parseYaml } from 'yaml'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

export type Transport = 'openai_chat' | 'anthropic_messages'

export interface ProviderDef {
  slug: string
  name: string
  baseUrl: string
  /** 环境变量名——config 只存名字，真值在 .env / Keychain */
  keyEnv: string | null
  transport: Transport
  source: 'readarc'
  /** 显式标注的类型：true = 本地模型服务（免费、可作兜底），false = 网关 / 中转（即使地址是 localhost）；
   *  缺省按地址猜（127.0.0.1 / localhost 视为本地） */
  local?: boolean
}

export interface ConfigRoots {
  readarcDir: string
}

export function defaultRoots(): ConfigRoots {
  return {
    // READARC_DIR：测试隔离与便携安装用的配置目录覆盖
    readarcDir: process.env['READARC_DIR'] ?? join(homedir(), '.readarc')
  }
}

interface RawProviderEntry {
  name?: unknown
  base_url?: unknown
  api?: unknown
  url?: unknown
  key_env?: unknown
  api_key_env?: unknown
  transport?: unknown
  /** 'local' | 'gateway'：本地网关转发云端模型的情况，地址是 localhost 但不是本地模型 */
  kind?: unknown
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 单个 providers: 块 → ProviderDef 列表。别名字段任取其一，缺省 transport 为 openai_chat。 */
export function parseProviders(yamlText: string, source: ProviderDef['source']): ProviderDef[] {
  let doc: unknown
  try {
    doc = parseYaml(yamlText)
  } catch {
    return [] // 配置损坏不致命：等同没有该来源（不阻塞阅读的同一条哲学）
  }
  const providers = (doc as { providers?: Record<string, RawProviderEntry> } | null)?.providers
  if (!providers || typeof providers !== 'object') return []

  const defs: ProviderDef[] = []
  for (const [slug, entry] of Object.entries(providers)) {
    if (!entry || typeof entry !== 'object') continue
    const baseUrl = str(entry.api) || str(entry.url) || str(entry.base_url)
    const keyEnv = str(entry.key_env) || str(entry.api_key_env)
    const transport = str(entry.transport) === 'anthropic_messages' ? 'anthropic_messages' : 'openai_chat'
    const kind = str(entry.kind)
    defs.push({
      slug,
      name: str(entry.name) || slug,
      baseUrl,
      keyEnv: keyEnv || null,
      transport,
      source,
      ...(kind === 'local' ? { local: true } : kind === 'gateway' ? { local: false } : {})
    })
  }
  return defs
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export interface LoadedProviders {
  providers: ProviderDef[]
}

/** providers 唯一来源：~/.readarc/config.yaml。 */
export function loadProviders(roots: ConfigRoots = defaultRoots()): LoadedProviders {
  const text = readIfExists(join(roots.readarcDir, 'config.yaml'))
  return { providers: parseProviders(text ?? '', 'readarc') }
}
