import { create } from 'zustand'
import type { PaperMetaPatch, PaperRow } from '../../shared/models'
import type { LibSort } from '../../shared/ipc'
import { ensureThumbnail } from '../lib/thumbnails'
import { usePaper } from './paper'
import { errText } from '../lib/errors'

export type Collection = 'all' | 'unread' | 'reading' | 'done'

interface LibraryState {
  /** 正在后台补标题译名（论文库标题旁给一句提示） */
  titlesTranslating: boolean
  papers: PaperRow[]
  /** 读库失败（多半是数据库损坏）：界面必须说出来，不能装作是空库 */
  loadError: string | null
  collection: Collection
  sort: LibSort
  /** 侧栏选中的标签；null = 不按标签筛 */
  tag: string | null
  /** 正在编辑信息的论文 id（编辑框开着） */
  editing: string | null
  /** paperId → 首页缩略图 data URL（无则回退纹理占位） */
  thumbs: Record<string, string>
  /** 某篇封面进入视野：确保它的缩略图生成 */
  ensureThumb(paperId: string): void
  load(): Promise<void>
  setCollection(c: Collection): void
  setSort(sort: LibSort): void
  setTag(tag: string | null): void
  setEditing(paperId: string | null): void
  /** 保存编辑后的信息：库列表与正在阅读的那篇同步更新 */
  updateMeta(paperId: string, meta: PaperMetaPatch): Promise<void>
  setPinned(paperId: string, pinned: boolean): Promise<void>
  /** 删除论文：DB+应用内文件；若正在阅读则关掉阅读器。笔记文件保留 */
  remove(paperId: string): Promise<void>
}

/** 正在补标题译名：同一时间只发一次 */
let titleJob: Promise<void> | null = null

export const useLibrary = create<LibraryState>((set, get) => ({
  papers: [],
  loadError: null,
  collection: 'all',
  sort: 'opened',
  tag: null,
  editing: null,
  thumbs: {},
  titlesTranslating: false,

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
    // 选中的标签已经没有论文了（最后一篇被删或改掉了这个标签）：回到不筛选
    const tag = get().tag
    set({ papers, loadError: null, tag: tag && papers.some((p) => p.tags?.includes(tag)) ? tag : null })
    // 有论文还没有标题译名就让主进程补一趟（只发标题；没接模型时主进程什么都不发），译出新的再刷新
    if (!titleJob && papers.some((p) => !p.title_tr && !p.title_zh)) {
      set({ titlesTranslating: true })
      titleJob = window.readarc
        .translateTitles()
        .then((n) => {
          if (n > 0) void get().load()
        })
        .catch(() => {})
        .finally(() => {
          titleJob = null
          set({ titlesTranslating: false })
        })
    }
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

  setSort: (sort) => {
    set({ sort })
    window.readarc?.patchSettings({ libSort: sort })
  },

  setTag: (tag) => set({ tag }),

  setEditing: (editing) => set({ editing }),

  updateMeta: async (paperId, meta) => {
    const row = await window.readarc.updatePaperMeta(paperId, meta)
    if (!row) return
    set((s) => ({ papers: s.papers.map((p) => (p.id === paperId ? { ...p, ...row } : p)) }))
    // 正在阅读的就是这篇：标题、作者跟着变（窗口标题、笔记标题都读 bundle.paper）
    const { bundle } = usePaper.getState()
    if (bundle?.paper.id === paperId) usePaper.setState({ bundle: { ...bundle, paper: { ...bundle.paper, ...row } } })
    await get().load()
  },

  setPinned: async (paperId, pinned) => {
    await window.readarc.setPaperPinned(paperId, pinned)
    await get().load()
  },

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
    [p.title, p.title_zh, p.title_tr, p.authors, p.source, p.arxiv_id, p.doi, p.year != null ? String(p.year) : null, ...(p.tags ?? [])]
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

export function filterByTag(papers: PaperRow[], tag: string | null): PaperRow[] {
  return tag ? papers.filter((p) => p.tags?.includes(tag)) : papers
}

/** 库里出现过的标签与篇数，按名称排序（中英文混排按本地化规则） */
export function tagCounts(papers: PaperRow[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const p of papers) for (const t of p.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag))
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * 排序：置顶的永远在前（后置顶的更靠前），其余按所选字段。
 * 标题按本地化规则；没有年份的排在有年份的后面；同值时按最近打开兜底，顺序稳定
 */
export function sortPapers(papers: PaperRow[], sort: LibSort): PaperRow[] {
  const opened = (p: PaperRow): number => p.last_opened_at ?? p.added_at
  const by = (a: PaperRow, b: PaperRow): number => {
    switch (sort) {
      case 'added':
        return b.added_at - a.added_at
      case 'title':
        return collator.compare(a.title ?? '', b.title ?? '')
      case 'year':
        return (b.year ?? -Infinity) - (a.year ?? -Infinity) || 0
      default:
        return opened(b) - opened(a)
    }
  }
  return [...papers].sort((a, b) => {
    const pa = a.pinned_at ?? 0
    const pb = b.pinned_at ?? 0
    if (pa || pb) return pb - pa
    return by(a, b) || opened(b) - opened(a)
  })
}

/** 继续读书架：0 < 进度 < 100，最多 3 张。 */
export function continueReading(papers: PaperRow[]): PaperRow[] {
  return papers.filter((p) => p.progress > 0 && p.progress < 100).slice(0, 3)
}
