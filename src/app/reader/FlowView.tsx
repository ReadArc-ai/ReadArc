/**
 * 流式双语视图：按阅读顺序把块一段接一段往下排，原文下面跟译文（或只看译文）。
 *
 * 镜像译文页把译文塞回原文每块的位置，中英文长短不同只能缩字号，于是字号忽大忽小、
 * 公式截图跟着缩、跨页的段落被截成两半。这里不受原版版面约束：全文统一字号，
 * 公式和图表按原版尺寸换算成与正文同一比例，截断的段落接成一段，参考文献只显示原文。
 *
 * 带 data-page / data-order：目录跳转、查找、滚动进度、视口优先翻译、划词浮层都沿用原有逻辑。
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import type { BlockRow } from '../../../shared/models'
import { parseInlines, placeholdersMatch, repairPlaceholders } from '../../../shared/inline-formula'
import { CAPTION_RE, continuationChains, isReferenceBlock } from '../../../shared/paper-flow'
import { useApp } from '../../store/app'
import { usePaper } from '../../store/paper'
import { useFigureSrc } from '../../lib/use-figure'
import { useT } from '../../i18n'
import { renderInline, parseBbox, type InlineCtx } from './page-text'
import { ArxivFlow, useArxivSource, type ArxivState } from './ArxivFlow'

export type FlowMode = 'both' | 'zh'

type FlowRole = 'body' | 'small' | 'caption' | 'ref' | 'line'

type FlowItem =
  | { type: 'heading'; block: BlockRow }
  | { type: 'para'; parts: BlockRow[]; role: FlowRole }
  | { type: 'figures'; blocks: BlockRow[] }

/** 正文字号（pt）：段落字号的中位数。图、公式按它换算成和正文同一比例 */
function bodyFontPt(blocks: BlockRow[]): number {
  const sizes = blocks
    .filter((b) => b.kind === 'para' && b.font_size && b.font_size > 4)
    .map((b) => b.font_size as number)
    .sort((a, b) => a - b)
  return sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] : 10
}

/** 块 → 阅读流条目：截断的段落接成一段，连续的子图并成一行，页眉页脚不进流 */
/**
 * 单独一行的短块（扉页、作者、单位、日期）：原版是一行行排的，流式里按段落留白会拉得很散，
 * 连续几行这样的块排紧一些
 */
function isShortLine(b: BlockRow, bodyPt: number): boolean {
  if (b.text.length > 90) return false
  const box = parseBbox(b)
  const size = b.font_size ?? bodyPt
  return box ? box[3] <= size * 1.8 : b.text.length <= 60
}

function buildItems(blocks: BlockRow[], bodyPt: number): FlowItem[] {
  const chains = continuationChains(blocks)
  const tails = new Set<string>()
  for (const parts of chains.values()) for (const p of parts.slice(1)) tails.add(p.block_id)
  const items: FlowItem[] = []
  for (const b of blocks) {
    if (b.kind === 'margin' || tails.has(b.block_id)) continue
    if (b.kind === 'heading') {
      items.push({ type: 'heading', block: b })
    } else if (b.kind === 'para') {
      const role = isReferenceBlock(b)
        ? 'ref'
        : CAPTION_RE.test(b.text)
          ? 'caption'
          : b.font_size && b.font_size < bodyPt * 0.85
            ? 'small'
            : 'body'
      const parts = chains.get(b.block_id) ?? [b]
      items.push({ type: 'para', parts, role: role === 'body' && parts.length === 1 && isShortLine(b, bodyPt) ? 'line' : role })
    } else {
      // 图、表、独立公式：同一页连续的子图并成一行
      const last = items[items.length - 1]
      if (b.kind === 'figure' && last?.type === 'figures' && last.blocks[0].kind === 'figure' && last.blocks[0].page === b.page) {
        last.blocks.push(b)
      } else {
        items.push({ type: 'figures', blocks: [b] })
      }
    }
  }
  return items
}

function firstBlock(item: FlowItem): BlockRow {
  return item.type === 'heading' ? item.block : item.type === 'para' ? item.parts[0] : item.blocks[0]
}

function inlineCtx(b: BlockRow): InlineCtx | undefined {
  const inlines = parseInlines(b.inlines)
  return inlines.length > 0 ? { paperId: b.paper_id, blockId: b.block_id, inlines, fontSize: b.font_size } : undefined
}

/** 旧缓存里占位符对不上的译文：显示时补齐（与镜像页同一处理） */
function shownTranslation(b: BlockRow, text: string): string {
  return placeholdersMatch(b.text, text) ? text : repairPlaceholders(b.text, text)
}

/** 几块接成一段渲染：各块用各自的公式截图；连字符断词处不加空格 */
function renderParts(parts: BlockRow[], texts: string[], cjk: boolean): (string | JSX.Element)[] {
  const out: (string | JSX.Element)[] = []
  parts.forEach((p, k) => {
    const text = texts[k] ?? ''
    if (k > 0) {
      const prev = texts[k - 1] ?? ''
      if (!cjk && !/-$/.test(prev.trimEnd())) out.push(' ')
    }
    out.push(...renderInline(cjk ? text : text.replace(/\s+$/, ''), `${p.block_id}:flow`, inlineCtx(p)))
  })
  return out
}

/** 图、表、独立公式：按原版尺寸换算成正文比例；没进视口不取图，占位尺寸先按原版定好，滚动位置不跳 */
function FlowFigure({ block, pxPerPt }: { block: BlockRow; pxPerPt: number }): JSX.Element {
  const box = parseBbox(block)
  const ref = useRef<HTMLDivElement | null>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '1200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  const w = box ? box[2] * pxPerPt : 320
  const h = box ? box[3] * pxPerPt : 200
  return (
    <div
      ref={ref}
      className={`flow-fig flow-fig--${block.kind}`}
      data-order={block.block_order}
      style={{ width: `${w.toFixed(1)}px`, aspectRatio: `${w.toFixed(1)} / ${h.toFixed(1)}` }}
    >
      {near && <FigureImage block={block} />}
    </div>
  )
}

function FigureImage({ block }: { block: BlockRow }): JSX.Element | null {
  const src = useFigureSrc(block.paper_id, block.block_id)
  return src ? <img src={src} alt="" draggable={false} /> : null
}

function FlowParagraph({ parts, role, mode }: { parts: BlockRow[]; role: FlowRole; mode: FlowMode }): JSX.Element {
  // 浅比较：翻译进度事件很密，只有这一段自己的块变了才重渲
  const states = usePaper(useShallow((s) => parts.map((p) => s.translations[p.block_id])))
  const lang = useApp((s) => s.targetLang)
  const cjk = lang === 'zh' || lang === 'ja' || lang === 'ko'
  const head = parts[0]
  // 参考文献整节只显示原文（旧版本译过的也不显示）
  const translated = role !== 'ref' && states.every((s) => s?.text)
  const pending = role !== 'ref' && !translated && states.some((s) => s?.pending)
  const original = renderParts(parts, parts.map((p) => p.text), false)
  const translation = translated
    ? renderParts(parts, parts.map((p, k) => shownTranslation(p, states[k]?.text ?? '')), cjk)
    : null
  const showOriginal = mode === 'both' || !translated
  return (
    <div className={`flow-block flow-para flow-para--${role}`} data-order={head.block_order} data-page={head.page}>
      {showOriginal && <p className={translated || mode === 'both' ? 'flow-orig' : 'flow-orig flow-orig--alone'}>{original}</p>}
      {translation && <p className="flow-trans">{translation}</p>}
      {pending && <p className="flow-trans flow-trans--pending" aria-hidden />}
    </div>
  )
}

function FlowHeading({ block, mode }: { block: BlockRow; mode: FlowMode }): JSX.Element {
  const state = usePaper((s) => s.translations[block.block_id])
  const level = Math.min(3, Math.max(1, block.heading_level ?? 1))
  const Tag = (`h${level + 1}` as 'h2' | 'h3' | 'h4')
  const ctx = inlineCtx(block)
  const zh = state?.text ? shownTranslation(block, state.text) : null
  return (
    <Tag className={`flow-block flow-h flow-h--${level}`} data-order={block.block_order} data-page={block.page}>
      {mode === 'zh' && zh ? (
        renderInline(zh, `${block.block_id}:h`, ctx)
      ) : (
        <>
          <span className="flow-h-orig">{renderInline(block.text, `${block.block_id}:ho`, ctx)}</span>
          {zh && zh !== block.text && <span className="flow-h-trans">{renderInline(zh, `${block.block_id}:ht`, ctx)}</span>}
        </>
      )}
    </Tag>
  )
}

/**
 * 一页的内容：接近视口才挂载（长文档不必一次渲染几百段、取几百张公式截图），挂上后不再卸载，
 * 免得来回滚动时高度变化、位置跳动。未挂载时按文字量估一个高度占位
 */
function FlowPage({ page, items, mode, pxPerPt, estimate }: { page: number; items: FlowItem[]; mode: FlowMode; pxPerPt: number; estimate: number }): JSX.Element {
  const ref = useRef<HTMLElement | null>(null)
  const [mounted, setMounted] = useState(page <= 2)
  useEffect(() => {
    const el = ref.current
    if (!el || mounted) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setMounted(true), { rootMargin: '1600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [mounted])
  return (
    <section ref={ref} className="flow-page" data-page={page} style={mounted ? undefined : { minHeight: `${estimate}px` }}>
      {mounted &&
        items.map((item) => {
          const b = firstBlock(item)
          if (item.type === 'heading') return <FlowHeading key={b.block_id} block={item.block} mode={mode} />
          if (item.type === 'para') return <FlowParagraph key={b.block_id} parts={item.parts} role={item.role} mode={mode} />
          return (
            <div key={b.block_id} className="flow-figs">
              {item.blocks.map((fb) => (
                <FlowFigure key={fb.block_id} block={fb} pxPerPt={pxPerPt} />
              ))}
            </div>
          )
        })}
    </section>
  )
}

/**
 * 来源切换：arXiv 网页版 / PDF 解析。放在工具栏右侧（不压在纸面上），
 * 只在这篇论文有 arXiv 网页版（或这次没连上）时出现；说明文字放在悬停提示里
 */
function SourceToggle({ arxiv, useHtml, onRetry }: { arxiv: ArxivState; useHtml: boolean; onRetry: () => void }): JSX.Element | null {
  const t = useT()
  const setFlowSource = useApp((s) => s.setFlowSource)
  if (arxiv.status === 'offline' && arxiv.arxivId) {
    return (
      <button className="tb-link tb-link--dim" title={t('flow.source.offline')} onClick={onRetry}>
        {t('flow.source.retry')}
      </button>
    )
  }
  if (arxiv.status !== 'ready') return null
  const item = (active: boolean, label: string, tip: string, source: 'arxiv' | 'pdf'): JSX.Element => (
    <button
      className="seg-item"
      title={tip}
      aria-pressed={active}
      style={active ? { background: 'var(--acc)', color: 'var(--on-acc)' } : undefined}
      onClick={() => setFlowSource(source)}
    >
      {label}
    </button>
  )
  return (
    <div className="seg-control tb-source-seg" role="group" aria-label={t('flow.source.label')}>
      {item(useHtml, t('flow.source.arxiv'), t('flow.source.arxiv-hint', { id: arxiv.arxivId }), 'arxiv')}
      {item(!useHtml, t('flow.source.pdf'), t('flow.source.pdf-hint'), 'pdf')}
    </div>
  )
}

export function FlowView({ mode }: { mode: FlowMode }): JSX.Element | null {
  const bundle = usePaper((s) => s.bundle)
  const zoom = useApp((s) => s.pageZoom)
  const zhScale = useApp((s) => s.zhTextScale)
  const flowSource = useApp((s) => s.flowSource)
  const sourceSlot = useApp((s) => s.tbSourceSlot)
  const t = useT()
  const [retry, setRetry] = useState(0)
  const arxiv = useArxivSource(bundle?.paper.id ?? '', retry)
  const useHtml = flowSource === 'arxiv' && arxiv.status === 'ready'
  const blocks = bundle?.blocks
  const bodyPt = useMemo(() => bodyFontPt(blocks ?? []), [blocks])
  const pages = useMemo(() => {
    const byPage = new Map<number, FlowItem[]>()
    for (const item of buildItems(blocks ?? [], bodyPt)) {
      const p = firstBlock(item).page
      const list = byPage.get(p)
      if (list) list.push(item)
      else byPage.set(p, [item])
    }
    return [...byPage.entries()].sort((a, b) => a[0] - b[0])
  }, [blocks, bodyPt])
  if (!bundle) return null
  const toggle = <SourceToggle arxiv={arxiv} useHtml={useHtml} onRetry={() => setRetry((n) => n + 1)} />
  // 正文字号随缩放走；图、公式按「正文 px / 正文 pt」换算，和文字保持同一比例
  const fontPx = 16 * zoom
  const pxPerPt = fontPx / bodyPt
  const estimate = (items: FlowItem[]): number =>
    items.reduce((h, item) => {
      if (item.type === 'figures') return h + item.blocks.reduce((m, b) => Math.max(m, (parseBbox(b)?.[3] ?? 120) * pxPerPt), 0) + 24
      const chars = item.type === 'heading' ? item.block.text.length : item.parts.reduce((n, p) => n + p.text.length, 0)
      return h + Math.ceil(chars / 80) * fontPx * 1.7 * (mode === 'both' ? 2 : 1) + 16
    }, 0)
  return (
    <>
    {sourceSlot && createPortal(toggle, sourceSlot)}
    <div className={`flow-doc flow-doc--${mode}`} style={{ fontSize: `${fontPx}px`, ['--flow-zh-scale' as string]: String(zhScale) }} aria-label={t('reader.view.bilingual')}>
      {useHtml && arxiv.status === 'ready' ? (
        <ArxivFlow units={arxiv.units} mode={mode} paperId={bundle.paper.id} blocks={bundle.blocks} />
      ) : (
        pages.map(([page, items]) => <FlowPage key={page} page={page} items={items} mode={mode} pxPerPt={pxPerPt} estimate={estimate(items)} />)
      )}
    </div>
    </>
  )
}
