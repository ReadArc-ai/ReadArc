/**
 * 内置讲法的内置提问（输入框上方的快捷按钮）：label 是按钮文字，q 是实际发出的问题。
 * 讲法自带的提问都是整篇维度的（whole），主进程按目录取各节首段做上下文；
 * 默认讲法的两个提问保持原来的按问句检索。设置页也用这张表展示每种讲法带了哪些提问。
 * 自定义讲法的提问由用户在设置里逐行填写（CustomPersona.presets）。
 */
import type { BuiltinPersonaId } from '../../shared/models'
import type { I18nKey } from '../i18n'

export interface BuiltinPreset {
  label: I18nKey
  q: I18nKey
  whole: boolean
}

export const BUILTIN_PRESETS: Record<BuiltinPersonaId, BuiltinPreset[]> = {
  default: [
    { label: 'panel.preset.method.label', q: 'panel.preset.method', whole: false },
    { label: 'panel.preset.weakness.label', q: 'panel.preset.weakness', whole: false }
  ],
  grandma: [
    { label: 'panel.preset.grandma.1.label', q: 'panel.preset.grandma.1', whole: true },
    { label: 'panel.preset.grandma.2.label', q: 'panel.preset.grandma.2', whole: true }
  ],
  kid: [
    { label: 'panel.preset.kid.1.label', q: 'panel.preset.kid.1', whole: true },
    { label: 'panel.preset.kid.2.label', q: 'panel.preset.kid.2', whole: true }
  ],
  stepwise: [
    { label: 'panel.preset.stepwise.1.label', q: 'panel.preset.stepwise.1', whole: true },
    { label: 'panel.preset.stepwise.2.label', q: 'panel.preset.stepwise.2', whole: true }
  ],
  advisor: [
    { label: 'panel.preset.advisor.1.label', q: 'panel.preset.advisor.1', whole: true },
    { label: 'panel.preset.advisor.2.label', q: 'panel.preset.advisor.2', whole: true }
  ],
  reviewer: [
    { label: 'panel.preset.reviewer.1.label', q: 'panel.preset.reviewer.1', whole: true },
    { label: 'panel.preset.reviewer.2.label', q: 'panel.preset.reviewer.2', whole: true }
  ]
}

/** 自定义提问的按钮文字：问题本身，太长就截断（完整问题放 title） */
export function presetChipLabel(q: string): string {
  const s = q.trim()
  return s.length > 14 ? `${s.slice(0, 14)}…` : s
}

/** 表单里逐行填写的内置提问 → 规整后的列表（去空行、去重、最多 4 条） */
export function parsePresetLines(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const q = line.trim()
    if (q && !out.includes(q)) out.push(q)
    if (out.length === 4) break
  }
  return out
}
