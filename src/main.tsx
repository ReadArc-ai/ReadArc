import { isTargetLang, resolveTargetLang } from '../shared/lang'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useApp } from './store/app'
import { usePaper } from './store/paper'
import { useChat } from './store/chat'
import { useSearch } from './store/search'
import { useGen } from './store/gen'
import { ErrorBoundary } from './lib/ErrorBoundary'
import { installTooltips } from './lib/tooltips'
import { isBuiltinPersona, type CustomPersona } from '../shared/models'
import './assets/app.css'

async function bootstrap(): Promise<void> {
  // 渲染前先水合持久化设置，避免主题/语言闪变
  try {
    const settings = await window.readarc.getSettings()
    useApp.setState({
      theme: settings.theme,
      paperDark: typeof settings.paperDark === 'boolean' ? settings.paperDark : null,
      summaryCollapsed: settings.summaryCollapsed === true,
      wordLookup: settings.wordLookup !== false,
      chatReasoning: settings.chatReasoning === true,
      zhTextScale:
        typeof settings.zhTextScale === 'number' && settings.zhTextScale >= 0.8 && settings.zhTextScale <= 2
          ? settings.zhTextScale
          : 1,
      lang: settings.lang,
      targetLang: resolveTargetLang(settings),
      targetLangPinned: isTargetLang(settings.targetLang),
      libView: settings.libView,
      railCollapsed: settings.railCollapsed ?? false,
      outlineCollapsed: settings.outlineCollapsed ?? false,
      railWidth: settings.sidebar?.rail ?? null,
      outlineWidth: settings.sidebar?.outline ?? null,
      panelWidth: settings.sidebar?.panel ?? null,
      panelHeight: settings.sidebar?.panelHeight ?? null,
      panelDock: settings.panelDock === 'bottom' ? 'bottom' : 'right'
    })
    // 对话讲法全局记住；settings.json 里的值来路不明（手改坏了、指向已删的自定义讲法）时回到默认讲法
    const customPersonas = (Array.isArray(settings.chatPersonas) ? settings.chatPersonas : [])
      .filter(
        (p): p is CustomPersona =>
          !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.style === 'string'
      )
      .map((p) => {
        // 内置提问只认字符串数组；早期版本存的是单条 opener，顺手迁移
        const legacy = (p as { opener?: unknown }).opener
        const presets = Array.isArray(p.presets)
          ? p.presets.filter((q): q is string => typeof q === 'string' && q.trim() !== '')
          : typeof legacy === 'string' && legacy.trim()
            ? [legacy.trim()]
            : []
        return { id: p.id, name: p.name, style: p.style, ...(presets.length > 0 ? { presets } : {}) }
      })
    const persona = settings.chatPersona
    const known = !!persona && (isBuiltinPersona(persona) || customPersonas.some((c) => c.id === persona))
    useChat.setState({ customPersonas, persona: known ? persona : 'default' })
    // [P1] 开机即读：恢复上次的论文与位置，不 await——外壳先渲染，数据到了即显示。
    // 上次那篇已被删（或从未记录）时退回最近打开的一篇：有论文的老用户不该面对空阅读器
    void (async () => {
      if (settings.lastPaperId) await usePaper.getState().loadPaper(settings.lastPaperId)
      if (usePaper.getState().bundle || !settings.onboarded) return
      const papers = await window.readarc.listPapers()
      if (papers[0] && !usePaper.getState().bundle) await usePaper.getState().loadPaper(papers[0].id)
    })()
    // [P5] 首次启动进引导；老用户永不打扰
    if (!settings.onboarded) useApp.setState({ screen: 'onboard' })
    window.readarc.onTranslateProgress((e) => usePaper.getState().applyProgress(e))
    window.readarc.onImportProgress((e) => usePaper.setState({ importProgress: e }))
    window.readarc.onChatDelta((e) => useChat.getState().applyDelta(e))
    window.readarc.onPaperBlocksUpdated((id) => void usePaper.getState().refreshBlocks(id))
    window.readarc.onLayoutProgress((e) => {
      if (usePaper.getState().bundle?.paper.id !== e.paperId) return
      usePaper.setState({ layoutProgress: e.done ? null : { page: e.page, pages: e.pages, ahead: e.ahead } })
    })
    window.readarc.onSearchAddProgress((e) => useSearch.getState().applyAddProgress(e))
    window.readarc.onSearchProgress((e) => useSearch.getState().applyProgress(e))
    window.readarc.onGenDelta((e) => useGen.getState().apply(e.kind, e.delta, e.paperId, e.reset))
    window.readarc.onMenuAction((action) => {
      if (action === 'settings') useApp.getState().setSettingsOpen(true)
      else if (action === 'privacy') useApp.getState().setSettingsOpen(true, 'privacy')
      else
        void usePaper.getState().pickAndImport()
    })
    window.addEventListener('online', () => useApp.getState().setOffline(false))
    window.addEventListener('offline', () => useApp.getState().setOffline(true))
    // 兜底拦截：标题栏拖拽区等 React 树外区域的文件拖放不许触发默认导航
    document.addEventListener('dragover', (e) => e.preventDefault())
    document.addEventListener('drop', (e) => e.preventDefault())
  } catch {
    // 无桥（如纯浏览器调试）时用默认值
  }
  // 诊断探针：把 store 挂到 window，供开发调试与故障排查时读取。
  // 仅在开发模式或主进程带远程调试端口启动（?diag=1）时装配，正式运行不存在。
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('diag')) {
    ;(window as unknown as { __app?: unknown }).__app = useApp
    ;(window as unknown as { __paper?: unknown }).__paper = usePaper
    void import('./store/library').then((m) => {
      ;(window as unknown as { __library?: unknown }).__library = m.useLibrary
    })
    void import('./store/notes').then((m) => {
      ;(window as unknown as { __notes?: unknown }).__notes = m.useNotes
    })
    void import('./store/confirm').then((m) => {
      ;(window as unknown as { __confirm?: unknown }).__confirm = m
    })
    ;(window as unknown as { __chat?: unknown }).__chat = useChat
    void import('./store/gen').then((m) => {
      ;(window as unknown as { __gen?: unknown }).__gen = m.useGen
    })
    ;(window as unknown as { __search?: unknown }).__search = useSearch
  }
  // 快速提示：接管所有带 title 的控件，120ms 出气泡（原生 title 要等系统那近一秒的延迟）
  installTooltips()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
}

void bootstrap()
