/**
 * 设置弹窗：
 * 左侧图标导航；右侧行式布局——每行左边「标题 + 说明 + 等宽 hint」、
 * 右边控件右对齐；分区带图标标题。所有编辑就地完成，不跳页。
 */
import { useEffect, useState, type JSX } from 'react'
import { useT, type I18nKey } from '../../i18n'
import { useModels } from '../../store/models'
import { useApp, type SettingsTab } from '../../store/app'
import { IconChip, IconRoute, IconGlobe, IconDrive, IconGeneral, IconPersona } from './shared'
import { ModelsTab } from './ModelsTab'
import { MainModelTab, RoutesTab, CostTab } from './MainModelTab'
import { NetworkTab } from './NetworkTab'
import { GeneralTab } from './GeneralTab'
import { PersonasTab } from './PersonasTab'
import { DataTab } from './DataTab'
import { PrivacyTab } from './PrivacyTab'


/* ---- 弹窗骨架 ---- */

const TABS: { id: SettingsTab; label: I18nKey; icon: JSX.Element }[] = [
  { id: 'general', label: 'set.tab.general', icon: <IconGeneral /> },
  { id: 'personas', label: 'set.tab.personas', icon: <IconPersona /> },
  { id: 'main', label: 'set.tab.models', icon: <IconChip /> },
  { id: 'models', label: 'set.tab.endpoint', icon: <IconRoute /> },
  { id: 'network', label: 'set.tab.network', icon: <IconGlobe /> },
  { id: 'data', label: 'set.tab.data', icon: <IconDrive /> },
  { id: 'privacy', label: 'set.tab.privacy', icon: <IconGlobe /> }
]

export function SettingsModal(): JSX.Element | null {
  const t = useT()
  const open = useApp((s) => s.settingsOpen)
  const load = useModels((s) => s.load)
  const [tab, setTab] = useState<SettingsTab>('main')

  const detectLocal = useModels((s) => s.detectLocal)
  // 调用方指定的落点（如引导页的「接一个模型」→ 接入页）：渲染期调整状态，
  // 只在落点变化的那一次生效；关闭时 store 会把它清回 null，下次再指定照样跳
  const wantTab = useApp((s) => s.settingsTab)
  const [seenWant, setSeenWant] = useState<SettingsTab | null>(null)
  if (wantTab !== seenWant) {
    setSeenWant(wantTab)
    if (wantTab) setTab(wantTab)
  }
  useEffect(() => {
    if (open) {
      void load()
      void detectLocal() // 本地端点状态实时化（两个 localhost 探测，快）
    }
  }, [open, load, detectLocal])

  if (!open) return null
  const close = (): void => useApp.getState().setSettingsOpen(false)

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="settings-modal">
        <aside className="settings-modal-tabs">
          <div className="settings-modal-title">{t('set.title')}</div>
          {TABS.map((item) => (
            <button
              key={item.id}
              className={`settings-tab${tab === item.id ? ' settings-tab--active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <span className="settings-tab-icon">{item.icon}</span>
              {t(item.label)}
            </button>
          ))}
          {/* 版本号与两个外链放在左栏底部：a 标签带 target=_blank，由主进程的 setWindowOpenHandler 交给系统浏览器 */}
          <div className="settings-modal-version">
            <span>{`v${__APP_VERSION__}`}</span>
            <a href="https://readarc.ai" target="_blank" rel="noreferrer">{t('set.site')}</a>
            <a href="https://github.com/ReadArc-ai/ReadArc" target="_blank" rel="noreferrer">GitHub</a>
          </div>
        </aside>
        {/* 关闭按钮挂在弹窗上而不是滚动区里：内容页滚下去时它得一直在右上角 */}
        <button className="settings-modal-close" onClick={close} title={t('common.close-esc')}>
          ×
        </button>
        <div className="settings-modal-pane">
          {tab === 'general' && <GeneralTab />}
          {tab === 'personas' && <PersonasTab />}
          {tab === 'main' && (
            <>
              <MainModelTab />
              <RoutesTab />
              <CostTab />
            </>
          )}
          {tab === 'models' && <ModelsTab />}
          {tab === 'network' && <NetworkTab />}
          {tab === 'data' && <DataTab />}
          {tab === 'privacy' && <PrivacyTab />}
        </div>
      </div>
    </div>
  )
}
