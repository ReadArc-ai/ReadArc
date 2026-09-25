/**
 * PDF.js 文本层提取 → PageItems（layout.ts 的输入）。
 * 用 legacy 构建在 Node（主进程）跑；渲染进程另用标准构建做视觉渲染。
 */
import { readFile } from 'node:fs/promises'
import type { PageItems } from './layout'
import { pdfjsAssetDirs } from './pdf-assets'
import { collidingTexts, hiddenItems, hiddenTextOrigins } from './occlusion'


interface PdfTextItem {
  str: string
  transform: number[]
  width: number
  height: number
  fontName?: string
}

export interface ExtractResult {
  pages: PageItems[]
  /** 原始字节，供上层算内容哈希（block_id 的根） */
  data: Buffer
}

/** 按字体真名判定粗体：Times/Nimbus 的 -Medi、CM 的 CMBX、常见 -Bold/Black 等。 */
export function isBoldFontName(name: string): boolean {
  return /bold|black|heavy|semib|demib|-medi\b|-medi$|cmbx|cmb\d|\bbx\d/i.test(name)
}

/**
 * 按字体真名判定数学字体：LaTeX 的花体 / 符号（CMSY）、数学斜体（CMMI）、大符号（CMEX）、
 * AMS 符号与黑板体（MSAM / MSBM）、rsfs 花体、欧拉花体（eufm / eusm），以及 MathTime、
 * STIX / Cambria / Latin Modern 等的 Math 变体。这些字体里的字符在文本层只剩普通字母
 * （花体 𝓛 抽出来是 L），翻译后必然失真，要按行内公式截图。
 * 正文常用的 CMR / Times / Nimbus 一律不算，避免整段被当成公式。
 */
export function isMathFontName(name: string): boolean {
  return /\b(cmsy|cmmi|cmex|cmbsy|cmmib|msam|msbm|rsfs|eufm|eusm|eurm|eufb|lasy|wasy|stmary|mtmi|mtsy|mtex|mathcal|mathscr|mathbb)\d*\b|math(?:italic|script|cal|bb|symbol|ext|bold)?[-_]?(?:italic|regular|bold)?$|[-_](?:math|mathit|mathsy)\b|LMMath|STIXMath|CambriaMath|XITSMath|AsanaMath|TeXGyre\w*Math/i.test(
    name
  )
}

export async function extractPages(filePath: string): Promise<ExtractResult> {
  const data = await readFile(filePath)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    // 主进程无 DOM/Worker：关闭 worker，直接在本线程解析
    useSystemFonts: true,
    ...pdfjsAssetDirs()
  })
  const doc = await loadingTask.promise

  const pages: PageItems[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const viewport = page.getViewport({ scale: 1 })
    // 字体对象懒加载：先跑一遍操作流让 commonObjs 拿到字体真名，
    // 才能按名字判定粗体（getTextContent 的 styles 只有归一化的 fontFamily）
    const ops = await page.getOperatorList()
    const content = await page.getTextContent()
    // 看不见的文字（写在表单对象内容框外被裁掉、叠字里被后画的图盖住）不进文本层：
    // 否则译文页上会出现原文页上根本看不见的字（Attention 第 13–15 页图上那行「Input-Input Layer5」）
    const origins = hiddenTextOrigins(ops)
    const traitsByFont = new Map<string, { bold: boolean; math: boolean }>()
    const traitsOf = (fontName?: string): { bold: boolean; math: boolean } => {
      if (!fontName) return { bold: false, math: false }
      let t = traitsByFont.get(fontName)
      if (t === undefined) {
        try {
          const f = page.commonObjs.get(fontName) as { name?: string } | null
          const name = f?.name ?? ''
          t = { bold: isBoldFontName(name), math: isMathFontName(name) }
        } catch {
          t = { bold: false, math: false }
        }
        traitsByFont.set(fontName, t)
      }
      return t
    }
    const boldOf = (fontName?: string): boolean => traitsOf(fontName).bold
    const all = (content.items as PdfTextItem[]).filter(
      (it) => typeof it.str === 'string' && it.str.length > 0
    )
    const isRotated = (it: PdfTextItem): boolean =>
      Math.abs(Math.atan2(it.transform[1], it.transform[0])) >= 0.087
    pages.push({
      page: n,
      width: viewport.width,
      height: viewport.height,
      // 旋转文本（arXiv 左缘竖排水印、侧转表头）不属于正文流——
      // 混进段落会产生 "extra[arXiv:…]galactic" 式的污染；单独收进 rotated 供页边块使用
      rotated: all
        .filter(isRotated)
        .map((it) => {
          const [a, b, c, d, e, f] = it.transform
          const fontSize = Math.hypot(c, d) || it.height
          // 文本矩阵：dir 是书写方向、up 是字高方向；四个角取外接框（页面坐标）
          const dl = Math.hypot(a, b) || 1
          const ul = Math.hypot(c, d) || 1
          const corners = [
            [e, f],
            [e + (a / dl) * it.width, f + (b / dl) * it.width],
            [e + (c / ul) * fontSize, f + (d / ul) * fontSize],
            [e + (a / dl) * it.width + (c / ul) * fontSize, f + (b / dl) * it.width + (d / ul) * fontSize]
          ]
          const xs = corners.map((p) => p[0])
          const ys = corners.map((p) => p[1])
          const x = Math.min(...xs)
          const y = Math.min(...ys)
          return {
            str: it.str,
            x,
            y,
            width: Math.max(...xs) - x,
            height: Math.max(...ys) - y,
            fontSize,
            angle: Math.atan2(b, a),
            bold: boldOf(it.fontName)
          }
        }),
      items: dropHidden(all
        .filter((it) => !isRotated(it))
        .map((it) => {
          const t = it.transform
          // 文本矩阵 [a b c d e f]：无旋转时 d = 字号，e/f = 基线原点
          const fontSize = Math.hypot(t[2], t[3]) || it.height
          const traits = traitsOf(it.fontName)
          return {
            str: it.str,
            x: t[4],
            y: t[5],
            width: it.width,
            height: it.height || fontSize,
            fontSize,
            bold: traits.bold,
            ...(traits.math ? { math: true } : {})
          }
        }), origins)
    })
    page.cleanup()
  }
  await loadingTask.destroy()
  return { pages, data }
}

function dropHidden<T extends { str: string; x: number; y: number; width: number; fontSize: number }>(
  items: T[],
  origins: ReturnType<typeof hiddenTextOrigins>
): T[] {
  if (origins.clipped.length === 0 && origins.covered.length === 0) return items
  const hidden = hiddenItems(items, collidingTexts(items), origins)
  return hidden.size === 0 ? items : items.filter((it) => !hidden.has(it))
}
