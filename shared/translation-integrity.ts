import { INLINE_PLACEHOLDER_RE } from './inline-formula'

/**
 * 上标 ^…^ / 下标 ~…~ 标记（版面解析产出）。内容不含空白：原文里普通的波浪号
 * （「~10% and ~20%」这类约数写法）不能被当成一个下标，否则这段怎么译都对不上。
 */
const SCRIPT_MARK_RE = /\^([^\s^~]{1,16})\^|~([^\s~^]{1,16})~/g

function scriptMarks(text: string): string[] {
  return [...text.matchAll(new RegExp(SCRIPT_MARK_RE.source, 'g'))].map((m) => m[0])
}

/** 允许翻译调整语序，但公式、上下标与脚注标号的值和出现次数必须一一对应。 */
export function preservesInlineContent(source: string, translated: string): boolean {
  const tokens = (text: string): string[] => [
    ...text.matchAll(new RegExp(INLINE_PLACEHOLDER_RE.source, 'g'))
  ].map((m) => `formula:${Number(m[1])}`).concat(scriptMarks(text)).sort()
  const expected = tokens(source)
  const actual = tokens(translated)
  return expected.length === actual.length && expected.every((token, i) => token === actual[i])
}

/** 原文的上下标标记原样列出（重试时点名给模型） */
export function scriptMarkList(text: string): string[] {
  return scriptMarks(text)
}

/**
 * 重试后上下标仍对不上时的兜底，与公式占位符的修补同理：
 * 原文没有的标记去掉标记、保留内容（模型多包的），缺的按原样补在句末（多为脚注标号）。
 * 标号宁可挪个位置，也不能让整段因此留在原文。
 */
export function repairScriptMarks(source: string, translated: string): string {
  const want = new Map<string, number>()
  for (const m of scriptMarks(source)) want.set(m, (want.get(m) ?? 0) + 1)
  let fixed = translated.replace(new RegExp(SCRIPT_MARK_RE.source, 'g'), (m, sup?: string, sub?: string) => {
    const left = want.get(m) ?? 0
    if (left > 0) {
      want.set(m, left - 1)
      return m
    }
    return sup ?? sub ?? ''
  })
  const missing = [...want.entries()].flatMap(([m, n]) => Array<string>(n).fill(m))
  if (missing.length === 0) return fixed
  const tail = /[。．.！!？?]\s*$/.exec(fixed)
  const marks = missing.join('')
  fixed = tail ? fixed.slice(0, tail.index) + marks + fixed.slice(tail.index) : fixed + marks
  return fixed
}
