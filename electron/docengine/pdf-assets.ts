/**
 * 渲染进程画 PDF 页面要用的 pdf.js 附带资源：CMap 表、标准字体、wasm 解码器。
 *
 * 渲染进程用 file:// 或 dev server 加载页面，自己 fetch 不到 node_modules 里的这些文件；
 * 缺了 CMap，用非内嵌中文字体的 PDF（国内不少期刊、学位论文）整页画成空白，
 * 只在控制台留一句 warning。所以由主进程按名字读给它。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export type PdfAssetKind = 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl'

const DIRS: Record<PdfAssetKind, string> = {
  cMapUrl: 'cmaps',
  standardFontDataUrl: 'standard_fonts',
  wasmUrl: 'wasm'
}

export function pdfjsRoot(): string {
  return dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
}

/** 只认纯文件名（字母数字、点、横线、下划线），拒绝路径分隔符，避免被当成任意文件读取口 */
export function readPdfAsset(kind: PdfAssetKind, filename: string, root: string = pdfjsRoot()): Buffer | null {
  const dir = DIRS[kind]
  if (!dir || !/^[\w.-]+$/.test(filename) || filename.startsWith('.')) return null
  try {
    return readFileSync(join(root, dir, filename))
  } catch {
    return null
  }
}

/**
 * 主进程自己用 pdf.js 时的资源目录（抽文字、版面识别栅格化、图表裁剪都要）。
 * 缺 cMapUrl 时中日韩字体的页面会渲染成空白：抽不到文字、版面模型看到白页、图表截图没有字。
 */
export function pdfjsAssetDirs(root: string = pdfjsRoot()): {
  cMapUrl: string
  cMapPacked: true
  standardFontDataUrl: string
  wasmUrl: string
} {
  return {
    cMapUrl: join(root, 'cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: join(root, 'standard_fonts') + '/',
    wasmUrl: join(root, 'wasm') + '/'
  }
}
