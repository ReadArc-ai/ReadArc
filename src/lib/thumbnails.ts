/**
 * PDF 首页缩略图：渲染进程用 pdf.js 画首页 → PNG data URL → 主进程落盘。
 * 封面即论文首页；任何失败都回退版面纹理占位，不报错。
 */
/* legacy 构建：新 pdf.js 用了 Electron 的 Chromium 尚未支持的 JS API
   （Map.getOrInsertComputed），legacy 版自带 polyfill——主进程同款选择 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { pdfAssetOptions } from './pdf-assets'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** 封面网格 136px 宽 × 2 倍屏 */
const THUMB_WIDTH = 272

const inFlight = new Map<string, Promise<string | null>>()

async function render(paperId: string): Promise<string | null> {
  try {
    const cached = await window.readarc.getThumbnail(paperId)
    if (cached) return cached

    const bytes = await window.readarc.paperFile(paperId)
    if (!bytes) return null

    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), ...pdfAssetOptions() })
    const doc = await loadingTask.promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width })

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    await loadingTask.destroy()

    const dataUrl = canvas.toDataURL('image/png')
    await window.readarc.saveThumbnail(paperId, dataUrl)
    return dataUrl
  } catch (err) {
    console.warn('thumbnail render failed:', err)
    return null
  }
}

/** 并发去重：同一篇只渲染一次。 */
export function ensureThumbnail(paperId: string): Promise<string | null> {
  let p = inFlight.get(paperId)
  if (!p) {
    p = render(paperId).finally(() => inFlight.delete(paperId))
    inFlight.set(paperId, p)
  }
  return p
}
