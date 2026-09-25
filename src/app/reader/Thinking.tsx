import { useState, type JSX } from 'react'
import { useT } from '../../i18n'
import { estimateTokens } from '../../lib/format'
import { StreamBox } from './StreamBox'

/**
 * 推理模型的思考流：一行「思考中… · 约 N tok ›」，点开看灰字草稿。
 * live（还在思考、正文没出来）时默认展开，正文一出来自动收起；用户点过之后以用户为准。
 * 对话回答、页首摘要、AI 阅读笔记三处共用——不显示的话，推理模型前十几秒只有一个光标在闪，看起来像卡住了。
 */
export function ThinkingBlock({ thinking, live }: { thinking: string | undefined; live: boolean }): JSX.Element | null {
  const t = useT()
  const [manual, setManual] = useState<boolean | null>(null)
  if (!thinking) return null
  const open = manual ?? live
  return (
    <div className={open ? 'chat-think is-open' : 'chat-think'}>
      <button className="chat-think-head" onClick={() => setManual(!open)} title={t('panel.thinking-tip')} aria-expanded={open}>
        <span className={live ? 'chat-think-dot is-live' : 'chat-think-dot'} aria-hidden />
        <span>{live ? t('panel.thinking') : t('panel.thought')}</span>
        <span className="chat-think-meta">· {t('panel.thinking-tokens', { n: estimateTokens(thinking) })}</span>
        <svg className="chat-think-chev" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4.5 3l3 3-3 3" />
        </svg>
      </button>
      {open && <StreamBox className="chat-think-text" text={thinking} />}
    </div>
  )
}
