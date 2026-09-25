import { useNeedsTranslation } from '../../lib/paper-lang'
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { jumpToBlock } from '../../store/chat'
import { formatTokens } from '../../lib/format'
import { errText } from '../../lib/errors'
import { GEN_ABORTED } from '../../../shared/ipc'
import type { PaperSummary } from '../../../shared/models'
import { skipTranslation } from '../../../shared/lang'
import { useGen, useGenStream } from '../../store/gen'
import { Markdown } from '../../lib/md'
import { useApp } from '../../store/app'
import { usePaper } from '../../store/paper'
import { useT } from '../../i18n'
import { PdfPageView } from './PageView'
import { parseBbox } from './page-text'
import { StreamBox } from './StreamBox'
import { ThinkingBlock } from './Thinking'
import { CropOverlay } from './CropOverlay'

/** AI 三句话摘要卡：--bg2 底、左边框 2px --cy；按需生成一次并缓存。 */
function SummaryCard({ paperId }: { paperId: string }): JSX.Element {
  const t = useT()
  const [summary, setSummary] = useState<PaperSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streaming = useGenStream('summary', paperId)
  const thinking = useGenStream('summary:thinking', paperId)
  const collapsed = useApp((s) => s.summaryCollapsed)
  const toggleCollapsed = useApp((s) => s.toggleSummaryCollapsed)

  // 摘要按目标语言分开缓存；论文重新载入（改了目标语言、在设置里清了摘要）时也重取一次
  const targetLang = useApp((s) => s.targetLang)
  const bundle = usePaper((s) => s.bundle)
  useEffect(() => {
    let live = true
    window.readarc
      .getSummary(paperId)
      .then((v) => {
        if (live) setSummary(v)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [paperId, targetLang, bundle])

  // force：无视缓存重新生成（换了模型、或上一次生成得不好）。重生成期间旧摘要先留着，
  // 流式草稿一到就替换显示，失败则回到旧摘要
  // 版面识别没做完时分段还是启发式的，摘要先不生成
  const layoutPending = usePaper((s) => s.bundle?.paper.layout_state === 'pending')
  const generate = async (force = false): Promise<void> => {
    setBusy(true)
    setError(null)
    useGen.getState().clear('summary')
    useGen.getState().clear('summary:thinking')
    try {
      setSummary(await window.readarc.generateSummary(paperId, force))
    } catch (err) {
      // 用户自己按的停止：安静回到待命态，不当报错显示
      if (!errText(err).includes(GEN_ABORTED)) setError(errText(err))
    } finally {
      setBusy(false)
      useGen.getState().clear('summary')
      useGen.getState().clear('summary:thinking')
    }
  }

  // 还没生成时只占一行：标签 + 一个文字按钮。原先是整张卡片里放一个大按钮，
  // 和上面的翻译横幅叠在一起，论文首页被推到屏幕下半截
  const generating = busy && (!!streaming || !!thinking)
  if (!summary && !error && !generating) {
    return (
      <div className="summary-card summary-card--empty">
        <span className="summary-label">{t('doc.summary-label')}</span>
        <button className="summary-inline-btn" onClick={() => void generate()} disabled={busy || layoutPending} title={layoutPending ? t('doc.layout-wait') : undefined}>
          {busy ? t('doc.generating') : t('doc.gen-summary')}
        </button>
        {/* 供应商挂住时至少能退出来，不用干等看门狗 */}
        {busy && (
          <button className="summary-inline-btn" onClick={() => window.readarc.stopGen('summary', paperId)}>
            {t('common.stop')}
          </button>
        )}
      </div>
    )
  }

  // 收起只留标题行（全局记住）；正在流式生成时总是展开，不然看不到在生成什么
  const folded = collapsed && !generating
  return (
    <div className={folded ? 'summary-card summary-card--folded' : 'summary-card'}>
      <div className="summary-head">
        <button
          className="summary-fold"
          onClick={toggleCollapsed}
          title={collapsed ? t('doc.summary-unfold') : t('doc.summary-fold')}
          aria-expanded={!folded}
        >
          <svg className={folded ? 'summary-fold-chev' : 'summary-fold-chev is-open'} width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4.5 3l3 3-3 3" />
          </svg>
          <span className="summary-label">{t('doc.summary-label')}</span>
        </button>
        {summary && !folded && (
          <span className="summary-head-actions">
            {/* 哪个模型生成的只放在提示里：界面上不再到处出现模型名 */}
            <button className="summary-inline-btn" onClick={() => void generate(true)} disabled={busy || layoutPending} title={t('doc.regen-summary-tip', { model: summary.model })}>
              {busy ? t('doc.generating') : t('doc.regen-summary')}
            </button>
            {busy && (
              <button className="summary-inline-btn" onClick={() => window.readarc.stopGen('summary', paperId)}>
                {t('common.stop')}
              </button>
            )}
          </span>
        )}
      </div>
      {!folded && busy && <ThinkingBlock thinking={thinking} live={!streaming} />}
      {folded ? null : busy && streaming ? (
        <StreamBox className="summary-text summary-text--streaming" text={streaming} />
      ) : busy && thinking ? null : summary ? (
        <Markdown className="summary-text" text={summary.text} />
      ) : (
        <div className="zh-error">
          <span>{error}</span>
          <button onClick={() => void generate()}>{t('common.retry')}</button>
        </div>
      )}
    </div>
  )
}

export function ReaderDocument({
  scrollRef
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>
}): JSX.Element | null {
  const bundle = usePaper((s) => s.bundle)
  const reportScroll = usePaper((s) => s.reportScroll)
  const translating = usePaper((s) => s.translating)
  const translations = usePaper((s) => s.translations)
  const startTranslation = usePaper((s) => s.startTranslation)
  // 后台版面识别没做完：分段是启发式的，整篇翻译先别花钱，等模型分段换上来
  const layoutPending = usePaper((s) => s.bundle?.paper.layout_state === 'pending')
  const layoutProgress = usePaper((s) => s.layoutProgress)
  const needsTranslation = useNeedsTranslation()
  const targetLang = useApp((s) => s.targetLang)
  const translateError = usePaper((s) => s.translateError)
  const translateTotal = usePaper((s) => s.translateTotal)
  const translateUsage = usePaper((s) => s.translateUsage)
  const stopTranslation = usePaper((s) => s.stopTranslation)
  const pendingEstimate = usePaper((s) => s.pendingEstimate)
  const pendingForce = usePaper((s) => s.pendingForce)
  const pendingOverride = usePaper((s) => s.pendingOverride)
  const cancelEstimate = usePaper((s) => s.cancelEstimate)
  // 论文本来就是目标语言时只显示原文；用户选的视图不改，换回需要翻译的论文还按它显示
  const storedView = useApp((s) => s.view)
  const view = needsTranslation ? storedView : 'orig'
  const offline = useApp((s) => s.offline)
  const tbSlot = useApp((s) => s.tbSlot)
  // 纸面深浅（工具栏一键切换；没切过时跟随界面主题）
  const paperDark = useApp((s) => s.paperDark ?? false)
  const t = useT()
  const restored = useRef<string | null>(null)
  /** 正在把位置恢复到上次读到的地方：这期间的滚动是程序滚的，不算阅读进度 */
  const restoring = useRef(false)


  // ⌘/Ctrl + 滚轮缩放（触控板捏合在 Chromium 里也是 ctrlKey 的 wheel 事件）。
  // 要 preventDefault 拦住浏览器自己的页面缩放，必须挂非 passive 的原生监听（React 的 onWheel 是 passive 的）。
  // 滚轮事件很密，而每次改缩放都会按新宽度重渲页面位图：把增量攒够一档（0.1）再动，别一滚一串重渲。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let acc = 0
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      // 触控板捏合的 deltaY 很小（每次 1–3），鼠标滚轮一格约 100：分别按各自的节奏攒，
      // 鼠标一格 = 一档（0.1），捏合约十几次事件一档
      acc += -e.deltaY * (Math.abs(e.deltaY) < 10 ? 6 : 1)
      if (Math.abs(acc) < 100) return
      const steps = Math.trunc(acc / 100)
      acc -= steps * 100
      const { pageZoom, setPageZoom } = useApp.getState()
      setPageZoom(pageZoom + steps * 0.1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scrollRef])

  // 打开论文即恢复上次滚动位置 [P1]，且不显示加载态。
  // 只在下一帧设一次不行：那一刻页面还没铺开（页面画布、镜像块的字号拟合都会改高度），
  // scrollHeight 还很小，算出来的位置几乎是 0，看起来就是「没恢复」。这里反复校正到高度稳定，
  // 或者用户自己动了滚轮为止。恢复完成前不上报进度，免得把存着的位置覆盖成 0。
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !bundle) return
    if (restored.current === bundle.paper.id) return
    restored.current = bundle.paper.id
    const ratio = bundle.paper.scroll_position
    restoring.current = ratio > 0
    if (!(ratio > 0)) return
    let stop = false
    const done = (): void => {
      stop = true
      restoring.current = false
    }
    el.addEventListener('wheel', done, { passive: true, once: true })
    el.addEventListener('touchstart', done, { passive: true, once: true })
    const deadline = Date.now() + 4000
    let lastHeight = -1
    const tick = (): void => {
      const node = scrollRef.current
      if (stop || !node) return
      const denom = node.scrollHeight - node.clientHeight
      if (denom > 0) node.scrollTop = ratio * denom
      if (node.scrollHeight !== lastHeight && Date.now() < deadline) {
        lastHeight = node.scrollHeight
        setTimeout(() => requestAnimationFrame(tick), 120)
      } else {
        done()
      }
    }
    requestAnimationFrame(tick)
    return () => {
      stop = true
      restoring.current = false
      el.removeEventListener('wheel', done)
      el.removeEventListener('touchstart', done)
    }
  }, [bundle, scrollRef])

  const lastFocusReport = useRef(0)
  const scrollRaf = useRef(0)

  // 当前章节：页面上没有逐个标题的节点可量，按「视口顶部在第几页、页内多深」
  // 对照目录条目的页码和标题块的纵坐标来算。每页的内容高度取该页块的最低边，页内深度按比例换算
  const sectionGeometry = useMemo(() => {
    const headingY = new Map<number, number>()
    const pageBottom = new Map<number, number>()
    for (const b of bundle?.blocks ?? []) {
      const box = parseBbox(b)
      if (!box) continue
      pageBottom.set(b.page, Math.max(pageBottom.get(b.page) ?? 0, box[1] + box[3]))
      if (b.kind === 'heading') headingY.set(b.block_order, box[1])
    }
    return { headingY, pageBottom }
  }, [bundle])

  const runScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || !bundle) return
    const denom = el.scrollHeight - el.clientHeight
    const ratio = denom > 0 ? el.scrollTop / denom : 1
    const pct = Math.min(100, ratio * 100 + (el.clientHeight / el.scrollHeight) * 100 * 0.2)
    // 视口顶部往下 60px 处落在哪一页、页内多深（0–1）
    let section: string | null = usePaper.getState().currentSection
    const probe = el.getBoundingClientRect().top + 60
    let curPage = 0
    let depth = 0
    for (const p of el.querySelectorAll<HTMLElement>('.pdf-page[data-page]')) {
      const r = p.getBoundingClientRect()
      if (r.top > probe) break
      curPage = Number(p.dataset.page)
      depth = r.height > 0 ? Math.min(1, (probe - r.top) / r.height) : 0
    }
    if (curPage > 0 && bundle.outline.length > 0) {
      section = null
      const { headingY, pageBottom } = sectionGeometry
      for (const o of bundle.outline) {
        if (o.page > curPage) break
        if (o.page === curPage) {
          const y = headingY.get(o.order)
          const bottom = pageBottom.get(o.page) ?? 0
          if (y != null && bottom > 0 && y / bottom > depth) break
        }
        section = o.title
      }
    }
    if (!restoring.current) reportScroll(pct, ratio, section)

    // 视口优先翻译：翻译进行中时把"当前看到的页"报给主进程，节流 600ms。
    // 工作池会优先认领离这里最近的批次——翻到哪，译到哪。
    const st = usePaper.getState()
    if (st.translating && Date.now() - lastFocusReport.current > 600) {
      lastFocusReport.current = Date.now()
      const top = el.getBoundingClientRect().top
      const pages = el.querySelectorAll<HTMLElement>('.pdf-page[data-page]')
      for (const p of pages) {
        const r = p.getBoundingClientRect()
        if (r.bottom > top + 40) {
          const page = Number(p.dataset.page)
          const first = bundle.blocks.find(
            (b) => b.page === page && (b.kind === 'para' || b.kind === 'heading')
          )
          if (first) window.readarc.reportTranslateFocus(bundle.paper.id, first.block_order)
          break
        }
      }
    }
  }, [bundle, reportScroll, scrollRef, sectionGeometry])

  // 滚动事件在 120Hz 屏上一帧可来多次；合帧执行，一帧最多算一次
  const onScroll = useCallback(() => {
    if (scrollRaf.current) return
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0
      runScroll()
    })
  }, [runScroll])

  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), [])

  if (!bundle) return null
  const { paper, blocks } = bundle
  // 跳过翻译的段（中文原文、参考文献条目）不算「待翻译」：口径与主进程一致，
  // 否则工具栏会一直显示「还有 N 段未翻译」，点了也不会有变化
  const paras = blocks.filter((b) => (b.kind === 'para' || b.kind === 'heading') && !skipTranslation(b.text, targetLang))
  const untranslated = paras.filter((b) => !translations[b.block_id]?.text).length
  // 进度按「还在等模型」的段数算，而不是按「没有译文」的段数：整篇重译时旧译文留在屏上，
  // 按后者算进度会一直是 100%
  const pendingCount = paras.filter((b) => translations[b.block_id]?.pending).length
  const showBanner = needsTranslation && view !== 'orig' && !translating && untranslated > 0 && !layoutPending
  // 版面识别期间不显示「已全文翻译 · 重译」：分段马上会换，这时点重译会被主进程拒绝
  const allDone = needsTranslation && view !== 'orig' && !translating && paras.length > 0 && untranslated === 0 && !layoutPending
  const showProgress = needsTranslation && view !== 'orig' && translating
  // 「由 X 翻译」：按段统计出自哪些模型，最多的排前面；混用时标明一共几个
  const modelCounts = new Map<string, number>()
  for (const b of paras) {
    const tr = translations[b.block_id]
    // identity = 原样当译文的段（纯符号 / 作者栏），不是模型
    if (tr?.text && tr.model && tr.model !== 'identity') modelCounts.set(tr.model, (modelCounts.get(tr.model) ?? 0) + 1)
  }
  const modelsSorted = [...modelCounts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m)
  // 扫描件：解析出了块但一段文字都没有。不说一句的话，用户切到译文视图只看到空白，
  // 会以为是应用坏了而不是这份 PDF 本来就没有文本层。
  const noTextLayer = view !== 'orig' && blocks.length > 0 && paras.length === 0
  // 版面识别没做完时只给原版页：启发式分段拼出来的镜像页字号、块框都不准，
  // 会被撑得比原版长一大截，看着像只有一页。识别完成后自动回到用户选的视图
  const mode = layoutPending ? 'orig' : view === 'page' ? 'pair' : view === 'orig' ? 'orig' : 'zh'

  // 翻译相关横幅（原版对照与译文视图共用）
  const banners = (
    <>
      {translateError && (
        <div className="doc-notice doc-notice--confirm">
          <span>{translateError}</span>
          {/模型|供应商|API Key|model|provider|API key/i.test(translateError) && (
            <button onClick={() => useApp.getState().setSettingsOpen(true, 'models')}>
              {t('common.open-settings')}
            </button>
          )}
          <button className="route-cancel" onClick={() => usePaper.setState({ translateError: null })}>
            {t('common.got-it')}
          </button>
        </div>
      )}
      {pendingEstimate && (
        // [P7] 花钱前先问：预估值与依据（token 数 × 单价），就地确认不弹模态
        <div className="doc-notice doc-notice--confirm">
          <span>
            {t('doc.estimate')}
            <strong>${pendingEstimate.usd?.toFixed(2)}</strong>
            {t('doc.estimate-detail', {
              paras: pendingEstimate.paraCount,
              k: Math.round((pendingEstimate.inputTokens + pendingEstimate.outputTokens) / 1000)
            })}
            {pendingEstimate.model})
          </span>
          <button onClick={() => void startTranslation(true, pendingForce, pendingOverride)}>
            {t('doc.continue-translate')}
          </button>
          <button className="route-cancel" onClick={cancelEstimate}>
            {t('common.cancel')}
          </button>
        </div>
      )}
      {offline && view !== 'orig' && <div className="doc-notice">{t('offline.reader')}</div>}
      {noTextLayer && <div className="doc-notice">{t('doc.no-text-layer')}</div>}
    </>
  )

  // 翻译状态：挂在工具栏视图切换旁（挂载点由工具栏登记），一行紧凑文字 + 文字按钮，
  // 不再是正文上方的整条横幅。费用确认、报错这些临时提示仍留在正文上方
  const status = (
    <span className="tb-tr">
      {allDone && !pendingEstimate && (
        <>
          <span className="tb-tr-ok">✓</span>
          {/* 由哪个模型译的只放在提示里；模型统一在设置里选，阅读界面不再放切换器 */}
          <span
            className="tb-tr-text"
            title={
              modelsSorted.length > 1
                ? t('doc.translated-by-mixed', { model: modelsSorted[0], n: modelsSorted.length })
                : modelsSorted.length === 1
                  ? t('doc.translated-by', { model: modelsSorted[0] })
                  : undefined
            }
          >
            {t('doc.translated-all', { n: paras.length })}
          </span>
          {/* 译得不好或换了设置里的翻译模型：整篇重译并覆盖，走同样的预估确认 */}
          <button className="tb-link" onClick={() => void startTranslation(false, true)} title={t('doc.retranslate-tip')}>
            {t('tb.retranslate')}
          </button>
        </>
      )}
      {showProgress && (
        <>
          <span className="tb-tr-text">
            {t('reader.translating')} · {translateTotal - pendingCount}/{translateTotal}
            {translateUsage && ` · ${formatTokens(translateUsage.inputTokens + translateUsage.outputTokens)} tok`}
          </span>
          <span className="tr-bar tb-tr-bar">
            <span
              style={{
                width: `${translateTotal > 0 ? Math.round(((translateTotal - pendingCount) / translateTotal) * 100) : 0}%`
              }}
            />
          </span>
          <button className="tb-link" onClick={() => void stopTranslation()}>
            {t('doc.pause')}
          </button>
        </>
      )}
      {layoutPending && (
        <>
          <span className="tb-tr-text" title={t('doc.layout-pending-tip')}>
            {layoutProgress && layoutProgress.pages > 0
              ? t('doc.layout-pending', { page: layoutProgress.page, pages: layoutProgress.pages })
              : layoutProgress?.ahead
                ? t('doc.layout-waiting', { n: layoutProgress.ahead })
                : t('doc.layout-queued')}
          </span>
          <span className="tr-bar tb-tr-bar">
            <span
              style={{
                width: `${layoutProgress && layoutProgress.pages > 0 ? Math.round((layoutProgress.page / layoutProgress.pages) * 100) : 0}%`
              }}
            />
          </span>
        </>
      )}
      {showBanner && !pendingEstimate && (
        <>
          <span className="tb-tr-text">{`${untranslated} ${t('reader.paras-untranslated')}`}</span>
          {/* 用设置里的翻译模型（没单独指定就是默认模型） */}
          <button className="tb-link" onClick={() => void startTranslation(false, false)}>
            {untranslated < paras.length ? t('doc.continue-translate') : t('reader.translate-all')}
          </button>
          <button
            className="tb-link tb-link--dim"
            onClick={() => {
              // 跳到第一个未译段，让「未翻译计数」可以直接对照验证
              const first = paras.find((b) => !translations[b.block_id]?.text)
              if (first) jumpToBlock(first.block_order)
            }}
          >
            {t('doc.jump-untranslated')}
          </button>
        </>
      )}
    </span>
  )

  // 三个视图统一 PDF 形态：原版对照（页|镜像）、原文（纯页面）、译文（整宽镜像）。
  // 摘要卡与翻译横幅统一放页面上方。
  return (
    <div className={paperDark ? 'reader-doc reader-doc--paper-dark' : 'reader-doc'} ref={scrollRef} onScroll={onScroll}>
      {tbSlot ? createPortal(status, tbSlot) : null}
      <div className="pdf-banners">
        {!tbSlot && status}
        {banners}
        {/* key 随论文切换重置卡片内部状态 */}
        <SummaryCard key={paper.id} paperId={paper.id} />
      </div>
      {/* key：换论文时整块重建，上一篇的 pdf 文档、报错和字号统计不带过来 */}
      <PdfPageView key={paper.id} paperId={paper.id} mode={mode} />
      <CropOverlay hostRef={scrollRef} />
    </div>
  )
}
