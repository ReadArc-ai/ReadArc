import { uiText } from './i18n'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

/**
 * 外链协议白名单。
 *
 * 应用里的外链多数来自 PDF 的链接注释——那是**不可信内容**。
 * `shell.openExternal` 会把 `file://` 与任意应用自注册的 scheme 交给系统处理器，
 * 等于让一篇论文能唤起本机上任何已注册协议的程序。只认 http/https/mailto。
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const scheme = new URL(url).protocol.toLowerCase()
    return scheme === 'http:' || scheme === 'https:' || scheme === 'mailto:'
  } catch {
    return false
  }
}

/** 只从 http(s) 下载论文：`pdfUrl` 来自检索源的响应，不是我们说了算的。 */
export function isDownloadableUrl(url: string): boolean {
  try {
    const scheme = new URL(url).protocol.toLowerCase()
    return scheme === 'http:' || scheme === 'https:'
  } catch {
    return false
  }
}

type ResolveHost = (hostname: string) => Promise<readonly string[]>
type FetchUrl = (url: string, init: RequestInit) => Promise<Response>

// IPv4 和 IPv6 必须分开：Node 会把传给 IPv4 的地址映射成 ::ffff:x.x.x.x；
// 如果同一 BlockList 里封了 ::ffff:0:0/96，所有 IPv4 都会被误判。
const blockedIpv4 = new BlockList()
const blockedIpv6 = new BlockList()

for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  // 198.18.0.0/15 故意不封：Clash / Surge 一类代理工具的 fake-ip 模式把所有域名都解析到这一段，
  // 真实目标由代理决定；封了它，开着代理的机器一个 PDF 都下不了。这段在公网不可路由，不构成内网目标。
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const) {
  blockedIpv4.addSubnet(address, prefix, 'ipv4')
}

for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
] as const) {
  blockedIpv6.addSubnet(address, prefix, 'ipv6')
}

const defaultResolveHost: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address)

function unbracket(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blockedIpv4.check(address, 'ipv4')
  if (family === 6) return !blockedIpv6.check(address, 'ipv6')
  return false
}

/**
 * 下载链接来自第三方检索 API，不能只检查 scheme：公网 URL 可能解析或重定向到本机/内网。
 * 每一跳都解析全部地址，只要混入一个非公网地址就拒绝，避免把 Electron 主进程变成 SSRF 代理。
 */
export async function assertPublicDownloadUrl(url: string, resolveHost: ResolveHost = defaultResolveHost): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(uiText('download.invalid'))
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(uiText('download.scheme'))
  }
  if (parsed.username || parsed.password) throw new Error(uiText('download.credentials'))

  const hostname = unbracket(parsed.hostname).toLowerCase().replace(/\.$/, '')
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa') ||
    (!isIP(hostname) && !hostname.includes('.'))
  ) {
    throw new Error(uiText('download.private'))
  }

  let addresses: readonly string[]
  try {
    addresses = isIP(hostname) ? [hostname] : await resolveHost(hostname)
  } catch (cause) {
    throw new Error(uiText('download.verify'), { cause })
  }
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error(uiText('download.private'))
  }
  return parsed
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5

/** 像浏览器一样跟随有限次重定向，但在发起每一跳请求前重新做公网地址校验。 */
export async function fetchPublicDownload(
  url: string,
  init: RequestInit = {},
  dependencies: { resolveHost?: ResolveHost; fetchUrl?: FetchUrl } = {}
): Promise<Response> {
  const resolveHost = dependencies.resolveHost ?? defaultResolveHost
  const fetchUrl = dependencies.fetchUrl ?? fetch
  let current = await assertPublicDownloadUrl(url, resolveHost)

  for (let redirects = 0; ; redirects += 1) {
    const response = await fetchUrl(current.href, { ...init, redirect: 'manual' })
    if (!REDIRECT_STATUSES.has(response.status)) return response

    if (redirects >= MAX_REDIRECTS) {
      void response.body?.cancel().catch(() => {})
      throw new Error(uiText('download.redirects', { n: MAX_REDIRECTS }))
    }
    const location = response.headers.get('location')
    if (!location) return response

    void response.body?.cancel().catch(() => {})
    current = await assertPublicDownloadUrl(new URL(location, current).href, resolveHost)
  }
}
