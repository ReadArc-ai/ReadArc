/**
 * 按 DOI / arXiv 号拉一次权威元数据，给「编辑论文信息」的「补全」按钮用。
 * 有 DOI 先问 Semantic Scholar（能拿到期刊 / 会议名），没有再按 arXiv 号问 arXiv。
 * 只读、不写库：结果填回编辑框，用户确认保存后才落库。
 */
import type { PaperMetaLookup } from '../../shared/models'
import { normalizeArxivId, normalizeDoi } from '../../shared/paper-meta'
import { parseArxivAtom } from '../search/sources/arxiv'
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

async function byArxiv(id: string, fetcher: Fetcher): Promise<PaperMetaLookup | null> {
  const res = await fetcher(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`, {
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const hit = parseArxivAtom(await res.text())[0]
  if (!hit || !hit.title) return null
  return { title: hit.title, authors: hit.authors, year: hit.year, source: 'arXiv', doi: hit.doi, arxiv_id: hit.arxivId ?? id }
}

export async function lookupPaperMeta(
  input: { doi?: unknown; arxiv_id?: unknown },
  fetcher: Fetcher = (url, init) => fetch(url, init)
): Promise<PaperMetaLookup> {
  const doi = normalizeDoi(input.doi)
  const arxivId = normalizeArxivId(input.arxiv_id)
  if (!doi && !arxivId) throw new Error(uiText('meta.need-id'))
  let failed: unknown = null
  for (const attempt of [doi ? () => bySemanticScholar(doi, fetcher) : null, arxivId ? () => byArxiv(arxivId, fetcher) : null]) {
    if (!attempt) continue
    try {
      const hit = await attempt()
      if (hit) return hit
    } catch (err) {
      failed = err
    }
  }
  throw new Error(uiText(failed ? 'meta.lookup-failed' : 'meta.not-found'), failed ? { cause: failed } : undefined)
}
