/** 去重：DOI → arXiv ID → 标题 simhash 三级；合并时保留信息更全的字段。 */
import { hammingDistance, simhash64 } from '../docengine/anchor'
import type { SearchResult } from './types'

const TITLE_THRESHOLD = 6

function merge(a: SearchResult, b: SearchResult): SearchResult {
  return {
    ...a,
    // 字段择优：有值的赢；引用数取大；PDF 链接优先保留
    year: a.year ?? b.year,
    doi: a.doi ?? b.doi,
    arxivId: a.arxivId ?? b.arxivId,
    pdfUrl: a.pdfUrl ?? b.pdfUrl,
    abstract: a.abstract ?? b.abstract,
    citations: Math.max(a.citations ?? -1, b.citations ?? -1) >= 0
      ? Math.max(a.citations ?? 0, b.citations ?? 0)
      : null,
    authors: a.authors.length >= b.authors.length ? a.authors : b.authors,
    source: a.source === b.source ? a.source : `${a.source}+${b.source}`
  }
}

export function dedupResults(results: SearchResult[]): SearchResult[] {
  const kept: { result: SearchResult; titleHash: string }[] = []
  const byDoi = new Map<string, number>()
  const byArxiv = new Map<string, number>()

  for (const r of results) {
    const idHit = (r.doi ? byDoi.get(r.doi.toLowerCase()) : undefined) ??
      (r.arxivId ? byArxiv.get(r.arxivId) : undefined)
    const hash = simhash64(r.title)
    const matchIdx =
      idHit ?? kept.findIndex((k) => hammingDistance(k.titleHash, hash) <= TITLE_THRESHOLD)

    let idx: number
    if (matchIdx >= 0) {
      kept[matchIdx].result = merge(kept[matchIdx].result, r)
      idx = matchIdx
    } else {
      kept.push({ result: r, titleHash: simhash64(r.title) })
      idx = kept.length - 1
    }
    const merged = kept[idx].result
    if (merged.doi) byDoi.set(merged.doi.toLowerCase(), idx)
    if (merged.arxivId) byArxiv.set(merged.arxivId, idx)
  }

  return kept.map((k) => k.result)
}

/**
 * 查询里没有区分度的英文词：命中它们说明不了任何事——
 * 「attention is all you need」曾给出「命中：attention、all、you、need」这种理由。
 */
const EN_STOP = new Set([
  'the', 'and', 'for', 'with', 'all', 'you', 'your', 'need', 'are', 'was', 'were', 'from', 'that',
  'this', 'these', 'those', 'what', 'how', 'why', 'when', 'which', 'who', 'using', 'use', 'used',
  'based', 'via', 'into', 'its', 'our', 'can', 'not', 'but', 'has', 'have', 'had', 'does', 'did',
  'about', 'paper', 'papers', 'study', 'method', 'approach', 'new', 'towards', 'toward', 'over',
  'under', 'between', 'through', 'more', 'than', 'some', 'any', 'one', 'two', 'per', 'via'
])

/** WHY 行的结构化理由：渲染端按界面语言组句（主进程不知道用户选了中文还是英文）。 */
export interface WhyReason {
  kind: 'hits' | 'cited' | 'related' | 'id'
  hits: string[]
  /** 中文兜底文案（AI 检索总结等主进程内消费者用） */
  text: string
}

/** WHY 行（没有这句话的推荐列表等于噪音）。AI 按研究方向重排接入前先给检索命中理由。 */
export function explainWhy(result: SearchResult, query: string): WhyReason {
  const terms = [
    // 纯数字（编号、年份）不算关键词：命中「1706」说明不了任何相关性
    ...(query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !EN_STOP.has(w) && !/^\d+$/.test(w)),
    ...(query.match(/[一-鿿]{2,}/g) ?? [])
  ]
  const haystack = `${result.title} ${result.abstract ?? ''}`.toLowerCase()
  const hits = [...new Set(terms.filter((t) => haystack.includes(t.toLowerCase())))].slice(0, 4)
  if (hits.length > 0) return { kind: 'hits', hits, text: `命中：${hits.join('、')}` }
  if (result.citations && result.citations > 100) {
    return { kind: 'cited', hits: [], text: `同主题高被引（${result.citations}）` }
  }
  return { kind: 'related', hits: [], text: '同领域相关结果' }
}

export function computeWhy(result: SearchResult, query: string): string {
  return explainWhy(result, query).text
}
