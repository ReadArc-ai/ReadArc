/**
 * 论文源贡献接口：加一个源 = sources/ 下一个文件，
 * 内容只有两件事——查询构造 + 结果归一化。
 */

export interface SearchResult {
  /** 源内唯一 id（去重后可能合并多个源的 id） */
  id: string
  title: string
  authors: string[]
  year: number | null
  /** 来源徽标：arXiv / S2 / … */
  source: string
  url: string
  pdfUrl: string | null
  doi: string | null
  arxivId: string | null
  citations: number | null
  abstract: string | null
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

export interface SourceAdapter {
  slug: string
  name: string
  search(query: string, fetcher: Fetcher, signal?: AbortSignal): Promise<SearchResult[]>
}

export interface SourceStatus {
  slug: string
  name: string
  count: number
  error: string | null
  /** 中间结果里还没回来的源 */
  pending?: boolean
}

export interface SearchOutcome {
  results: (SearchResult & { why: string; whyKind?: 'hits' | 'cited' | 'related' | 'id'; whyHits?: string[] })[]
  sources: SourceStatus[]
  /** 去重前总数 */
  rawCount: number
  fromCache: boolean
  /** 中文检索词被翻成了英文再查：实际发给各源的词 */
  queryUsed?: string
  /** 中文转英文失败（没接模型等）：照原词查了，界面提示用英文试 */
  translateError?: string | null
  /** 还有源没回来（快的源先渲染） */
  partial?: boolean
}
