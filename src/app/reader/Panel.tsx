/** 右侧上下文面板壳子：对话 / 笔记两个页签，可停靠到底部 */
import { type JSX } from 'react'
import { useApp, type PanelTab } from '../../store/app'
import { useT } from '../../i18n'
import { DragHandle } from '../shell/DragHandle'
import { ChatTab } from './ChatTab'
import { NotesTab } from './NotesTab'


/** 上下文面板：对话/笔记两个标签是上限。 */
export function ContextPanel(): JSX.Element | null {
  const panelOpen = useApp((s) => s.panelOpen)
  const panel = useApp((s) => s.panel)
  const setPanel = useApp((s) => s.setPanel)
  const togglePanel = useApp((s) => s.togglePanel)
  const tier = useApp((s) => s.tier)
  const panelWidth = useApp((s) => s.panelWidth)
  const setSidebarWidth = useApp((s) => s.setSidebarWidth)
  // 停靠位置：靠右按宽度拖，靠下按高度拖；sm 档只有浮层，没有停靠概念
  const panelDock = useApp((s) => s.panelDock)
  const panelHeight = useApp((s) => s.panelHeight)
  const setPanelHeight = useApp((s) => s.setPanelHeight)
  const t = useT()

  if (!panelOpen) return null

  const tabs: { id: PanelTab; label: string }[] = [
    { id: 'chat', label: t('panel.chat') },
    { id: 'notes', label: t('panel.notes') }
  ]

  const bottom = panelDock === 'bottom' && tier !== 'sm'
  const defaultW = tier === 'md' ? 300 : 344
  const defaultH = 320
  const maxH = Math.max(240, Math.round(window.innerHeight * 0.7))
  const panelEl = (
    <aside
      className={`context-panel${tier === 'sm' ? ' context-panel--overlay' : ''}${bottom ? ' context-panel--bottom' : ''}`}
      style={tier === 'sm' ? undefined : bottom ? { height: panelHeight ?? defaultH } : { width: panelWidth ?? defaultW }}
    >
      {tier !== 'sm' && !bottom && (
        <DragHandle
          edge="left"
          width={panelWidth ?? defaultW}
          min={250}
          max={560}
          onResize={(w) => setSidebarWidth('panel', w)}
          onCommit={() => {
            const s = useApp.getState()
            if (s.panelWidth != null) s.setSidebarWidth('panel', s.panelWidth, true)
          }}
        />
      )}
      {bottom && (
        <DragHandle
          edge="top"
          width={panelHeight ?? defaultH}
          min={160}
          max={maxH}
          onResize={(h) => setPanelHeight(h)}
          onCommit={() => {
            const s = useApp.getState()
            if (s.panelHeight != null) s.setPanelHeight(s.panelHeight, true)
          }}
        />
      )}
      <div className="panel-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className="panel-tab"
            style={
              panel === tab.id
                ? { color: 'var(--fg)', boxShadow: 'inset 0 -2px 0 var(--acc)' }
                : undefined
            }
            onClick={() => setPanel(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <span className="panel-tabs-spacer" />
        {/* 停靠位置的切换并入工具栏那个面板控件，这里只留关闭 */}
        <button className="panel-close" onClick={togglePanel} title={t('tb.hide-panel')}>
          ×
        </button>
      </div>
      <div className="panel-body">{panel === 'chat' ? <ChatTab /> : <NotesTab />}</div>
    </aside>
  )

  // [P3] sm 档：浮层是出流元素，min-width 管不住它——默认收起（store 已强制），
  // 打开时加半透明遮罩（点击关闭）
  if (tier === 'sm') {
    return (
      <div className="panel-mask" onClick={togglePanel}>
        <div onClick={(e) => e.stopPropagation()}>{panelEl}</div>
      </div>
    )
  }
  return panelEl
}
