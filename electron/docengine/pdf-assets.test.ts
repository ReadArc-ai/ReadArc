import { describe, expect, it } from 'vitest'
import { pdfjsRoot, readPdfAsset } from './pdf-assets'

describe('readPdfAsset', () => {
  it('能读到 pdf.js 附带的 CMap 与标准字体', () => {
    expect(readPdfAsset('cMapUrl', 'UniGB-UTF16-H.bcmap')?.length).toBeGreaterThan(1000)
    expect(readPdfAsset('standardFontDataUrl', 'LiberationSans-Regular.ttf')?.length).toBeGreaterThan(1000)
  })
  it('拒绝带路径的文件名与未知类型', () => {
    expect(readPdfAsset('cMapUrl', '../package.json')).toBeNull()
    expect(readPdfAsset('cMapUrl', '/etc/hosts')).toBeNull()
    expect(readPdfAsset('cMapUrl', '.hidden')).toBeNull()
    expect(readPdfAsset('other' as never, 'x.bcmap')).toBeNull()
    expect(readPdfAsset('cMapUrl', 'no-such-file.bcmap', pdfjsRoot())).toBeNull()
  })
})

describe('pdfjsAssetDirs', () => {
  it('三类资源目录都给出，且 cMapPacked 为 true（不给的话中日韩页面渲染成白页）', async () => {
    const { pdfjsAssetDirs } = await import('./pdf-assets')
    const d = pdfjsAssetDirs()
    expect(d.cMapUrl).toMatch(/cmaps\/$/)
    expect(d.standardFontDataUrl).toMatch(/standard_fonts\/$/)
    expect(d.wasmUrl).toMatch(/wasm\/$/)
    expect(d.cMapPacked).toBe(true)
  })
})
