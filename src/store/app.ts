/**
 * 全局状态。
 * tier 档位切换的副作用是硬约束 [P3]：进入 sm 时 panelOpen 必须强制 false，离开 sm 恢复 true。
 */
import type { TargetLang } from '../../shared/lang'
import { create } from 'zustand'
import type { Lang, LibView, ThemeMode } from '../../shared/ipc'

export type Screen = 'reader' | 'library' | 'discover' | 'onboard'
export type Tier = 'sm' | 'md' | 'lg'
/** page = 原版对照（pdf.js 整页渲染 + 平行译文列）；orig/zh 为重排视图 */
export type ReaderView = 'page' | 'orig' | 'zh'
export type PanelTab = 'chat' | 'notes'
export type PanelDock = 'right' | 'bottom'
export type SettingsTab = 'general' | 'personas' | 'main' | 'models' | 'network' | 'data' | 'privacy'

interface AppState {
  screen: Screen
  theme: ThemeMode
  /** 界面主题解析后的实际值（跟随系统时由 useResolvedTheme 写入） */
  resolvedTheme: 'dark' | 'light'
  /** 纸面深色：原文页反色、译文页深色配色；null = 跟随界面主题 */
  paperDark: boolean | null
  lang: Lang
  /** 翻译 / 摘要 / 笔记的目标语言 */
  targetLang: TargetLang
  /** 目标语言是用户在设置里选定的；没选时跟界面语言走（与主进程 resolveTargetLang 一致） */
  targetLangPinned: boolean
  tier: Tier
  view: ReaderView
  libView: LibView
  panel: PanelTab
  panelOpen: boolean
  paletteOpen: boolean
  /** 设置弹窗（独立于 screen 导航） */
  settingsOpen: boolean
  /** 打开设置时要落到哪一页；null = 弹窗自己决定（记住上次的页） */
  settingsTab: SettingsTab | null
  findOpen: boolean
  /** 原版对照页缩放（1 = 适配宽度） */
  pageZoom: number
  /** 译文字号偏好（1 = 跟原文字号走）；放不下的段落让镜像页长高，不裁字 */
  zhTextScale: number
  /** 左栏手动收起（sm 档强制收起，与此无关） */
  railCollapsed: boolean
  /** 目录栏手动收起 */
  outlineCollapsed: boolean
  /** 侧栏拖拽宽度；null = 用默认 token */
  railWidth: number | null
  outlineWidth: number | null
  panelWidth: number | null
  /** 面板停靠：靠右（默认）或靠下；靠下时用 panelHeight */
  panelDock: PanelDock
  panelHeight: number | null
  /** 离线时库、缓存译文、笔记全可用；只有新翻译/问答/检索不可用 */
  offline: boolean

  setOffline(offline: boolean): void
  /** persist=true（松手时）才写设置文件，拖动中只改内存 */
  setSidebarWidth(key: 'rail' | 'outline' | 'panel', px: number, persist?: boolean): void
  setPanelHeight(px: number, persist?: boolean): void
  setPanelDock(dock: PanelDock): void
  /** 专注模式：一键收起左栏、目录与面板只留正文；再按一次恢复原状。会话内状态，不落盘 */
  focusMode: boolean
  toggleFocus(): void
  /** 页首 AI 摘要卡收起只留标题行；全局记住 */
  summaryCollapsed: boolean
  toggleSummaryCollapsed(): void
  /** 双击单词弹内置词典释义（不花 token） */
  wordLookup: boolean
  setWordLookup(on: boolean): void
  /** 截图提问：框选模式（工具栏按钮进入，框完或 Esc 退出） */
  cropMode: boolean
  setCropMode(on: boolean): void
  /** 对话时要求模型先思考再回答 */
  chatReasoning: boolean
  setChatReasoning(on: boolean): void
  /** 工具栏里给翻译状态留的挂载点：状态逻辑在正文组件里，通过 portal 渲染到这里 */
  tbSlot: HTMLElement | null
  setTbSlot(el: HTMLElement | null): void
  setPageZoom(zoom: number): void
  setZhTextScale(scale: number): void
  toggleRail(): void
  toggleOutline(): void
  setPaletteOpen(open: boolean): void
  /** tab 指定落点：「还没接模型」的引导按钮该直接落到「模型来源」页，而不是让用户自己找 */
  setSettingsOpen(open: boolean, tab?: SettingsTab): void
  setFindOpen(open: boolean): void
  setScreen(screen: Screen): void
  setTheme(theme: ThemeMode): void
  toggleTheme(resolvedDark: boolean): void
  /** 一键切换纸面深浅（工具栏图标），切过就记住，不再跟随主题 */
  togglePaperDark(): void
  toggleLang(): void
  setTargetLang(next: TargetLang): void
  setTier(tier: Tier): void
  setView(view: ReaderView): void
  cycleView(): void
  setLibView(view: LibView): void
  setPanel(tab: PanelTab): void
  togglePanel(): void
}

const VIEW_CYCLE: ReaderView[] = ['page', 'orig', 'zh']

/** 进入专注模式前的布局，退出时恢复 */
let focusRestore: { railCollapsed: boolean; outlineCollapsed: boolean; panelOpen: boolean } | null = null

export const useApp = create<AppState>((set, get) => ({
  screen: 'reader',
  theme: 'system',
  resolvedTheme: 'light',
  paperDark: null,
  lang: 'zh',
  targetLang: 'zh',
  targetLangPinned: false,
  tier: 'lg',
  view: 'page',
  libView: 'cover',
  panel: 'chat',
  panelOpen: true,
  paletteOpen: false,
  settingsOpen: false,
  settingsTab: null,
  findOpen: false,
  offline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  pageZoom: 1,
  zhTextScale: 1,
  railCollapsed: false,
  outlineCollapsed: false,
  railWidth: null,
  outlineWidth: null,
  panelWidth: null,
  panelDock: 'right',
  panelHeight: null,

  setOffline: (offline) => set({ offline }),

  setPanelDock: (panelDock) => {
    set({ panelDock, panelOpen: true })
    window.readarc?.patchSettings({ panelDock })
  },

  focusMode: false,
  toggleFocus: () => {
    const s = get()
    if (!s.focusMode) {
      focusRestore = { railCollapsed: s.railCollapsed, outlineCollapsed: s.outlineCollapsed, panelOpen: s.panelOpen }
      // 只改内存里的显示状态，不写设置：退出专注后要回到用户原来的布局
      set({ focusMode: true, railCollapsed: true, outlineCollapsed: true, panelOpen: false })
    } else {
      set({ focusMode: false, ...(focusRestore ?? {}) })
      focusRestore = null
    }
  },

  summaryCollapsed: false,
  toggleSummaryCollapsed: () => {
    const summaryCollapsed = !get().summaryCollapsed
    set({ summaryCollapsed })
    window.readarc?.patchSettings({ summaryCollapsed })
  },

  cropMode: false,
  setCropMode: (cropMode) => set({ cropMode }),

  chatReasoning: false,
  setChatReasoning: (chatReasoning) => {
    set({ chatReasoning })
    window.readarc?.patchSettings({ chatReasoning })
  },

  wordLookup: true,
  setWordLookup: (wordLookup) => {
    set({ wordLookup })
    window.readarc?.patchSettings({ wordLookup })
  },

  tbSlot: null,
  setTbSlot: (tbSlot) => {
    if (get().tbSlot !== tbSlot) set({ tbSlot })
  },

  setPanelHeight: (px, persist) => {
    set({ panelHeight: px })
    if (persist) get().setSidebarWidth('panel', get().panelWidth ?? 0, true)
  },
  setPageZoom: (zoom) => set({ pageZoom: Math.min(3, Math.max(0.5, Math.round(zoom * 20) / 20)) }),

  setZhTextScale: (scale) => {
    const zhTextScale = Math.min(2, Math.max(0.8, Math.round(scale * 100) / 100))
    set({ zhTextScale })
    window.readarc?.patchSettings({ zhTextScale })
  },

  setSidebarWidth: (key, px, persist) => {
    // px=0 表示只想触发落盘（setPanelHeight 借道），不改宽度
    if (px > 0) set({ [`${key}Width`]: px } as Partial<AppState>)
    if (persist) {
      const s = get()
      window.readarc?.patchSettings({
        sidebar: {
          ...(s.railWidth != null ? { rail: s.railWidth } : {}),
          ...(s.outlineWidth != null ? { outline: s.outlineWidth } : {}),
          ...(s.panelWidth != null ? { panel: s.panelWidth } : {}),
          ...(s.panelHeight != null ? { panelHeight: s.panelHeight } : {})
        }
      })
    }
  },

  toggleOutline: () => {
    const outlineCollapsed = !get().outlineCollapsed
    set({ outlineCollapsed })
    window.readarc?.patchSettings({ outlineCollapsed })
  },

  toggleRail: () => {
    const railCollapsed = !get().railCollapsed
    set({ railCollapsed })
    window.readarc?.patchSettings({ railCollapsed })
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen, tab) => set({ settingsOpen, settingsTab: settingsOpen ? (tab ?? null) : null }),
  setFindOpen: (findOpen) => set({ findOpen }),

  setScreen: (screen) => {
    // 从引导页离开就算引导完成——新用户直接把 PDF 拖进引导页也会走到这里，
    // 不标记的话下次启动引导又会弹出来
    if (get().screen === 'onboard' && screen !== 'onboard') {
      window.readarc?.patchSettings({ onboarded: true })
    }
    set({ screen, paletteOpen: false })
  },

  setTheme: (theme) => {
    set({ theme })
    window.readarc?.patchSettings({ theme })
  },

  // ⌘D：在明确的 dark/light 之间切换（手动选择后记住）
  toggleTheme: (resolvedDark) => get().setTheme(resolvedDark ? 'light' : 'dark'),

  togglePaperDark: () => {
    const { paperDark } = get()
    // 未设置时默认白纸：反色后的图表看着别扭，深色界面也不该替用户决定纸面颜色
    const next = !(paperDark ?? false)
    set({ paperDark: next })
    window.readarc?.patchSettings({ paperDark: next })
  },

  toggleLang: () => {
    const lang: Lang = get().lang === 'zh' ? 'en' : 'zh'
    // 先落设置再改状态：改状态会触发当前论文按新语言重载，主进程得先知道新语言
    window.readarc?.patchSettings({ lang })
    // 没选过目标语言时主进程按界面语言翻译，这边跟着换，两边口径一致
    set(get().targetLangPinned ? { lang } : { lang, targetLang: lang })
  },

  setTargetLang: (targetLang) => {
    // 先落设置再改状态（同上：重载论文的请求要排在设置之后）
    window.readarc?.patchSettings({ targetLang })
    set({ targetLang, targetLangPinned: true })
  },

  setTier: (tier) => {
    const prev = get().tier
    if (prev === tier) return
    // 窄档没有目录与面板的位置；中等档留一条收起的目录（点开即用），宽档恢复展开
    if (tier === 'sm') {
      set({ tier, panelOpen: false })
    } else if (prev === 'sm') {
      set({ tier, panelOpen: true, outlineCollapsed: tier === 'md' })
    } else if (tier === 'md') {
      set({ tier, outlineCollapsed: true })
    } else {
      set({ tier })
    }
  },

  setView: (view) => set({ view }),

  cycleView: () =>
    set((s) => ({ view: VIEW_CYCLE[(VIEW_CYCLE.indexOf(s.view) + 1) % VIEW_CYCLE.length] })),

  setLibView: (libView) => {
    set({ libView })
    window.readarc?.patchSettings({ libView })
  },

  setPanel: (panel) => set({ panel, panelOpen: true }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen }))
}))

export function tierForWidth(width: number): Tier {
  if (width >= 1320) return 'lg'
  if (width >= 1000) return 'md'
  return 'sm'
}
