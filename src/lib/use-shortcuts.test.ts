import { describe, expect, it } from 'vitest'
import { escTarget } from './use-shortcuts'

const base = { settingsOpen: false, tier: 'lg', panelOpen: false, paletteOpen: false, findOpen: false }

describe('Esc 一次只退一层', () => {
  it('没有任何浮层时不响应（永不离开阅读器）', () => {
    expect(escTarget(base)).toBeNull()
    expect(escTarget({ ...base, panelOpen: true })).toBeNull() // 宽屏面板是常驻布局，不是浮层
  })

  it('设置在最上层', () => {
    expect(escTarget({ ...base, settingsOpen: true, paletteOpen: true, findOpen: true })).toBe('settings')
  })

  it('设置 + 查找同时开：先关设置，查找留着', () => {
    const s = { ...base, settingsOpen: true, findOpen: true }
    expect(escTarget(s)).toBe('settings')
    expect(escTarget({ ...s, settingsOpen: false })).toBe('find') // 再按一次才轮到查找
  })

  it('窄屏的浮层面板排在命令面板之前', () => {
    expect(escTarget({ ...base, tier: 'sm', panelOpen: true, paletteOpen: true })).toBe('panel')
    expect(escTarget({ ...base, tier: 'lg', panelOpen: true, paletteOpen: true })).toBe('palette')
  })

  it('命令面板先于查找条', () => {
    expect(escTarget({ ...base, paletteOpen: true, findOpen: true })).toBe('palette')
    expect(escTarget({ ...base, findOpen: true })).toBe('find')
  })

  it('逐层退出：四层全开时按四次刚好清空', () => {
    let s = { settingsOpen: true, tier: 'sm', panelOpen: true, paletteOpen: true, findOpen: true }
    const order: (string | null)[] = []
    for (let i = 0; i < 5; i++) {
      const layer = escTarget(s)
      order.push(layer)
      if (layer === 'settings') s = { ...s, settingsOpen: false }
      else if (layer === 'panel') s = { ...s, panelOpen: false }
      else if (layer === 'palette') s = { ...s, paletteOpen: false }
      else if (layer === 'find') s = { ...s, findOpen: false }
    }
    expect(order).toEqual(['settings', 'panel', 'palette', 'find', null])
  })
})
