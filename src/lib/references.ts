import type { BlockRow } from '../../shared/models'

const REF_SECTION = /reference|bibliograph|参考文献/i
const AUTHOR_TITLE_BREAK = /(?<=[\p{L}\p{M}]{2})[.。](?:\s+|$)/u

function words(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}'’-]+/gu) ?? []
}

/** 作者年份引用只匹配第一作者；合作者或正文里再次出现的引用不是目标。 */
export function findReference(cite: string, blocks: BlockRow[]): BlockRow | undefined {
  const match = /^([\p{L}'’-]+)[\s\S]*?\b(\d{4})([a-z]?)\b/u.exec(cite)
  if (!match) return undefined
  const [, surname, year, suffix] = match
  const author = words(surname).join(' ')
  const refs = blocks.filter((b) => b.kind === 'para' && REF_SECTION.test(b.section ?? ''))
  // 老的解析结果可能没有 section，但保留了参考文献标题。
  const heading = blocks.find((b) => b.kind === 'heading' && REF_SECTION.test(b.text))
  const pool = refs.length ? refs : heading
    ? blocks.filter((b) => b.kind === 'para' && b.block_order > heading.block_order)
    : []
  const candidates = pool.filter((b) => {
    const text = b.text.replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/, '')
    // 单作者条目用句号分隔作者与标题；J. / S. 等名字缩写的句号不能截断。
    const firstAuthor = text.split(AUTHOR_TITLE_BREAK)[0].split(/[,，;]|\s+(?:and|&)\s+/)[0]
    const name = words(firstAuthor)
    if (name.at(-1) !== author || name.length > 6) return false
    const years = [...text.matchAll(/\b(\d{4})([a-z]?)\b/g)]
    return years.some((y) => y[1] === year && y[2] === suffix)
  })
  if (candidates.length === 1) return candidates[0]
  // 同一第一作者同年同时有双作者和多人作品时，用引用里保留的作者信息区分。
  const secondAuthor = /\s+(?:and|&)\s+([\p{L}'’-]+)/u.exec(cite)?.[1]
  const narrowed = candidates.filter((b) => {
    const authorList = b.text.split(AUTHOR_TITLE_BREAK)[0]
    const authors = authorList.split(/[,，;]|\s+(?:and|&)\s+/)
      .map((name) => words(name.replace(/^\s*and\s+/, '')).at(-1)).filter(Boolean)
    if (secondAuthor) return authors.length === 2 && authors[1] === words(secondAuthor).join(' ')
    return /\bet al\./.test(cite) && authors.length >= 3
  })
  // 仍有歧义时，不随意跳到其中一篇。
  return narrowed.length === 1 ? narrowed[0] : undefined
}
