import { create } from 'zustand'
import type { PaperRow } from '../../shared/models'
import { ensureThumbnail } from '../lib/thumbnails'
import { usePaper } from './paper'
import { errText } from '../lib/errors'

export type Collection = 'all' | 'unread' | 'reading' | 'done'

interface LibraryState {
  papers: PaperRow[]
  /** 读库失败（多半是数据库损坏）：界面必须说出来，不能装作是空库 */
  loadError: string | null
  collection: Collection
  /** paperId → 首页缩略图 data URL（无则回退纹理占位） */
  thumbs: Record<string, string>
  /** 某篇封面进入视野：确保它的缩略图生成 */
  ensureThumb(paperId: string): void
  load(): Promise<void>
  setCollection(c: Collection): void
  /** 删除论文：DB+应用内文件；若正在阅读则关掉阅读器。笔记文件保留 */
  remove(paperId: string): Promise<void>
}

export const useLibrary = create<LibraryState>((set, get) => ({
  papers: [],
  loadError: null,
  collection: 'all',
  thumbs: {},

  load: async () => {
    let papers: PaperRow[]
    try {
      papers = await window.readarc.listPapers()
    } catch (err) {
      // 数据库打不开时若什么都不说，用户看到的是一个「正常的空库」，
      // 会以为论文全丢了——实际 PDF 与笔记都还在磁盘上。
      set({ loadError: errText(err) })
      return
    }
    set({ papers, loadError: null })
  },

  /**
   * 封面缩略图按需生成：卡片滚进视野才渲染那一篇。
   * 原来打开论文库就把所有缺图的论文排队渲染一遍——三百篇的库要跑几百次 PDF 渲染，
   * 其中绝大多数用户根本没滚到。渲染结果仍然落盘，第二次打开直接读文件。
   */
  ensureThumb: (paperId) => {
    if (get().thumbs[paperId]) return
    void ensureThumbnail(paperId).then((url) => {
      if (url) set((s) => ({ thumbs: { ...s.thumbs, [paperId]: url } }))
    })
  },

  setCollection: (collection) => set({ collection }),

  remove: async (paperId) => {
    const ok = await window.readarc.deletePaper(paperId)
    if (!ok) return
    set((s) => ({ papers: s.papers.filter((p) => p.id !== paperId) }))
    if (usePaper.getState().bundle?.paper.id === paperId) {
      usePaper.setState({ bundle: null, translations: {}, translating: false })
    }
  }
}))

/** 论文库内搜索：标题（含中文标题）、作者、年份、来源。空查询原样返回 */
export function filterByQuery(papers: PaperRow[], query: string): PaperRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return papers
  return papers.filter((p) =>
    [p.title, p.title_zh, p.authors, p.source, p.arxiv_id, p.year != null ? String(p.year) : null]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(q))
  )
}

export function filterByCollection(papers: PaperRow[], c: Collection): PaperRow[] {
  switch (c) {
    case 'unread':
      return papers.filter((p) => p.status === 'new')
    case 'reading':
      return papers.filter((p) => p.status === 'reading')
    case 'done':
      return papers.filter((p) => p.status === 'done')
    default:
      return papers
  }
}

/** 继续读书架：0 < 进度 < 100，最多 3 张。 */
export function continueReading(papers: PaperRow[]): PaperRow[] {
  return papers.filter((p) => p.progress > 0 && p.progress < 100).slice(0, 3)
}
