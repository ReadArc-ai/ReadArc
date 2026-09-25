/** 对话面板状态：每篇论文有多次独立会话，消息由主进程持久化到 SQLite。 */
import { create } from 'zustand'
import { tNow } from '../i18n'
import { errText } from '../lib/errors'
import type {
  ChatCitation,
  ChatDeltaEvent,
  ChatPersona,
  ChatSession,
  CustomPersona
} from '../../shared/models'
import { useApp } from './app'
import { usePaper } from './paper'

export interface ChatMessageUI {
  role: 'user' | 'assistant'
  text: string
  /** 发问时用的讲法（默认讲法不记），显示在用户消息上 */
  persona?: ChatPersona
  citations?: ChatCitation[]
  model?: string
  costUsd?: number | null
  /** 本轮 token 总量（输入+输出） */
  tokens?: number
  hops?: string[]
  pending?: boolean
  error?: string
  /** 用户中途停止，text 是已生成的部分 */
  stopped?: boolean
  /** 推理模型的思考流（只在本次会话内存里，不落库） */
  thinking?: string
  /** 截图提问附的图（只在内存里；历史里以「[截图]」前缀标记） */
  image?: string
}

interface ChatState {
  sessionsByPaper: Record<string, ChatSession[]>
  activeSessionByPaper: Record<string, string | null>
  messagesBySession: Record<string, ChatMessageUI[]>
  loadedPapers: Record<string, boolean>
  loadingSessionId: string | null
  historyError: string | null
  asking: boolean
  askingPaperId: string | null
  /** 「问」动作塞进来的段落引用，随下一个问题一起发出 */
  quote: string | null
  /** 待发送的截图（PNG data URL） */
  image: string | null
  setImage(dataUrl: string | null): void
  /** 递增触发对话输入框聚焦（⌘L / 「问」共用） */
  focusNonce: number
  /** 当前讲法（读者人设），全局生效并落盘记住 */
  persona: ChatPersona
  /** 用户自定义的讲法（设置 → 讲法），落 settings.json */
  customPersonas: CustomPersona[]

  /** whole：整篇维度的内置提问，主进程按目录取各节首段做上下文 */
  ask(question: string, opts?: { whole?: boolean }): Promise<void>
  loadSessions(paperId: string): Promise<void>
  selectSession(paperId: string, sessionId: string): Promise<void>
  newSession(paperId: string): void
  deleteSession(paperId: string, sessionId: string): Promise<void>
  /** 重命名会话；空标题恢复自动标题（首个问题） */
  renameSession(paperId: string, sessionId: string, title: string): Promise<void>
  setPersona(persona: ChatPersona): void
  /** 新增或按 id 覆盖一条自定义讲法 */
  savePersona(p: CustomPersona): void
  /** 删除自定义讲法；正在用它就回到默认讲法 */
  removePersona(id: string): void
  /** 停止当前论文的在途回答（已生成的部分保留） */
  stop(): void
  /** 把段落作为上下文塞进对话并切到对话标签（段落操作·问） */
  askAboutBlock(text: string): void
  /** ⌘L：展开面板、切到对话、聚焦输入框 */
  focusInput(): void
  clearQuote(): void
  applyDelta(e: ChatDeltaEvent): void
}

const sessionLoads = new Map<string, Promise<void>>()

export const useChat = create<ChatState>((set, get) => ({
  sessionsByPaper: {},
  activeSessionByPaper: {},
  messagesBySession: {},
  loadedPapers: {},
  loadingSessionId: null,
  historyError: null,
  asking: false,
  askingPaperId: null,
  quote: null,
  image: null,
  setImage: (image) => set((s) => ({ image, focusNonce: image ? s.focusNonce + 1 : s.focusNonce })),
  focusNonce: 0,
  persona: 'default',
  customPersonas: [],

  setPersona: (persona) => {
    set({ persona })
    window.readarc?.patchSettings({ chatPersona: persona })
  },

  savePersona: (p) => {
    const list = get().customPersonas
    const next = list.some((c) => c.id === p.id) ? list.map((c) => (c.id === p.id ? p : c)) : [...list, p]
    set({ customPersonas: next })
    window.readarc?.patchSettings({ chatPersonas: next })
  },

  removePersona: (id) => {
    const next = get().customPersonas.filter((c) => c.id !== id)
    const persona = get().persona === id ? 'default' : get().persona
    set({ customPersonas: next, persona })
    window.readarc?.patchSettings({ chatPersonas: next, chatPersona: persona })
  },

  askAboutBlock: (text) => {
    set((s) => ({ quote: text, focusNonce: s.focusNonce + 1 }))
    // 面板收起时先展开（setPanel 会置 panelOpen=true）
    useApp.getState().setPanel('chat')
  },

  focusInput: () => {
    useApp.getState().setPanel('chat')
    set((s) => ({ focusNonce: s.focusNonce + 1 }))
  },

  clearQuote: () => set({ quote: null }),

  loadSessions: async (paperId) => {
    const existing = sessionLoads.get(paperId)
    if (existing) return existing
    const task = (async (): Promise<void> => {
      set({ historyError: null })
      try {
        const sessions = await window.readarc.listChatSessions(paperId)
        const state = get()
        const remembered = state.activeSessionByPaper[paperId]
        const hasRemembered = Object.prototype.hasOwnProperty.call(state.activeSessionByPaper, paperId)
        const active =
          hasRemembered && (remembered === null || sessions.some((s) => s.id === remembered))
            ? remembered
            : (sessions[0]?.id ?? null)
        set((s) => ({
          sessionsByPaper: { ...s.sessionsByPaper, [paperId]: sessions },
          activeSessionByPaper: { ...s.activeSessionByPaper, [paperId]: active },
          loadedPapers: { ...s.loadedPapers, [paperId]: true }
        }))
        if (active && !get().messagesBySession[active]) {
          set({ loadingSessionId: active })
          const messages = await window.readarc.listChatMessages(paperId, active)
          set((s) => ({
            messagesBySession: { ...s.messagesBySession, [active]: messages },
            loadingSessionId: s.loadingSessionId === active ? null : s.loadingSessionId
          }))
        }
      } catch (err) {
        set((s) => ({
          historyError: errText(err),
          loadedPapers: { ...s.loadedPapers, [paperId]: true },
          loadingSessionId: null
        }))
      }
    })().finally(() => sessionLoads.delete(paperId))
    sessionLoads.set(paperId, task)
    return task
  },

  selectSession: async (paperId, sessionId) => {
    if (get().asking) return
    set((s) => ({
      activeSessionByPaper: { ...s.activeSessionByPaper, [paperId]: sessionId },
      quote: null,
      historyError: null
    }))
    if (get().messagesBySession[sessionId]) return
    set({ loadingSessionId: sessionId })
    try {
      const messages = await window.readarc.listChatMessages(paperId, sessionId)
      set((s) => ({
        messagesBySession: { ...s.messagesBySession, [sessionId]: messages },
        loadingSessionId: s.loadingSessionId === sessionId ? null : s.loadingSessionId
      }))
    } catch (err) {
      set({ historyError: errText(err), loadingSessionId: null })
    }
  },

  newSession: (paperId) => {
    if (get().asking) return
    set((s) => ({
      activeSessionByPaper: { ...s.activeSessionByPaper, [paperId]: null },
      quote: null,
      historyError: null,
      focusNonce: s.focusNonce + 1
    }))
  },

  deleteSession: async (paperId, sessionId) => {
    if (get().asking) return
    set({ historyError: null })
    try {
      await window.readarc.deleteChatSession(paperId, sessionId)
      const sessions = (get().sessionsByPaper[paperId] ?? []).filter((s) => s.id !== sessionId)
      const nextId = sessions[0]?.id ?? null
      set((s) => {
        const messagesBySession = { ...s.messagesBySession }
        delete messagesBySession[sessionId]
        return {
          sessionsByPaper: { ...s.sessionsByPaper, [paperId]: sessions },
          activeSessionByPaper: { ...s.activeSessionByPaper, [paperId]: nextId },
          messagesBySession
        }
      })
      if (nextId && !get().messagesBySession[nextId]) {
        await get().selectSession(paperId, nextId)
      }
    } catch (err) {
      set({ historyError: errText(err) })
    }
  },

  renameSession: async (paperId, sessionId, title) => {
    set({ historyError: null })
    try {
      await window.readarc.renameChatSession(paperId, sessionId, title)
      // 主进程规整过的标题以重新拉取为准（截断、空标题回落到自动标题）
      const sessions = await window.readarc.listChatSessions(paperId)
      set((s) => ({ sessionsByPaper: { ...s.sessionsByPaper, [paperId]: sessions } }))
    } catch (err) {
      set({ historyError: errText(err) })
    }
  },

  stop: () => {
    const paperId = get().askingPaperId
    if (paperId && get().asking) window.readarc.stopChat(paperId)
  },

  ask: async (question, opts) => {
    const paperId = usePaper.getState().bundle?.paper.id
    if (!paperId || get().asking || (!question.trim() && !get().image)) return
    // 新建会话需要一次 IPC；先占住发送状态，避免用户连点时创建两次并发会话。
    set({ asking: true, askingPaperId: paperId, historyError: null })
    if (!get().loadedPapers[paperId]) await get().loadSessions(paperId)
    const quote = get().quote
    const persona = get().persona
    const image = get().image
    // 只附了截图没写字：用默认问法
    const asked = question.trim() || (image ? tNow('panel.image-default-question') : '')
    const q = quote ? tNow('panel.chat.quoted-question', { quote: quote.slice(0, 400), question: asked }) : asked
    set({ quote: null, image: null })

    let sessionId = get().activeSessionByPaper[paperId]
    if (!sessionId) {
      try {
        const session = await window.readarc.createChatSession(paperId)
        sessionId = session.id
        set((s) => ({
          sessionsByPaper: {
            ...s.sessionsByPaper,
            [paperId]: [session, ...(s.sessionsByPaper[paperId] ?? [])]
          },
          activeSessionByPaper: { ...s.activeSessionByPaper, [paperId]: session.id },
          messagesBySession: { ...s.messagesBySession, [session.id]: [] },
          loadedPapers: { ...s.loadedPapers, [paperId]: true }
        }))
      } catch (err) {
        set({ historyError: errText(err), asking: false, askingPaperId: null })
        return
      }
    }

    const history = (get().messagesBySession[sessionId] ?? [])
      .filter((m) => !m.pending && !m.error)
      .map((m) => ({ role: m.role, content: m.text }))

    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: [
          ...(s.messagesBySession[sessionId] ?? []),
          { role: 'user', text: q, ...(persona !== 'default' ? { persona } : {}), ...(image ? { image } : {}) },
          { role: 'assistant', text: '', pending: true }
        ]
      }
    }))

    const patchLast = (patch: Partial<ChatMessageUI>): void =>
      set((s) => {
        const msgs = [...(s.messagesBySession[sessionId] ?? [])]
        const last = msgs[msgs.length - 1]
        if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, ...patch }
        return { messagesBySession: { ...s.messagesBySession, [sessionId]: msgs } }
      })

    try {
      const answer = await window.readarc.askChat(paperId, q, history, {
        persona,
        whole: opts?.whole === true,
        sessionId,
        ...(image ? { image } : {})
      })
      patchLast({
        text: answer.text,
        citations: answer.citations,
        model: answer.model || undefined,
        costUsd: answer.costUsd,
        tokens: answer.usage.inputTokens + answer.usage.outputTokens,
        hops: answer.hops,
        pending: false,
        stopped: answer.stopped,
        ...(answer.thinking ? { thinking: answer.thinking } : {})
      })
      // 回答已经成功且已由主进程落盘；刷新标题失败不能把这一轮误标成回答失败。
      try {
        const sessions = await window.readarc.listChatSessions(paperId)
        set((s) => ({ sessionsByPaper: { ...s.sessionsByPaper, [paperId]: sessions } }))
      } catch (err) {
        set({ historyError: errText(err) })
      }
    } catch (err) {
      // [P4] 就地报错；问题保留，可直接重发。带图被拒（模型不支持看图）给一句人能看懂的提示
      const raw = errText(err)
      const noVision = image && /image|vision|multimodal|图片|图像/i.test(raw)
      patchLast({ pending: false, error: noVision ? tNow('panel.no-vision', { detail: raw }) : raw })
    } finally {
      set({ asking: false, askingPaperId: null })
    }
  },

  applyDelta: (e) => {
    set((s) => {
      const msgs = s.messagesBySession[e.sessionId]
      if (!msgs || msgs.length === 0) return s
      const last = msgs[msgs.length - 1]
      if (last.role !== 'assistant' || !last.pending) return s
      const next = [...msgs]
      next[next.length - 1] =
        e.kind === 'thinking'
          ? { ...last, thinking: (last.thinking ?? '') + e.delta }
          : { ...last, text: last.text + e.delta }
      return { messagesBySession: { ...s.messagesBySession, [e.sessionId]: next } }
    })
  }
}))

// 引用的段落和截图属于当时那篇论文：换了论文就清掉，别带着上一篇的原文去问下一篇
usePaper.subscribe((s, prev) => {
  if (s.bundle?.paper.id !== prev.bundle?.paper.id && (useChat.getState().quote || useChat.getState().image)) {
    useChat.setState({ quote: null, image: null })
  }
})

let cancelPendingJump: (() => void) | undefined

function revealBlock(el: HTMLElement): void {
  el.scrollIntoView({ block: 'center' })
  el.classList.remove('block-flash')
  void el.offsetWidth // 重启动画
  el.classList.add('block-flash')
}

/** 跳到当前阅读视图中的段落；未挂载的译文页先滚入视口，再定位段落。 */
export function jumpToBlock(order: number): void {
  cancelPendingJump?.()
  const root = document.querySelector<HTMLElement>('.reader-doc')
  const el = root?.querySelector<HTMLElement>(`[data-order="${order}"]`)
  if (el) {
    revealBlock(el)
    return
  }
  // 原版视图没有 data-order 元素：按块所在页 + bbox 纵向位置滚动（与目录跳转同策略）
  if (!root) return
  const b = usePaper.getState().bundle?.blocks.find((x) => x.block_order === order)
  if (!b) return
  const translatedPage = root.querySelector<HTMLElement>(`.tp-page[data-page="${b.page}"]`)
  const pageEl = translatedPage ?? root.querySelector<HTMLElement>(`.pdf-page[data-page="${b.page}"]`)
  if (!pageEl) return
  if (translatedPage) {
    // 页壳一直存在，段落要等 IntersectionObserver 触发后才挂载。
    const observer = new MutationObserver(() => {
      const target = translatedPage.querySelector<HTMLElement>(`[data-order="${order}"]`)
      if (!target) return
      cancel()
      if (translatedPage.isConnected && usePaper.getState().bundle?.paper.id === b.paper_id) {
        revealBlock(target)
      }
    })
    const timer = setTimeout(() => cancel(), 2000)
    const cancel = (): void => {
      observer.disconnect()
      clearTimeout(timer)
      if (cancelPendingJump === cancel) cancelPendingJump = undefined
    }
    cancelPendingJump = cancel
    observer.observe(translatedPage, { childList: true, subtree: true })
  }
  let frac = 0
  const ph = Number(pageEl.dataset.ph)
  if (b.bbox && Number.isFinite(ph) && ph > 0) {
    try {
      const [, y, , h] = JSON.parse(b.bbox) as [number, number, number, number]
      frac = Math.min(1, Math.max(0, 1 - (y + h) / ph))
    } catch {
      /* bbox 损坏则跳页顶 */
    }
  }
  const pageRect = pageEl.getBoundingClientRect()
  const rootRect = root.getBoundingClientRect()
  root.scrollTo({
    top: pageRect.top - rootRect.top + root.scrollTop + frac * pageRect.height - rootRect.height / 3
  })
  if (!translatedPage) flashBlockOnPage(pageEl, b.bbox)
}

/**
 * 原版页上没有段落元素可以加 .block-flash：按块的 bbox 在页面上盖一层短暂的高亮，
 * 让用户看得出跳到了哪一段，而不是只滚到大概的位置。
 */
function flashBlockOnPage(pageEl: HTMLElement, bbox: string | null): void {
  if (!bbox) return
  const pw = Number(pageEl.dataset.pw)
  const ph = Number(pageEl.dataset.ph)
  if (!(pw > 0 && ph > 0)) return
  let rect: [number, number, number, number]
  try {
    rect = JSON.parse(bbox) as [number, number, number, number]
  } catch {
    return
  }
  const [x, y, w, h] = rect
  const mark = document.createElement('div')
  mark.className = 'block-flash-mark'
  mark.style.left = `${(x / pw) * 100}%`
  mark.style.top = `${(1 - (y + h) / ph) * 100}%`
  mark.style.width = `${(w / pw) * 100}%`
  mark.style.height = `${(h / ph) * 100}%`
  pageEl.appendChild(mark)
  setTimeout(() => mark.remove(), 1700)
}
