/** 搜索屏状态：提升到 store——切屏/回来结果仍在（组件卸载不丢）。 */
import { create } from 'zustand'
import { errText } from '../lib/errors'
import type { SearchOutcome, SearchProgressEvent, SearchResultInput } from '../../shared/models'

export type AddState =
  | { paperId: string; existed: boolean }
  | { busy: true; stage: 'download' | 'import'; received: number; total: number }
  | { error: string }
  | undefined

interface SearchState {
  query: string
  outcome: SearchOutcome | null
  searching: boolean
  added: Record<string, AddState>

  setQuery(q: string): void
  run(): Promise<void>
  /** 某个源先回来：先渲染中间结果（只认当前这次检索的） */
  applyProgress(e: SearchProgressEvent): void
  add(r: SearchResultInput): Promise<void>
  applyAddProgress(e: {
    id: string
    stage: 'download' | 'import'
    received: number
    total: number
  }): void
}

export const useSearch = create<SearchState>((set, get) => ({
  query: '',
  outcome: null,
  searching: false,
  added: {},

  setQuery: (query) => set({ query }),

  run: async () => {
    const { query, searching } = get()
    if (!query.trim() || searching) return
    set({ searching: true })
    try {
      set({ outcome: await window.readarc.runSearch(query.trim()) })
    } catch (err) {
      // 请求本身失败（不是某个源失败）：还在等的源标成失败，别让来源标签一直停在「…」
      const msg = errText(err)
      const prev = get().outcome
      const sources = prev?.sources.length
        ? prev.sources.map((s) => (s.pending ? { ...s, pending: false, error: msg } : s))
        : [{ slug: 'readarc', name: 'ReadArc', count: 0, error: msg }]
      set({ outcome: { results: prev?.results ?? [], sources, rawCount: prev?.rawCount ?? 0, fromCache: false, partial: false } })
    } finally {
      set({ searching: false })
    }
  },

  applyProgress: (e) => {
    const { query, searching } = get()
    if (!searching || e.query !== query.trim()) return
    set({ outcome: e.outcome })
  },

  applyAddProgress: (e) => {
    set((s) => {
      const cur = s.added[e.id]
      // 已完成/已失败后迟到的进度事件丢弃
      if (cur && !('busy' in cur)) return s
      return {
        added: {
          ...s.added,
          [e.id]: { busy: true, stage: e.stage, received: e.received, total: e.total }
        }
      }
    })
  },

  add: async (r) => {
    set((s) => ({
      added: { ...s.added, [r.id]: { busy: true, stage: 'download', received: 0, total: 0 } }
    }))
    try {
      const out = await window.readarc.addSearchResult(r)
      set((s) => ({ added: { ...s.added, [r.id]: out } }))
      // 下载完直接开读，不让人在搜索页干等；版面识别在后台继续
      const { usePaper } = await import('./paper')
      const { useApp } = await import('./app')
      await usePaper.getState().loadPaper(out.paperId)
      useApp.getState().setScreen('reader')
    } catch (err) {
      set((s) => ({
        added: { ...s.added, [r.id]: { error: errText(err) } }
      }))
    }
  }
}))
