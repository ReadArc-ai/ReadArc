import { beforeEach, describe, expect, it } from 'vitest'
import { figureCacheClear, figureCacheGet, figureCacheSet, figureCacheSize } from './use-figure'

describe('截图缓存', () => {
  beforeEach(() => figureCacheClear())

  it('没存过返回 undefined，存过的原样返回（含 null）', () => {
    expect(figureCacheGet('a')).toBeUndefined()
    figureCacheSet('a', 'data:image/png;base64,xx')
    expect(figureCacheGet('a')).toBe('data:image/png;base64,xx')
    figureCacheSet('b', null) // 没有截图的块也记下来，别每次都问主进程
    expect(figureCacheGet('b')).toBeNull()
  })

  it('超过上限时淘汰最久没用的，最近取过的留下', () => {
    for (let i = 0; i < 120; i++) figureCacheSet(`k${i}`, `v${i}`)
    expect(figureCacheSize()).toBe(120)
    figureCacheGet('k0') // 刷新 k0 的最近使用
    figureCacheSet('new', 'v')
    expect(figureCacheSize()).toBe(120)
    expect(figureCacheGet('k0')).toBe('v0') // 刚用过，留下
    expect(figureCacheGet('k1')).toBeUndefined() // 最久没用的被淘汰
    expect(figureCacheGet('new')).toBe('v')
  })
})
