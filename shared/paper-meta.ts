/**
 * 论文信息的规整与校验（主进程与渲染进程共用）。
 * 编辑框的输入来自渲染进程，主进程写库前必须再过一遍：长度、年份范围、标签个数都要设上限。
 */
import type { PaperMetaPatch } from './models'

const MAX_TEXT = 500
const MAX_AUTHORS = 200
export const MAX_TAGS = 20
export const MAX_TAG_LEN = 32

function text(v: unknown, max = MAX_TEXT): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

/** 「https://doi.org/10.1145/xxx」「doi:10.1145/xxx」都规整成「10.1145/xxx」 */
export function normalizeDoi(v: unknown): string | null {
  const t = text(v, 200)
  if (!t) return null
  const m = /(10\.\d{4,9}\/\S+)/.exec(t)
  return m ? m[1].replace(/[.,;]+$/, '') : null
}

/** 「arXiv:2401.12345v2」「https://arxiv.org/abs/2401.12345」都规整成「2401.12345v2」；老式编号（hep-th/9901001）也认 */
export function normalizeArxivId(v: unknown): string | null {
  const t = text(v, 200)
  if (!t) return null
  const m = /(\d{4}\.\d{4,5}(?:v\d+)?)/.exec(t) ?? /([a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/.exec(t)
  return m ? m[1] : null
}

/** 输入框里的作者：逗号、分号、换行或「and」分隔 */
export function splitAuthors(v: string): string[] {
  return v
    .split(/[,;，；\n]|\s+and\s+/)
    .map((a) => a.trim())
    .filter(Boolean)
}

/** 标签：去首尾空白与开头的 #，同名（忽略大小写）只留第一个 */
export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of tags) {
    const t = text(raw, MAX_TAG_LEN)?.replace(/^#+/, '').trim()
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

/** 写库前的校验：标题不能为空，其余字段规整成合法值或 null */
export function sanitizeMetaPatch(v: unknown): PaperMetaPatch | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const title = text(o['title'])
  if (!title) return null
  const year = typeof o['year'] === 'number' && Number.isInteger(o['year']) && o['year'] >= 1000 && o['year'] <= 2999 ? o['year'] : null
  const authors = Array.isArray(o['authors'])
    ? o['authors'].map((a) => text(a, 200)).filter((a): a is string => !!a).slice(0, MAX_AUTHORS)
    : []
  return {
    title,
    title_zh: text(o['title_zh']),
    authors,
    year,
    source: text(o['source'], 200),
    doi: normalizeDoi(o['doi']),
    arxiv_id: normalizeArxivId(o['arxiv_id']),
    tags: normalizeTags(o['tags'])
  }
}
