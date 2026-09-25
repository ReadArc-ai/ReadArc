import { useEffect, useState, type JSX } from 'react'
import { useApp } from '../../store/app'
import { useChat } from '../../store/chat'
import { useT } from '../../i18n'

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * 截图提问的框选层：盖在正文滚动区上，拖一个框，从框下面的原版页 canvas 里裁出 PNG，
 * 挂到对话输入框上。只认 canvas（原版页）；镜像译文页是 DOM，不裁。Esc 或点工具栏按钮退出。
 */
export function CropOverlay({ hostRef }: { hostRef: React.RefObject<HTMLDivElement | null> }): JSX.Element | null {
  const t = useT()
  const cropMode = useApp((s) => s.cropMode)
  const setCropMode = useApp((s) => s.setCropMode)
  const [drag, setDrag] = useState<Box | null>(null)
  // 覆盖区域 = 滚动区的视口矩形；进入框选时量一次，窗口变化时再量
  const [area, setArea] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  useEffect(() => {
    if (!cropMode) return
    const measure = (): void => {
      const r = hostRef.current?.getBoundingClientRect()
      if (r) setArea({ left: r.left, top: r.top, width: r.width, height: r.height })
    }
    const raf = requestAnimationFrame(measure)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setCropMode(false)
      }
    }
    window.addEventListener('resize', measure)
    window.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [cropMode, hostRef, setCropMode])

  if (!cropMode || !area) return null

  const finish = (d: Box | null): void => {
    setDrag(null)
    const host = hostRef.current
    if (!d || !host) return
    const left = Math.min(d.x0, d.x1)
    const top = Math.min(d.y0, d.y1)
    const w = Math.abs(d.x1 - d.x0)
    const h = Math.abs(d.y1 - d.y0)
    if (w < 8 || h < 8) return // 误触
    // 找与框相交面积最大的原版页 canvas
    let best: { canvas: HTMLCanvasElement; rect: DOMRect; area: number } | null = null
    for (const canvas of host.querySelectorAll<HTMLCanvasElement>('.pdf-page canvas')) {
      const r = canvas.getBoundingClientRect()
      const ix = Math.max(0, Math.min(left + w, r.right) - Math.max(left, r.left))
      const iy = Math.max(0, Math.min(top + h, r.bottom) - Math.max(top, r.top))
      const a = ix * iy
      if (a > 0 && (!best || a > best.area)) best = { canvas, rect: r, area: a }
    }
    if (!best) {
      // 框在镜像译文页（DOM）上：没有 canvas 可裁，先把框选层撤掉，再让主进程截这块屏幕像素
      setCropMode(false)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          void window.readarc
            .captureRegion({ x: left, y: top, width: w, height: h })
            .then((dataUrl) => {
              useChat.getState().setImage(dataUrl)
              useApp.getState().setPanel('chat')
            })
            .catch(() => {})
        })
      )
      return
    }
    const { canvas, rect } = best
    const sx = canvas.width / rect.width
    const sy = canvas.height / rect.height
    const cx = Math.max(0, (Math.max(left, rect.left) - rect.left) * sx)
    const cy = Math.max(0, (Math.max(top, rect.top) - rect.top) * sy)
    const cw = Math.min(canvas.width - cx, (Math.min(left + w, rect.right) - Math.max(left, rect.left)) * sx)
    const ch = Math.min(canvas.height - cy, (Math.min(top + h, rect.bottom) - Math.max(top, rect.top)) * sy)
    if (cw < 4 || ch < 4) return
    const out = document.createElement('canvas')
    // 裁图按原栅格分辨率，够模型看清公式；超大框限到 1600px 宽以控制请求体积
    const scale = Math.min(1, 1600 / cw)
    out.width = Math.round(cw * scale)
    out.height = Math.round(ch * scale)
    const ctx = out.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(canvas, cx, cy, cw, ch, 0, 0, out.width, out.height)
    useChat.getState().setImage(out.toDataURL('image/png'))
    setCropMode(false)
    useApp.getState().setPanel('chat')
  }

  const box = drag
    ? {
        left: Math.min(drag.x0, drag.x1) - area.left,
        top: Math.min(drag.y0, drag.y1) - area.top,
        width: Math.abs(drag.x1 - drag.x0),
        height: Math.abs(drag.y1 - drag.y0)
      }
    : null
  return (
    <div
      className="crop-overlay"
      style={area}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        setDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY })
      }}
      onMouseMove={(e) => {
        if (!drag) return
        const { clientX, clientY } = e
        setDrag((d) => (d ? { ...d, x1: clientX, y1: clientY } : d))
      }}
      onMouseUp={() => finish(drag)}
      onMouseLeave={() => drag && finish(drag)}
    >
      {!drag && <div className="crop-hint">{t('crop.hint')}</div>}
      {box && <div className="crop-rect" style={box} />}
    </div>
  )
}
