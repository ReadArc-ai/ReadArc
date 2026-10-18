/** arXiv 源：Atom XML，公开 API 无需密钥。粘贴 arXiv ID 时先读摘要页的元数据，取不到再走 id_list。 */
import type { Fetcher, SearchResult, SourceAdapter } from '../types'
import { sanitizeResults } from '../sanitize'

export const ARXIV_ID_RE = /^(\d{4}\.\d{4,5})(v\d+)?$/

function tag(entry: string, name: string): string {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(entry)
  return m ? m[1].replace(/\s+/g, ' ').trim() : ''
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Atom → 归一化结果。正则解析够用：arXiv 的 Atom 结构十年未变，引入 XML 库不值当。 */
export function parseArxivAtom(xml: string): SearchResult[] {
  const results: SearchResult[] = []
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = m[1]
    const idUrl = tag(entry, 'id') // http://arxiv.org/abs/2406.01234v2
    const idMatch = /abs\/([\d.]+)(v\d+)?/.exec(idUrl)
    const arxivId = idMatch ? idMatch[1] : null
    const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((a) =>
      decode(a[1].trim())
    )
    const published = tag(entry, 'published')
    const pdfLink = /<link[^>]*title="pdf"[^>]*href="([^"]+)"/.exec(entry)
    const doiMatch = /<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/.exec(entry)
    results.push({
      id: `arxiv:${arxivId ?? idUrl}`,
      title: decode(tag(entry, 'title')),
      authors,
      year: published ? Number(published.slice(0, 4)) || null : null,
      source: 'arXiv',
      url: idUrl,
      pdfUrl: pdfLink ? pdfLink[1] : arxivId ? `https://arxiv.org/pdf/${arxivId}` : null,
      doi: doiMatch ? doiMatch[1].trim() : null,
      arxivId,
      citations: null,
      abstract: decode(tag(entry, 'summary')) || null
    })
  }
  return sanitizeResults(results)
}

/**
 * 论文摘要页（arxiv.org/abs/…）上的 citation_* 元数据 → 一条结果。
 * 按编号查时先走这里：它和检索 API（export.arxiv.org）分开服务，API 排队或挂住时摘要页照样秒回
 */
export function parseArxivAbs(html: string, arxivId: string): SearchResult[] {
  const metas = (name: string): string[] =>
    [...html.matchAll(new RegExp(`<meta\\s+name="citation_${name}"\\s+content="([^"]*)"`, 'g'))].map((m) => decode(m[1]).replace(/\s+/g, ' ').trim())
  const title = metas('title')[0]
  if (!title) return []
  const date = metas('date')[0] ?? ''
  return sanitizeResults([
    {
      id: `arxiv:${arxivId}`,
      title,
      // 「Yao, Shunyu」→「Shunyu Yao」
      authors: metas('author').map((a) => a.split(/\s*,\s*/).reverse().join(' ')),
      year: Number(date.slice(0, 4)) || null,
      source: 'arXiv',
      url: `https://arxiv.org/abs/${arxivId}`,
      pdfUrl: metas('pdf_url')[0] ?? `https://arxiv.org/pdf/${arxivId}`,
      doi: metas('doi')[0] ?? null,
      arxivId,
      citations: null,
      abstract: metas('abstract')[0] ?? null
    }
  ])
}

export const arxivSource: SourceAdapter = {
  slug: 'arxiv',
  name: 'arXiv',
  async search(query: string, fetcher: Fetcher, signal?: AbortSignal): Promise<SearchResult[]> {
    const idMatch = ARXIV_ID_RE.exec(query.trim())
    if (idMatch) {
      try {
        const res = await fetcher(`https://arxiv.org/abs/${idMatch[1]}`, { signal })
        if (res.status === 404) return []
        if (res.ok) {
          const hit = parseArxivAbs(await res.text(), idMatch[1])
          if (hit.length > 0) return hit
        }
      } catch (err) {
        if (signal?.aborted) throw err
        // 摘要页取不到：退回检索 API
      }
    }
    const params = idMatch
      ? `id_list=${idMatch[1]}`
      : `search_query=all:${encodeURIComponent(query)}&sortBy=relevance`
    const url = `https://export.arxiv.org/api/query?${params}&max_results=20`
    const res = await fetcher(url, { signal })
    if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`)
    return parseArxivAtom(await res.text())
  }
}
