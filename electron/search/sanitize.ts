/**
 * 检索源返回字段的收口。
 *
 * 这是外部数据**大量**进入应用的唯一入口：标题、摘要、作者会直接写进数据库、
 * 渲染到界面、参与生成下载文件名。上游给什么就存什么的话，一条畸形记录就能
 * 往结果列表里塞空卡片，或者把 20 万字符的标题灌进库里。
 * 收口只做两件事：没有可用身份的条目丢弃、明显超长的字段截断。
 */
import type { SearchResult } from './types'

/** 标题：正常论文标题不会超过这个长度，超出多半是上游出错或投毒。 */
const MAX_TITLE = 300
const MAX_ABSTRACT = 4000
const MAX_AUTHORS = 60
const MAX_AUTHOR_NAME = 120

function clamp(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) : t
}

/** 收口一条结果；没有任何可用身份（标题与三种 id 全空）时返回 null 表示丢弃。 */
export function sanitizeResult(r: SearchResult): SearchResult | null {
  const title = clamp(r.title ?? '', MAX_TITLE)
  const hasIdentity = Boolean(title || r.arxivId || r.doi || r.pdfUrl)
  if (!hasIdentity) return null
  return {
    ...r,
    title,
    authors: (r.authors ?? []).slice(0, MAX_AUTHORS).map((a) => clamp(a, MAX_AUTHOR_NAME)).filter(Boolean),
    abstract: r.abstract ? clamp(r.abstract, MAX_ABSTRACT) || null : null,
    year: Number.isFinite(r.year) && r.year !== null && r.year > 1500 && r.year < 2200 ? r.year : null
  }
}

export function sanitizeResults(rs: SearchResult[]): SearchResult[] {
  const out: SearchResult[] = []
  for (const r of rs) {
    const s = sanitizeResult(r)
    if (s) out.push(s)
  }
  return out
}
