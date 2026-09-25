import type { JSX } from 'react'
import { useApp } from '../../store/app'
import { usePaper } from '../../store/paper'
import { useT } from '../../i18n'

/**
 * 导入状态提示（底部居中，所有屏幕共用）：
 * 拖入 PDF 后解析要几秒到几十秒，原来只有阅读器的空态页有进度，
 * 在论文库或搜索屏拖入就像没反应；失败也一样。
 * 阅读器空态页自己就地展示进度，这里让位；引导页没有就地展示，照常提示。
 */
export function ImportToast(): JSX.Element | null {
  const t = useT()
  const screen = useApp((s) => s.screen)
  const hasPaper = usePaper((s) => !!s.bundle)
  const importing = usePaper((s) => s.importing)
  const progress = usePaper((s) => s.importProgress)
  const error = usePaper((s) => s.importError)
  const notice = usePaper((s) => s.importNotice)

  if (screen === 'reader' && !hasPaper) return null
  if (importing) {
    const pct = progress ? Math.round((progress.page / progress.pages) * 100) : 0
    return (
      <div className="import-toast" role="status">
        <span className="import-toast-dot" />
        <span className="import-toast-text">
          {t('reader.importing')}
          {progress &&
            (progress.page >= progress.pages
              ? ` ${progress.file} · ${t('reader.import-finalize')}`
              : ` ${progress.file} · ${t('reader.import-layout')} ${progress.page}/${progress.pages}`)}
        </span>
        {progress && (
          <span className="tr-bar import-toast-bar">
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </div>
    )
  }
  if (!error && notice) {
    return (
      <div className="import-toast import-toast--info" role="status">
        <span className="import-toast-text">{notice}</span>
      </div>
    )
  }
  if (!error) return null
  return (
    <div className="import-toast import-toast--error" role="alert">
      <span className="import-toast-text">{error}</span>
      <button className="route-cancel" onClick={() => usePaper.setState({ importError: null })}>
        {t('common.got-it')}
      </button>
    </div>
  )
}
