/**
 * AI 生成流：摘要/笔记/检索总结/找矛盾的流式增量，按 kind 分流。
 *
 * 与某篇论文绑定的流（摘要、笔记）会记下归属的 paperId：生成要几十秒，
 * 这期间用户完全可能切到别的论文，读取方必须能判断「这段流不是我的」，
 * 否则新论文的面板会显示上一篇的流式草稿。
 */
import { create } from 'zustand'

export interface GenStream {
  text: string
  /** 该流属于哪篇论文；全局流（找矛盾、检索总结）没有 */
  paperId?: string
}

interface GenState {
  streams: Record<string, GenStream>
  /** reset=true：主进程判定第一次输出不合格要重来，已流出的文字作废 */
  apply(kind: string, delta: string, paperId?: string, reset?: boolean): void
  clear(kind: string): void
}

/**
 * 取这段流的正文；不属于当前论文就当它不存在。
 * `paperId` 传 undefined = 调用方不关心归属（全局流）。
 */
export function streamText(
  streams: Record<string, GenStream>,
  kind: string,
  paperId?: string
): string | undefined {
  const s = streams[kind]
  if (!s) return undefined
  if (paperId !== undefined && s.paperId !== undefined && s.paperId !== paperId) return undefined
  return s.text
}

export const useGen = create<GenState>((set) => ({
  streams: {},
  apply: (kind, delta, paperId, reset) =>
    set((s) => {
      const prev = s.streams[kind]
      // 换了论文就从头开始，别把两篇的草稿接在一起；主进程要求重来时也从头开始
      const carry = !reset && prev && prev.paperId === paperId ? prev.text : ''
      return { streams: { ...s.streams, [kind]: { text: carry + delta, paperId } } }
    }),
  clear: (kind) =>
    set((s) => {
      const streams = { ...s.streams }
      delete streams[kind]
      return { streams }
    })
}))

/** 组件用：按 kind + 归属论文取流。 */
export function useGenStream(kind: string, paperId?: string): string | undefined {
  return useGen((s) => streamText(s.streams, kind, paperId))
}
