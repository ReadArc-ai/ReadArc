/** 侧栏宽度 / 底部面板高度的拖拽把手：贴在栏的一条边上，拖动改尺寸、松手落盘（悬停显示细线提示可拖）。 */
import { useRef, useState, type JSX } from 'react'

export function DragHandle({
  edge,
  width,
  min,
  max,
  onResize,
  onCommit
}: {
  /** 把手贴在栏的哪条边（right = 栏在左侧，向右拖变宽；top = 栏在底部，向上拖变高） */
  edge: 'left' | 'right' | 'top'
  /** 当前实际尺寸（拖动起点的基准）：左右把手是宽度，顶部把手是高度 */
  width: number
  min: number
  max: number
  /** 拖动中连续回调（未夹紧前的原始目标尺寸也一并给出，供折叠判定） */
  onResize: (clamped: number, raw: number) => void
  /** 松手：持久化时机 */
  onCommit: () => void
}): JSX.Element {
  const base = useRef({ x: 0, y: 0, w: width })
  const [active, setActive] = useState(false)
  const horizontal = edge === 'top'

  return (
    <div
      className={`drag-handle${horizontal ? ' drag-handle--h' : ''}${active ? ' drag-handle--active' : ''}`}
      style={horizontal ? { top: -4 } : edge === 'right' ? { right: -4 } : { left: -4 }}
      onPointerDown={(e) => {
        e.preventDefault()
        base.current = { x: e.clientX, y: e.clientY, w: width }
        e.currentTarget.setPointerCapture(e.pointerId)
        setActive(true)
      }}
      onPointerMove={(e) => {
        if (!active || !(e.buttons & 1)) return
        const raw = horizontal
          ? base.current.w - (e.clientY - base.current.y)
          : base.current.w + (edge === 'right' ? 1 : -1) * (e.clientX - base.current.x)
        onResize(Math.min(max, Math.max(min, raw)), raw)
      }}
      onPointerUp={() => {
        setActive(false)
        onCommit()
      }}
      onLostPointerCapture={() => setActive(false)}
    />
  )
}
