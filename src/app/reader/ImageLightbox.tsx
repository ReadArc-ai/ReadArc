/** 图片放大查看：滚轮或按钮缩放，拖动平移，双击在适应窗口和放大之间切换。Esc 由 use-shortcuts 统一处理 */
import { useEffect, useRef, useState, type JSX } from 'react'
import { useApp, type LightboxImage } from '../../store/app'
import { useT } from '../../i18n'

const MIN_SCALE = 1
const MAX_SCALE = 8

export function ImageLightbox(): JSX.Element | null {
  const image = useApp((s) => s.lightbox)
  // 换一张图时内部状态归零
  return image ? <LightboxBody key={image.src.slice(-64)} image={image} /> : null
}

function LightboxBody({ image }: { image: LightboxImage }): JSX.Element {
  const t = useT()
  const close = (): void => useApp.getState().setLightbox(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [box, setBox] = useState({ w: window.innerWidth, h: window.innerHeight })
  const drag = useRef<{ px: number; py: number; moved: boolean } | null>(null)

  useEffect(() => {
    const onResize = (): void => setBox({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 以 (cx, cy)（相对窗口中心）为不动点缩放
  const zoomAt = (factor: number, cx = 0, cy = 0): void =>
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
      if (scale === MIN_SCALE) return { scale, x: 0, y: 0 }
      const k = scale / v.scale
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
    })

  // wheel 要 preventDefault，React 的 onWheel 是被动监听，得自己挂
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - window.innerWidth / 2, e.clientY - window.innerHeight / 2)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const fit = Math.min((box.w * 0.92) / image.width, (box.h * 0.86) / image.height)
  return (
    <div
      ref={rootRef}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      onPointerDown={(e) => {
        if ((e.target as Element).closest('.lightbox-bar')) return
        drag.current = { px: e.clientX, py: e.clientY, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.px
        const dy = e.clientY - d.py
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
        d.px = e.clientX
        d.py = e.clientY
        if (d.moved) setView((v) => (v.scale > 1 ? { ...v, x: v.x + dx, y: v.y + dy } : v))
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        // 点图外面的空白关闭；拖动结束不算点击
        if (d && !d.moved && !(e.target as Element).closest('.lightbox-stage, .lightbox-bar')) close()
      }}
      onDoubleClick={(e) => {
        if ((e.target as Element).closest('.lightbox-bar')) return
        if (view.scale > 1) setView({ scale: 1, x: 0, y: 0 })
        else zoomAt(2.5, e.clientX - window.innerWidth / 2, e.clientY - window.innerHeight / 2)
      }}
    >
      <div
        className="lightbox-stage"
        style={{
          width: image.width * fit,
          height: image.height * fit,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          cursor: view.scale > 1 ? 'grab' : 'zoom-in'
        }}
      >
        <img src={image.src} alt="" draggable={false} />
      </div>
      <div className="lightbox-bar">
        <button aria-label={t('lightbox.zoom-out')} title={t('lightbox.zoom-out')} onClick={() => zoomAt(1 / 1.4)}>
          −
        </button>
        <button className="lightbox-pct" aria-label={t('lightbox.fit')} title={t('lightbox.fit')} onClick={() => setView({ scale: 1, x: 0, y: 0 })}>
          {Math.round(view.scale * 100)}%
        </button>
        <button aria-label={t('lightbox.zoom-in')} title={t('lightbox.zoom-in')} onClick={() => zoomAt(1.4)}>
          +
        </button>
        <button aria-label={t('lightbox.close')} title={t('lightbox.close')} onClick={close}>
          ×
        </button>
      </div>
    </div>
  )
}
