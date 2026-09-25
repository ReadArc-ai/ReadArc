/**
 * 讲法（读者人设）id → 提示词段。只改「怎么讲」，不改事实规则：
 * 「只依据片段、不编造、引用只用给定标号」由 context.ts 固定给出，人设段拼在其后。
 */
import { isBuiltinPersona, type CustomPersona } from '../../shared/models'
import { personaStyle } from '../../shared/personas'
import type { TargetLang } from '../../shared/lang'

/**
 * 内置讲法查内置表，自定义讲法查用户列表（来自 settings.json）；
 * 默认讲法、来路不明的 id、空白的自定义要求都返回 null（沿用标准的克制表达要求）。
 */
export function resolvePersonaStyle(
  persona: string | undefined,
  custom: readonly CustomPersona[] = [],
  lang: TargetLang = 'zh'
): string | null {
  if (!persona) return null
  if (isBuiltinPersona(persona)) return persona === 'default' ? null : personaStyle(persona, lang)
  const style = custom.find((c) => c.id === persona)?.style.trim()
  return style ? style : null
}
