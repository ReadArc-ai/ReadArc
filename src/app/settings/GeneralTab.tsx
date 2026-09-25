/** 设置 → 通用：语言、主题等 */
import { type JSX } from 'react'
import type { Lang, ThemeMode } from '../../../shared/ipc'
import { TARGET_LANGS, type TargetLang } from '../../../shared/lang'
import { useT } from '../../i18n'
import { useApp } from '../../store/app'
import { Section, Row, IconGeneral } from './shared'


export function GeneralTab(): JSX.Element {
  const t = useT()
  const lang = useApp((s) => s.lang)
  const targetLang = useApp((s) => s.targetLang)
  const setTargetLang = useApp((s) => s.setTargetLang)
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const wordLookup = useApp((s) => s.wordLookup)
  const setWordLookup = useApp((s) => s.setWordLookup)
  const setLang = (next: Lang): void => {
    useApp.setState({ lang: next })
    window.readarc?.patchSettings({ lang: next }) // 主进程据此重建应用菜单的语言
  }
  return (
    <Section icon={<IconGeneral />} title={t('set.general')}>
      <Row
        title={t('set.lang')}
        action={
          <select className="set-select" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        }
      />
      <Row
        title={t('set.target-lang')}
        desc={t('set.target-lang.desc')}
        action={
          <select className="set-select" value={targetLang} onChange={(e) => setTargetLang(e.target.value as TargetLang)}>
            {TARGET_LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        }
      />
      <Row
        title={t('set.theme')}
        desc={t('set.theme-desc')}
        action={
          <select className="set-select" value={theme} onChange={(e) => setTheme(e.target.value as ThemeMode)}>
            <option value="system">{t('set.theme.system')}</option>
            <option value="dark">{t('set.theme.dark')}</option>
            <option value="light">{t('set.theme.light')}</option>
          </select>
        }
      />
      <Row
        title={t('set.word-lookup')}
        desc={t('set.word-lookup.desc')}
        action={
          <button
            className={wordLookup ? 'set-switch set-switch--on' : 'set-switch'}
            role="switch"
            aria-checked={wordLookup}
            aria-label={t('set.word-lookup')}
            onClick={() => setWordLookup(!wordLookup)}
          >
            <span className="set-switch-thumb" />
          </button>
        }
      />
    </Section>
  )
}
