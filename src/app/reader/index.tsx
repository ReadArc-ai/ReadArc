import { useRef, type JSX } from 'react'
import { useApp } from '../../store/app'
import { usePaper } from '../../store/paper'
import { useT } from '../../i18n'
import { ReaderToolbar } from './Toolbar'
import { FindBar } from './FindBar'
import { SelectionPopover } from './SelectionPopover'
import { ReaderOutline } from './Outline'
import { HighlightUndo } from './HighlightUndo'
import { ReaderDocument } from './Document'
import { ContextPanel } from './Panel'

function EmptyState(): JSX.Element {
  const t = useT()
  const importing = usePaper((s) => s.importing)
  const importProgress = usePaper((s) => s.importProgress)
  const importError = usePaper((s) => s.importError)
  return (
    <div className="reader-empty">
      <h2>{importing ? t('reader.importing') : t('reader.empty.title')}</h2>
      {!importing && importError && <p className="import-error">{importError}</p>}
      {importing && importProgress && (
        <p className="import-progress">
          {importProgress.page >= importProgress.pages
            ? t('reader.import-finalize')
            : `${t('reader.import-layout')} ${importProgress.page}/${importProgress.pages}`}
          <span className="tr-bar">
            <span style={{ width: `${Math.round((importProgress.page / importProgress.pages) * 100)}%` }} />
          </span>
        </p>
      )}
      {!importing && (
        <>
          <ul>
            <li>{t('reader.empty.drop')}</li>
            <li>{t('reader.empty.doi')}</li>
          </ul>
          <button className="btn-accent" onClick={() => void usePaper.getState().pickAndImport()} disabled={importing}>
            {t('reader.empty.pick')}
          </button>
        </>
      )}
    </div>
  )
}

export function ReaderScreen(): JSX.Element {
  const bundle = usePaper((s) => s.bundle)
  const tier = useApp((s) => s.tier)
  const panelDock = useApp((s) => s.panelDock)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const jumpTo = (order: number): void => {
    const root = scrollRef.current
    if (!root) return
    const el = root.querySelector<HTMLElement>(`[data-order="${order}"]`)
    if (el) {
      el.scrollIntoView({ block: 'start' })
      return
    }
    // 原版视图没有 data-order 元素：按块所在页 + bbox 纵向位置滚动
    const b = usePaper.getState().bundle?.blocks.find((x) => x.block_order === order)
    if (!b) return
    const pageEl = root.querySelector<HTMLElement>(`.pdf-page[data-page="${b.page}"]`)
    if (!pageEl) return
    let frac = 0
    const ph = Number(pageEl.dataset.ph)
    if (b.bbox && Number.isFinite(ph) && ph > 0) {
      try {
        const [, y, , h] = JSON.parse(b.bbox) as [number, number, number, number]
        // bbox y 向上：顶边 = y + h，换算成页内自顶向下的比例
        frac = Math.min(1, Math.max(0, 1 - (y + h) / ph))
      } catch {
        /* bbox 损坏则跳页顶 */
      }
    }
    const pageRect = pageEl.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    root.scrollTo({ top: pageRect.top - rootRect.top + root.scrollTop + frac * pageRect.height - 8 })
  }

  if (!bundle) {
    return (
      <section className="screen">
        <div className="screen-body">
          <EmptyState />
        </div>
      </section>
    )
  }

  return (
    <section className="screen">
      <ReaderToolbar />
      <FindBar />
      <HighlightUndo />
      <div className="reader-layout">
        {/* 目录在中等宽度也留着（1280×800 是常见笔记本尺寸，没有目录就没法在长论文里跳转）：
            进 md 时自动收成 28px 的窄条，点一下就能展开 */}
        {tier !== 'sm' && <ReaderOutline onJump={jumpTo} />}
        {/* 面板靠下时正文与面板竖着叠在目录右侧那一列里（目录保持通高） */}
        {panelDock === 'bottom' && tier !== 'sm' ? (
          <div className="reader-main">
            <ReaderDocument scrollRef={scrollRef} />
            <ContextPanel />
          </div>
        ) : (
          <>
            <ReaderDocument scrollRef={scrollRef} />
            <ContextPanel />
          </>
        )}
      </div>
      <SelectionPopover containerRef={scrollRef} />
    </section>
  )
}
