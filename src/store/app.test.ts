import { beforeEach, describe, expect, it } from 'vitest'
import { tierForWidth, useApp } from './app'

describe('tier 档位', () => {
  it('宽度映射：lg ≥1320，md 1000–1319，sm <1000', () => {
    expect(tierForWidth(1320)).toBe('lg')
    expect(tierForWidth(1319)).toBe('md')
    expect(tierForWidth(1000)).toBe('md')
    expect(tierForWidth(999)).toBe('sm')
  })
})

describe('tier 副作用 [P3]', () => {
  beforeEach(() => {
    useApp.setState({ tier: 'lg', panelOpen: true })
  })

  it('进入 sm 强制收起面板', () => {
    useApp.getState().setTier('sm')
    expect(useApp.getState().panelOpen).toBe(false)
  })

  it('离开 sm 恢复面板', () => {
    useApp.getState().setTier('sm')
    useApp.getState().setTier('md')
    expect(useApp.getState().panelOpen).toBe(true)
  })

  it('lg↔md 切换不动面板状态', () => {
    useApp.setState({ panelOpen: false })
    useApp.getState().setTier('md')
    expect(useApp.getState().panelOpen).toBe(false)
  })
})

describe('视图循环 ⌘T', () => {
  it('page → orig → zh → page', () => {
    useApp.setState({ view: 'page' })
    const seen = [useApp.getState().view]
    for (let i = 0; i < 3; i++) {
      useApp.getState().cycleView()
      seen.push(useApp.getState().view)
    }
    expect(seen).toEqual(['page', 'orig', 'zh', 'page'])
  })
})

describe('档位切换时的目录', () => {
  it('进中等宽度自动收起目录，回到宽档保持用户当时的状态', () => {
    const s = useApp.getState()
    s.setTier('lg')
    useApp.setState({ outlineCollapsed: false })
    s.setTier('md')
    expect(useApp.getState().outlineCollapsed).toBe(true)
    // 用户在 md 下手动展开后回到 lg：不强行改回去
    useApp.setState({ outlineCollapsed: false })
    s.setTier('lg')
    expect(useApp.getState().outlineCollapsed).toBe(false)
  })
  it('从窄档回到中等档：面板打开、目录收起', () => {
    const s = useApp.getState()
    s.setTier('sm')
    expect(useApp.getState().panelOpen).toBe(false)
    s.setTier('md')
    expect(useApp.getState().panelOpen).toBe(true)
    expect(useApp.getState().outlineCollapsed).toBe(true)
  })
})
