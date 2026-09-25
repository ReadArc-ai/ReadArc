import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CROP_SCALE, cropRegions } from './layout-ml'

const here = dirname(fileURLToPath(import.meta.url))

/** PNG 的 IHDR：宽高各 4 字节大端，从偏移 16 开始 */
function pngSize(buf: Buffer): [number, number] {
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
}

describe('图/表截图', () => {
  it('按 CROP_SCALE 倍率裁出：100pt 宽的区域得到约 100×倍率 像素（Retina 上不糊）', async () => {
    const data = readFileSync(join(here, 'fixtures', 'cjk.pdf'))
    const crops = await cropRegions(data, [{ key: 'k', page: 1, bbox: [40, 500, 100, 50] }])
    const png = crops.get('k')
    expect(png).toBeDefined()
    const [w, h] = pngSize(png!)
    // 两侧各 3px 内边距，加上倍率取整的 1–2px 误差；框边压着文字时还会向外扩到墨迹边界，
    // 上限是两侧各 26pt（见 MAX_GROW_PT），所以只能给出区间
    const grow = 26 * CROP_SCALE * 2
    expect(w).toBeGreaterThanOrEqual(100 * CROP_SCALE + 4)
    expect(w).toBeLessThanOrEqual(100 * CROP_SCALE + 10 + grow)
    expect(h).toBeGreaterThanOrEqual(50 * CROP_SCALE + 4)
    expect(h).toBeLessThanOrEqual(50 * CROP_SCALE + 10 + grow)
  })

  it('不在页面范围内的请求跳过，不报错', async () => {
    const data = readFileSync(join(here, 'fixtures', 'cjk.pdf'))
    const crops = await cropRegions(data, [{ key: 'x', page: 99, bbox: [0, 0, 10, 10] }])
    expect(crops.size).toBe(0)
  })
})

describe('expandToInk', () => {
  // 造一张 40×20 的「页面」：中间一条横向墨迹从 x=5 延伸到 x=30，框只圈住 x=10..20
  function fakeCtx(inkFrom: number, inkTo: number, w = 40, h = 20): { getImageData: (x: number, y: number, ww: number, hh: number) => { data: Uint8ClampedArray; width: number; height: number } } {
    const px = new Uint8ClampedArray(w * h * 4).fill(255)
    for (let x = inkFrom; x < inkTo; x++) {
      const i = (10 * w + x) * 4
      px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 255
    }
    return {
      getImageData: (x, y, ww, hh) => {
        const out = new Uint8ClampedArray(ww * hh * 4)
        for (let yy = 0; yy < hh; yy++)
          for (let xx = 0; xx < ww; xx++) {
            const src = ((y + yy) * w + (x + xx)) * 4
            const dst = (yy * ww + xx) * 4
            out[dst] = px[src]; out[dst + 1] = px[src + 1]; out[dst + 2] = px[src + 2]; out[dst + 3] = px[src + 3]
          }
        return { data: out, width: ww, height: hh }
      }
    }
  }

  it('框切掉了两侧的墨迹：向外扩到墨迹边界', async () => {
    const { expandToInk } = await import('./layout-ml')
    const box = expandToInk(fakeCtx(5, 30), { sx: 10, sy: 8, sw: 10, sh: 5 }, { width: 40, height: 20 }, 12, 2)
    expect(box.sx).toBe(5)
    expect(box.sx + box.sw).toBe(30)
  })

  it('框外是空白：一点不扩', async () => {
    const { expandToInk } = await import('./layout-ml')
    const box = expandToInk(fakeCtx(12, 18), { sx: 10, sy: 8, sw: 10, sh: 5 }, { width: 40, height: 20 }, 12, 2)
    expect(box).toEqual({ sx: 10, sy: 8, sw: 10, sh: 5 })
  })

  it('墨迹一直连到窗口边：扩到上限就停，不会越界', async () => {
    const { expandToInk } = await import('./layout-ml')
    const box = expandToInk(fakeCtx(0, 40), { sx: 18, sy: 8, sw: 4, sh: 5 }, { width: 40, height: 20 }, 6, 2)
    expect(box.sx).toBe(12)
    expect(box.sx + box.sw).toBe(28)
  })
  it('字与字之间的空白能跨过去，栏间的大空隙跨不过去', async () => {
    const { expandToInk } = await import('./layout-ml')
    // 墨迹：5..8（被切掉的半个词）、空 2 列、10..20（框内）、空 8 列（栏间）、28..38（邻栏）
    const w = 40, h = 20
    const px = new Uint8ClampedArray(w * h * 4).fill(255)
    const ink = (x: number): void => { const i = (10 * w + x) * 4; px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 255 }
    for (let x = 5; x < 8; x++) ink(x)
    for (let x = 10; x < 20; x++) ink(x)
    for (let x = 28; x < 38; x++) ink(x)
    const ctx = {
      getImageData: (x: number, y: number, ww: number, hh: number) => {
        const out = new Uint8ClampedArray(ww * hh * 4)
        for (let yy = 0; yy < hh; yy++)
          for (let xx = 0; xx < ww; xx++) {
            const src = ((y + yy) * w + (x + xx)) * 4
            const dst = (yy * ww + xx) * 4
            out[dst] = px[src]; out[dst + 1] = px[src + 1]; out[dst + 2] = px[src + 2]; out[dst + 3] = px[src + 3]
          }
        return { data: out, width: ww, height: hh }
      }
    }
    const box = expandToInk(ctx, { sx: 10, sy: 8, sw: 10, sh: 5 }, { width: w, height: h }, 18, 3)
    expect(box.sx).toBe(5) // 跨过 2 列空白，接回被切的半个词
    expect(box.sx + box.sw).toBe(20) // 8 列的栏间空隙没跨过去
  })
})

describe('trimToNeighbours', () => {
  // 40×40 的「页面」：按行给墨迹，rows 里列出有墨迹的行号
  function rowsCtx(rows: number[], w = 40, h = 40): { getImageData: (x: number, y: number, ww: number, hh: number) => { data: Uint8ClampedArray; width: number; height: number } } {
    const ink = new Set(rows)
    return {
      getImageData: (x, y, ww, hh) => {
        const out = new Uint8ClampedArray(ww * hh * 4).fill(255)
        for (let yy = 0; yy < hh; yy++) {
          if (!ink.has(y + yy) || y + yy >= h) continue
          for (let xx = 0; xx < Math.min(ww, w - x); xx++) out.set([0, 0, 0, 255], (yy * ww + xx) * 4)
        }
        return { data: out, width: ww, height: hh }
      }
    }
  }

  it('框顶压着上一行的下伸部分：裁到下伸部分与内容之间的空白行', async () => {
    const { trimToNeighbours } = await import('./layout-ml')
    // 上一行基线在 y=10，下伸部分 10..12，公式内容从 15 开始
    const ctx = rowsCtx([10, 11, 12, 15, 16, 17, 18, 19, 20])
    const box = trimToNeighbours(ctx, { sx: 0, sy: 9, sw: 40, sh: 13 }, { y: 10, fs: 10 }, null)
    expect(box.sy).toBe(13)
    expect(box.sy + box.sh).toBe(22)
  })

  it('框底压着下一行的首行字身：裁到内容与这一行之间的空白行', async () => {
    const { trimToNeighbours } = await import('./layout-ml')
    // 公式内容 5..12，下一块顶边 y=14（字身从 16 起）
    const ctx = rowsCtx([5, 6, 7, 8, 9, 10, 11, 12, 16, 17, 18])
    const box = trimToNeighbours(ctx, { sx: 0, sy: 4, sw: 40, sh: 16 }, null, { y: 14, fs: 10 })
    expect(box.sy).toBe(4)
    expect(box.sy + box.sh).toBe(16)
  })

  it('内容紧贴文字没有空白：不动', async () => {
    const { trimToNeighbours } = await import('./layout-ml')
    const ctx = rowsCtx(Array.from({ length: 20 }, (_, i) => i + 5))
    const box = { sx: 0, sy: 5, sw: 40, sh: 20 }
    expect(trimToNeighbours(ctx, box, { y: 6, fs: 10 }, null)).toEqual(box)
  })
})
