import { useNeedsTranslation } from '../../lib/paper-lang'
import { useMemo, useState, type JSX } from 'react'
import { errText } from '../../lib/errors'
import { usePaper } from '../../store/paper'
import { useApp } from '../../store/app'
import { useT } from '../../i18n'
import { DragHandle } from '../shell/DragHandle'
import { IconPanelLeft } from '../shell/icons'

export function ReaderOutline({
  onJump
}: {
  onJump: (order: number) => void
}): JSX.Element | null {
  const bundle = usePaper((s) => s.bundle)
  const progress = usePaper((s) => s.liveProgress)
  const current = usePaper((s) => s.currentSection)
  const translations = usePaper((s) => s.translations)
  const t = useT()
  const lang = useApp((s) => s.lang)
  const targetLang = useApp((s) => s.targetLang)
  const needsTranslation = useNeedsTranslation()
  const outlineWidth = useApp((s) => s.outlineWidth)
  const setSidebarWidth = useApp((s) => s.setSidebarWidth)
  const collapsed = useApp((s) => s.outlineCollapsed)
  const toggleOutline = useApp((s) => s.toggleOutline)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 目录项 order → 标题译文（标题已纳入翻译管线，与镜像页共用同一份缓存）
  const zhByOrder = useMemo(() => {
    const map = new Map<number, string>()
    for (const b of bundle?.blocks ?? []) {
      if (b.kind !== 'heading') continue
      const zh = translations[b.block_id]?.text
      if (zh) map.set(b.block_order, zh)
    }
    return map
  }, [bundle, translations])

  if (!bundle) return null

  if (collapsed) {
    return (
      <aside className="reader-outline reader-outline--collapsed">
        {/* 与展开态同位置同 key：跨形态拖拽时 DOM 节点复用，指针捕获不中断 */}
        <DragHandle
          key="dh"
          edge="right"
          width={28}
          min={140}
          max={340}
          onResize={(w, raw) => {
            if (raw >= 90) {
              toggleOutline()
              setSidebarWidth('outline', w)
            }
          }}
          onCommit={() => {
            const s = useApp.getState()
            if (!s.outlineCollapsed && s.outlineWidth != null)
              s.setSidebarWidth('outline', s.outlineWidth, true)
          }}
        />
        <button className="outline-toggle" onClick={toggleOutline} title={t('outline.expand')}>
          <IconPanelLeft open={false} />
        </button>
        <span className="outline-vert">{t('reader.outline')}</span>
      </aside>
    )
  }

  const headingCount = bundle.outline.length
  const untranslated = headingCount - zhByOrder.size

  // 目录单独翻译：一次批量调用（~3s），进度事件实时刷新条目
  const translateOutlineNow = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.readarc.translateOutline(bundle.paper.id)
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside
      className="reader-outline"
      style={outlineWidth != null ? { width: outlineWidth } : undefined}
    >
      <DragHandle
        key="dh"
        edge="right"
        width={outlineWidth ?? 184}
        min={140}
        max={340}
        onResize={(w, raw) => {
          if (raw < 90) {
            if (!useApp.getState().outlineCollapsed) toggleOutline()
            return
          }
          if (useApp.getState().outlineCollapsed) toggleOutline()
          setSidebarWidth('outline', w)
        }}
        onCommit={() => {
          const s = useApp.getState()
          if (!s.outlineCollapsed && s.outlineWidth != null)
            s.setSidebarWidth('outline', s.outlineWidth, true)
        }}
      />
      <div className="outline-head">
        <button className="outline-collapse" onClick={toggleOutline} title={t('outline.collapse')}>
          <IconPanelLeft open />
        </button>
        <span className="outline-label">{t('reader.outline')}</span>
        {untranslated > 0 && needsTranslation && (
          <button
            className="outline-translate"
            onClick={() => void translateOutlineNow()}
            disabled={busy}
            title={error ?? t('outline.translate-title')}
            style={error ? { color: 'var(--vi)' } : undefined}
          >
            {busy ? '…' : error ? t('reader.retry') : lang === 'en' ? targetLang.toUpperCase() : t('outline.translate')}
          </button>
        )}
        <span className="outline-pct">{Math.round(progress)}%</span>
      </div>
      <div className="outline-bar">
        <div style={{ width: `${Math.min(100, progress)}%` }} />
      </div>
      <div className="outline-list">
        {bundle.paper.layout_state === 'pending' && bundle.outline.length === 0 && (
          <p className="outline-pending">{t('outline.pending')}</p>
        )}
        {bundle.outline.map((o) => {
          const zh = zhByOrder.get(o.order)
          return (
            <button
              key={o.order}
              className={`outline-item${o.level > 1 ? ' outline-item--sub' : ''}`}
              style={
                current === o.title
                  ? { color: 'var(--acc)', boxShadow: 'inset 2px 0 0 var(--acc)' }
                  : undefined
              }
              onClick={() => onJump(o.order)}
            >
              {/* 中英并列：中文为主行、原文为辅行；未译只显原文 */}
              <span className="outline-zh">{zh ?? o.title}</span>
              {zh && zh !== o.title && <span className="outline-orig">{o.title}</span>}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
