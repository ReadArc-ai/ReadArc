import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractPages, isBoldFontName, isMathFontName } from './extract'

const here = dirname(fileURLToPath(import.meta.url))
const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))

describe('pdf.js 资源目录', () => {
  // 缺了 cmaps，中日韩论文的 getTextContent() 会返回 0 项：
  // 导入「成功」但一个块都没有，且只在控制台留一句 warning。
  it('CMap 与标准字体目录必须存在且非空', () => {
    for (const d of ['cmaps', 'standard_fonts']) {
      const p = join(pdfjsRoot, d)
      expect(existsSync(p), `${d} 目录缺失`).toBe(true)
      expect(readdirSync(p).length, `${d} 是空目录`).toBeGreaterThan(0)
    }
  })
})

describe('中日韩 PDF 的文本提取', () => {
  it('中文论文能提取出中文文本（不给 cMapUrl 时这里会是 0 项）', async () => {
    const { pages } = await extractPages(join(here, 'fixtures', 'cjk.pdf'))
    expect(pages).toHaveLength(1)
    const text = pages[0].items.map((i) => i.str).join('')
    expect(text.length).toBeGreaterThan(200)
    expect(/[一-鿿]/.test(text)).toBe(true)
    expect(text).toContain('稀疏注意力')
  })

  it('提取出的文本项带有可用的几何信息（版面解析的输入）', async () => {
    const { pages } = await extractPages(join(here, 'fixtures', 'cjk.pdf'))
    const items = pages[0].items.filter((i) => i.str.trim())
    expect(items.length).toBeGreaterThan(0)
    for (const it of items.slice(0, 5)) {
      expect(Number.isFinite(it.x)).toBe(true)
      expect(Number.isFinite(it.y)).toBe(true)
      expect(it.height).toBeGreaterThan(0)
    }
  })
})

describe('isMathFontName', () => {
  it('认得 LaTeX 与常见排版系统的数学字体', () => {
    for (const n of ['ZTGCFV+CMSY10', 'ABCDEF+CMMI10', 'CMEX10', 'MSBM10', 'RSFS10', 'EUFM10', 'MTMI', 'LMMathItalic10-Regular', 'STIXMath-Regular', 'CambriaMath', 'XITSMath']) {
      expect(isMathFontName(n), n).toBe(true)
    }
  })
  it('正文字体不算数学字体', () => {
    for (const n of ['CMR10', 'CMBX12', 'NimbusRomNo9L-Regu', 'Times-Roman', 'TimesNewRomanPSMT', 'Helvetica', 'SFRM1000', 'DejaVuSans', 'STIXGeneral-Italic', 'CMTT10']) {
      expect(isMathFontName(n), n).toBe(false)
    }
  })
})

describe('isBoldFontName', () => {
  it('认得常见的粗体字体真名', () => {
    for (const n of ['Times-Bold', 'NimbusRomNo9L-Medi', 'CMBX12', 'Arial-Black', 'Helvetica-SemiB']) {
      expect(isBoldFontName(n), n).toBe(true)
    }
  })
  it('不把常规字体误判为粗体', () => {
    for (const n of ['Times-Roman', 'NimbusRomNo9L-Regu', 'CMR10', 'Helvetica']) {
      expect(isBoldFontName(n), n).toBe(false)
    }
  })
})
