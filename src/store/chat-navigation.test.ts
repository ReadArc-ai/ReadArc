import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaperBundle } from '../../shared/models'
import { jumpToBlock } from './chat'
import { usePaper } from './paper'

function target() {
  return { scrollIntoView: vi.fn(), classList: { remove: vi.fn(), add: vi.fn() }, offsetWidth: 100 }
}

let onMount: () => void
let disconnect: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  disconnect = vi.fn()
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { onMount = callback }
    observe = vi.fn()
    disconnect = disconnect
  })
  usePaper.setState({ bundle: {
    paper: { id: 'paper' },
    blocks: [{ paper_id: 'paper', block_order: 119, page: 12, bbox: '[40,500,500,100]' }]
  } as PaperBundle })
})

afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup(translated: boolean) {
  const page = {
    dataset: { ph: '800' },
    isConnected: true,
    getBoundingClientRect: () => ({ top: 8800, height: 800 }),
    querySelector: vi.fn().mockReturnValue(null)
  }
  const root = {
    scrollTop: 100,
    getBoundingClientRect: () => ({ top: 0, height: 600 }),
    scrollTo: vi.fn(),
    querySelector: vi.fn((selector: string) => {
      if (selector === `${translated ? '.tp-page' : '.pdf-page'}[data-page="12"]`) return page
      return null
    })
  }
  vi.stubGlobal('document', { querySelector: () => root })
  return { root, page }
}

describe('阅读器段落跳转', () => {
  it('纯译文的目标页尚未挂载时，先滚动页壳，挂载后定位并高亮目标', () => {
    const { root, page } = setup(true)
    jumpToBlock(119)
    expect(root.scrollTo).toHaveBeenCalledWith({ top: 8900 })
    const block = target()
    page.querySelector.mockReturnValue(block)
    onMount()
    expect(block.scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(block.classList.add).toHaveBeenCalledWith('block-flash')
    expect(disconnect).toHaveBeenCalled()
  })

  it('已渲染的段落直接定位，不需要页壳回退', () => {
    const { root } = setup(true)
    const block = target()
    root.querySelector.mockImplementation(() => block as never)
    jumpToBlock(119)
    expect(block.scrollIntoView).toHaveBeenCalled()
    expect(root.scrollTo).not.toHaveBeenCalled()
  })

  it('纯原文视图仍可按 bbox 滚动', () => {
    const { root } = setup(false)
    // 本例只检验滚动，无 bbox 高亮覆盖层。
    usePaper.getState().bundle!.blocks[0].bbox = null
    jumpToBlock(119)
    expect(root.scrollTo).toHaveBeenCalledWith({ top: 8700 })
  })

  it('切换论文后不再执行旧目标的延迟定位', () => {
    const { page } = setup(true)
    jumpToBlock(119)
    usePaper.setState({ bundle: null })
    const block = target()
    page.querySelector.mockReturnValue(block)
    onMount()
    expect(block.scrollIntoView).not.toHaveBeenCalled()
  })

  it('新的跳转会取消旧监听，目标迟迟不挂载也会清理', () => {
    setup(true)
    jumpToBlock(119)
    jumpToBlock(119)
    expect(disconnect).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    expect(disconnect).toHaveBeenCalledTimes(2)
  })
})
