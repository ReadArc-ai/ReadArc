/**
 * OpenAlex 源：开放学术图谱，公开 API 无需密钥，限额宽松（arXiv 关键词检索常卡住、Semantic Scholar 免密钥限流时，它多半还能用）。
 * 只做关键词检索：它对 arXiv 编号的映射偶有错配，编号查询交给 arXiv 与 Semantic Scholar。
 * 只留能下载的：期刊论文的 PDF 链接多指向出版社（403、要登录、空文件），所以只收在 arXiv 或开放仓储里有全文的
 */
import type { Fetcher, SearchResult, SourceAdapter } from '../types'
import { sanitizeResults } from '../sanitize'
import { ARXIV_ID_RE } from './arxiv'

interface OaWork {
  id?: string
  title?: string | null
  publication_year?: number | null
  cited_by_count?: number | null
  doi?: string | null
  authorships?: { author?: { display_name?: string | null } }[]
  best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null } | null
  locations?: { pdf_url?: string | null; landing_page_url?: string | null; source?: { type?: string | null } | null }[] | null
  abstract_inverted_index?: Record<string, number[]> | null
}

/** OpenAlex 的摘要是倒排索引（词 → 位置），按位置拼回原文 */
function abstractOf(index: OaWork['abstract_inverted_index']): string | null {
  if (!index) return null
  const words: string[] = []
  for (const [word, positions] of Object.entries(index)) for (const p of positions) if (p >= 0 && p < 5000) words[p] = word
  const text = words.filter(Boolean).join(' ').trim()
  return text || null
}

/**
 * 这些站点挡程序下载（返回网页、人机验证或 403）：PubMed Central 及其镜像 Europe PMC、preprints.org、ResearchGate 等。
 * 全文只在这些地方的，搜出来也加不进论文库，不如不列
 */
const BLOCKED_HOSTS = /^https:\/\/([^/]+\.)?(ncbi\.nlm\.nih\.gov|europepmc\.org|preprints\.org|researchgate\.net|ssrn\.com|academia\.edu)\//i

/** 能直接下载的全文：arXiv 的那份优先（下载最稳，也能和 arXiv 结果合并），其次开放仓储；只有出版社链接的不要 */
function downloadable(w: OaWork): { pdfUrl: string; arxivId: string | null } | null {
  const locs = w.locations ?? []
  for (const l of locs) {
    const m = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i.exec(`${l.landing_page_url ?? ''} ${l.pdf_url ?? ''}`)
    if (m) return { pdfUrl: `https://arxiv.org/pdf/${m[1]}`, arxivId: m[1] }
  }
  const repo = locs.find((l) => l.source?.type === 'repository' && l.pdf_url && /^https:\/\//i.test(l.pdf_url) && !BLOCKED_HOSTS.test(l.pdf_url))
  return repo?.pdf_url ? { pdfUrl: repo.pdf_url, arxivId: null } : null
}

export function normalizeOpenAlex(works: OaWork[]): SearchResult[] {
  const out: SearchResult[] = []
  for (const w of works) {
    if (!w.title) continue
    const file = downloadable(w)
    if (!file) continue
    const doi = w.doi ? w.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : null
    out.push({
      id: `oa:${(w.id ?? w.title).replace(/^https?:\/\/openalex\.org\//, '')}`,
      title: w.title,
      authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? '').filter(Boolean),
      year: w.publication_year ?? null,
      source: 'OpenAlex',
      url: w.doi ?? w.best_oa_location?.landing_page_url ?? w.id ?? '',
      pdfUrl: file.pdfUrl,
      // arXiv 的 DOI（10.48550/arXiv.…）不拿来合并：映射偶有错配；arXiv 编号只认 arXiv 自己那份全文的地址
      doi: doi && !/^10\.48550\/arxiv\./i.test(doi) ? doi : null,
      arxivId: file.arxivId,
      citations: w.cited_by_count ?? null,
      abstract: abstractOf(w.abstract_inverted_index)
    })
  }
  return sanitizeResults(out).slice(0, 20)
}

const SELECT = 'id,title,publication_year,cited_by_count,doi,authorships,best_oa_location,locations,abstract_inverted_index'

export const openAlexSource: SourceAdapter = {
  slug: 'openalex',
  name: 'OpenAlex',
  // 2：只收能下载的全文（arXiv 优先、跳过挡下载的站点）
  cacheVersion: 2,
  async search(query: string, fetcher: Fetcher, signal?: AbortSignal): Promise<SearchResult[]> {
    if (ARXIV_ID_RE.test(query.trim())) return []
    // 只要在开放仓储（含 arXiv）有副本的；多取一些，筛掉没有可下载全文的还能剩下足够的结果
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&filter=locations.source.type:repository&per-page=50&select=${SELECT}`
    const res = await fetcher(url, { signal })
    if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`)
    const parsed = (await res.json()) as { results?: OaWork[] }
    return normalizeOpenAlex(parsed.results ?? [])
  }
}
