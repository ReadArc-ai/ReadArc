/**
 * ML 版面检测：PP-DocLayoutV2 ONNX（Apache-2.0，PaddleOCR 血统，
 * RapidAI/RapidLayout 转换与前后处理参考，同为 Apache-2.0）。
 * 页面渲染成图 → 检测 25 类区域（正文/标题/公式/图/表/页眉页脚/侧栏水印…）→
 * 文本项按区域归组。模型缺失或推理失败一律返回 null，上层回退启发式解析。
 */
import { existsSync } from 'node:fs'
import { pdfjsAssetDirs } from './pdf-assets'
import { join } from 'node:path'

export interface LayoutRegion {
  label: string
  score: number
  /** PDF 用户空间坐标（y 向上），与文本项同一坐标系 */
  x1: number
  y1: number
  x2: number
  y2: number
  /** 模型输出序 = 阅读序（PP-DocLayoutV2 是版面+阅读顺序联合模型） */
  order: number
}

const MODEL_FILE = 'pp_doc_layoutv2.onnx'
// 模型输入固定 800×800，改小会直接推理失败回退启发式
const INPUT_SIZE = 800
const SCORE_THRESHOLD = 0.45
/** 页面渲染倍率（相对 PDF 点）——太低小字区域检不出 */
const RENDER_SCALE = 2
// 各阶段耗时统计，READARC_PROFILE=1 时打印到主进程日志
const prof = { render: 0, pre: 0, infer: 0, post: 0, blobs: 0 }
/**
 * 图/表截图的渲染倍率。镜像页在 Retina 上把截图拉到 3 倍多（整宽译文视图 ≈ 1.6 CSS px/pt × DPR 2），
 * 按 2 倍裁出来的图会糊；4 倍够到 125% 缩放，文件大小可接受（每篇论文几 MB）。改动此值要连带 ensureFigureQuality 的标记
 */
export const CROP_SCALE = 4
/**
 * 裁剪算法版本：改了裁法（比如加上向墨迹外扩）就 +1，存量论文的截图会在下次打开时重裁。
 * 只靠倍率标记不够——倍率没变但裁法变了，老图会一直带着被切掉的图注。
 */
export const CROP_VERSION = 3

/** 内嵌于模型 metadata 的 25 类；运行时读取失败用这份镜像 */
const FALLBACK_LABELS = [
  'abstract', 'algorithm', 'aside_text', 'chart', 'content', 'display_formula',
  'doc_title', 'figure_title', 'footer', 'footer_image', 'footnote', 'formula_number',
  'header', 'header_image', 'image', 'inline_formula', 'number', 'paragraph_title',
  'reference', 'reference_content', 'seal', 'table', 'text', 'vertical_text', 'vision_footnote'
]

export function modelPath(): string {
  // 打包后在 resources/models；开发时在仓库 resources/models
  const packaged = join(process.resourcesPath ?? '', 'models', MODEL_FILE)
  if (process.resourcesPath && existsSync(packaged)) return packaged
  return join(__dirname, '..', '..', 'resources', 'models', MODEL_FILE)
}

export function modelAvailable(): boolean {
  if (process.env['READARC_DISABLE_ML'] === '1') return false
  try {
    return existsSync(modelPath())
  } catch {
    return false
  }
}

interface OrtModule {
  InferenceSession: {
    create(path: string, opts?: unknown): Promise<{
      run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | Int32Array; dims: number[] }>>
      release?(): Promise<void>
    }>
  }
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown
}

let sessionPromise: Promise<{
  ort: OrtModule
  session: Awaited<ReturnType<OrtModule['InferenceSession']['create']>>
  labels: string[]
}> | null = null

function loadSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      // 原生依赖延迟加载：不可用时让调用方回退启发式
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- 原生依赖延迟加载，失败可回退
      const ort = require('onnxruntime-node') as OrtModule
      const session = await ort.InferenceSession.create(modelPath(), {
        graphOptimizationLevel: 'all',
        // 线程数留给 onnxruntime 按物理核数定；CoreML 后端试过，模型有动态维度只能部分卸载，总耗时没变
        ...(process.env['READARC_ORT_THREADS'] ? { intraOpNumThreads: Number(process.env['READARC_ORT_THREADS']) } : {}),
        // CPU arena 会预留大块内存池且几乎不归还系统：开着的话首次导入后
        // 主进程常驻内存长期停在 1GB 以上。关掉走系统分配器，慢一点但内存会还回去。
        enableCpuMemArena: process.env['READARC_ORT_ARENA'] === '1'
      })
      return { ort, session, labels: FALLBACK_LABELS }
    })()
    sessionPromise.catch(() => {
      sessionPromise = null
    })
  }
  return sessionPromise
}

/**
 * 版面模型只在导入时用得上，却要占几百 MB 常驻内存。导入批次结束就放掉，
 * 让用户读论文的那几小时里不白扛着——代价是下次导入多花不到 1 秒重新加载。
 * 用引用计数是因为多批导入可能重叠（比如正在导入时又拖进来几个文件），
 * 谁都不许把别人正在用的 session 拆掉。
 */
let sessionUsers = 0

export function retainLayoutSession(): void {
  sessionUsers++
}

export async function releaseLayoutSession(): Promise<void> {
  if (sessionUsers > 0) sessionUsers--
  if (sessionUsers > 0) return
  const pending = sessionPromise
  sessionPromise = null
  if (!pending) return
  try {
    const { session } = await pending
    await session.release?.()
  } catch {
    /* 释放失败不致命：下次 loadSession 会重新建 */
  }
}

interface RawImage {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

/** RGBA 图 → 模型输入（拉伸到 800×800，RGB/255，CHW）。 */
function preprocess(img: RawImage, ort: OrtModule) {
  // 用 canvas 拉伸重采样
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 同上
  const { createCanvas, ImageData: NapiImageData } = require('@napi-rs/canvas')
  const src = createCanvas(img.width, img.height)
  const sctx = src.getContext('2d')
  sctx.putImageData(new NapiImageData(Uint8ClampedArray.from(img.data), img.width, img.height), 0, 0)

  const dst = createCanvas(INPUT_SIZE, INPUT_SIZE)
  const dctx = dst.getContext('2d')
  dctx.drawImage(src, 0, 0, INPUT_SIZE, INPUT_SIZE)
  const resized = dctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data

  const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE)
  const plane = INPUT_SIZE * INPUT_SIZE
  for (let i = 0; i < plane; i++) {
    chw[i] = resized[i * 4] / 255
    chw[plane + i] = resized[i * 4 + 1] / 255
    chw[2 * plane + i] = resized[i * 4 + 2] / 255
  }

  return {
    image: new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    im_shape: new ort.Tensor('float32', Float32Array.from([INPUT_SIZE, INPUT_SIZE]), [1, 2]),
    scale_factor: new ort.Tensor(
      'float32',
      Float32Array.from([INPUT_SIZE / img.height, INPUT_SIZE / img.width]),
      [1, 2]
    )
  }
}

function iou(a: number[], b: number[]): number {
  const x1 = Math.max(a[0], b[0])
  const y1 = Math.max(a[1], b[1])
  const x2 = Math.min(a[2], b[2])
  const y2 = Math.min(a[3], b[3])
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = (a[2] - a[0]) * (a[3] - a[1])
  const areaB = (b[2] - b[0]) * (b[3] - b[1])
  return inter / (areaA + areaB - inter + 1e-6)
}

/**
 * 对一页的渲染图跑版面检测。
 * @param img 页面 RGBA 位图（renderScale 倍）
 * @param pageWidth/pageHeight PDF 点单位页面尺寸
 */
export async function detectRegions(
  img: RawImage,
  pageWidth: number,
  pageHeight: number
): Promise<LayoutRegion[]> {
  const { ort, session, labels } = await loadSession()
  const t0 = Date.now()
  const feeds = preprocess(img, ort)
  const t1 = Date.now()
  prof.pre += t1 - t0
  const out = await session.run(feeds)
  prof.infer += Date.now() - t1

  // fetch_name_0: [N,8] = 类别, 置信度, x1, y1, x2, y2, 阅读序, 阅读序'（原图像素坐标，y 向下）
  const boxesT = out['fetch_name_0']
  const data = boxesT.data as Float32Array
  const cols = boxesT.dims[1]
  const n = boxesT.dims[0]

  const scaleX = img.width / pageWidth
  const scaleY = img.height / pageHeight

  // 图像坐标系内做阈值过滤 + 同类 NMS
  const raw: { label: string; score: number; box: number[]; rank: number }[] = []
  for (let i = 0; i < n; i++) {
    const cls = Math.round(data[i * cols])
    const score = data[i * cols + 1]
    if (score < SCORE_THRESHOLD || cls < 0) continue
    const box = [data[i * cols + 2], data[i * cols + 3], data[i * cols + 4], data[i * cols + 5]]
    const label = labels[cls] ?? `cls_${cls}`
    if (raw.some((r) => r.label === label && iou(box, r.box) > 0.5)) continue
    // 第 7 列是模型给的页内阅读顺序（v2 = 版面 + 阅读顺序联合模型）
    const rank = cols >= 8 ? data[i * cols + 6] : i
    raw.push({ label, score, box, rank })
  }
  raw.sort((a, b) => a.rank - b.rank)

  // 图像坐标（y 向下）→ PDF 用户空间（y 向上）
  return raw.map((r, order) => ({
    label: r.label,
    score: r.score,
    x1: r.box[0] / scaleX,
    y1: pageHeight - r.box[3] / scaleY,
    x2: r.box[2] / scaleX,
    y2: pageHeight - r.box[1] / scaleY,
    order
  }))
}

/** 用 pdf.js（legacy + napi canvas）把每页渲染成位图，逐页跑检测。
 *  渲染与推理流水线重叠：ORT 在原生线程池里推理本页时，JS 线程预渲染下一页。 */
export async function detectDocumentRegions(
  pdfData: Buffer,
  onPage?: (done: number, total: number) => void,
  /** 每页文字项（用于漏检兜底：有文字的地方不当作图形） */
  textByPage?: Map<number, { x: number; y: number; width: number; fontSize: number }[]>
): Promise<Map<number, LayoutRegion[]>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 同上
  const { createCanvas } = require('@napi-rs/canvas')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const canvasFactory = {
    create(width: number, height: number) {
      const canvas = createCanvas(Math.ceil(width), Math.ceil(height))
      return { canvas, context: canvas.getContext('2d') }
    },
    reset(target: { canvas: { width: number; height: number } }, width: number, height: number) {
      target.canvas.width = Math.ceil(width)
      target.canvas.height = Math.ceil(height)
    },
    destroy(target: { canvas: { width: number; height: number } | null; context: unknown }) {
      if (target.canvas) {
        target.canvas.width = 0
        target.canvas.height = 0
      }
      target.canvas = null
      target.context = null
    }
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfData),
    // @ts-expect-error node 环境自定义 canvas 工厂
    canvasFactory,
    useSystemFonts: true,
    // 少了这些，中日韩字体的页面栅格化出来是白页：版面模型认不出区域、图表截图也没有字
    ...pdfjsAssetDirs()
  })
  const doc = await loadingTask.promise
  const result = new Map<number, LayoutRegion[]>()

  const renderPage = async (
    p: number
  ): Promise<{ img: { data: Uint8ClampedArray; width: number; height: number }; w: number; h: number }> => {
    const page = await doc.getPage(p)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: RENDER_SCALE })
    const target = canvasFactory.create(viewport.width, viewport.height)
    await page.render({
      canvasContext: target.context,
      viewport,
      canvas: target.canvas
      // napi canvas 与 DOM Canvas 接口兼容，类型系统不知情
    } as unknown as Parameters<typeof page.render>[0]).promise
    const imgData = target.context.getImageData(0, 0, target.canvas.width, target.canvas.height)
    const out = {
      img: { data: imgData.data, width: target.canvas.width, height: target.canvas.height },
      w: base.width,
      h: base.height
    }
    page.cleanup()
    canvasFactory.destroy(target) // imgData 是拷贝，画布立即释放
    return out
  }

  try {
    let next = renderPage(1)
    for (let p = 1; p <= doc.numPages; p++) {
      const tR = Date.now()
      const cur = await next
      prof.render += Date.now() - tR
      // 下一页的渲染和本页的推理重叠；推理本身已经用满 CPU 核，
      // 多页并发推理实测没有收益（33 页 19.0s 对 18.7s，在噪声内），不做
      if (p < doc.numPages) next = renderPage(p + 1)
      const tD = Date.now()
      const regions = await detectRegions(cur.img, cur.w, cur.h)
      prof.post += Date.now() - tD
      const textItems = textByPage?.get(p) ?? []
      // 文字项也算「已被解释的内容」：只有既无区域又无文字的墨迹才补图块
      const asPseudo: LayoutRegion[] = textItems.map((t) => ({
        label: 'text', score: 1, order: 0,
        x1: t.x - 2, y1: t.y - 2, x2: t.x + t.width + 2, y2: t.y + t.fontSize + 2
      }))
      const tB = Date.now()
      const blobs = graphicBlobs(cur.img, cur.w, cur.h, [...regions, ...asPseudo])
      prof.blobs += Date.now() - tB
      result.set(p, [...regions, ...blobs])
      onPage?.(p, doc.numPages)
    }
    if (process.env['READARC_PROFILE']) {
      console.log('[profile] layout', JSON.stringify({ ...prof, post: prof.post - prof.pre - prof.infer, pages: doc.numPages }))
      for (const k of Object.keys(prof) as (keyof typeof prof)[]) prof[k] = 0
    }
  } finally {
    await loadingTask.destroy()
  }
  return result
}

/**
 * 漏检兜底：页面上有墨迹、却既不在任何检测区域内、也没有文字项的连通块，
 * 合成为 image 区域。实测有论文整页只检出 2 个区域，正文外的图表全丢，
 * 镜像页看起来是空的——这道网保证「原文有的东西，译文页至少有个截图」。
 */
export function graphicBlobs(
  img: { data: Uint8ClampedArray; width: number; height: number },
  pageW: number,
  pageH: number,
  regions: LayoutRegion[]
): LayoutRegion[] {
  const G = 48 // 网格边长（格）
  const cw = Math.max(1, Math.floor(img.width / G))
  const ch = Math.max(1, Math.floor(img.height / G))
  const gx = Math.floor(img.width / cw)
  const gy = Math.floor(img.height / ch)
  const ink = new Uint8Array(gx * gy)
  for (let y = 0; y < gy; y++) {
    for (let x = 0; x < gx; x++) {
      let dark = 0
      const x0 = x * cw
      const y0 = y * ch
      for (let py = y0; py < y0 + ch; py += 2) {
        const row = py * img.width
        for (let px = x0; px < x0 + cw; px += 2) {
          const i = (row + px) * 4
          if (img.data[i] < 150 && img.data[i + 3] > 100) dark++
        }
      }
      // 该格有 ≥1.5% 暗像素才算有墨（抗轻微底纹）
      if (dark > ((cw / 2) * (ch / 2)) * 0.015) ink[y * gx + x] = 1
    }
  }
  // 已被检测区域覆盖的格清零（区域是 PDF 坐标、y 向上）
  for (const r of regions) {
    const cx0 = Math.floor((r.x1 / pageW) * gx) - 1
    const cx1 = Math.ceil((r.x2 / pageW) * gx) + 1
    const cy0 = Math.floor(((pageH - r.y2) / pageH) * gy) - 1
    const cy1 = Math.ceil(((pageH - r.y1) / pageH) * gy) + 1
    for (let y = Math.max(0, cy0); y < Math.min(gy, cy1); y++) {
      for (let x = Math.max(0, cx0); x < Math.min(gx, cx1); x++) ink[y * gx + x] = 0
    }
  }
  // 连通块（4 邻域）
  const out: LayoutRegion[] = []
  const seen = new Uint8Array(ink.length)
  const minCells = Math.max(12, Math.round(gx * gy * 0.012)) // 至少占页面 1.2%
  for (let s = 0; s < ink.length; s++) {
    if (!ink[s] || seen[s]) continue
    const stack = [s]
    seen[s] = 1
    const cells: number[] = []
    while (stack.length > 0) {
      const c = stack.pop()!
      cells.push(c)
      const cx = c % gx
      const cy = (c - cx) / gx
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx
        const ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= gx || ny >= gy) continue
        const n = ny * gx + nx
        if (ink[n] && !seen[n]) {
          seen[n] = 1
          stack.push(n)
        }
      }
    }
    if (cells.length < minCells) continue
    let minX = gx
    let maxX = -1
    let minY = gy
    let maxY = -1
    for (const c of cells) {
      const cx = c % gx
      const cy = (c - cx) / gx
      if (cx < minX) minX = cx
      if (cx > maxX) maxX = cx
      if (cy < minY) minY = cy
      if (cy > maxY) maxY = cy
    }
    const pad = 0.004
    const x1 = Math.max(0, (minX / gx - pad) * pageW)
    const x2 = Math.min(pageW, ((maxX + 1) / gx + pad) * pageW)
    const yTop = Math.max(0, (minY / gy - pad) * pageH)
    const yBot = Math.min(pageH, ((maxY + 1) / gy + pad) * pageH)
    out.push({ label: 'image', score: 0.5, order: 9000 + out.length, x1, y1: pageH - yBot, x2, y2: pageH - yTop })
  }
  return out
}

export interface CropRequest {
  /** 输出键（调用方用它对应回 block） */
  key: string
  page: number
  /** PDF 用户空间 bbox [x, y, w, h]（y 向上，与 BlockRow.bbox 同构） */
  bbox: [number, number, number, number]
  /** 行内公式：框两侧紧挨着正文，不做向墨迹外扩（会把邻字扩进来），按框裁 */
  tight?: boolean
  /**
   * 紧贴在上方 / 下方的文字块（PDF y，字号）：above 是上方块的底边，below 是下方块的顶边。
   * 公式框常常压着上一行的下伸部分（CKM 第 3 页式 (1) 顶上带出「is given by」里 g、y 的尾巴），
   * 截图裁到这一行与内容之间的空白处为止
   */
  above?: { y: number; fs: number }
  below?: { y: number; fs: number }
}

/**
 * 按检测框裁出图/表区域的 PNG（只渲染涉及的页面）。
 * 图表数量少（每篇 ~10），单独重渲比在检测流程里攒全页位图省内存。
 */
/** 截图向外扩的上限（PDF 点）：够找回被切掉的图注与坐标轴标签，又不至于把邻栏正文卷进来 */
const MAX_GROW_PT = 26
/** 允许跨过的空白宽度（PDF 点）：字距词距都小于它，栏间空隙远大于它 */
const GAP_PT = 4

interface Ctx2D {
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number }
}

export interface CropBox {
  sx: number
  sy: number
  sw: number
  sh: number
}

/**
 * 把裁剪框向四周扩到墨迹边界：逐列 / 逐行往外看，有墨迹就继续。
 * 字与字之间本来就有空白，遇到第一条空白就停会卡在半个词上（Attention 图 2 的标题被切成
 * 「d Dot-Product Attention」），所以允许跨过 gap 个空白列；栏间的空隙远大于 gap，扩不过去。
 */
export function expandToInk(
  ctx: Ctx2D,
  box: CropBox,
  canvas: { width: number; height: number },
  maxGrow: number,
  gap = 0
): CropBox {
  if (maxGrow <= 0) return box
  const left = Math.max(0, box.sx - maxGrow)
  const top = Math.max(0, box.sy - maxGrow)
  const right = Math.min(canvas.width, box.sx + box.sw + maxGrow)
  const bottom = Math.min(canvas.height, box.sy + box.sh + maxGrow)
  const winW = right - left
  const winH = bottom - top
  if (winW <= 0 || winH <= 0) return box
  const img = ctx.getImageData(left, top, winW, winH)
  const INK = 245 // 比这更暗算有内容；页面底色是白的
  const hasInk = (px: number, py: number): boolean => {
    const i = (py * winW + px) * 4
    const d = img.data
    // 透明像素（未绘制区域）不算墨迹
    return d[i + 3] > 8 && (d[i] < INK || d[i + 1] < INK || d[i + 2] < INK)
  }
  // 相对窗口的坐标
  let x0 = box.sx - left
  let y0 = box.sy - top
  let x1 = x0 + box.sw
  let y1 = y0 + box.sh
  const colInk = (px: number, from: number, to: number): boolean => {
    for (let py = Math.max(0, from); py < Math.min(winH, to); py++) if (hasInk(px, py)) return true
    return false
  }
  const rowInk = (py: number, from: number, to: number): boolean => {
    for (let px = Math.max(0, from); px < Math.min(winW, to); px++) if (hasInk(px, py)) return true
    return false
  }
  /** 从 start 沿 step 走到 limit，返回最远的那条墨迹；连续空白超过 gap 就停 */
  const walk = (start: number, step: number, limit: number, ink: (p: number) => boolean): number => {
    let lastInk = start
    for (let p = start + step; step > 0 ? p < limit : p >= limit; p += step) {
      if (ink(p)) lastInk = p
      else if (Math.abs(p - lastInk) > gap) break
    }
    return lastInk
  }
  x0 = walk(x0, -1, 0, (p) => colInk(p, y0, y1))
  x1 = walk(x1 - 1, 1, winW, (p) => colInk(p, y0, y1)) + 1
  y0 = walk(y0, -1, 0, (p) => rowInk(p, x0, x1))
  y1 = walk(y1 - 1, 1, winH, (p) => rowInk(p, x0, x1)) + 1
  return { sx: left + x0, sy: top + y0, sw: x1 - x0, sh: y1 - y0 }
}

/**
 * 把截图的上下边收到相邻文字行与内容之间的空白处。
 * 上边：从上方文字块的底边往下找第一条整行空白（跨过这一行的下伸部分），截图顶边不高于它。
 * 下边：从下方文字块首行字身里往上找第一条整行空白，截图底边不低于它。
 * 搜索范围限在大半个字号内；内容和文字之间没有空白就不动，宁可带上几个像素也不切掉公式。
 */
export function trimToNeighbours(
  ctx: Ctx2D,
  box: CropBox,
  above: { y: number; fs: number } | null,
  below: { y: number; fs: number } | null
): CropBox {
  let top = box.sy
  let bottom = box.sy + box.sh
  if (box.sw <= 0 || box.sh <= 0) return box
  const img = ctx.getImageData(box.sx, box.sy, box.sw, box.sh)
  const INK = 245
  const blank = (row: number): boolean => {
    const off = (row - box.sy) * box.sw * 4
    for (let px = 0; px < box.sw; px++) {
      const i = off + px * 4
      const d = img.data
      if (d[i + 3] > 8 && (d[i] < INK || d[i + 1] < INK || d[i + 2] < INK)) return false
    }
    return true
  }
  if (above) {
    const from = Math.max(box.sy, Math.round(above.y))
    const to = Math.min(bottom, Math.round(above.y + above.fs * 0.6))
    for (let r = from; r < to; r++) {
      if (blank(r)) {
        top = Math.max(top, r)
        break
      }
    }
  }
  if (below) {
    const from = Math.min(bottom - 1, Math.round(below.y + below.fs * 0.3))
    const to = Math.max(top, Math.round(below.y - below.fs * 0.4))
    for (let r = from; r >= to; r--) {
      if (blank(r)) {
        bottom = Math.min(bottom, r + 1)
        break
      }
    }
  }
  if (bottom - top <= 4) return box
  return { sx: box.sx, sy: top, sw: box.sw, sh: bottom - top }
}

export async function cropRegions(
  pdfData: Buffer,
  requests: CropRequest[]
): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>()
  if (requests.length === 0) return out

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 同上
  const { createCanvas } = require('@napi-rs/canvas')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const byPage = new Map<number, CropRequest[]>()
  for (const r of requests) {
    const list = byPage.get(r.page)
    if (list) list.push(r)
    else byPage.set(r.page, [r])
  }

  const canvasFactory = {
    create(width: number, height: number) {
      const canvas = createCanvas(Math.ceil(width), Math.ceil(height))
      return { canvas, context: canvas.getContext('2d') }
    },
    reset(target: { canvas: { width: number; height: number } }, width: number, height: number) {
      target.canvas.width = Math.ceil(width)
      target.canvas.height = Math.ceil(height)
    },
    destroy(target: { canvas: { width: number; height: number } | null; context: unknown }) {
      target.canvas = null
      target.context = null
    }
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfData),
    // @ts-expect-error node 环境自定义 canvas 工厂
    canvasFactory,
    useSystemFonts: true,
    // 少了这些，中日韩字体的页面栅格化出来是白页：版面模型认不出区域、图表截图也没有字
    ...pdfjsAssetDirs()
  })
  const doc = await loadingTask.promise
  try {
    for (const [pageNum, reqs] of byPage) {
      if (pageNum < 1 || pageNum > doc.numPages) continue
      const page = await doc.getPage(pageNum)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: CROP_SCALE })
      const target = canvasFactory.create(viewport.width, viewport.height)
      await page.render({
        canvasContext: target.context,
        viewport,
        canvas: target.canvas
      } as unknown as Parameters<typeof page.render>[0]).promise

      const scaleX = target.canvas.width / base.width
      const scaleY = target.canvas.height / base.height
      for (const r of reqs) {
        const [x, y, w, h] = r.bbox
        // 行内公式两侧紧挨正文，余量只留 1px；图表留 3px
        const PAD = r.tight ? 1 : 3
        // PDF y 向上 → 图像 y 向下
        const sx0 = Math.max(0, Math.floor(x * scaleX) - PAD)
        const sy0 = Math.max(0, Math.floor((base.height - y - h) * scaleY) - PAD)
        const sw0 = Math.min(target.canvas.width - sx0, Math.ceil(w * scaleX) + PAD * 2)
        const sh0 = Math.min(target.canvas.height - sy0, Math.ceil(h * scaleY) + PAD * 2)
        if (sw0 <= 4 || sh0 <= 4) continue
        // 版面模型给的框常常压着内容边（Attention 图 2 的标题被切成「d Dot-Product Attention」）：
        // 从框边往外走，只要那一列 / 行还有墨迹就继续扩，遇到整条空白就停，最多扩 MAX_GROW_PT。
        const grown = r.tight
          ? { sx: sx0, sy: sy0, sw: sw0, sh: sh0 }
          : expandToInk(
              target.context as unknown as Ctx2D,
              { sx: sx0, sy: sy0, sw: sw0, sh: sh0 },
              { width: target.canvas.width, height: target.canvas.height },
              Math.round(MAX_GROW_PT * Math.max(scaleX, scaleY)),
              Math.round(GAP_PT * Math.max(scaleX, scaleY))
            )
        // 相邻文字块的边换算到图像坐标（y 向下），字号换算成像素
        const toImg = (n?: { y: number; fs: number }): { y: number; fs: number } | null =>
          n ? { y: (base.height - n.y) * scaleY, fs: n.fs * scaleY } : null
        const { sx, sy, sw, sh } =
          r.tight || (!r.above && !r.below)
            ? grown
            : trimToNeighbours(target.context as unknown as Ctx2D, grown, toImg(r.above), toImg(r.below))
        const crop = createCanvas(sw, sh)
        crop.getContext('2d').drawImage(target.canvas, sx, sy, sw, sh, 0, 0, sw, sh)
        out.set(r.key, crop.toBuffer('image/png'))
      }
      page.cleanup()
    }
  } finally {
    await loadingTask.destroy()
  }
  return out
}
