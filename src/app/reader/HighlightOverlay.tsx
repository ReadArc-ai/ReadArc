/** 原版页上的高亮层：按锚点矩形铺色块，点击可删 */
import { useEffect, useRef, useState, type JSX } from 'react'
import { useT } from '../../i18n'
import { usePaper } from '../../store/paper'
import { useNotes } from '../../store/notes'
import { normLen } from './page-text'
import { PageInfo } from './PdfPage'


export interface HlItem {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * 高亮覆盖层。矩形来源三级：
 * ① 创建时记录的选区矩形（原版页划的，精确）；
 * ② 无矩形（译文页划的）→ 渲染时从文本层按字符区间推导——对应英文内容的真实位置；
 * ③ 文本层不可用 → 整块 bbox 兜底。点击色块移除。
 */
export function HighlightOverlay({
  paperId,
  pageNum,
  info,
  layerTick
}: {
  paperId: string
  pageNum: number
  info: PageInfo
  /** 文本层渲染完成的信号：推导路径依赖 span 几何 */
  layerTick: number
}): JSX.Element {
  const t = useT()
  const notes = useNotes((s) => s.byPaper[paperId])
  const blocks = usePaper((s) => s.bundle?.blocks)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [items, setItems] = useState<HlItem[]>([])

  useEffect(() => {
    const out: HlItem[] = []
    const pageEl = rootRef.current?.closest('.pdf-page') as HTMLElement | null
    const pageRect = pageEl?.getBoundingClientRect()
    const layer = pageEl?.querySelector('.textLayer')

    const pushPdf = (id: string, x: number, y: number, w: number, h: number): void => {
      out.push({
        id,
        x: (x / info.width) * 100,
        // PDF y 向上 → CSS top 从上往下
        y: (1 - (y + h) / info.height) * 100,
        w: (w / info.width) * 100,
        h: (h / info.height) * 100
      })
    }

    /** 字符区间 → 文本层 span 片段矩形（页面百分比）。失败返回 false。 */
    const deriveFromLayer = (
      id: string,
      bbox: [number, number, number, number],
      blockText: string,
      cs: number,
      ce: number
    ): boolean => {
      if (!layer || !pageRect || pageRect.width <= 0) return false
      const [bx, by, bw, bh] = bbox
      const PAD = 4
      const spans = [...layer.querySelectorAll('span')].filter((sp) => {
        const r = sp.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) return false
        const cx = ((r.left + r.width / 2 - pageRect.left) / pageRect.width) * info.width
        const cy = info.height - ((r.top + r.height / 2 - pageRect.top) / pageRect.height) * info.height
        return cx >= bx - PAD && cx <= bx + bw + PAD && cy >= by - PAD && cy <= by + bh + PAD
      })
      if (spans.length === 0) return false
      const startNorm = normLen(blockText.slice(0, cs))
      const endNorm = normLen(blockText.slice(0, ce))
      if (endNorm <= startNorm) return false
      let acc = 0
      let found = false
      for (const sp of spans) {
        const len = normLen(sp.textContent ?? '')
        if (len === 0) continue
        const spStart = acc
        const spEnd = acc + len
        acc = spEnd
        const a = Math.max(startNorm, spStart)
        const b = Math.min(endNorm, spEnd)
        if (b <= a) continue
        const r = sp.getBoundingClientRect()
        // 覆盖比例 → span 矩形的横向切片（近似字符等宽）
        const fa = (a - spStart) / len
        const fb = (b - spStart) / len
        out.push({
          id,
          x: ((r.left + r.width * fa - pageRect.left) / pageRect.width) * 100,
          y: ((r.top - pageRect.top) / pageRect.height) * 100,
          w: ((r.width * (fb - fa)) / pageRect.width) * 100,
          h: (r.height / pageRect.height) * 100
        })
        found = true
      }
      return found
    }

    for (const [id, anchor] of Object.entries(notes?.highlights ?? {})) {
      // 摘录含中文 = 译文页划的：早期版本存过镜像几何矩形，画在英文页必错位，
      // 一律改走文本层推导（对应英文内容的真实位置）
      const mirrorMade = /[\u4e00-\u9fff]/.test(anchor.excerpt ?? '')
      if (!mirrorMade && anchor.rects && anchor.rects.length > 0) {
        for (const [page, x, y, w, h] of anchor.rects) {
          if (page === pageNum) pushPdf(id, x, y, w, h)
        }
        continue
      }
      const b = blocks?.find((x) => x.block_id === anchor.block_id)
      if (!b || b.page !== pageNum || !b.bbox) continue
      try {
        const bbox = JSON.parse(b.bbox) as [number, number, number, number]
        const partial = anchor.char_end - anchor.char_start < b.text.length
        if (!(partial && deriveFromLayer(id, bbox, b.text, anchor.char_start, anchor.char_end))) {
          // 整块锚点或文本层不可用：整块 bbox 兜底
          pushPdf(id, bbox[0], bbox[1], bbox[2], bbox[3])
        }
      } catch {
        /* bbox 损坏跳过 */
      }
    }
    setItems(out)
  }, [notes, blocks, pageNum, info, layerTick])

  return (
    <div ref={rootRef} className="hl-overlay" aria-hidden>
      {items.map((r, i) => (
        <div
          key={`${r.id}:${i}`}
          className="hl-rect"
          style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
          title={t('sel.remove-highlight')}
          onClick={() => void useNotes.getState().removeHighlight(r.id)}
        />
      ))}
    </div>
  )
}
