import { type JSX } from 'react'
import privacyZh from '../../../PRIVACY.md?raw'
import privacyEn from '../../../PRIVACY.en.md?raw'
import { useApp } from '../../store/app'
import { Markdown } from '../../lib/md'

/** 政策正文随应用打包：断网或仓库暂不可访问时也能完整阅读。 */
export function PrivacyTab(): JSX.Element {
  const lang = useApp((s) => s.lang)
  return <Markdown text={lang === 'en' ? privacyEn : privacyZh} />
}
