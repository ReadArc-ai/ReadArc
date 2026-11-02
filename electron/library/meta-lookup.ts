/**
 * 按 DOI / arXiv 号拉一次权威元数据，给「编辑论文信息」的「补全」按钮和导入后的自动补全用。
 * 有 DOI 先问 Semantic Scholar（能拿到期刊 / 会议名），限流或查不到再问 OpenAlex；
 * arXiv 号先读摘要页（和检索 API 分开服务，API 排队或挂住时它照样秒回），取不到再走 API。
 * 只读、不写库。
 */
import type { PaperMetaLookup } from '../../shared/models'
import { normalizeArxivId, normalizeDoi } from '../../shared/paper-meta'
import { parseArxivAbs, parseArxivAtom } from '../search/sources/arxiv'
import type { Fetcher } from '../search/types'
import { uiText } from '../i18n'

const TIMEOUT_MS = 10_000

interface S2Paper {
  title?: string
  year?: number
  venue?: string
  authors?: { name?: string }[]
  externalIds?: { DOI?: string; ArXiv?: string }
}

async function bySemanticScholar(doi: string, fetcher: Fetcher): Promise<PaperMetaLookup | null> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=title,year,venue,authors,externalIds`
  const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const p = (await res.json()) as S2Paper
  if (!p.title) return null
  return {
    title: p.title,
    authors: (p.authors ?? []).map((a) => a.name ?? '').filter(Boolean),
    year: p.year ?? null,
    source: p.venue?.trim() || null,
    doi: p.externalIds?.DOI ?? doi,
    arxiv_id: p.externalIds?.ArXiv ?? null
  }
}

async function byArxivAbs(id: string, fetcher: Fetcher): Promise<PaperMetaLookup | null> {
  const res = await fetcher(`https://arxiv.org/abs/${encodeURIComponent(id).replace(/%2F/g, '/')}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const hit = parseArxivAbs(await res.text(), id.replace(/v\d+$/, ''))[0]
  if (!hit) return null
  return { title: hit.title, authors: hit.authors, year: hit.year, source: 'arXiv', doi: hit.doi, arxiv_id: hit.arxivId ?? id }
}

interface OaWork {
  title?: string | null
  publication_year?: number | null
  doi?: string | null
  authorships?: { author?: { display_name?: string | null } }[]
  primary_location?: { source?: { display_name?: string | null } | null } | null
  locations?: { landing_page_url?: string | null; pdf_url?: string | null }[] | null
}

const OA_SELECT = 'title,publication_year,doi,authorships,primary_location,locations'

function fromOpenAlex(w: OaWork): PaperMetaLookup | null {
  if (!w.title) return null
  const venue = w.primary_location?.source?.display_name?.trim() || null
  const arxiv = (w.locations ?? [])
    .map((l) => /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i.exec(`${l.landing_page_url ?? ''} ${l.pdf_url ?? ''}`)?.[1])
    .find(Boolean)
  return {
    title: w.title,
    authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? '').filter(Boolean),
    year: w.publication_year ?? null,
    source: venue && /arxiv/i.test(venue) ? 'arXiv' : venue,
    doi: normalizeDoi(w.doi),
    arxiv_id: arxiv ?? null
  }
}

async function byOpenAlexDoi(doi: string, fetcher: Fetcher): Promise<PaperMetaLookup | null> {
  const res = await fetcher(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=${OA_SELECT}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return fromOpenAlex((await res.json()) as OaWork)
}

async function byArxiv(id: string, fetcher: Fetcher): Promise<PaperMetaLookup | null> {
  const res = await fetcher(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`, {
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const hit = parseArxivAtom(await res.text())[0]
  if (!hit || !hit.title) return null
  return { title: hit.title, authors: hit.authors, year: hit.year, source: 'arXiv', doi: hit.doi, arxiv_id: hit.arxivId ?? id }
}

/** 依次试各条路：查到就返回；都明确查不到返回 null；有路走不通（断网、限流）且没查到时抛错，调用方下次再试 */
export async function findPaperMeta(
  input: { doi?: unknown; arxiv_id?: unknown },
  fetcher: Fetcher = (url, init) => fetch(url, init)
): Promise<PaperMetaLookup | null> {
  const doi = normalizeDoi(input.doi)
  const arxivId = normalizeArxivId(input.arxiv_id)
  const attempts = [
    doi ? () => bySemanticScholar(doi, fetcher) : null,
    doi ? () => byOpenAlexDoi(doi, fetcher) : null,
    arxivId ? () => byArxivAbs(arxivId, fetcher) : null,
    arxivId ? () => byArxiv(arxivId, fetcher) : null
  ]
  let failed: unknown = null
  for (const attempt of attempts) {
    if (!attempt) continue
    try {
      const hit = await attempt()
      if (hit) return hit
    } catch (err) {
      failed = err
    }
  }
  if (failed) throw failed
  return null
}

export async function lookupPaperMeta(
  input: { doi?: unknown; arxiv_id?: unknown },
  fetcher: Fetcher = (url, init) => fetch(url, init)
): Promise<PaperMetaLookup> {
  if (!normalizeDoi(input.doi) && !normalizeArxivId(input.arxiv_id)) throw new Error(uiText('meta.need-id'))
  let hit: PaperMetaLookup | null
  try {
    hit = await findPaperMeta(input, fetcher)
  } catch (err) {
    throw new Error(uiText('meta.lookup-failed'), { cause: err })
  }
  if (!hit) throw new Error(uiText('meta.not-found'))
  return hit
}

/** 只比字母数字：版面识别出的「REAC T」和官方标题「ReAct」算同一个 */
function titleKey(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** 首页上认出的编号是不是这篇自己的（也可能是脚注里引用的别的论文）：标题相同或一个包含另一个 */
export function sameTitle(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = titleKey(a ?? '')
  const y = titleKey(b ?? '')
  if (x.length < 4 || y.length < 4) return false
  return x === y || x.includes(y) || y.includes(x)
}

/**
 * 没有任何编号的 PDF（会议论文、学位论文）：按标题在 OpenAlex 查。
 * 同名不同文的风险靠两条拦：标题必须完全相同，且候选的作者姓氏要出现在 PDF 首页上。
 */
export async function lookupByTitle(
  title: string,
  firstPage: string,
  fetcher: Fetcher = (url, init) => fetch(url, init)
): Promise<PaperMetaLookup | null> {
  const res = await fetcher(`https://api.openalex.org/works?search=${encodeURIComponent(title)}&per-page=8&select=${OA_SELECT}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { results } = (await res.json()) as { results?: OaWork[] }
  const key = titleKey(title)
  const page = firstPage.toLowerCase()
  for (const w of results ?? []) {
    if (!w.title || titleKey(w.title) !== key) continue
    const hit = fromOpenAlex(w)
    const surnames = (hit?.authors ?? []).slice(0, 20).map((a) => a.trim().split(/\s+/).pop()?.toLowerCase() ?? '')
    if (hit && surnames.some((s) => s.length >= 3 && page.includes(s))) return hit
  }
  return null
}
