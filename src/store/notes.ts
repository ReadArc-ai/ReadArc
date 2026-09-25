/** 笔记面板状态。composerBlockId = 「记」按钮选中的段落，面板据此展开输入框。 */
import { create } from 'zustand'
import type { NoteAnchorView, PaperNotes } from '../../shared/models'
import { useApp } from './app'
import { usePaper } from './paper'

interface NotesState {
  byPaper: Record<string, PaperNotes>
  composerBlockId: string | null
  /** 选区文字：有则锚点作用域是选区而非整段 */
  composerSelection: string | null

  load(paperId: string): Promise<void>
  /** 「记」动作：以该段（或选区）为锚点开始写（面板收起时先展开） */
  startNote(blockId: string, selection?: string): void
  submit(text: string): Promise<void>
  cancelComposer(): void
  addHighlight(
    blockId: string,
    selection: string,
    rects?: [number, number, number, number, number][],
    hintRange?: [number, number]
  ): Promise<void>
  removeHighlight(id: string): Promise<void>
  /** 刚被移除的高亮（几秒内可撤销）：高亮点一下就没，误点等于悄悄丢数据 */
  undoHighlight: { paperId: string; anchor: NoteAnchorView } | null
  restoreHighlight(): Promise<void>
  dismissUndo(): void
  removeNote(anchorId: string): Promise<void>
}

let undoTimer: ReturnType<typeof setTimeout> | null = null

export const useNotes = create<NotesState>((set, get) => ({
  byPaper: {},
  composerBlockId: null,
  composerSelection: null,

  load: async (paperId) => {
    const notes = await window.readarc.listNotes(paperId)
    set((s) => ({ byPaper: { ...s.byPaper, [paperId]: notes } }))
  },

  startNote: (blockId, selection) => {
    set({ composerBlockId: blockId, composerSelection: selection ?? null })
    useApp.getState().setPanel('notes')
  },

  submit: async (text) => {
    const paperId = usePaper.getState().bundle?.paper.id
    const { composerBlockId: blockId, composerSelection } = get()
    if (!paperId || !blockId || !text.trim()) return
    const entry = await window.readarc.addNote(
      paperId,
      blockId,
      text.trim(),
      composerSelection ?? undefined
    )
    set((s) => {
      const current = s.byPaper[paperId] ?? { file: '', entries: [] }
      return {
        composerBlockId: null,
        composerSelection: null,
        byPaper: {
          ...s.byPaper,
          [paperId]: { ...current, entries: [entry, ...current.entries] }
        }
      }
    })
    // 文件名可能首次生成，回读一次拿准 file 字段
    void get().load(paperId)
  },

  cancelComposer: () => set({ composerBlockId: null, composerSelection: null }),

  addHighlight: async (blockId, selection, rects, hintRange) => {
    const paperId = usePaper.getState().bundle?.paper.id
    if (!paperId) return
    await window.readarc.addHighlight(paperId, blockId, selection, rects, hintRange)
    await get().load(paperId)
  },

  removeNote: async (anchorId) => {
    const paperId = usePaper.getState().bundle?.paper.id
    if (!paperId) return
    await window.readarc.removeNote(paperId, anchorId)
    await get().load(paperId)
  },

  removeHighlight: async (id) => {
    const paperId = usePaper.getState().bundle?.paper.id
    if (!paperId) return
    const anchor = get().byPaper[paperId]?.highlights?.[id]
    await window.readarc.removeHighlight(paperId, id)
    await get().load(paperId)
    if (anchor) {
      set({ undoHighlight: { paperId, anchor } })
      if (undoTimer) clearTimeout(undoTimer)
      undoTimer = setTimeout(() => set({ undoHighlight: null }), 6000)
    }
  },

  undoHighlight: null,
  dismissUndo: () => {
    if (undoTimer) clearTimeout(undoTimer)
    set({ undoHighlight: null })
  },
  restoreHighlight: async () => {
    const pending = get().undoHighlight
    if (!pending) return
    get().dismissUndo()
    const { paperId, anchor } = pending
    await window.readarc.addHighlight(paperId, anchor.block_id, anchor.excerpt, anchor.rects, [
      anchor.char_start,
      anchor.char_end
    ])
    await get().load(paperId)
  }
}))
