/** Semantic Scholar 源：Graph API，公开、无需密钥（IP 级限流，客户端退避）。 */
import type { Fetcher, SearchResult, SourceAdapter } from '../types'
import { sanitizeResults } from '../sanitize'
import { ARXIV_ID_RE } from './arxiv'

interface S2Paper {
  paperId?: string
  title?: string
  year?: number
  abstract?: string
  citationCount?: number
  authors?: { name?: string }[]
  externalIds?: { DOI?: string; ArXiv?: string }
  openAccessPdf?: { url?: string }
}

export function normalizeS2(papers: S2Paper[]): SearchResult[] {
  return sanitizeResults(
    papers
    .filter((p) => p.title)
    .map((p) => ({
      id: `s2:${p.paperId ?? p.title}`,
      title: p.title!,
      authors: (p.authors ?? []).map((a) => a.name ?? '').filter(Boolean),
      year: p.year ?? null,
      source: 'S2',
      url: p.paperId ? `https://www.semanticscholar.org/paper/${p.paperId}` : '',
      pdfUrl: p.openAccessPdf?.url ?? null,
      doi: p.externalIds?.DOI ?? null,
      arxivId: p.externalIds?.ArXiv ?? null,
      citations: p.citationCount ?? null,
      abstract: p.abstract ?? null
    }))
  )
}

const FIELDS = 'title,year,authors,abstract,citationCount,externalIds,openAccessPdf'

export const semanticScholarSource: SourceAdapter = {
  slug: 's2',
  name: 'Semantic Scholar',
  async search(query: string, fetcher: Fetcher, signal?: AbortSignal): Promise<SearchResult[]> {
    // arXiv 编号直接按编号取这一篇（arXiv 自己的接口慢或挂了时，这条路还能找到）；关键词检索会把编号拆成数字碎片
    const id = ARXIV_ID_RE.exec(query.trim())
    if (id) {
      const res = await fetcher(`https://api.semanticscholar.org/graph/v1/paper/arXiv:${id[1]}?fields=${FIELDS}`, { signal })
      if (res.status === 404) return []
      if (!res.ok) throw new Error(`S2 HTTP ${res.status}`)
      return normalizeS2([(await res.json()) as S2Paper])
    }
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=20&fields=${FIELDS}`
    const res = await fetcher(url, { signal })
    if (!res.ok) throw new Error(`S2 HTTP ${res.status}`)
    const parsed = (await res.json()) as { data?: S2Paper[] }
    return normalizeS2(parsed.data ?? [])
  }
}
