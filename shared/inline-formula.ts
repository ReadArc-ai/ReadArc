/**
 * 行内公式占位符。
 * 版面模型标出的 inline_formula 区域在建段时换成 ⟦fN⟧，公式本身按原版截图嵌回译文；
 * 文本层里的数学字符（花体、帽子、上下标）经翻译后几乎必然错位，截图是唯一忠实的呈现。
 * 占位符只带序号：翻译模型照抄即可，渲染端按「块 id:fN」取图。
 */

export interface InlineFormula {
  /** 占位符序号（从 1 起，块内唯一） */
  n: number
  /** 截图框，PDF 用户空间 [x, y, w, h]（y 向上，与 BlockRow.bbox 同构） */
  bbox: [number, number, number, number]
  /** 所在行主基线的 y（pt）：渲染时据此把截图底边对齐到文字基线 */
  base: number
  /** 文本层原文（供对话上下文、摘要等还原成可读文本） */
  text: string
}

export function inlinePlaceholder(n: number): string {
  return `⟦f${n}⟧`
}

/** 截图文件键：块 id 后接 :fN，与 figureFileName / figureGet 的校验一致 */
export function inlineFigureKey(blockId: string, n: number): string {
  return `${blockId}:f${n}`
}

/**
 * 占位符匹配：模型偶尔把 ⟦⟧ 换成 [[ ]]、【】或普通方括号，序号才是要紧的，括号形态放宽。
 * 用前记得重置 lastIndex（全局正则）或用 matchAll。
 */
export const INLINE_PLACEHOLDER_RE = /(?:⟦|\[\[|\[|【)\s*f(\d{1,3})\s*(?:⟧|\]\]|\]|】)/g

export function hasInlinePlaceholder(text: string): boolean {
  INLINE_PLACEHOLDER_RE.lastIndex = 0
  const hit = INLINE_PLACEHOLDER_RE.test(text)
  // 全局正则 test 命中后 lastIndex 停在匹配末尾，matchAll 会从那里接着找，第一个占位符就丢了
  INLINE_PLACEHOLDER_RE.lastIndex = 0
  return hit
}

export function parseInlines(json: string | null | undefined): InlineFormula[] {
  if (!json) return []
  try {
    const v = JSON.parse(json) as unknown
    return Array.isArray(v) ? (v as InlineFormula[]) : []
  } catch {
    return []
  }
}

/** 把占位符换回文本层原文（给模型读、给检索用）；没有对应记录的占位符去掉 */
export function restoreInlines(text: string, inlines: InlineFormula[] | string | null | undefined): string {
  if (!hasInlinePlaceholder(text)) return text
  const list = typeof inlines === 'string' || inlines == null ? parseInlines(inlines) : inlines
  const byN = new Map(list.map((f) => [f.n, f.text]))
  return text.replace(INLINE_PLACEHOLDER_RE, (_m, n: string) => byN.get(Number(n)) ?? '')
}

/** 文本里出现的占位符序号（去重、升序） */
export function placeholderNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(INLINE_PLACEHOLDER_RE)].map((m) => Number(m[1])))].sort((a, b) => a - b)
}

/** 译文的占位符和原文一一对应：一个不少、也没有模型编出来的 */
export function placeholdersMatch(src: string, out: string): boolean {
  return placeholderNumbers(src).join(',') === placeholderNumbers(out).join(',')
}

/**
 * 重试后仍对不上时的兜底：去掉原文没有的序号（模型编的），缺的按序号补在句末。
 * 公式宁可挪个位置，也不能从译文里消失，或在页面上露出一串「⟦f6⟧」。
 */
export function repairPlaceholders(src: string, out: string): string {
  const want = new Set(placeholderNumbers(src))
  let fixed = out.replace(INLINE_PLACEHOLDER_RE, (m, n: string) => (want.has(Number(n)) ? m : ''))
  const have = new Set(placeholderNumbers(fixed))
  const missing = [...want].filter((n) => !have.has(n))
  if (missing.length > 0) {
    const tail = /[。．.！!？?]\s*$/.exec(fixed)
    const add = missing.map(inlinePlaceholder).join(' ')
    fixed = tail ? `${fixed.slice(0, tail.index)} ${add}${fixed.slice(tail.index)}` : `${fixed} ${add}`
  }
  return fixed.replace(/\s{2,}/g, ' ').trim()
}
