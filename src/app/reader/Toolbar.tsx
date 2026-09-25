import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useNeedsTranslation, usePaperLang } from '../../lib/paper-lang'
import { TARGET_LANGS, type TargetLang } from '../../../shared/lang'
import { usePaper } from '../../store/paper'
import { useApp, type PanelDock, type ReaderView } from '../../store/app'
import { useT } from '../../i18n'
import { IconContrast, IconCrop, IconDockBottom, IconFocus, IconPanelNone, IconPanelRight } from '../shell/icons'

const VIEWS: {
  id: ReaderView
  label: 'reader.view.page' | 'reader.view.orig' | 'reader.view.zh'
}[] = [
  { id: 'page', label: 'reader.view.page' },
  { id: 'orig', label: 'reader.view.orig' },
  { id: 'zh', label: 'reader.view.zh' }
]

/**
 * 阅读器工具栏只放阅读本身的控件：视图三态、缩放、面板开关。
 * AI 生成笔记搬进了笔记面板——它是花钱的 AI 动作，不该是工具栏里最醒目的那个按钮，
 * 而且结果本来就出现在笔记面板里，动作和结果放一起才顺手。
 */
export function ReaderToolbar(): JSX.Element {
  const storedView = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  // 论文语言就是目标语言（比如英文论文、目标英文）：没有译文可看，只留原文视图
  const needsTranslation = useNeedsTranslation()
  // 译文字号控件的标签：英文界面下直接写目标语言代码（ZH / JA / DE），不再固定写 ZH
  const lang = useApp((s) => s.lang)
  const targetLang = useApp((s) => s.targetLang)
  const setTargetLang = useApp((s) => s.setTargetLang)
  const paperLang = usePaperLang()
  // 只影响这篇的显示，不改用户选的视图（改了会让之后打开的每篇都停在原文）
  const view = needsTranslation ? storedView : 'orig'
  // 版面识别期间正文只显示原版页，视图切换先锁住；选中态照常保留，识别完就按它显示
  const layoutPending = usePaper((s) => s.bundle?.paper.layout_state === 'pending')
  const panelOpen = useApp((s) => s.panelOpen)
  const togglePanel = useApp((s) => s.togglePanel)
  const panelDock = useApp((s) => s.panelDock)
  const setPanelDock = useApp((s) => s.setPanelDock)
  const tier = useApp((s) => s.tier)
  // 停靠菜单：点外面或 Esc 关掉
  const [dockMenuOpen, setDockMenuOpen] = useState(false)
  const menuRef = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    if (!dockMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && e.target instanceof Node && !menuRef.current.contains(e.target)) setDockMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDockMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [dockMenuOpen])
  const pageZoom = useApp((s) => s.pageZoom)
  const setPageZoom = useApp((s) => s.setPageZoom)
  // 纸面深浅：没切过时跟随界面主题
  const paperDark = useApp((s) => s.paperDark ?? false)
  const togglePaperDark = useApp((s) => s.togglePaperDark)
  const focusMode = useApp((s) => s.focusMode)
  const toggleFocus = useApp((s) => s.toggleFocus)
  const cropMode = useApp((s) => s.cropMode)
  const setCropMode = useApp((s) => s.setCropMode)
  // 译文字号：下拉直选；只在有译文的视图里出现。设置文件里手改的档位不在列表时也要能显示
  const zhTextScale = useApp((s) => s.zhTextScale)
  const setZhTextScale = useApp((s) => s.setZhTextScale)
  const ZH_STEPS = [0.85, 1, 1.15, 1.3, 1.5, 1.75]
  const zhSteps = ZH_STEPS.some((v) => Math.abs(v - zhTextScale) < 0.005)
    ? ZH_STEPS
    : [...ZH_STEPS, zhTextScale].sort((a, b) => a - b)
  const t = useT()
  // 翻译状态（未译几段 / 翻译中 / 已译完 + 重译）挂在视图切换旁边：它和「原版对照 / 译文」
  // 是一回事，放在正文上方当横幅太占地方。逻辑仍在正文组件里，这里只留挂载点
  const setTbSlot = useApp((s) => s.setTbSlot)
  const slotRef = useCallback((el: HTMLElement | null) => setTbSlot(el), [setTbSlot])

  return (
    <div className="reader-toolbar">
      {needsTranslation && (
      <div className="seg-control">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className="seg-item"
            style={
              view === v.id
                ? { background: 'var(--acc)', color: 'var(--on-acc)' }
                : undefined
            }
            onClick={() => setView(v.id)}
            disabled={layoutPending && v.id !== 'orig'}
            title={layoutPending && v.id !== 'orig' ? t('reader.view.layout-wait') : t('reader.view.tip')}
          >
            {t(v.label)}
          </button>
        ))}
      </div>
      )}
      {/* 论文语言和目标语言相同（比如英文界面没选过目标语言时读英文论文）：翻译入口换成选语言，
          不能让翻译整个消失、用户找不到 */}
      {!needsTranslation && (
        <label className="tb-control tb-zh-scale" title={t('tb.translate-to-tip')}>
          <span className="tb-zh-scale-glyph">{t('tb.translate-to')}</span>
          <select value="" onChange={(e) => setTargetLang(e.target.value as TargetLang)}>
            <option value="" disabled hidden>
              {t('tb.translate-pick')}
            </option>
            {TARGET_LANGS.filter((l) => l.id !== paperLang).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <svg className="tb-zh-scale-chev" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 4.5l3 3 3-3" />
          </svg>
        </label>
      )}
      <span className="tb-translate" ref={slotRef} />
      <div className="reader-toolbar-right">
        {view !== 'orig' && (
          <label className="tb-control tb-zh-scale" title={t('tb.zh-scale')}>
            <span className="tb-zh-scale-glyph">{lang === 'en' ? targetLang.toUpperCase() : t('tb.zh-scale-label')}</span>
            <select value={String(zhTextScale)} onChange={(e) => setZhTextScale(Number(e.target.value))}>
              {zhSteps.map((v) => (
                <option key={v} value={String(v)}>
                  {Math.round(v * 100)}%
                </option>
              ))}
            </select>
            <svg className="tb-zh-scale-chev" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 4.5l3 3 3-3" />
            </svg>
          </label>
        )}
        <div className="zoom-controls">
          <button className="tb-control" title={t('tb.zoom-out')} onClick={() => setPageZoom(pageZoom - 0.15)}>
            −
          </button>
          <button className="tb-control zoom-pct" title={t('tb.zoom-reset')} onClick={() => setPageZoom(1)}>
            {Math.round(pageZoom * 100)}%
          </button>
          <button className="tb-control" title={t('tb.zoom-in')} onClick={() => setPageZoom(pageZoom + 0.15)}>
            +
          </button>
        </div>
        <button
          className="tb-control tb-icon"
          onClick={togglePaperDark}
          title={paperDark ? t('tb.paper-light') : t('tb.paper-dark')}
          aria-pressed={paperDark}
          style={paperDark ? { color: 'var(--acc)', borderColor: 'var(--acc)' } : undefined}
        >
          <IconContrast on={paperDark} />
        </button>
        {/* 截图提问：框选公式 / 图表发给 AI（只能框原版页；需要模型支持看图） */}
        {view !== 'zh' && (
          <button
            className="tb-control tb-icon"
            onClick={() => setCropMode(!cropMode)}
            title={cropMode ? t('tb.crop-off') : t('tb.crop')}
            aria-pressed={cropMode}
            style={cropMode ? { color: 'var(--acc)', borderColor: 'var(--acc)' } : undefined}
          >
            <IconCrop />
          </button>
        )}
        <button
          className="tb-control tb-icon"
          onClick={toggleFocus}
          title={focusMode ? t('tb.focus-off') : t('tb.focus')}
          aria-pressed={focusMode}
          style={focusMode ? { color: 'var(--acc)', borderColor: 'var(--acc)' } : undefined}
        >
          <IconFocus />
        </button>
        {tier === 'sm' ? (
          // 窄窗口只有浮层面板，没有停靠概念：保留开关
          <button
            className="tb-control tb-icon"
            onClick={togglePanel}
            title={panelOpen ? t('tb.hide-panel') : t('tb.show-panel')}
          >
            <IconPanelRight open={panelOpen} />
          </button>
        ) : (
          // 面板的开关与停靠位置合成一个控件：图标显示当前状态，点开是浏览器调试工具那种
          // 「停靠位置」图标行（隐藏 / 靠下 / 靠右），不是文字下拉（⌘\ 仍可开关）
          <span className="tb-panel-menu" ref={menuRef}>
            <button
              className="tb-control tb-icon"
              onClick={() => setDockMenuOpen((v) => !v)}
              title={t('tb.panel-layout')}
              aria-haspopup="true"
              aria-expanded={dockMenuOpen}
            >
              {!panelOpen ? <IconPanelNone /> : panelDock === 'bottom' ? <IconDockBottom /> : <IconPanelRight open />}
            </button>
            {dockMenuOpen && (
              <div className="dock-menu" role="menu">
                <span className="dock-menu-label">{t('tb.dock-side')}</span>
                {(
                  [
                    { id: 'hidden', icon: <IconPanelNone />, label: t('tb.hide-panel'), on: !panelOpen },
                    { id: 'bottom', icon: <IconDockBottom />, label: t('tb.panel-bottom'), on: panelOpen && panelDock === 'bottom' },
                    { id: 'right', icon: <IconPanelRight open />, label: t('tb.panel-right'), on: panelOpen && panelDock === 'right' }
                  ] as { id: 'hidden' | PanelDock; icon: JSX.Element; label: string; on: boolean }[]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    role="menuitemradio"
                    aria-checked={opt.on}
                    className={opt.on ? 'is-on' : undefined}
                    title={opt.label}
                    onClick={() => {
                      if (opt.id === 'hidden') {
                        if (panelOpen) togglePanel()
                      } else {
                        setPanelDock(opt.id)
                      }
                      setDockMenuOpen(false)
                    }}
                  >
                    {opt.icon}
                  </button>
                ))}
              </div>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
