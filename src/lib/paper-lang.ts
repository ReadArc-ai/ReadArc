/** 这篇论文要不要翻译：论文语言和目标语言一样时，阅读器不显示翻译相关的入口 */
import { useMemo } from 'react'
import { paperLang, type TargetLang } from '../../shared/lang'
import { useApp } from '../store/app'
import { usePaper } from '../store/paper'

export function usePaperLang(): TargetLang | null {
  const blocks = usePaper((s) => s.bundle?.blocks ?? null)
  return useMemo(() => (blocks ? paperLang(blocks.filter((b) => b.kind === 'para').map((b) => b.text)) : null), [blocks])
}

export function useNeedsTranslation(): boolean {
  const lang = usePaperLang()
  const target = useApp((s) => s.targetLang)
  return lang == null ? true : lang !== target
}
