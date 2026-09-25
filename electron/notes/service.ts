/**
 * 笔记服务 [P6]：每篇一个 Markdown 文件，锚点在 front-matter。
 * 文件名从标题导出（rasr-2025.md 风格），放同步盘即完成共享——没有共享界面。
 */
import { uiText } from '../i18n'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type Database from 'better-sqlite3'
import { getBlocks, getPaper, type BlockRow } from '../db'
import { hammingDistance, relocateBlock, RELOCATE_THRESHOLD } from '../docengine/anchor'
import {
  addHighlight as addHighlightToFile,
  appendNote,
  listEntries,
  newNotesFile,
  parseNotesFile,
  removeHighlight as removeHighlightFromFile,
  serializeNotesFile,
  type NoteAnchorMeta,
  type NotesFile,
  removeNote as removeNoteFromFile
} from './note-file'
import type { NoteView, PaperNotes } from '../../shared/models'

const LIGATURES: Record<string, string> = {
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬀ': 'ff',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
  'ﬅ': 'ft',
  'ﬆ': 'st'
}

/**
 * 归一化 + 索引映射：丢弃空白与连字符（跨行断词 "signifi-\ncantly"）、展开合字，
 * map[i] = 归一化串第 i 个字符在原串中的下标。连字符对两侧一致丢弃，匹配不受影响。
 */
function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (/\s/.test(ch) || ch === '-') continue
    for (const c of LIGATURES[ch] ?? ch) {
      norm += c
      map.push(i)
    }
  }
  return { norm, map }
}

/**
 * 在块文本中定位选区：精确匹配 → 空白弹性正则 → 归一化匹配（空白/连字符/合字差异）
 * → 首尾锚定（选区中间混入公式等噪音时按头尾各 24 字定位范围）。返回 [start, end] 或 null。
 */
export function locateSelectionRange(
  blockText: string,
  selection: string
): [number, number] | null {
  const exact = blockText.indexOf(selection)
  if (exact >= 0) return [exact, exact + selection.length]
  const parts = selection.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  try {
    const pattern = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
    const m = new RegExp(pattern).exec(blockText)
    if (m) return [m.index, m.index + m[0].length]
  } catch {
    /* 正则失败视为未命中 */
  }

  const b = normalizeWithMap(blockText)
  const s = normalizeWithMap(selection)
  if (s.norm.length >= 4) {
    const i = b.norm.indexOf(s.norm)
    if (i >= 0) return [b.map[i], b.map[i + s.norm.length - 1] + 1]

    // 首尾锚定：文本层选区中间（甚至首尾附近）可能夹带公式/上下标碎片，
    // 前后缀逐级缩短（24→16→10）提高命中率
    if (s.norm.length > 48) {
      let hi = -1
      for (const len of [24, 16, 10]) {
        hi = b.norm.indexOf(s.norm.slice(0, len))
        if (hi >= 0) break
      }
      if (hi >= 0) {
        for (const len of [24, 16, 10]) {
          const ti = b.norm.indexOf(s.norm.slice(-len), hi + 10)
          // 命中范围离谱（超过选区长度 3 倍）视为误匹配
          if (ti >= 0 && ti + len - hi <= s.norm.length * 3) {
            return [b.map[hi], b.map[ti + len - 1] + 1]
          }
        }
      }
    }
  }
  return null
}

/** 提取翻译中原样保留的词元：拉丁词（≥3 字母）与数字。 */
function sharedTokens(s: string): string[] {
  return [...new Set(s.match(/[A-Za-z][A-Za-z-]{2,}|\d+(?:\.\d+)?%?/g) ?? [])]
}

/**
 * 笔记落盘失败 → 用户能看懂的一句话。
 * 不包一层的话，界面上会出现 `permission denied, open '/Users/xxx/Documents/…md'`
 * 这种原始报错——笔记是 [P6] 的核心承诺，出问题时更要说清楚发生了什么、怎么办。
 */
export function friendlyNoteError(err: unknown, dir: string): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/EACCES|EPERM|permission denied|EROFS|read-only/i.test(msg))
    return uiText('notes.permission', { dir })
  if (/ENOSPC|no space left/i.test(msg)) return uiText('notes.disk')
  if (/ENOENT|no such file/i.test(msg)) return uiText('notes.missing', { dir })
  return uiText('notes.failed', { detail: msg })
}

/** 包一层写盘：所有笔记文件的写入都走这里，报错统一中文化。 */
function writeNotesFile(path: string, dir: string, content: string): void {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, content, 'utf8')
  } catch (err) {
    // 挂上 cause：友好文案给用户看，原始异常留给排查
    throw new Error(friendlyNoteError(err, dir), { cause: err })
  }
}

/**
 * 共享词元锚定：中文选区里的 "BLEU"/"41.8"/"Transformer" 在英文原文中原样存在。
 * 每个词元取离 center（按占比投影的中点）最近的出现位置，min..max 即为区间。
 */
export function rangeFromSharedTokens(
  blockText: string,
  selection: string,
  center: number
): [number, number] | null {
  const toks = sharedTokens(selection)
  if (toks.length === 0) return null
  let min = -1
  let max = -1
  for (const t of toks) {
    let best = -1
    let from = 0
    for (;;) {
      const i = blockText.indexOf(t, from)
      if (i < 0) break
      if (best < 0 || Math.abs(i - center) < Math.abs(best - center)) best = i
      from = i + 1
    }
    if (best < 0) continue
    if (min < 0 || best < min) min = best
    if (best + t.length > max) max = best + t.length
  }
  if (min < 0) return null
  return [min, max]
}

export function noteFileName(title: string | null, year: number | null, paperId: string): string {
  const base = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const slug = base || paperId.slice(0, 8)
  return year ? `${slug}-${year}.md` : `${slug}.md`
}

/**
 * 这篇论文的笔记文件路径。文件名由标题生成，但标题会变（后台版面识别换上模型标题、
 * 搜索元数据补全），按新标题找不到文件时，按 front-matter 里的 `paper:` 找回原文件，
 * 继续读写它，不另起一份空笔记 [P6]。
 */
function notesPath(dir: string, paper: { id: string; title: string | null; year: number | null }): string {
  const canonical = join(dir, noteFileName(paper.title, paper.year, paper.id))
  if (existsSync(canonical) || !existsSync(dir)) return canonical
  const marker = new RegExp(`^paper:\\s*['"]?${paper.id}['"]?\\s*$`, 'm')
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    try {
      const head = readFileSync(join(dir, name), 'utf8').slice(0, 600)
      if (head.startsWith('---') && marker.test(head)) return join(dir, name)
    } catch {
      /* 读不了的文件跳过 */
    }
  }
  return canonical
}

function loadFile(path: string, paperId: string, title: string): NotesFile {
  if (!existsSync(path)) return newNotesFile(paperId, title)
  return parseNotesFile(readFileSync(path, 'utf8'))
}

export function notesForPaper(db: Database.Database, dir: string, paperId: string): PaperNotes {
  const paper = getPaper(db, paperId)
  if (!paper) return { file: '', entries: [], highlights: {} }
  const path = notesPath(dir, paper)
  const file = basename(path)
  if (!existsSync(path)) return { file, entries: [], highlights: {} }

  const parsed = parseNotesFile(readFileSync(path, 'utf8'))
  const resolve = anchorResolver(db, paperId)
  const entries: NoteView[] = listEntries(parsed)
    .map((e) => ({
      anchorId: e.anchorId,
      stamp: e.stamp,
      text: e.text,
      anchor: resolve(parsed.meta.anchors[e.anchorId] ?? null)
    }))
    .reverse() // 倒序：最新在前
  const highlights: typeof parsed.meta.highlights = {}
  for (const [id, a] of Object.entries(parsed.meta.highlights)) {
    const r = resolve(a)
    if (r) highlights[id] = r
  }
  return { file, entries, highlights }
}

/**
 * 锚点重定位 [P6]：块 id 是「内容哈希:页:序号」，解析器一升级序号就偏移，
 * 老笔记指向的 block_id 便不复存在——笔记还在，却再也跳不回原文那一段。
 *
 * 读取时按内容指纹把锚点找回来（`relocateBlock`：归一化全等优先，否则取
 * simhash 汉明距离最近且在阈值内者；找不到就原样返回，宁可显示「未定位」
 * 也不错挂到别的段落）。只在内存里换算，不回写笔记文件——笔记是用户的文件，
 * 读一次改一次不合适；下次写笔记时自然会带上新锚点。
 */
function anchorResolver(
  db: Database.Database,
  paperId: string
): (a: NoteAnchorMeta | null) => NoteAnchorMeta | null {
  let blocks: BlockRow[] | null = null
  let byId: Map<string, BlockRow> | null = null
  return (a) => {
    if (!a) return null
    if (!blocks || !byId) {
      blocks = getBlocks(db, paperId)
      byId = new Map(blocks.map((b) => [b.block_id, b]))
    }
    // 块 id 还在不代表还是那一段：后台版面识别会把同一个「页:序号」换成别的段落，
    // 所以内容也得对得上（指纹相近，或段落里能找到当时选中的文字）才原样信任
    const live = byId.get(a.block_id)
    if (live && (hammingDistance(live.simhash, a.simhash) <= RELOCATE_THRESHOLD || locateSelectionRange(live.text, a.excerpt))) return a
    // 先按选中文字找（高亮的 excerpt 就是选区原文，能顺带算出新的字符范围），再按指纹找
    if (a.excerpt.trim().length >= 12) {
      for (const b of blocks) {
        const range = locateSelectionRange(b.text, a.excerpt)
        if (!range) continue
        // 整段锚点的 excerpt 只存了前 160 字，范围按新段落整段算
        const whole = a.char_end - a.char_start > a.excerpt.length
        return { ...a, block_id: b.block_id, char_start: whole ? 0 : range[0], char_end: whole ? b.text.length : range[1], simhash: b.simhash }
      }
    }
    const hit = relocateBlock(
      { text_simhash: a.simhash, text: a.excerpt },
      blocks.map((b) => ({ block_id: b.block_id, text: b.text, simhash: b.simhash }))
    )
    if (hit) return { ...a, block_id: hit.block_id }
    // 原 id 已指向别的段落又找不回：宁可显示未定位，也不挂错段落
    return live ? null : a
  }
}

function mutateFile(
  db: Database.Database,
  dir: string,
  paperId: string,
  mutate: (file: NotesFile) => NotesFile
): void {
  const paper = getPaper(db, paperId)
  if (!paper) throw new Error('paper not found')
  const path = notesPath(dir, paper)
  const current = loadFile(path, paperId, paper.title ?? '')
  writeNotesFile(path, dir, serializeNotesFile(mutate(current)))
}

/** 高亮 [P6]：马克笔不是链接——渲染用 --mark，落盘进 front-matter。
 *  字符定位失败（跨行连字/跨段选区）不报错：退回整块范围，
 *  视觉精度由 rects（创建时记录的选区矩形）保证。 */
export function addHighlight(
  db: Database.Database,
  dir: string,
  paperId: string,
  blockId: string,
  selection: string,
  rects?: [number, number, number, number, number][],
  /** 渲染进程算好的原文区间（译文选区按占比反投影）；文本定位失败时优先于整块兜底 */
  hintRange?: [number, number]
): { id: string; anchor: NoteAnchorMeta } {
  const block = getBlocks(db, paperId).find((b) => b.block_id === blockId)
  if (!block) throw new Error('block not found')
  const clamp = (n: number): number => Math.max(0, Math.min(n, block.text.length))
  const hinted: [number, number] | null =
    hintRange && hintRange[1] > hintRange[0] ? [clamp(hintRange[0]), clamp(hintRange[1])] : null
  // 词元锚定：中文选区里的数字/术语在原文中原样存在，比纯占比投影准
  const tokenRange = hinted
    ? rangeFromSharedTokens(block.text, selection, (hinted[0] + hinted[1]) / 2)
    : null
  const range =
    locateSelectionRange(block.text, selection) ?? tokenRange ?? hinted ?? [0, block.text.length]
  const anchor: NoteAnchorMeta = {
    block_id: blockId,
    char_start: range[0],
    char_end: range[1],
    simhash: block.simhash,
    excerpt: selection.slice(0, 160),
    ...(rects && rects.length > 0 ? { rects } : {})
  }
  let id = ''
  mutateFile(db, dir, paperId, (file) => {
    const out = addHighlightToFile(file, anchor)
    id = out.id
    return out.file
  })
  return { id, anchor }
}

export function removeHighlight(
  db: Database.Database,
  dir: string,
  paperId: string,
  id: string
): void {
  mutateFile(db, dir, paperId, (file) => removeHighlightFromFile(file, id))
}

export function removeNote(
  db: Database.Database,
  dir: string,
  paperId: string,
  anchorId: string
): void {
  mutateFile(db, dir, paperId, (file) => removeNoteFromFile(file, anchorId))
}

export function addNote(
  db: Database.Database,
  dir: string,
  paperId: string,
  blockId: string,
  text: string,
  selection?: string
): NoteView {
  // 空白笔记不落盘：否则文件里堆出一节节空条目
  if (!text.trim()) throw new Error(uiText('notes.empty'))
  const paper = getPaper(db, paperId)
  if (!paper) throw new Error('paper not found')
  const block = getBlocks(db, paperId).find((b) => b.block_id === blockId)
  if (!block) throw new Error('block not found')

  // 选区锚点：字符偏移 + 选区摘录；找不到（跨段选择等）退回整段
  const range = selection ? locateSelectionRange(block.text, selection) : null
  const anchor: NoteAnchorMeta =
    selection && range
      ? {
          block_id: block.block_id,
          char_start: range[0],
          char_end: range[1],
          simhash: block.simhash,
          excerpt: selection.slice(0, 160)
        }
      : {
          block_id: block.block_id,
          char_start: 0,
          char_end: block.text.length,
          simhash: block.simhash,
          excerpt: block.text.slice(0, 160)
        }

  const path = notesPath(dir, paper)
  const current = loadFile(path, paperId, paper.title ?? '')
  const { file: next, anchorId } = appendNote(current, anchor, text)
  writeNotesFile(path, dir, serializeNotesFile(next))

  return {
    anchorId,
    stamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
    text,
    anchor
  }
}
