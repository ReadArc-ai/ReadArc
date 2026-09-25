/**
 * 移除高亮后的撤销条：高亮点一下就没了，误点等于把自己的标记悄悄删掉。
 * 底部居中显示六秒，点「撤销」按原锚点加回去。
 */
import type { JSX } from 'react'
import { useT } from '../../i18n'
import { useNotes } from '../../store/notes'

export function HighlightUndo(): JSX.Element | null {
  const t = useT()
  const pending = useNotes((s) => s.undoHighlight)
  const restore = useNotes((s) => s.restoreHighlight)
  const dismiss = useNotes((s) => s.dismissUndo)
  if (!pending) return null
  return (
    <div className="hl-undo" role="status">
      <span>{t('sel.highlight-removed')}</span>
      <button className="hl-undo-action" onClick={() => void restore()}>
        {t('common.undo')}
      </button>
      <button className="hl-undo-close" onClick={dismiss} title={t('common.close-esc')}>
        ×
      </button>
    </div>
  )
}
