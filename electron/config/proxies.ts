/**
 * 命名代理档案 + 端点绑定：
 *   proxies.<name>: { protocol, host, port, username }   —— 代理档案（可多个）
 *   endpoint_proxy.<providerSlug>: <proxyName>           —— 官方 endpoint 用哪个代理
 * 密码是密钥：READARC_PROXY_<NAME>_PASSWORD 存 ~/.readarc/.env，yaml 里绝不出现。
 * 旧版单代理 network: 块在首次读取时一次性迁移为 proxies.default（+全部官方端点绑定，
 * 若旧配置开了「官方走代理」）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { defaultRoots, type ConfigRoots } from './providers-config'
import { removeYamlBlock, upsertYamlMap } from './yaml-patch'
import { resolveApiKey } from './env-file'

export type ProxyProtocol = 'http' | 'https' | 'socks5'
const PROTOCOLS: ProxyProtocol[] = ['http', 'https', 'socks5']

export interface ProxyDef {
  name: string
  protocol: ProxyProtocol
  host: string
  port: string
  username: string
}

export function proxyPasswordEnv(name: string): string {
  return `READARC_PROXY_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_PASSWORD`
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''

function readDoc(roots: ConfigRoots): Record<string, unknown> | null {
  try {
    return parseYaml(readFileSync(join(roots.readarcDir, 'config.yaml'), 'utf8')) as Record<
      string,
      unknown
    > | null
  } catch {
    return null
  }
}

function parseProxyEntry(name: string, raw: unknown): ProxyDef | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const host = str(r['host'])
  if (!host) return null
  const proto = str(r['protocol'])
  return {
    name,
    protocol: PROTOCOLS.includes(proto as ProxyProtocol) ? (proto as ProxyProtocol) : 'http',
    host,
    port: str(r['port']),
    username: str(r['username'])
  }
}

/** 旧版 network: 单代理 → proxies.default（幂等：proxies 已存在即跳过）。 */
export function migrateLegacyNetworkOnce(roots: ConfigRoots = defaultRoots()): void {
  const doc = readDoc(roots)
  if (!doc || doc['proxies']) return
  const n = doc['network']
  if (!n || typeof n !== 'object') return
  const legacy = parseProxyEntry('default', n)
  if (!legacy) return

  const path = join(roots.readarcDir, 'config.yaml')
  let text = readFileSync(path, 'utf8')
  text = upsertYamlMap(text, ['proxies', 'default'], {
    protocol: legacy.protocol,
    host: legacy.host,
    port: legacy.port,
    username: legacy.username
  }).text
  const nn = n as Record<string, unknown>
  if (nn['official_via_proxy'] !== false && nn['official_via_proxy'] !== 'false') {
    // 旧语义「官方全部走代理」→ 显式绑定当时的内置官方端点
    for (const slug of ['siliconflow', 'deepseek', 'openai', 'anthropic', 'gemini', 'openrouter']) {
      text = upsertYamlMap(text, ['endpoint_proxy'], { [slug]: 'default' }).text
    }
  }
  text = removeYamlBlock(text, ['network']).text
  writeFileSync(path, text, 'utf8')
}

export function loadProxies(roots: ConfigRoots = defaultRoots()): ProxyDef[] {
  migrateLegacyNetworkOnce(roots)
  const doc = readDoc(roots)
  const raw = doc?.['proxies']
  if (!raw || typeof raw !== 'object') return []
  const out: ProxyDef[] = []
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    const def = parseProxyEntry(name, entry)
    if (def) out.push(def)
  }
  return out
}

export function saveProxy(def: ProxyDef, roots: ConfigRoots = defaultRoots()): void {
  const path = join(roots.readarcDir, 'config.yaml')
  const src = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const { text } = upsertYamlMap(src, ['proxies', def.name], {
    protocol: def.protocol,
    host: def.host.trim(),
    port: def.port.trim(),
    username: def.username.trim()
  })
  mkdirSync(roots.readarcDir, { recursive: true })
  writeFileSync(path, text, 'utf8')
}

export function deleteProxy(name: string, roots: ConfigRoots = defaultRoots()): boolean {
  const path = join(roots.readarcDir, 'config.yaml')
  if (!existsSync(path)) return false
  let src = readFileSync(path, 'utf8')
  const { text, changed } = removeYamlBlock(src, ['proxies', name])
  if (!changed) return false
  src = text
  // 解除引用它的端点绑定
  for (const [slug, bound] of Object.entries(loadEndpointProxyFromText(src))) {
    if (bound === name) src = removeYamlBlock(src, ['endpoint_proxy', slug]).text
  }
  writeFileSync(path, src, 'utf8')
  return true
}

function loadEndpointProxyFromText(text: string): Record<string, string> {
  try {
    const doc = parseYaml(text) as Record<string, unknown> | null
    const raw = doc?.['endpoint_proxy']
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [slug, v] of Object.entries(raw as Record<string, unknown>)) {
      const name = str(v)
      if (name) out[slug] = name
    }
    return out
  } catch {
    return {}
  }
}

/** providerSlug → 代理档案名（未绑定 = 直连）。 */
export function loadEndpointProxy(roots: ConfigRoots = defaultRoots()): Record<string, string> {
  migrateLegacyNetworkOnce(roots)
  const path = join(roots.readarcDir, 'config.yaml')
  if (!existsSync(path)) return {}
  return loadEndpointProxyFromText(readFileSync(path, 'utf8'))
}

export function saveEndpointProxy(
  slug: string,
  proxyName: string | null,
  roots: ConfigRoots = defaultRoots()
): void {
  const path = join(roots.readarcDir, 'config.yaml')
  const src = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const { text } = proxyName
    ? upsertYamlMap(src, ['endpoint_proxy'], { [slug]: proxyName })
    : removeYamlBlock(src, ['endpoint_proxy', slug])
  mkdirSync(roots.readarcDir, { recursive: true })
  writeFileSync(path, text, 'utf8')
}

/** 组装代理 URL；密码从 .env 的 READARC_PROXY_<NAME>_PASSWORD 解析。 */
export function composeProxyUrl(def: ProxyDef, roots: ConfigRoots = defaultRoots()): string {
  if (!def.host.trim()) return ''
  const pw = resolveApiKey(proxyPasswordEnv(def.name), roots)
  const auth = def.username.trim()
    ? `${encodeURIComponent(def.username.trim())}${pw ? `:${encodeURIComponent(pw)}` : ''}@`
    : ''
  const port = def.port.trim() ? `:${def.port.trim()}` : ''
  return `${def.protocol}://${auth}${def.host.trim()}${port}`
}

/** providerSlug → 代理 URL（未绑定/档案缺失 = ''，直连）。路由层每跳调用。 */
export function proxyUrlForProvider(slug: string, roots: ConfigRoots = defaultRoots()): string {
  const bound = loadEndpointProxy(roots)[slug]
  if (!bound) return ''
  const def = loadProxies(roots).find((p) => p.name === bound)
  return def ? composeProxyUrl(def, roots) : ''
}
