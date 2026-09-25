/**
 * 检索服务：并发打各源、指数退避、24h 结果缓存、去重、WHY 行。
 * 限流打在用户 IP 上，所以退避与缓存是义务而不是优化。
 */
import { uiText } from '../i18n'
import { isCjkDominant } from '../../shared/lang'
import { ARXIV_ID_RE } from './sources/arxiv'
import type Database from 'better-sqlite3'
import { arxivSource } from './sources/arxiv'
import { semanticScholarSource } from './sources/semanticscholar'
import { dedupResults, explainWhy } from './dedup'
import type { Fetcher, SearchOutcome, SearchResult, SourceAdapter, SourceStatus } from './types'

export const SOURCES: SourceAdapter[] = [arxivSource, semanticScholarSource]

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const RETRY_DELAYS_MS = [500, 1500]
/** 单源请求超时：一个源挂住不能让整次检索没有尽头 */
const SOURCE_TIMEOUT_MS = 12_000
/**
 * 重试仍被限流的源进入冷却：冷却期内直接跳过，
 * 不让接下来的每次检索都白等一轮退避（无密钥的 Semantic Scholar 常态就是 429）
 */
const RATE_LIMIT_COOLDOWN_MS = 60_000
const defaultCooldowns = new Map<string, number>()

export interface SearchDeps {
  /** 中文检索词转英文关键词；不给就原样查 */
  translate?: (query: string) => Promise<string>
  fetcher?: Fetcher
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  timeoutMs?: number
  /** 源 slug → 冷却截止时间戳；测试注入以隔离 */
  cooldowns?: Map<string, number>
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

function isRateLimited(err: unknown): boolean {
  return err instanceof Error && /HTTP 429/.test(err.message)
}

function normQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ')
}

function cacheGet(
  db: Database.Database,
  query: string,
  source: string,
  now: number
): SearchResult[] | null {
  const row = db
    .prepare('SELECT json, ts FROM search_cache WHERE query_norm = ? AND source = ?')
    .get(normQuery(query), source) as { json: string; ts: number } | undefined
  if (!row || now - row.ts > CACHE_TTL_MS) return null
  try {
    return JSON.parse(row.json) as SearchResult[]
  } catch {
    return null
  }
}

function cachePut(
  db: Database.Database,
  query: string,
  source: string,
  results: SearchResult[],
  now: number
): void {
  db.prepare(
    `INSERT INTO search_cache (query_norm, source, json, ts) VALUES (?, ?, ?, ?)
     ON CONFLICT(query_norm, source) DO UPDATE SET json = excluded.json, ts = excluded.ts`
  ).run(normQuery(query), source, JSON.stringify(results), now)
}

/** 源标签上的错误提示：把 "S2 HTTP 429" 这类原始错误换成用户看得懂的话 */
export function friendlySourceError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const status = /HTTP (\d{3})/.exec(msg)?.[1]
  if (status === '429') return uiText('search.limit')
  if (status && Number(status) >= 500) return uiText('search.server', { status })
  if (status) return uiText('search.http', { status })
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|network/i.test(msg)) return uiText('search.network')
  return msg
}

/** 是否值得重试：限流与服务端错误重试，4xx（限流除外）不重试。 */
function retryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const status = /HTTP (\d{3})/.exec(msg)?.[1]
  if (!status) return true // 网络层错误
  const code = Number(status)
  return code === 429 || code >= 500
}

async function searchWithRetry(
  adapter: SourceAdapter,
  query: string,
  fetcher: Fetcher,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number
): Promise<SearchResult[]> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await adapter.search(query, fetcher, AbortSignal.timeout(timeoutMs))
    } catch (err) {
      lastErr = err
      // 超时不重试：再等一轮只会更慢
      if (isTimeout(err) || attempt === RETRY_DELAYS_MS.length || !retryable(err)) break
      await sleep(RETRY_DELAYS_MS[attempt])
    }
  }
  throw lastErr
}

interface SourcePart {
  status: SourceStatus
  results: SearchResult[]
}

/**
 * 并发打各源。onPartial：某个源先回来时先给一版中间结果（未回的源标 pending），
 * 快的源（arXiv 约 1.5s）不用等慢的源退避完；最终结果由返回值给出。
 */
export async function searchAll(
  db: Database.Database,
  rawQuery: string,
  deps: SearchDeps = {},
  onPartial?: (outcome: SearchOutcome) => void
): Promise<SearchOutcome> {
  // 各源只认英文：中文检索词先翻成英文关键词；翻不了（没接模型）就照原词查并标注
  let query = rawQuery
  let translateError: string | null = null
  if (deps.translate && isCjkDominant(rawQuery) && !ARXIV_ID_RE.test(rawQuery)) {
    try {
      const en = (await deps.translate(rawQuery)).trim()
      if (en) query = en
    } catch (err) {
      translateError = err instanceof Error ? err.message : String(err)
    }
  }
  const fetcher = deps.fetcher ?? ((url, init) => fetch(url, init))
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const timeoutMs = deps.timeoutMs ?? SOURCE_TIMEOUT_MS
  const cooldowns = deps.cooldowns ?? defaultCooldowns

  let anyLive = false
  let anyCached = false
  const settled = new Map<string, SourcePart>()

  const one = async (adapter: SourceAdapter): Promise<SourcePart> => {
    const status = (count: number, error: string | null): SourceStatus => ({
      slug: adapter.slug,
      name: adapter.name,
      count,
      error
    })
    // 粘贴 arXiv 编号时只查 arXiv：其它源按「1706」「03762」这种数字碎片做关键词匹配，出来的全是无关结果
    if (ARXIV_ID_RE.test(query) && adapter.slug !== 'arxiv') {
      return { status: status(0, null), results: [] }
    }
    const cached = cacheGet(db, query, adapter.slug, now())
    if (cached) {
      anyCached = true
      return { status: status(cached.length, null), results: cached }
    }
    const coolUntil = cooldowns.get(adapter.slug) ?? 0
    if (coolUntil > now()) {
      return { status: status(0, uiText('search.cooldown', { seconds: Math.ceil((coolUntil - now()) / 1000) })), results: [] }
    }
    try {
      const results = await searchWithRetry(adapter, query, fetcher, sleep, timeoutMs)
      anyLive = true
      cachePut(db, query, adapter.slug, results, now())
      return { status: status(results.length, null), results }
    } catch (err) {
      // 单源失败不拖垮整次检索——空结果 + 错误标注（源标签上显示）
      if (isRateLimited(err)) cooldowns.set(adapter.slug, now() + RATE_LIMIT_COOLDOWN_MS)
      const message = isTimeout(err) ? uiText('search.timeout', { seconds: Math.round(timeoutMs / 1000) }) : friendlySourceError(err)
      return { status: status(0, message), results: [] }
    }
  }

  const compose = (final: boolean): SearchOutcome => {
    const parts = SOURCES.map(
      (a) =>
        settled.get(a.slug) ?? {
          status: { slug: a.slug, name: a.name, count: 0, error: null, pending: true },
          results: []
        }
    )
    const raw = parts.flatMap((p) => p.results)
    const deduped = dedupResults(raw)
    // 排序：被引数优先、无被引按年份新旧；查的是 arXiv 编号时精确命中永远排第一
    const idMatch = ARXIV_ID_RE.exec(query)
    const wantedId = idMatch ? idMatch[1] : null
    deduped.sort(
      (a, b) =>
        Number(b.arxivId === wantedId) - Number(a.arxivId === wantedId) ||
        (b.citations ?? -1) - (a.citations ?? -1) ||
        (b.year ?? 0) - (a.year ?? 0)
    )
    return {
      results: deduped.map((r) => {
        const w = r.arxivId && r.arxivId === wantedId ? { kind: 'id' as const, hits: [], text: 'arXiv 编号完全匹配' } : explainWhy(r, query)
        return { ...r, why: w.text, whyKind: w.kind, whyHits: w.hits }
      }),
      sources: parts.map((p) => p.status),
      rawCount: raw.length,
      // 只有真从缓存拿到东西才算「缓存」；各源全失败不是缓存命中
      fromCache: anyCached && !anyLive,
      ...(query !== rawQuery ? { queryUsed: query } : {}),
      ...(translateError ? { translateError } : {}),
      ...(final ? {} : { partial: true })
    }
  }

  await Promise.all(
    SOURCES.map(async (adapter) => {
      const part = await one(adapter)
      settled.set(adapter.slug, part)
      if (onPartial && settled.size < SOURCES.length) onPartial(compose(false))
    })
  )
  return compose(true)
}
