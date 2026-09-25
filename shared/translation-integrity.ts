import { INLINE_PLACEHOLDER_RE } from './inline-formula'

/** 允许翻译调整语序，但公式、上下标与脚注标号的值和出现次数必须一一对应。 */
export function preservesInlineContent(source: string, translated: string): boolean {
  const tokens = (text: string): string[] => [
    ...text.matchAll(new RegExp(INLINE_PLACEHOLDER_RE.source, 'g'))
  ].map((m) => `formula:${Number(m[1])}`).concat(
    [...text.matchAll(/\^([^\s^~]{1,16})\^|~([^~^]{1,16})~/g)]
      .map((m) => m[1] === undefined ? `sub:${m[2]}` : `sup:${m[1]}`)
  ).sort()
  const expected = tokens(source)
  const actual = tokens(translated)
  return expected.length === actual.length && expected.every((token, i) => token === actual[i])
}
