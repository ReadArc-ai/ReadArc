/**
 * 流式视图的 arXiv 网页版：原文是 arXiv 官方 HTML（矢量公式、真表格），译文里的公式换回同一份 MathML。
 *
 * 单元按文字对上 PDF 的块，借用它的块序与页码（data-order / data-page）：目录跳转、滚动进度、
 * 视口优先翻译、划词浮层都沿用原有逻辑。对不上的单元沿用前一个对上的位置。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { BlockRow, FlowUnitInput } from '../../../shared/models'
import { parseArxivHtml, type FlowUnit } from '../../lib/arxiv-html'
import { usePaper, type FlowOutlineItem } from '../../store/paper'
import { useApp } from '../../store/app'
import { renderInline } from './page-text'
import type { FlowMode } from './FlowView'

export type ArxivState =
  | { status: 'loading' }
  | { status: 'ready'; units: FlowUnit[]; arxivId: string }
  | { status: 'unavailable' | 'offline'; arxivId?: string }

/** 取 arXiv 网页版并解析；有缓存时几乎立即返回 */
export function useArxivSource(paperId: string, retry: number): ArxivState {
  const [state, setState] = useState<{ key: string; value: ArxivState }>({ key: '', value: { status: 'loading' } })
  const key = `${paperId}#${retry}`
  useEffect(() => {
    let cancelled = false
    void window.readarc
      .arxivHtml(paperId, false)
      .then((r) => {
        if (cancelled) return
        if (r.status !== 'ok') return setState({ key, value: { status: r.status, arxivId: r.arxivId } })
        const units = parseArxivHtml(r.html, paperId)
        setState({ key, value: units.length > 0 ? { status: 'ready', units, arxivId: r.arxivId } : { status: 'unavailable', arxivId: r.arxivId } })
      })
      .catch(() => !cancelled && setState({ key, value: { status: 'offline' } }))
    return () => {
      cancelled = true
    }
  }, [paperId, key])
  return state.key === key ? state.value : { status: 'loading' }
}

/** 只比字母：去掉公式占位、强调标记、章节号，取前 48 个字母当键 */
function matchKey(text: string): string {
  return text
    .replace(/⟦f\d+⟧|\*\*|[*^~]/g, '')
    .replace(/^\s*(?:[A-Z]|\d+)(?:\.\d+)*\.?\s+/, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '')
    .slice(0, 48)
}

interface Placed {
  unit: FlowUnit
  order: number
  page: number
}

/** 单元对上 PDF 的块：按文字开头匹配，对不上的沿用前一个位置 */
function placeUnits(units: FlowUnit[], blocks: BlockRow[]): Placed[] {
  const byKey = new Map<string, BlockRow>()
  for (const b of blocks) {
    if (b.kind !== 'para' && b.kind !== 'heading') continue
    const k = matchKey(b.text)
    if (k.length >= 12 && !byKey.has(k)) byKey.set(k, b)
  }
  let order = blocks[0]?.block_order ?? 0
  let page = 1
  return units.map((unit) => {
    const k = matchKey(unit.text || unit.html.replace(/<[^>]+>/g, ' '))
    const hit = k.length >= 12 ? byKey.get(k) : undefined
    if (hit) {
      order = hit.block_order
      page = hit.page
    }
    return { unit, order, page }
  })
}

/** 交给主进程翻译的单元 */
export function unitInputs(placed: Placed[]): FlowUnitInput[] {
  return placed
    .filter((p) => p.unit.translatable && p.unit.text)
    .map((p) => ({ id: p.unit.id, kind: p.unit.kind === 'heading' ? 'heading' : 'para', text: p.unit.text, order: p.order }))
}

/**
 * 同一个图片文件只向主进程要一次：合作组论文的作者栏里上千个一模一样的 ORCID 小图标，
 * 不合并的话每个都要走一次 IPC、传一份 data URL
 */
const assetRequests = new Map<string, Promise<string | null>>()
function arxivAsset(paperId: string, src: string): Promise<string | null> {
  const key = `${paperId}|${src}`
  let p = assetRequests.get(key)
  if (!p) {
    p = window.readarc.arxivAsset(paperId, src).catch(() => null)
    assetRequests.set(key, p)
    // 取失败（断网）不留在表里，下次进视口再试
    void p.then((url) => url === null && assetRequests.delete(key))
  }
  return p
}

/**
 * 原文 HTML 由这个组件自己写进 DOM（innerHTML），React 不管它的子节点：
 * 用 dangerouslySetInnerHTML 时，React 重渲会把整块换成新节点，先前挂上的图片懒加载就落到了旧节点上，
 * 图片永远不出来。这里每块自己观察自己的图片，接近视口才向主进程要（下载并缓存后以 data URL 给回）
 */
function RawHtml({ as: Tag = 'div', html, className, paperId, ...rest }: { as?: 'div' | 'p' | 'span'; html: string; className?: string; paperId: string } & Record<`data-${string}`, string | number>): JSX.Element {
  const ref = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = html // 解析时已经过两层净化（自有清洗 + DOMPurify）
    const cleanups: (() => void)[] = []
    // 宽表按版心缩小（原版 PDF 里它们就是 \resizebox 缩到页宽的），缩到 55% 还放不下才横向滚动
    const tables = [...el.querySelectorAll<HTMLElement>('table.ltx_tabular')].filter((t) => !t.parentElement?.closest('table'))
    if (tables.length > 0) {
      let lastWidth = -1
      const fit = (): void => {
        const width = el.clientWidth
        if (width === lastWidth || width === 0) return
        lastWidth = width
        for (const t of tables) {
          t.style.removeProperty('zoom')
          const need = t.getBoundingClientRect().width
          if (need > width) t.style.setProperty('zoom', String(Math.max(0.55, width / need)))
        }
      }
      fit()
      const ro = new ResizeObserver(fit)
      ro.observe(el)
      cleanups.push(() => ro.disconnect())
    }
    const imgs = el.querySelectorAll<HTMLImageElement>('img[data-arxiv-src]')
    if (imgs.length === 0) return () => cleanups.forEach((f) => f())
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const img = e.target as HTMLImageElement
          io.unobserve(img)
          const src = img.dataset.arxivSrc
          if (!src) continue
          void arxivAsset(paperId, src).then((url) => {
            if (url && img.isConnected) img.src = url
          })
        }
      },
      { rootMargin: '800px' }
    )
    imgs.forEach((img) => io.observe(img))
    return () => {
      io.disconnect()
      cleanups.forEach((f) => f())
    }
  }, [html, paperId])
  return <Tag ref={ref as never} className={className} {...rest} />
}

function ArxivUnit({ placed, mode, paperId }: { placed: Placed; mode: FlowMode; paperId: string }): JSX.Element {
  const { unit, order, page } = placed
  const state = usePaper(useShallow((s) => s.translations[unit.id]))
  const ctx = useMemo(() => ({ paperId: '', blockId: unit.id, inlines: [], fontSize: null, math: unit.maths }), [unit])
  const zh = unit.translatable && state?.text ? state.text : null
  const pending = unit.translatable && !zh && state?.pending
  const anchor = { 'data-order': order, 'data-page': page, 'data-unit': unit.id }
  if (unit.kind === 'heading') {
    const level = Math.min(3, unit.level)
    const Tag = (level === 0 ? 'h1' : `h${level + 1}`) as 'h1' | 'h2' | 'h3' | 'h4'
    return (
      <Tag className={`flow-block flow-anchor flow-h flow-h--${level === 0 ? 'title' : level}`} {...anchor}>
        {mode === 'zh' && zh ? (
          renderInline(zh, `${unit.id}:h`, ctx)
        ) : (
          <>
            <RawHtml as="span" className="flow-h-orig ltx" html={unit.html} paperId={paperId} />
            {/* 译文和原文一样（论文名常保留英文）就不再重复一行 */}
            {zh && zh.trim() !== unit.text.trim() && <span className="flow-h-trans">{renderInline(zh, `${unit.id}:ht`, ctx)}</span>}
          </>
        )}
      </Tag>
    )
  }
  if (unit.kind === 'para') {
    const showOriginal = mode === 'both' || !zh
    return (
      <div className={`flow-block flow-anchor flow-para flow-para--${unit.role}`} {...anchor}>
        {showOriginal && <RawHtml as="p" className={zh || mode === 'both' ? 'flow-orig ltx' : 'flow-orig flow-orig--alone ltx'} html={unit.html} paperId={paperId} />}
        {zh && <p className="flow-trans">{renderInline(zh, `${unit.id}:t`, ctx)}</p>}
        {pending && <p className="flow-trans flow-trans--pending" aria-hidden />}
      </div>
    )
  }
  // 图、表、独立公式、作者栏、代码：原样（已净化）
  return <RawHtml className={`flow-anchor flow-ltx flow-ltx--${unit.kind} flow-ltx--${unit.role}`} html={unit.html} paperId={paperId} {...anchor} />
}

/** 一组单元：接近视口才挂载 */
function ArxivChunk({ index, items, mode, paperId, estimate, eager }: { index: number; items: Placed[]; mode: FlowMode; paperId: string; estimate: number; eager: boolean }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [mounted, setMounted] = useState(eager)
  useEffect(() => {
    const el = ref.current
    if (!el || mounted) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setMounted(true), { rootMargin: '1600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [mounted])
  return (
    <div ref={ref} className="flow-chunk" data-chunk={index} style={mounted ? undefined : { minHeight: `${estimate}px` }}>
      {mounted && items.map((p) => <ArxivUnit key={p.unit.id} placed={p} mode={mode} paperId={paperId} />)}
    </div>
  )
}

const CHUNK = 24

/** 目录跳到网页版的某个标题：所在分组还没挂载时先滚到分组，等标题出现再定位（最多等一秒） */
export function jumpToArxivUnit(item: Pick<FlowOutlineItem, 'id' | 'chunk'>): void {
  const find = (): HTMLElement | null => document.querySelector<HTMLElement>(`.flow-arxiv [data-unit="${CSS.escape(item.id)}"]`)
  const hit = find()
  if (hit) return hit.scrollIntoView({ block: 'start' })
  document.querySelector<HTMLElement>(`.flow-arxiv [data-chunk="${item.chunk}"]`)?.scrollIntoView({ block: 'start' })
  const deadline = Date.now() + 1000
  const tick = (): void => {
    const el = find()
    if (el) el.scrollIntoView({ block: 'start' })
    else if (Date.now() < deadline) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

export function ArxivFlow({ units, mode, paperId, blocks }: { units: FlowUnit[]; mode: FlowMode; paperId: string; blocks: BlockRow[] }): JSX.Element {
  const zoom = useApp((s) => s.pageZoom)
  const placed = useMemo(() => placeUnits(units, blocks), [units, blocks])

  // 告诉阅读器：现在翻译、计数按这些单元来；离开时撤掉
  useEffect(() => {
    const inputs = unitInputs(placed)
    usePaper.setState({ flowUnits: inputs })
    let cancelled = false
    void window.readarc.arxivTranslations(paperId, inputs).then((cached) => {
      if (cancelled || Object.keys(cached).length === 0) return
      usePaper.setState((s) => {
        const next = { ...s.translations }
        for (const [id, tr] of Object.entries(cached)) if (!next[id]?.text) next[id] = { text: tr.text, model: tr.model }
        return { translations: next }
      })
    })
    return () => {
      cancelled = true
      usePaper.setState({ flowUnits: null })
    }
  }, [placed, paperId])

  const chunks = useMemo(() => {
    const out: Placed[][] = []
    for (let i = 0; i < placed.length; i += CHUNK) out.push(placed.slice(i, i + CHUNK))
    return out
  }, [placed])
  // 元素 id → 所在分组：引用跳到还没挂载的分组（参考文献在最后）时，先把那一组滚进来
  const chunkOfId = useMemo(() => {
    const m = new Map<string, number>()
    chunks.forEach((items, i) => {
      for (const p of items) for (const hit of p.unit.html.matchAll(/\bid="([^"]+)"/g)) m.set(hit[1], i)
    })
    return m
  }, [chunks])
  // 目录改用网页版的标题：PDF 抽出来的小型大写字母会断开（「REAC T」），网页版的是原文
  useEffect(() => {
    const items: FlowOutlineItem[] = []
    chunks.forEach((list, chunk) => {
      for (const p of list) {
        if (p.unit.kind !== 'heading' || !p.unit.text) continue
        items.push({ id: p.unit.id, level: Math.max(1, p.unit.level), title: p.unit.text, chunk })
      }
    })
    usePaper.setState({ flowOutline: items.length > 0 ? items : null })
    return () => usePaper.setState({ flowOutline: null })
  }, [chunks])

  const rootRef = useRef<HTMLDivElement | null>(null)
  const fontPx = 16 * zoom
  const estimate = (items: Placed[]): number =>
    items.reduce((h, p) => h + (p.unit.kind === 'figure' ? 320 : Math.ceil((p.unit.text.length || 80) / 80) * fontPx * 1.7 * (mode === 'both' ? 2 : 1) + 16), 0)

  // 页内链接（引用、图表编号）在本视图里跳；外链交给系统浏览器
  const onClick = (e: React.MouseEvent): void => {
    const a = (e.target as Element).closest?.('a')
    if (!a) return
    const href = a.getAttribute('href') ?? ''
    e.preventDefault()
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1))
      const target = document.getElementById(id)
      if (target) return target.scrollIntoView({ block: 'center' })
      const chunk = chunkOfId.get(id)
      const chunkEl = chunk === undefined ? null : rootRef.current?.querySelector<HTMLElement>(`[data-chunk="${chunk}"]`)
      if (!chunkEl) return
      chunkEl.scrollIntoView({ block: 'start' })
      // 分组挂载要一两帧：等目标出现再定位，最多等一秒
      const deadline = Date.now() + 1000
      const tick = (): void => {
        const el = document.getElementById(id)
        if (el) el.scrollIntoView({ block: 'center' })
        else if (Date.now() < deadline) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    } else if (/^https?:\/\//.test(href)) {
      window.open(href)
    }
  }

  return (
    <div ref={rootRef} className="flow-arxiv" onClick={onClick}>
      {chunks.map((items, i) => (
        <ArxivChunk key={items[0].unit.id} index={i} items={items} mode={mode} paperId={paperId} estimate={estimate(items)} eager={i < 2} />
      ))}
    </div>
  )
}
