/** 应用内确认框：Enter 确认、Esc 或点遮罩取消，打开时焦点落在确认按钮上 */
import { useEffect, useRef, type JSX } from 'react'
import { useConfirm } from '../../store/confirm'
import { useT } from '../../i18n'

export function ConfirmDialog(): JSX.Element | null {
  const pending = useConfirm((s) => s.pending)
  const settle = useConfirm((s) => s.settle)
  const t = useT()
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!pending) return
    okRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        settle(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        settle(true)
      }
    }
    // 捕获阶段监听：压过面板 / 设置页自己的 Esc 处理
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending, settle])

  if (!pending) return null
  const [title, ...rest] = pending.message.split(/\n\s*\n/)
  const body = rest.join('\n\n').trim()
  const { confirmLabel, cancelLabel, danger } = pending.options

  return (
    <div className="dlg-overlay" onMouseDown={() => settle(false)}>
      <div
        className="dlg"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="dlg-title" id="dlg-title">
          {title}
        </p>
        {body && <p className="dlg-body">{body}</p>}
        <div className="dlg-actions">
          <button className="dlg-btn" onClick={() => settle(false)}>
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            ref={okRef}
            className={danger ? 'dlg-btn dlg-btn--danger' : 'dlg-btn dlg-btn--primary'}
            onClick={() => settle(true)}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
