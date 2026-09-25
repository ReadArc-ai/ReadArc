/**
 * 「原版对照」视图：左列 pdf.js 整页渲染（图/表/公式像素级还原），
 * 右列该页段落的平行译文——按段落 bbox 的纵向位置向下推挤对齐，
 * 读起来就是"左边原页、右边平行译文"。窄窗（sm）只留页面。
 */
import { useEffect, useMemo, useState, type JSX } from 'react'
import { tNow } from '../../i18n'
import { errText } from '../../lib/errors'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pdfAssetOptions } from '../../lib/pdf-assets'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { BlockRow } from '../../../shared/models'
import { useApp } from '../../store/app'
import { usePaper } from '../../store/paper'
import { useNotes } from '../../store/notes'
import '../../lib/thumbnails'
import { PageInfo, Page } from './PdfPage'
import { TranslatedPage } from './TranslatedPage'


export type PageViewMode = 'pair' | 'orig' | 'zh'

export function PdfPageView({
  paperId,
  mode
}: {
  paperId: string
  /** pair = 原版｜镜像并排；orig = 纯原版页；zh = 整宽镜像译文页 */
  mode: PageViewMode
}): JSX.Element {
  const bundle = usePaper((s) => s.bundle)
  const tier = useApp((s) => s.tier)
  const zoom = useApp((s) => s.pageZoom)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState<PageInfo[]>([])
  const [error, setError] = useState<string | null>(null)

  // pair 在 sm 档左右放不下：改成原文页在上、译文页在下（原来直接不显示译文，工具栏却还标着「原版对照」）
  const paired = mode === 'pair' && tier !== 'sm'
  const showOrig = mode !== 'zh'
  const showTrans = mode === 'pair' || mode === 'zh'

  const blocksByPage = useMemo(() => {
    const map = new Map<number, BlockRow[]>()
    for (const b of bundle?.blocks ?? []) {
      const list = map.get(b.page)
      if (list) list.push(b)
      else map.set(b.page, [b])
    }
    return map
  }, [bundle])

  // 高亮覆盖层的数据源：打开论文就加载笔记（不等笔记面板）
  useEffect(() => {
    void useNotes.getState().load(paperId)
  }, [paperId])

  useEffect(() => {
    let cancelled = false
    let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null

    void (async () => {
      try {
        const bytes = await window.readarc.paperFile(paperId)
        if (!bytes || cancelled) {
          if (!bytes) setError(tNow('doc.pdf-missing'))
          return
        }
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), ...pdfAssetOptions() })
        const loaded = await loadingTask.promise
        if (cancelled) return
        const infos: PageInfo[] = []
        for (let n = 1; n <= loaded.numPages; n++) {
          const vp = (await loaded.getPage(n)).getViewport({ scale: 1 })
          infos.push({ width: vp.width, height: vp.height })
        }
        if (cancelled) return
        setDoc(loaded)
        setPages(infos)
      } catch (err) {
        if (!cancelled) setError(errText(err))
      }
    })()

    return () => {
      cancelled = true
      void loadingTask?.destroy()
    }
  }, [paperId])

  if (error) {
    return <p className="placeholder-note">{error}</p>
  }

  // zh 模式无需 pdf 文档也能渲染镜像页（尺寸取自块 bbox 所属页信息）——
  // 但页面尺寸来自 pdf 文档加载；未加载完成前显示占位
  return (
    <div
      className={`pdf-pages${paired ? ' pdf-pages--paired' : ''}`}
      style={{ width: `${zoom * 100}%`, maxWidth: zoom > 1 ? 'none' : undefined }}
    >
      {doc &&
        pages.map((info, i) => (
          // key 含 zoom：缩放后重挂载按新宽度重渲，保持位图清晰
          <div className="pdf-row" key={`${i}@${zoom}`}>
            {showOrig && <Page doc={doc} pageNum={i + 1} info={info} paperId={paperId} />}
            {showTrans && (
              <TranslatedPage doc={doc} blocks={blocksByPage.get(i + 1) ?? []} info={info} paperId={paperId} pageNum={i + 1} />
            )}
          </div>
        ))}
      {!doc && (
        <div className="pdf-row">
          <div className="pdf-page pdf-page--loading" style={{ aspectRatio: '612 / 792' }} />
        </div>
      )}
    </div>
  )
}
