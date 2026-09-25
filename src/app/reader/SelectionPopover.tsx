/** 选中文字后浮出的操作组：出现在选区上方，作用域是选区。 */
import { useNeedsTranslation } from '../../lib/paper-lang'
import { useEffect, useRef, useState, type JSX } from 'react'
import { useT } from '../../i18n'
import { useChat } from '../../store/chat'
import { useNotes } from '../../store/notes'
import { usePaper } from '../../store/paper'
import { useApp } from '../../store/app'

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * 原版页选区 → 块：几何命中优先（选区起点屏幕坐标 → PDF 坐标 → 块 bbox），
 * 与文本内容无关——跨行/断词/连字都不影响；文本包含匹配仅作兜底。
 */
function blockIdFromPageSelection(
  sel: Selection,
  text: string,
  pageEl: HTMLElement
): string | null {
  const page = Number(pageEl.dataset.page)
  const pw = Number(pageEl.dataset.pw)
  const ph = Number(pageEl.dataset.ph)
  const bundle = usePaper.getState().bundle
  if (!bundle || !Number.isFinite(page)) return null

  // ① 几何命中：取选区第一行矩形的中点
  if (Number.isFinite(pw) && Number.isFinite(ph) && sel.rangeCount > 0) {
    const rects = sel.getRangeAt(0).getClientRects()
    const first = rects[0]
    if (first && first.width > 0) {
      const pageRect = pageEl.getBoundingClientRect()
      const px = ((first.left + Math.min(first.width, 40) / 2 - pageRect.left) / pageRect.width) * pw
      const py = ph - ((first.top + first.height / 2 - pageRect.top) / pageRect.height) * ph
      const PAD = 4
      let best: { id: string; area: number } | null = null
      for (const b of bundle.blocks) {
        if (b.page !== page || !b.bbox) continue
        try {
          const [x, y, w, h] = JSON.parse(b.bbox) as [number, number, number, number]
          if (px >= x - PAD && px <= x + w + PAD && py >= y - PAD && py <= y + h + PAD) {
            const area = w * h
            if (!best || area < best.area) best = { id: b.block_id, area }
          }
        } catch {
          /* bbox 损坏跳过 */
        }
      }
      if (best) return best.id
    }
  }

  // ② 文本兜底
  const needle = collapse(text)
  if (needle.length < 2) return null
  const hit = bundle.blocks.find(
    (b) => b.page === page && b.kind !== 'figure' && collapse(b.text).includes(needle)
  )
  return hit?.block_id ?? null
}

const icon = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

function IconCopy(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...icon} aria-hidden>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </svg>
  )
}

function IconHighlight(): JSX.Element {
  // 荧光笔：斜笔身 + 笔尖楔形 + 底部高亮线
  return (
    <svg viewBox="0 0 16 16" {...icon} aria-hidden>
      <path d="M9.5 2.5l4 4-5.5 5.5-4-4 5.5-5.5Z" />
      <path d="M4 8l-1.5 3.5L6 10" />
      <path d="M3 14h10" />
    </svg>
  )
}

function IconAsk(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...icon} aria-hidden>
      <path d="M2.5 3.5h11v8h-6l-3 2.5v-2.5h-2v-8Z" />
    </svg>
  )
}

function IconNote(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...icon} aria-hidden>
      <path d="M4 2.5h8v11l-2.5-1.8L7 13.5l-3-1.8v-9.2Z" />
    </svg>
  )
}

function IconTranslate(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...icon} aria-hidden>
      <path d="M2.5 4h6M5.5 2.5V4M4 4c.4 2.6 2 4.8 4 6M7.5 4c-.6 2.8-2.4 5-4.5 6.4" />
      <path d="m9 13.5 2.5-6 2.5 6M10 11.7h3" />
    </svg>
  )
}

interface PopState {
  x: number
  y: number
  text: string
  blockId: string
  /** 选区矩形（PDF 坐标 [page, x, y, w, h]，y 向上）：高亮据此绘制与落盘 */
  rects?: [number, number, number, number, number][]
  /** 译文选区按占比反投影出的原文区间（后端文本定位必然失败时的锚点依据） */
  hintRange?: [number, number]
}

/**
 * 选区的屏幕矩形 → PDF 坐标矩形，按行合并（同一行的多个 span 片段并成一条）。
 * 高亮的视觉精度全靠这里——文本匹配只用于笔记锚点，不再决定高亮成败。
 */
function selectionRectsInPage(
  sel: Selection,
  pageEl: HTMLElement
): [number, number, number, number, number][] {
  const page = Number(pageEl.dataset.page)
  const pw = Number(pageEl.dataset.pw)
  const ph = Number(pageEl.dataset.ph)
  if (!Number.isFinite(page) || !Number.isFinite(pw) || !Number.isFinite(ph)) return []
  const pageRect = pageEl.getBoundingClientRect()
  if (pageRect.width <= 0 || pageRect.height <= 0) return []

  // 收集与本页相交的有面积矩形
  const raw: { left: number; right: number; top: number; bottom: number }[] = []
  for (let i = 0; i < sel.rangeCount; i++) {
    for (const r of sel.getRangeAt(i).getClientRects()) {
      if (r.width < 1 || r.height < 1) continue
      const left = Math.max(r.left, pageRect.left)
      const right = Math.min(r.right, pageRect.right)
      const top = Math.max(r.top, pageRect.top)
      const bottom = Math.min(r.bottom, pageRect.bottom)
      if (right - left < 1 || bottom - top < 1) continue
      raw.push({ left, right, top, bottom })
    }
  }
  // 按行合并：纵向重叠过半视为同一行
  raw.sort((a, b) => a.top - b.top || a.left - b.left)
  const lines: typeof raw = []
  for (const r of raw) {
    const last = lines[lines.length - 1]
    const overlap = last ? Math.min(last.bottom, r.bottom) - Math.max(last.top, r.top) : 0
    if (last && overlap > (r.bottom - r.top) / 2) {
      last.left = Math.min(last.left, r.left)
      last.right = Math.max(last.right, r.right)
      last.top = Math.min(last.top, r.top)
      last.bottom = Math.max(last.bottom, r.bottom)
    } else {
      lines.push({ ...r })
    }
  }
  const round = (n: number): number => Math.round(n * 100) / 100
  return lines.map((l) => {
    const x = ((l.left - pageRect.left) / pageRect.width) * pw
    const w = ((l.right - l.left) / pageRect.width) * pw
    const h = ((l.bottom - l.top) / pageRect.height) * ph
    // PDF y 向上：从底边换算
    const y = ph - ((l.bottom - pageRect.top) / pageRect.height) * ph
    return [page, round(x), round(y), round(w), round(h)]
  })
}

type TransState =
  | { status: 'loading'; text: string }
  | { status: 'ok'; text: string }
  | { status: 'err'; msg: string }

export function SelectionPopover({
  containerRef
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
}): JSX.Element | null {
  const t = useT()
  const needsTranslation = useNeedsTranslation()
  const [pop, setPop] = useState<PopState | null>(null)
  const [trans, setTrans] = useState<TransState | null>(null)

  // 连续划两段并各点翻译时，前一段的结果和流式增量会晚到：按请求编号只认最新一次
  const reqRef = useRef(0)
  const startTranslate = (text: string, dictOnly = false): void => {
    const id = ++reqRef.current
    setTrans({ status: 'loading', text: '' })
    // 流式增量：气泡随生成逐字增长（词典命中是同步返回，不走增量）
    const off = window.readarc.onTranslateTextDelta((delta, reqId) => {
      if (reqId !== id) return
      setTrans((s) => (s && s.status === 'loading' ? { status: 'loading', text: s.text + delta } : s))
    })
    window.readarc
      .translateText(text, dictOnly, id)
      .then((t) => {
        if (reqRef.current !== id) return
        // dictOnly 未命中：安静收起，等用户自己点「翻译」再花 token
        setTrans(t === null ? null : { status: 'ok', text: t })
      })
      .catch((err: unknown) => {
        if (reqRef.current !== id) return
        setTrans({ status: 'err', msg: err instanceof Error ? err.message : String(err) })
      })
      .finally(off)
  }

  useEffect(() => {
    const onMouseUp = (e: MouseEvent): void => {
      // 浮层内部的点击（翻译按钮等）不重建/关闭浮层
      if (e.target instanceof Element && e.target.closest('.selection-popover')) return
      // 等选区稳定后再取
      requestAnimationFrame(() => {
        const sel = window.getSelection()
        const text = sel?.toString().trim() ?? ''
        if (!sel || sel.isCollapsed || text.length < 2) {
          setPop(null)
          return
        }
        const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement
        const pageEl = node?.closest?.('.pdf-page') as HTMLElement | null
        const tpBlock = node?.closest?.('.tp-block') as HTMLElement | null
        let blockId: string | null = null
        let rects: [number, number, number, number, number][] | undefined
        let hintRange: [number, number] | undefined
        if (pageEl && containerRef.current?.contains(pageEl)) {
          // 原版页：几何命中（选区起点坐标 → 块 bbox）；同时记录选区矩形供高亮绘制
          blockId = blockIdFromPageSelection(sel, text, pageEl)
          rects = selectionRectsInPage(sel, pageEl)
        } else if (tpBlock && containerRef.current?.contains(tpBlock)) {
          // 镜像译文页：块元素自带 data-order；矩形同样采集（tp-page 与原版页同坐标系）
          const order = Number(tpBlock.dataset.order)
          blockId =
            usePaper.getState().bundle?.blocks.find((b) => b.block_order === order)?.block_id ??
            null
          // 不采集镜像几何矩形：译文版面位置画到英文页上必然错位，
          // 左页矩形改由字符区间在渲染时从文本层推导
          // 译文选区：中文在英文原文里定位必然失败——先在译文里定位，
          // 再按字符占比反投影回原文区间，随锚点落盘
          if (blockId) {
            const st = usePaper.getState()
            const zh = st.translations[blockId]?.text
            const srcLen = st.bundle?.blocks.find((b) => b.block_id === blockId)?.text.length ?? 0
            if (zh && srcLen > 0) {
              const idx = zh.indexOf(text)
              if (idx >= 0 && text.length < zh.length) {
                hintRange = [
                  Math.floor((idx / zh.length) * srcLen),
                  Math.min(srcLen, Math.ceil(((idx + text.length) / zh.length) * srcLen))
                ]
              }
            }
          }
        }
        if (!blockId) {
          setPop(null)
          return
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        setTrans(null)
        setPop({ x: rect.left + rect.width / 2, y: rect.top, text, blockId, rects, hintRange })
        // 双击选中单词 → 词典命中即弹释义（零延迟零成本，设置里可关）；
        // 词典没有的不自动请求 LLM——等用户自己点「翻译」，不浪费 token
        // 内置词典只有英译中：目标语言是英文时双击不弹释义
        if (useApp.getState().wordLookup && useApp.getState().targetLang === 'zh' && /^[A-Za-z][A-Za-z'-]{1,23}$/.test(text)) startTranslate(text, true)
      })
    }
    const onDown = (e: MouseEvent): void => {
      if (!(e.target instanceof Element) || !e.target.closest('.selection-popover')) {
        setPop(null)
        setTrans(null)
      }
    }
    // 滚动时收起浮窗与译文气泡（fixed 定位的浮层会盖住滚过来的文字）；
    // 气泡内部自身的滚动（长释义 overflow）不触发收起
    const onScroll = (e: Event): void => {
      if (e.target instanceof Element && e.target.closest('.selection-popover')) return
      setPop(null)
      setTrans(null)
    }
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [containerRef])

  if (!pop) return null

  const done = (): void => {
    setPop(null)
    window.getSelection()?.removeAllRanges()
  }

  // Edge 式：icon 常显，悬停浮出文字提示（data-tip 由 CSS 渲染，比原生 title 即时）
  return (
    <div
      className="selection-popover"
      style={{ left: pop.x, top: pop.y - 38 }}
      // 工具条经典处理：按下不夺焦点、不折叠文字选区
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        data-tip={t('sel.copy')}
        onClick={() => {
          void navigator.clipboard.writeText(pop.text)
          done()
        }}
      >
        <IconCopy />
      </button>
      <button
        data-tip={t('sel.highlight')}
        onClick={() => {
          void useNotes.getState().addHighlight(pop.blockId, pop.text, pop.rects, pop.hintRange)
          done()
        }}
      >
        <IconHighlight />
      </button>
      <button
        data-tip={t('sel.ask')}
        onClick={() => {
          useChat.getState().askAboutBlock(pop.text)
          done()
        }}
      >
        <IconAsk />
      </button>
      <button
        data-tip={t('sel.note')}
        onClick={() => {
          useNotes.getState().startNote(pop.blockId, pop.text)
          done()
        }}
      >
        <IconNote />
      </button>
      {needsTranslation && (
        <button
          data-tip={t('sel.translate')}
          onClick={() => startTranslate(pop.text)}
        >
          <IconTranslate />
        </button>
      )}
      {trans && (
        <div
          className={'sel-trans' + (pop.y < 220 ? ' sel-trans--below' : '')}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {trans.status === 'loading' &&
            (trans.text ? trans.text : <span className="sel-trans-dim">{t('sel.translating')}</span>)}
          {trans.status === 'ok' && trans.text}
          {trans.status === 'err' && <span className="sel-trans-dim">{trans.msg}</span>}
        </div>
      )}
    </div>
  )
}
