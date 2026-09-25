/** 原版页：pdf.js 渲染到 canvas，加文本层供选词与查找 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { HighlightOverlay } from './HighlightOverlay'
import { selectWordAtPoint } from './TranslatedPage'

export interface PageInfo {
  width: number
  height: number
}

/** 单页：canvas 渲染 + 透明文本层（原文可选中/复制）。进入视口附近才渲染。 */
export function Page({
  doc,
  pageNum,
  info,
  paperId
}: {
  doc: PDFDocumentProxy
  pageNum: number
  info: PageInfo
  paperId: string
}): JSX.Element {
  const pageRef = useRef<HTMLDivElement | null>(null)
  const holderRef = useRef<HTMLDivElement | null>(null)
  const [layerTick, setLayerTick] = useState(0)
  // PDF 链接注释（画布只画出蓝色，真正的可点性来自这层覆盖）：
  // 外链走系统浏览器；文内引用（GoTo）跳到目标页
  const [links, setLinks] = useState<
    { x: number; y: number; w: number; h: number; url?: string; targetPage?: number }[]
  >([])
  // 链接不再是几百个覆盖在文字上的热区元素——那会截住双击选词，也是白白的
  // DOM 开销。改为保存几何数据，在页面层做命中测试，只渲染悬停中的那一个框。
  const [hoverLink, setHoverLink] = useState(-1)
  const hoverRaf = useRef(0)
  const linkAt = useCallback(
    (clientX: number, clientY: number): number => {
      const el = pageRef.current
      if (!el || links.length === 0) return -1
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return -1
      const px = ((clientX - r.left) / r.width) * 100
      const py = ((clientY - r.top) / r.height) * 100
      for (let i = 0; i < links.length; i++) {
        const l = links[i]
        if (px >= l.x && px <= l.x + l.w && py >= l.y && py <= l.y + l.h) return i
      }
      return -1
    },
    [links]
  )
  const onPageMove = useCallback(
    (e: React.MouseEvent): void => {
      if (hoverRaf.current) return
      const { clientX, clientY } = e
      hoverRaf.current = requestAnimationFrame(() => {
        hoverRaf.current = 0
        setHoverLink((prev) => {
          const next = linkAt(clientX, clientY)
          return next === prev ? prev : next
        })
      })
    },
    [linkAt]
  )
  const onPageClick = useCallback(
    (e: React.MouseEvent): void => {
      // 有选区时是划词操作，不触发跳转
      if (!window.getSelection()?.isCollapsed) return
      const i = linkAt(e.clientX, e.clientY)
      if (i < 0) return
      const l = links[i]
      if (l.url) window.open(l.url, '_blank', 'noreferrer')
      else if (l.targetPage) {
        document.querySelector(`.pdf-page[data-page="${l.targetPage}"]`)?.scrollIntoView({ block: 'start' })
      }
    },
    [linkAt, links]
  )

  useEffect(() => {
    let stop = false
    void (async () => {
      try {
        const page = await doc.getPage(pageNum)
        const annots = (await page.getAnnotations()) as {
          subtype?: string
          rect?: number[]
          url?: string
          unsafeUrl?: string
          dest?: unknown
        }[]
        const out: typeof links = []
        for (const a of annots) {
          if (a.subtype !== 'Link' || !a.rect) continue
          const [x1, y1, x2, y2] = a.rect
          const base = {
            x: (Math.min(x1, x2) / info.width) * 100,
            y: (1 - Math.max(y1, y2) / info.height) * 100,
            w: (Math.abs(x2 - x1) / info.width) * 100,
            h: (Math.abs(y2 - y1) / info.height) * 100
          }
          const url = a.url ?? a.unsafeUrl
          if (url) {
            out.push({ ...base, url })
            continue
          }
          if (a.dest) {
            try {
              const dest = typeof a.dest === 'string' ? await doc.getDestination(a.dest) : (a.dest as unknown[])
              const ref = Array.isArray(dest) ? dest[0] : null
              if (ref) out.push({ ...base, targetPage: (await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0])) + 1 })
            } catch {
              /* 解析不了的目标跳过 */
            }
          }
        }
        if (!stop) setLinks(out)
      } catch {
        /* 注释层失败不影响阅读 */
      }
    })()
    return () => {
      stop = true
    }
  }, [doc, pageNum, info])

  useEffect(() => {
    const pageEl = pageRef.current
    const holder = holderRef.current
    if (!pageEl || !holder) return
    let disposed = false
    let renderedWidth = 0
    let renderedPreview = false // 当前画布是低清预览（待升级）
    let rendering = false
    let queued: 'full' | null = null
    let near = false
    let cancelRender: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    // 离开视口足够远时释放位图（DPR 2 下每页 ~10MB，长文档滚一遍不释放会常驻数百 MB）。
    // 壳的 aspect-ratio 保持占位高度，布局与滚动位置不动；回到附近由 enterIO 重渲。
    const release = (): void => {
      if (renderedWidth === 0) return
      for (const c of holder.querySelectorAll('canvas')) {
        c.width = 0
        c.height = 0
      }
      holder.replaceChildren()
      renderedWidth = 0
      renderedPreview = false
    }

    /**
     * 两阶段渲染：进视口先出低清预览（不等静置、不建文本层，几毫秒可见），
     * 静置后再渲全清并挂文本层。滚动中不再出现整片白页，也不用为途经的页
     * 付全清栅格化的代价。
     */
    const render = async (mode: 'preview' | 'full' = 'full'): Promise<void> => {
      if (disposed) return
      if (rendering) {
        if (mode === 'full') queued = 'full'
        return
      }
      rendering = true
      try {
        if (mode === 'full') {
          // 静置判定：飞速翻页时途经的页不必渲全清——120ms 后仍在附近才动手
          await new Promise((r) => setTimeout(r, 120))
          if (disposed || !near) return
        }
        const page = await doc.getPage(pageNum)
        // 等一帧让缩放后的布局定稳再量宽（remount 后立即量会拿到过渡值）
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        const cssWidth = pageEl.clientWidth || pageEl.getBoundingClientRect().width || 600
        const cssScale = cssWidth / info.width
        // 清晰度与开销的平衡：canvas 只有灰度抗锯齿，小页面（并排视图）超采样
        // 能让小字更实；但总像素必须设硬上限——全宽页在 3× 下达 4000 万像素/56MB，
        // 每次进视口都要重栅格化并上传纹理，这正是滚动卡顿的来源。
        // 超预算时退回接近原生 DPR：大页面本身字就大，DPR 已足够清晰。
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        let scale: number
        if (mode === 'preview') {
          scale = cssScale * 1 // 像素量约全清的 1/7，几毫秒出图，观感已接近清晰
        } else {
          scale = cssScale * dpr * 1.35
          const MAX_CANVAS_PX = 6_000_000 // ≈24MB RGBA
          const wantPx = info.width * scale * (info.height * scale)
          if (wantPx > MAX_CANVAS_PX) scale *= Math.sqrt(MAX_CANVAS_PX / wantPx)
        }
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const task = page.render({ canvasContext: ctx, viewport, canvas })
        cancelRender = () => task.cancel()
        await task.promise
        cancelRender = null

        if (mode === 'preview') {
          // 预览只贴图：文本层（数百个 span）留给全清阶段，先让页面不空白
          if (disposed) return
          holder.replaceChildren(canvas)
          renderedWidth = cssWidth
          renderedPreview = true
          return
        }

        // 透明文本层：与字形逐一对齐，让原文可选中（pdf.js TextLayer；
        // 宽高由 TextLayer 依据 --scale-factor 等变量自行设置，官方 CSS 见 app.css）
        const textDiv = document.createElement('div')
        textDiv.className = 'textLayer'
        const cssViewport = page.getViewport({ scale: cssScale })
        textDiv.style.setProperty('--scale-factor', String(cssViewport.scale))
        try {
          const layer = new pdfjs.TextLayer({
            textContentSource: page.streamTextContent(),
            container: textDiv,
            viewport: cssViewport
          })
          await layer.render()
        } catch (err) {
          console.warn(`text layer ${pageNum} failed:`, err)
        }
        textDiv.addEventListener('dblclick', (e) => {
          const { clientX } = e
          setTimeout(() => selectWordAtPoint(clientX), 0)
        })
        // 双击的第二次按下瞬间就隐藏原生选区视觉（它带漂移，先画出来会闪跳一下）；
        // 单击/拖选(detail 1)与三击(detail 3)恢复原生视觉
        textDiv.addEventListener('mousedown', (e) => {
          textDiv.classList.toggle('dbl-selecting', e.detail === 2)
        })

        if (disposed) return
        holder.replaceChildren(canvas, textDiv)
        renderedPreview = false
        // 旋转文本（arXiv 左缘竖排水印）沿整栏覆盖行首字符，会截胡双击/选区——
        // 块解析已剔除它，文本层同样禁掉其命中与选中
        for (const sp of textDiv.querySelectorAll('span')) {
          const tr = getComputedStyle(sp).transform
          const m2 = tr && tr !== 'none' ? /matrix\(([-\d.]+), ([-\d.]+)/.exec(tr) : null
          if (m2 && Math.abs(parseFloat(m2[2])) > 0.01) {
            sp.style.pointerEvents = 'none'
            sp.style.userSelect = 'none'
          }
        }
        renderedWidth = cssWidth
        setLayerTick((t) => t + 1) // 高亮推导层重算
        // 渲染期间已被快速滚出回收区 → 立即释放，不留孤儿位图
        if (!near) release()
      } catch (err) {
        // 渲染取消是快速翻页的正常路径，不告警
        if (!(err instanceof Error && /cancel/i.test(err.name + err.message))) {
          console.warn(`pdf page ${pageNum} render failed:`, err)
        }
      } finally {
        cancelRender = null
        rendering = false
        if (!disposed && near) {
          if (queued === 'full') {
            queued = null
            void render('full')
          } else if (renderedPreview) {
            void render('full') // 预览已上屏，接着升级全清
          } else if (renderedWidth === 0) {
            // 静置判定跳过后又回到附近：补渲
            setTimeout(() => {
              if (!disposed && near && renderedWidth === 0 && !rendering) void render('preview')
            }, 60)
          }
        }
      }
    }

    // 观察外层 .pdf-page：aspect-ratio 使其未渲染时也有高度，进视口判定可靠。
    // 进出双观察器带滞回（进 800px 渲染 / 出 2500px 释放）：留一屏余量避免
    // 来回翻页反复栅格化，又不让大位图长期占着内存与合成带宽
    const enterIO = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        near = true
        if (renderedWidth > 0 || rendering) return
        void render('preview')
      },
      { root: null, rootMargin: '800px' }
    )
    enterIO.observe(pageEl)
    const exitIO = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) return
        near = false
        if (cancelRender) cancelRender() // 飞掠中的渲染立即中止
        release()
      },
      { root: null, rootMargin: '2500px' }
    )
    exitIO.observe(pageEl)

    // 同上：窗口回到前台时补判一次，避免空白页停留到用户滚动
    const recheckVisible = (): void => {
      const r = pageEl.getBoundingClientRect()
      const nearNow = r.bottom > -800 && r.top < window.innerHeight + 800
      near = nearNow
      if (nearNow && renderedWidth === 0 && !rendering) void render('preview')
    }
    document.addEventListener('visibilitychange', recheckVisible)
    window.addEventListener('focus', recheckVisible)
    // 滚动时也补判：任何滚动容器的 scroll 事件都能在捕获阶段听到，
    // 只在还没渲染时起作用（渲染后的进出仍交给观察器）
    let scrollRaf = 0
    const onScroll = (): void => {
      if (renderedWidth > 0 || rendering || scrollRaf) return
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0
        recheckVisible()
      })
    }
    window.addEventListener('scroll', onScroll, true)
    // 挂载时按几何位置立即判一次，不等观察器的首次回调：窗口被遮挡或后台节流时
    // 首次回调可能迟迟不来，切换视图回来的页面会一直空着
    recheckVisible()

    // 宽度显著变化（开合面板/收拉侧栏/窗口缩放）→ 按新宽重渲，
    // 位图不能只靠 CSS 拉伸（会糊）；重渲前用 transform 临时对齐文本层
    const ro = new ResizeObserver(() => {
      if (renderedWidth === 0) return
      const w = pageEl.clientWidth
      if (renderedWidth > 0) {
        const tl = holder.querySelector<HTMLElement>('.textLayer')
        if (tl) tl.style.transform = `scale(${w / renderedWidth})`
      }
      if (Math.abs(w - renderedWidth) / renderedWidth < 0.02) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void render('full'), 250)
    })
    ro.observe(pageEl)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', recheckVisible)
      window.removeEventListener('focus', recheckVisible)
      window.removeEventListener('scroll', onScroll, true)
      if (scrollRaf) cancelAnimationFrame(scrollRaf)
      enterIO.disconnect()
      exitIO.disconnect()
      ro.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [doc, pageNum, info])

  return (
    <div
      ref={pageRef}
      className={'pdf-page' + (hoverLink >= 0 ? ' pdf-page--link' : '')}
      onMouseMove={onPageMove}
      onMouseLeave={() => setHoverLink(-1)}
      onClick={onPageClick}
      style={{ aspectRatio: `${info.width} / ${info.height}` }}
      data-page={pageNum}
      // PDF 点尺寸：供选区浮层做屏幕坐标 → 块 bbox 的几何命中
      data-pw={info.width}
      data-ph={info.height}
    >
      {/* canvas/文本层由 pdf.js 命令式填充；高亮层是 React 兄弟节点，互不覆写 */}
      <div ref={holderRef} className="pdf-canvas-holder" />
      <HighlightOverlay paperId={paperId} pageNum={pageNum} info={info} layerTick={layerTick} />
      {hoverLink >= 0 && links[hoverLink] && (
        <div
          className="pdf-link-hover"
          style={{
            left: `${links[hoverLink].x}%`,
            top: `${links[hoverLink].y}%`,
            width: `${links[hoverLink].w}%`,
            height: `${links[hoverLink].h}%`
          }}
          aria-hidden
        />
      )}
    </div>
  )
}
