/** 当前论文的数据与阅读进度。进度按最深位置记录 [P1]/[P6]，节流落盘。 */
import { create } from 'zustand'
import { errText } from '../lib/errors'
import type {
  PaperBundle,
  TranslateEstimateView,
  TranslateOverride,
  TranslateProgressEvent
} from '../../shared/models'
import { useApp } from './app'
import { tNow } from '../i18n'

export interface BlockTranslationState {
  text?: string
  /** 这段译文出自哪个模型 */
  model?: string
  error?: string
  pending?: boolean
}

interface PaperState {
  bundle: PaperBundle | null
  importing: boolean
  /** 导入解析进度（版面识别逐页）：长 PDF 的等待可见 */
  importProgress: { file: string; page: number; pages: number } | null
  /** 当前论文的后台版面识别进度；null = 没在识别或还没报第一页。ahead：还在排队，前面还有几篇 */
  layoutProgress: { page: number; pages: number; ahead?: number } | null
  /** 导入失败提示（坏 PDF 等）：绝不静默 */
  importError: string | null
  /** 导入的说明性提示（比如「已在论文库里」）：几秒后自动消失 */
  importNotice: string | null
  /** 本会话内展示用的进度（%），与 bundle.paper.progress 取 max */
  liveProgress: number
  currentSection: string | null
  /** blockId → 译文状态。已有译文永不清空 [P4] */
  translations: Record<string, BlockTranslationState>
  translating: boolean
  /** 用户已点暂停：在途批次回来的进度不许把「翻译中」重新点亮 */
  stopRequested: boolean
  /** [P7] 预估超阈值等待确认：显示预估值与依据 */
  pendingEstimate: TranslateEstimateView | null
  /** 待确认的那次是「整篇重译」：确认后要原样带上 force */
  pendingForce: boolean
  /** 待确认的那次指定了模型：确认后原样带上 */
  pendingOverride: TranslateOverride | null
  /** 翻译启动失败（如未接模型）就地展示 */
  translateError: string | null
  /** 本轮翻译起始总段数（进度条分母） */
  translateTotal: number
  /** 本轮累计 token */
  translateUsage: { inputTokens: number; outputTokens: number } | null
  stopTranslation(): Promise<void>

  loadPaper(paperId: string): Promise<void>
  /** 主进程后台补完页边块：当前论文就只换块列表，其余状态（滚动、译文）不动 */
  refreshBlocks(paperId: string): Promise<void>
  importFiles(paths: string[]): Promise<void>
  /** 弹文件框选 PDF 后导入，进度、失败提示和拖入完全一样 */
  pickAndImport(): Promise<void>
  reportScroll(progressPct: number, scrollRatio: number, section: string | null): void
  /** force=true：整篇重译（换模型后重来）；已有译文保留显示直到被新译文替换 [P4]。
   *  override：只用于这一次的模型（横幅上选的），不改设置 */
  startTranslation(confirmed?: boolean, force?: boolean, override?: TranslateOverride | null): Promise<void>
  cancelEstimate(): void
  retranslate(blockId: string): Promise<void>
  applyProgress(e: TranslateProgressEvent): void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

export const usePaper = create<PaperState>((set, get) => ({
  bundle: null,
  importing: false,
  importProgress: null,
  layoutProgress: null,
  importError: null,
  importNotice: null,
  liveProgress: 0,
  currentSection: null,
  translations: {},
  translating: false,
  stopRequested: false,
  pendingEstimate: null,
  pendingForce: false,
  pendingOverride: null,
  translateError: null,
  translateTotal: 0,
  translateUsage: null,

  loadPaper: async (paperId) => {
    const bundle = await window.readarc.openPaper(paperId)
    if (!bundle) return
    set({
      bundle,
      liveProgress: bundle.paper.progress,
      currentSection: bundle.paper.last_section,
      translations: Object.fromEntries(
        Object.entries(bundle.translations).map(([id, text]) => [
          id,
          { text, model: bundle.translationModels?.[id] }
        ])
      ),
      translating: false,
      stopRequested: false,
      pendingEstimate: null,
      pendingForce: false,
      pendingOverride: null,
      // 上一篇（或上一种目标语言）那一轮的报错、分母和用量不能带到这里
      translateError: null,
      translateTotal: 0,
      translateUsage: null,
      layoutProgress: null
    })
    window.readarc.patchSettings({ lastPaperId: paperId })
  },

  refreshBlocks: async (paperId) => {
    if (get().bundle?.paper.id !== paperId) return
    const fresh = await window.readarc.openPaper(paperId)
    if (!fresh) return
    // 后台版面识别换过分段：块、目录、标题和 layout_state 一起换；译文已按内容指纹搬家，重新取一遍
    set((s) =>
      s.bundle?.paper.id === paperId
        ? {
            bundle: { ...s.bundle, blocks: fresh.blocks, outline: fresh.outline, paper: fresh.paper },
            translations: {
              // 还在翻译中的段（pending）和报过错的段，块还在就保留它们的状态，缓存里的新译文覆盖在上面
              ...(() => {
                const alive = new Set(fresh.blocks.map((b) => b.block_id))
                return Object.fromEntries(
                  Object.entries(s.translations).filter(([id, v]) => (v.pending || v.error) && alive.has(id))
                )
              })(),
              ...Object.fromEntries(
                Object.entries(fresh.translations).map(([id, text]) => [id, { text, model: fresh.translationModels?.[id] }])
              )
            },
            layoutProgress: null
          }
        : {}
    )
  },

  startTranslation: async (confirmed = false, force = false, override = null) => {
    const { bundle } = get()
    if (!bundle) return
    set({ translateError: null })
    let res
    try {
      res = await window.readarc.translatePaper(bundle.paper.id, confirmed, force, override)
    } catch (err) {
      // 无模型等启动期错误：就地显示，绝不静默
      set({ translateError: errText(err) })
      return
    }
    if (!res.started) {
      // [P7] 预估超阈值：先问，不动；记住这次是不是重译、选了什么模型，确认时原样带上
      set({ pendingEstimate: res.estimate ?? null, pendingForce: force, pendingOverride: override })
      return
    }
    // 必须取 await 之后的最新状态：主进程一收到请求就同步上报缓存命中与跳过翻译的段
    // （参考文献条目原样即译文），这些进度在 IPC 返回前就已写进 store。
    // 用 await 前的快照会把它们重新标成待译，而后面再也没有事件来清掉，整页参考文献就一直灰着
    const pending: Record<string, BlockTranslationState> = { ...get().translations }
    for (const b of bundle.blocks) {
      if (b.kind !== 'para' && b.kind !== 'heading') continue
      const cur = pending[b.block_id]
      // 重译：已有译文留在屏上（[P4] 永不清空），只标 pending，新译文到了再替换
      if (force) pending[b.block_id] = { ...cur, pending: true, error: undefined }
      else if (!cur?.text) pending[b.block_id] = { pending: true }
    }
    const total = Object.values(pending).filter((t) => t.pending).length
    // 启动即上报视口焦点：可见页最先出译文
    const doc = document.querySelector('.reader-doc')
    const topPage = doc?.querySelector('.pdf-page[data-page]')
    if (doc && topPage) {
      let focusPage = Number((topPage as HTMLElement).dataset.page)
      const top = doc.getBoundingClientRect().top
      for (const p of doc.querySelectorAll<HTMLElement>('.pdf-page[data-page]')) {
        if (p.getBoundingClientRect().bottom > top + 40) {
          focusPage = Number(p.dataset.page)
          break
        }
      }
      const first = bundle.blocks.find(
        (b) => b.page === focusPage && (b.kind === 'para' || b.kind === 'heading')
      )
      if (first) window.readarc.reportTranslateFocus(bundle.paper.id, first.block_order)
    }
    set({
      translations: pending,
      // 没有要译的段（主进程直接返回「已开始」、不会再有进度事件）：不能进「翻译中」，否则永远停在那里
      translating: total > 0,
      stopRequested: false,
      translateTotal: total,
      translateUsage: null,
      pendingEstimate: null,
      pendingForce: false,
      pendingOverride: null
    })
  },

  stopTranslation: async () => {
    const { bundle, translations } = get()
    if (!bundle) return
    await window.readarc.stopTranslation(bundle.paper.id)
    // 未完成段只去掉 pending 标记：整篇重译时它们还带着旧译文，必须留在屏上 [P4]
    // （曾经直接清成 {}，重译中途暂停会让 158 段译文瞬间只剩 24 段）
    const cleaned: typeof translations = {}
    for (const [k, v] of Object.entries(translations)) {
      cleaned[k] = v.pending ? { ...v, pending: false } : v
    }
    set({ translating: false, stopRequested: true, translations: cleaned })
  },

  cancelEstimate: () => set({ pendingEstimate: null, pendingForce: false, pendingOverride: null }),

  retranslate: async (blockId) => {
    const { bundle } = get()
    if (!bundle) return
    set((s) => ({ translations: { ...s.translations, [blockId]: { ...s.translations[blockId], pending: true } } }))
    try {
      const { text } = await window.readarc.retranslateBlock(bundle.paper.id, blockId)
      set((s) => ({ translations: { ...s.translations, [blockId]: { text } } }))
    } catch (err) {
      set((s) => ({
        translations: {
          ...s.translations,
          [blockId]: {
            ...s.translations[blockId],
            pending: false,
            error: errText(err)
          }
        }
      }))
    }
  },

  applyProgress: (e) => {
    // 归属校验必须在最前面：用量也是当前这篇的用量，
    // 先写再判会让切走后的新论文横幅显示上一篇的 token 计数。
    const { bundle } = get()
    if (!bundle || e.paperId !== bundle.paper.id) return
    // 改了目标语言之后，旧语言那一轮在途批次的回报不能当成新语言的译文显示
    if (e.lang && e.lang !== useApp.getState().targetLang) return
    if (e.usage) set({ translateUsage: e.usage })
    set((s) => ({
      // 暂停后在途批次仍会陆续回报，它们的译文照收，但别把「翻译中」重新点亮——
      // 否则横幅会永久停在「翻译中」，而实际上已经没有后续工作了。
      translating: s.stopRequested ? false : e.remaining > 0,
      translations: {
        ...s.translations,
        [e.blockId]: e.text
          ? { text: e.text, model: e.model ?? s.translations[e.blockId]?.model }
          : { ...s.translations[e.blockId], pending: false, error: e.error }
      }
    }))
  },

  importFiles: async (paths) => {
    if (paths.length === 0) return
    set({ importing: true, importError: null })
    try {
      const { outcomes, failures } = await window.readarc.importPdfs(paths)
      if (failures.length > 0) {
        const zh = useApp.getState().lang === 'zh'
        set({ importError: failures.map((f) => `${f.file}${zh ? '：' : ': '}${f.error}`).join(zh ? '；' : '; ') })
      }
      // 全是已在库里的：告诉用户一声，不然像什么都没发生
      if (outcomes.length > 0 && outcomes.every((o) => o.existing)) {
        set({ importNotice: tNow(outcomes.length === 1 ? 'import.exists' : 'import.exists-many') })
        setTimeout(() => set({ importNotice: null }), 5000)
      }
      if (outcomes.length > 0) {
        await get().loadPaper(outcomes[0].paperId)
        useApp.getState().setScreen('reader')
        // 论文库列表跟着刷新；动态引入避免 store 之间互相引用
        void import('./library').then((m) => m.useLibrary.getState().load())
      }
    } catch (err) {
      // IPC 层意外失败也不许静默
      set({ importError: errText(err) })
    } finally {
      set({ importing: false, importProgress: null })
    }
  },

  pickAndImport: async () => {
    const paths = await window.readarc.pickPdfs()
    if (paths.length > 0) await get().importFiles(paths)
  },

  reportScroll: (progressPct, scrollRatio, section) => {
    const { bundle, liveProgress } = get()
    if (!bundle) return
    const next = Math.max(liveProgress, progressPct)
    // 目录订阅了这两个值：没有实质变化就不写 store，避免每帧重渲染
    if (Math.abs(next - liveProgress) >= 0.4 || section !== get().currentSection) {
      set({ liveProgress: next, currentSection: section })
    }
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      window.readarc.saveProgress(bundle.paper.id, {
        progress: progressPct,
        scrollPosition: scrollRatio,
        lastSection: section
      })
    }, 600)
  }
}))

// 目标语言变了：译文和摘要都按语言分开缓存，当前论文按新语言重新取一遍；
// 旧语言那一轮还在翻就停掉，别继续为已经不显示的语言花钱
useApp.subscribe((s, prev) => {
  if (s.targetLang === prev.targetLang) return
  const { bundle, translating } = usePaper.getState()
  if (!bundle) return
  if (translating) void window.readarc.stopTranslation(bundle.paper.id)
  void usePaper.getState().loadPaper(bundle.paper.id)
})
