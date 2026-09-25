import type { JSX } from 'react'
import { useApp } from '../../store/app'
import { useT } from '../../i18n'
import { BrandMark, IconSearch } from './icons'
import { keyLabel } from '../../lib/keys'

/**
 * 标题栏只留品牌、⌘K 搜索框和离线徽标。
 * 语言、主题、版本号原先挤在右上角——那是设置项，不是每时每刻要碰的东西，
 * 已搬进设置（通用 / 关于）。
 */
export function Titlebar(): JSX.Element {
  const offline = useApp((s) => s.offline)
  const t = useT()
  const isMac = window.readarc?.platform === 'darwin'

  return (
    <header className={`titlebar${isMac ? ' titlebar--mac' : ''}`}>
      <div className="titlebar-brand">
        <BrandMark />
        <span>ReadArc</span>
      </div>

      <div className="titlebar-center">
        <div
          className="titlebar-search"
          style={{ cursor: 'pointer' }}
          onClick={() => useApp.getState().setPaletteOpen(true)}
        >
          <IconSearch />
          <input
            type="text"
            placeholder={t('titlebar.search')}
            readOnly
            style={{ cursor: 'pointer' }}
          />
          <kbd>{keyLabel('⌘K')}</kbd>
        </div>
      </div>

      <div className="titlebar-right">
        {offline && (
          <span className="tb-control tb-offline" title={t('offline.title')}>
            {t('offline.badge')}
          </span>
        )}
      </div>
    </header>
  )
}
