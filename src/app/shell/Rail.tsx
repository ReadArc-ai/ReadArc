import { useEffect, useState, type CSSProperties, type JSX } from 'react'
import { useApp, type Screen } from '../../store/app'
import { usePaper } from '../../store/paper'
import { useT, type I18nKey } from '../../i18n'
import { DragHandle } from './DragHandle'
import { IconLibrary, IconPanelLeft, IconReader, IconSearch, IconSettings } from './icons'
import { formatTokens, formatUsd } from '../../lib/format'
import { useChat } from '../../store/chat'
import { useGen } from '../../store/gen'
import { keyLabel } from '../../lib/keys'

const NAV: { screen: Screen; label: I18nKey; key: string; icon: () => JSX.Element }[] = [
  { screen: 'reader', label: 'nav.reader', key: '⌘1', icon: IconReader },
  { screen: 'library', label: 'nav.library', key: '⌘2', icon: IconLibrary },
  { screen: 'discover', label: 'nav.discover', key: '⌘3', icon: IconSearch }
]

/* 选中态必须是内联样式（高优先级）——原型踩坑：样式表规则被元素自身背景压过，
   导致所有选中态失效。 */
const ACTIVE: CSSProperties = {
  background: 'var(--bg2)',
  color: 'var(--fg)',
  boxShadow: 'inset 2px 0 0 var(--acc)'
}

function RailItem({
  item,
  active,
  compact
}: {
  item: (typeof NAV)[number]
  active: boolean
  compact: boolean
}): JSX.Element {
  const setScreen = useApp((s) => s.setScreen)
  const t = useT()
  const Icon = item.icon
  return (
    <button
      className="rail-item"
      style={active ? ACTIVE : undefined}
      onClick={() => setScreen(item.screen)}
      title={compact ? `${t(item.label)} ${keyLabel(item.key)}` : undefined}
    >
      <span style={active ? { color: 'var(--acc)', display: 'flex' } : { display: 'flex' }}>
        <Icon />
      </span>
      {!compact && (
        <>
          <span className="rail-item-label">{t(item.label)}</span>
          <span className="rail-item-key">{keyLabel(item.key)}</span>
        </>
      )}
    </button>
  )
}

export function Rail(): JSX.Element {
  const screen = useApp((s) => s.screen)
  const tier = useApp((s) => s.tier)
  const railCollapsed = useApp((s) => s.railCollapsed)
  const toggleRail = useApp((s) => s.toggleRail)
  const translating = usePaper((s) => s.translating)
  const t = useT()
  const compact = tier === 'sm' || railCollapsed
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof window.readarc.monthUsage>> | null>(
    null
  )

  // 用量常驻可见 [P7]：翻译批次、对话、生成结束后都要刷新——
  // 原来只跟翻译状态，问完一句话左栏还显示 0 tok，用户会以为没计
  const asking = useChat((s) => s.asking)
  const generating = useGen((s) => Object.keys(s.streams).length > 0)
  useEffect(() => {
    if (translating || asking || generating) return
    window.readarc
      .monthUsage()
      .then(setUsage)
      .catch(() => {})
  }, [translating, asking, generating])

  const settingsOpen = useApp((s) => s.settingsOpen)

  const railWidth = useApp((s) => s.railWidth)
  const setSidebarWidth = useApp((s) => s.setSidebarWidth)
  const curWidth = compact ? 52 : (railWidth ?? 192)

  return (
    <nav
      className={`rail${compact ? ' rail--sm' : ''}`}
      style={!compact && railWidth != null ? { width: railWidth } : undefined}
    >
      {NAV.map((item) => (
        <RailItem key={item.screen} item={item} active={screen === item.screen} compact={compact} />
      ))}
      <div className="rail-spacer" />
      <button
        className="rail-item"
        style={settingsOpen ? { color: 'var(--acc)', background: 'var(--acc-soft)' } : undefined}
        onClick={() => useApp.getState().setSettingsOpen(true)}
        title={compact ? `${t('nav.models')} ${keyLabel('⌘,')}` : undefined}
      >
        <span style={{ display: 'flex' }}>
          <IconSettings />
        </span>
        {!compact && (
          <>
            <span className="rail-item-label">{t('nav.models')}</span>
            <span className="rail-item-key">{keyLabel('⌘,')}</span>
          </>
        )}
      </button>
      {!compact && (
        <div className="rail-usage">
          <div className="rail-usage-label">{t('usage.label')}</div>
          <div className="rail-usage-amount">
            {usage
              ? `${formatTokens(usage.inputTokens + usage.outputTokens)} tok` +
                (usage.spendUsd > 0 ? ` · ${formatUsd(usage.spendUsd)}` : '')
              : '—'}
          </div>
        </div>
      )}
      {/* sm 档为自动收起，手动开关只在有空间时提供 */}
      {tier !== 'sm' && (
        <button
          className="rail-toggle"
          onClick={toggleRail}
          title={railCollapsed ? t('rail.expand') : t('rail.collapse')}
        >
          <IconPanelLeft open={!railCollapsed} />
        </button>
      )}
      {/* 拖窄过阈值折叠、折叠态拖宽展开；宽度松手落盘 */}
      {tier !== 'sm' && (
        <DragHandle
          key="dh"
          edge="right"
          width={curWidth}
          min={150}
          max={300}
          onResize={(w, raw) => {
            if (raw < 110) {
              if (!railCollapsed) toggleRail()
              return
            }
            if (railCollapsed) toggleRail()
            setSidebarWidth('rail', w)
          }}
          onCommit={() => {
            const s = useApp.getState()
            if (s.railWidth != null) s.setSidebarWidth('rail', s.railWidth, true)
          }}
        />
      )}
    </nav>
  )
}
