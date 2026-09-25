import { scriptCounts, scriptOf, type TargetLang } from '../../shared/lang'
/**
 * 模型输出的基本体检。摘要 / 阅读笔记这类固定格式的中文产物，
 * 输出既不能是英文（指令被网关丢掉时，模型只看到论文文本就会用原文语言续写），
 * 也不能是原文照抄。不合格的输出不能当结果缓存起来。
 */

/** 中文字符占主体：至少 minCjk 个汉字，且汉字数不少于英文字母数的一半（术语、模型名可以是英文） */
export function isMostlyChinese(text: string, minCjk = 20): boolean {
  const cjk = (text.match(/[一-鿿]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  return cjk >= minCjk && cjk >= latin * 0.5
}

/** 输出里任一 window 字的窗口原样出现在上下文里，视为照抄 */
export function echoesContext(text: string, context: string, window = 40): boolean {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
  const t = norm(text)
  const ctx = norm(context)
  if (t.length === 0) return false
  if (t.length < window) return ctx.includes(t)
  const starts = [0, Math.floor((t.length - window) / 2), t.length - window]
  return starts.some((i) => ctx.includes(t.slice(i, i + window)))
}

/** 英文字母占主体：至少 minLatin 个字母，且不被汉字压过 */
export function isMostlyLatin(text: string, minLatin = 40): boolean {
  const cjk = (text.match(/[一-鿿]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  return latin >= minLatin && latin >= cjk * 2
}

/** 像一段中文概括：中文为主，且不是原文照抄 */
export function looksLikeChineseDigest(text: string, context: string): boolean {
  return isMostlyChinese(text) && !echoesContext(text, context)
}

/** 输出用的是目标语言的文字：中文看汉字、日文看假名、韩文看谚文、其余看拉丁字母 */
export function inTargetScript(text: string, lang: TargetLang): boolean {
  const c = scriptCounts(text)
  switch (scriptOf(lang)) {
    case 'han':
      return isMostlyChinese(text)
    case 'kana':
      return c.kana >= 10
    case 'hangul':
      return c.hangul >= 10
    default:
      return isMostlyLatin(text)
  }
}

/** 像一段目标语言的概括，且不是原文照抄 */
export function looksLikeDigest(text: string, context: string, lang: TargetLang): boolean {
  return inTargetScript(text, lang) && !echoesContext(text, context)
}
