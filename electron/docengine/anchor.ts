/**
 * 段落级稳定锚点 [P6]——整个产品的地基。
 *
 *   block_id = sha1(file_content_hash) + ":" + page + ":" + block_order
 *   锚点     = { block_id, char_start, char_end, bbox, text_simhash }
 *
 * 用内容哈希而非路径：文件改名/移动不丢锚点。
 * 额外存文本 simhash：版面解析器升级后块的切分会变，靠 simhash 近邻重新定位老笔记。
 */
import { createHash } from 'node:crypto'

export interface BlockAnchor {
  block_id: string
  char_start: number
  char_end: number
  bbox?: [number, number, number, number]
  /** 64 位 simhash，16 位十六进制 */
  text_simhash: string
}

export interface AnchorCandidate {
  block_id: string
  text: string
  simhash?: string
}

export function sha1(data: Buffer | string): string {
  return createHash('sha1').update(data).digest('hex')
}

export function blockId(fileHash: string, page: number, order: number): string {
  return `${fileHash}:${page}:${order}`
}

/** 归一化：小写、压空白——解析器升级带来的空白差异不该动摇锚点。 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * 特征切分：拉丁/数字按词，CJK 按单字；特征 = 词元 + 相邻词元对。
 * 字符 n-gram 在英文里共享度太高（无关段落距离仅 ~10），词级特征把无关距离拉到 ~30。
 * 切分前先合并 PDF 换行断词（"aug- mented" → "augmented"）——这是解析器升级最典型的扰动。
 */
function tokenize(text: string): string[] {
  const dehyphenated = text.replace(/([a-zA-Z])-\s+([a-zA-Z])/g, '$1$2')
  const matches = dehyphenated.toLowerCase().match(/[a-z0-9]+|[一-鿿㐀-䶿]/g)
  return matches ?? []
}

function features(text: string): string[] {
  const tokens = tokenize(text)
  const feats = [...tokens]
  for (let i = 0; i < tokens.length - 1; i++) {
    feats.push(tokens[i] + ' ' + tokens[i + 1])
  }
  return feats
}

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK64 = 0xffffffffffffffffn

function fnv1a64(s: string): bigint {
  let h = FNV_OFFSET
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i))
    h = (h * FNV_PRIME) & MASK64
  }
  return h
}

/** 64 位 simhash：词级特征（词元 + 相邻对），FNV-1a 加权投票。 */
export function simhash64(text: string): string {
  const feats = features(text)
  if (feats.length === 0) return '0'.repeat(16)
  const weights = new Array<number>(64).fill(0)
  for (const f of feats) {
    const h = fnv1a64(f)
    for (let bit = 0; bit < 64; bit++) {
      weights[bit] += (h >> BigInt(bit)) & 1n ? 1 : -1
    }
  }
  let out = 0n
  for (let bit = 0; bit < 64; bit++) {
    if (weights[bit] > 0) out |= 1n << BigInt(bit)
  }
  return out.toString(16).padStart(16, '0')
}

export function hammingDistance(aHex: string, bHex: string): number {
  let x = BigInt('0x' + aHex) ^ BigInt('0x' + bHex)
  let count = 0
  while (x) {
    count += Number(x & 1n)
    x >>= 1n
  }
  return count
}

/** 重定位阈值：≤ 12/64 位视为同一段落（经验值，回归集建立后再校准）。 */
export const RELOCATE_THRESHOLD = 12

/**
 * 在新一轮解析产出的块里找回老锚点指向的段落。
 * 归一化全等直接命中；否则取 simhash 汉明距离最近且 ≤ 阈值者。找不到返回 null——
 * 宁可让笔记显示「未定位」，也不错挂到别的段落上。
 */
export function relocateBlock(
  anchor: { text_simhash: string; text?: string },
  candidates: AnchorCandidate[]
): AnchorCandidate | null {
  if (anchor.text) {
    const target = normalize(anchor.text)
    const exact = candidates.find((c) => normalize(c.text) === target)
    if (exact) return exact
  }
  let best: AnchorCandidate | null = null
  let bestDist = RELOCATE_THRESHOLD + 1
  for (const c of candidates) {
    const dist = hammingDistance(anchor.text_simhash, c.simhash ?? simhash64(c.text))
    if (dist < bestDist) {
      bestDist = dist
      best = c
    }
  }
  return best
}
