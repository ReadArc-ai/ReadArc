/**
 * 流式视图的高亮：用 CSS Custom Highlight API 画，不改 DOM。
 * 这里的正文一半由 React 渲染、一半是 RawHtml 写进去的 arXiv HTML，段落还按需挂载、译文不断到达，
 * 往里面插 <mark> 会和两边都打架；Range 只引用现有文字节点，内容变了重新算一遍即可。
 *
 * 定位靠选中时存下的文字（去掉空白后比较，换行、公式间距不影响）；对不上时（比如只看译文时的英文高亮）
 * 才按字符占比投影到译文，再向句读对齐，和镜像页同一套办法。
 */
import { useEffect, type RefObject } from 'react'
import type { BlockRow, NoteAnchorView } from '../../../shared/models'
import { useNotes } from '../../store/notes'
import { useT } from '../../i18n'
import { rangeFromTokens, sharedTokens, snapToSentenceEnd, snapToSentenceStart } from './page-text'

const HIGHLIGHT_NAME = 'readarc-flow'
/** 比较时忽略的字符：空白，以及 MathML 里的不可见运算符 */
const IGNORED = new RegExp('[\\s\\u200b-\\u200d\\u2060-\\u2064\\ufeff]')
/** 一段高亮可以跨几块（选区跨段时）：从锚点所在块往后看这么多块 */
const SCOPE_BLOCKS = 8
/** 全文兜底只接受够长的文字，短词到处都有，容易标错地方 */
const MIN_DOC_MATCH = 12

interface TextRun {
  node: Text
  start: number
  /** 去空白后第 k 个字符在节点里的偏移 */
  offsets: number[]
}

export interface TextIndex {
  text: string
  runs: TextRun[]
}

export function compactForMatch(s: string): string {
  let out = ''
  for (const ch of s) if (!IGNORED.test(ch)) out += ch
  return out
}

/** 把若干元素的文字（按 DOM 顺序、去掉空白）接成一串，并记住每个字符来自哪个节点 */
export function buildTextIndex(elements: Element[]): TextIndex {
  const runs: TextRun[] = []
  let text = ''
  for (const el of elements) {
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      // 公式的 TeX 源码（annotation）不显示，也选不中
      if (n.parentElement?.closest('annotation, annotation-xml, script, style')) continue
      const raw = n.data
      const offsets: number[] = []
      let piece = ''
      for (let i = 0; i < raw.length; i++) {
        if (IGNORED.test(raw[i])) continue
        piece += raw[i]
        offsets.push(i)
      }
      if (!piece) continue
      runs.push({ node: n, start: text.length, offsets })
      text += piece
    }
  }
  return { text, runs }
}

/** 所有出现位置里离 expected 最近的一个（同一个词在一段里出现多次时不至于总标第一个） */
export function nearestOccurrence(text: string, needle: string, expected: number): number {
  let best = -1
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    if (best < 0 || Math.abs(i - expected) < Math.abs(best - expected)) best = i
  }
  return best
}

function rangeOf(index: TextIndex, start: number, end: number, doc: Document): Range | null {
  if (end <= start) return null
  const at = (pos: number): TextRun | undefined => index.runs.find((r) => pos >= r.start && pos < r.start + r.offsets.length)
  const a = at(start)
  const b = at(end - 1)
  if (!a || !b) return null
  const range = doc.createRange()
  range.setStart(a.node, a.offsets[start - a.start])
  range.setEnd(b.node, b.offsets[end - 1 - b.start] + 1)
  return range
}

/** 对不上文字时的投影：优先译文，按字符占比，再向句读对齐 */
function projectedRange(el: Element, anchor: NoteAnchorView, block: BlockRow): Range | null {
  const container = el.querySelector('.flow-trans, .flow-h-trans') ?? el
  const index = buildTextIndex([container])
  const n = index.text.length
  if (n === 0) return null
  const srcLen = block.text.length || 1
  const center = (((anchor.char_start + anchor.char_end) / 2) / srcLen) * n
  const tok = rangeFromTokens(index.text, sharedTokens(block.text.slice(anchor.char_start, anchor.char_end)), center)
  const start = snapToSentenceStart(index.text, tok ? tok[0] : Math.floor((anchor.char_start / srcLen) * n))
  const end = snapToSentenceEnd(index.text, tok ? tok[1] : Math.ceil((anchor.char_end / srcLen) * n))
  return rangeOf(index, start, Math.min(end, n), el.ownerDocument)
}

interface Painted {
  id: string
  range: Range
}

function computeRanges(root: Element, highlights: Record<string, NoteAnchorView>, blocks: BlockRow[]): Painted[] {
  const blockEls = [...root.querySelectorAll<HTMLElement>('.flow-block')]
  const firstByOrder = new Map<string, number>()
  blockEls.forEach((el, i) => {
    for (const o of (el.dataset.orders ?? el.dataset.order ?? '').split(' ')) if (o && !firstByOrder.has(o)) firstByOrder.set(o, i)
  })
  const byId = new Map(blocks.map((b) => [b.block_id, b]))
  let docIndex: TextIndex | null = null
  const out: Painted[] = []
  for (const [id, anchor] of Object.entries(highlights)) {
    const block = byId.get(anchor.block_id)
    const at = block ? firstByOrder.get(String(block.block_order)) : undefined
    const needle = compactForMatch(anchor.quote ?? anchor.excerpt)
    let range: Range | null = null
    if (needle && at !== undefined && block) {
      const index = buildTextIndex(blockEls.slice(at, at + SCOPE_BLOCKS))
      const head = blockEls[at].querySelector('.flow-orig, .flow-h-orig') ?? blockEls[at]
      const expected = (anchor.char_start / (block.text.length || 1)) * compactForMatch(head.textContent ?? '').length
      const hit = nearestOccurrence(index.text, needle, expected)
      if (hit >= 0) range = rangeOf(index, hit, hit + needle.length, root.ownerDocument)
    }
    if (!range && needle.length >= MIN_DOC_MATCH) {
      docIndex ??= buildTextIndex(blockEls)
      const hit = docIndex.text.indexOf(needle)
      if (hit >= 0) range = rangeOf(docIndex, hit, hit + needle.length, root.ownerDocument)
    }
    if (!range && at !== undefined && block) range = projectedRange(blockEls[at], anchor, block)
    if (range) out.push({ id, range })
  }
  return out
}

/** 点到的是哪条高亮 */
function hitTest(painted: Painted[], x: number, y: number): string | null {
  for (const { id, range } of painted) {
    for (const r of range.getClientRects()) {
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id
    }
  }
  return null
}

export function useFlowHighlights(rootRef: RefObject<HTMLElement | null>, paperId: string | undefined, blocks: BlockRow[] | undefined): void {
  const t = useT()
  const highlights = useNotes((s) => (paperId ? s.byPaper[paperId]?.highlights : undefined))
  const removeTip = t('sel.remove-highlight')

  // 原版页视图加载过笔记，直接进流式视图的要自己取一次
  useEffect(() => {
    if (paperId) void useNotes.getState().load(paperId)
  }, [paperId])

  useEffect(() => {
    const root = rootRef.current
    if (!root || !highlights || !blocks || typeof Highlight === 'undefined') return
    let painted: Painted[] = []
    const paint = (): void => {
      painted = computeRanges(root, highlights, blocks)
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...painted.map((p) => p.range)))
    }
    paint()
    // 段落按需挂载、译文陆续到达：内容一变就重算（放到一起算，翻译进度事件很密）
    let timer: ReturnType<typeof setTimeout> | null = null
    const observer = new MutationObserver(() => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        paint()
      }, 200)
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true })

    // 和镜像页一样点一下移除（有撤销提示）。Highlight 没有元素，靠坐标判断
    const onClick = (e: MouseEvent): void => {
      if (!window.getSelection()?.isCollapsed) return
      if ((e.target as Element).closest?.('a, button')) return
      const id = hitTest(painted, e.clientX, e.clientY)
      if (id) void useNotes.getState().removeHighlight(id)
    }
    let hover = false
    const onMove = (e: MouseEvent): void => {
      const over = !e.buttons && hitTest(painted, e.clientX, e.clientY) !== null
      if (over === hover) return
      hover = over
      root.style.cursor = over ? 'pointer' : ''
      root.title = over ? removeTip : ''
    }
    root.addEventListener('click', onClick)
    root.addEventListener('mousemove', onMove)
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
      root.removeEventListener('click', onClick)
      root.removeEventListener('mousemove', onMove)
      root.style.cursor = ''
      root.title = ''
      CSS.highlights.delete(HIGHLIGHT_NAME)
    }
  }, [rootRef, highlights, blocks, removeTip])
}
