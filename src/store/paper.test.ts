import { beforeEach, describe, expect, it } from 'vitest'
import { usePaper } from './paper'
import type { PaperBundle, TranslateProgressEvent } from '../../shared/models'

const PAPER = 'p1'

function bundle(): PaperBundle {
  return {
    paper: { id: PAPER, file_path: '/x.pdf', title: 'X', progress: 0, last_section: null } as PaperBundle['paper'],
    blocks: [],
    outline: [],
    translations: {},
    translationModels: {}
  }
}

function progress(over: Partial<TranslateProgressEvent> = {}): TranslateProgressEvent {
  return { paperId: PAPER, blockId: 'b1', text: '译文', remaining: 5, ...over } as TranslateProgressEvent
}

beforeEach(() => {
  usePaper.setState({
    bundle: bundle(),
    translations: {},
    translating: false,
    stopRequested: false,
    translateUsage: null
  })
})

describe('翻译进度事件', () => {
  it('remaining > 0 时标记为翻译中', () => {
    usePaper.getState().applyProgress(progress({ remaining: 5 }))
    expect(usePaper.getState().translating).toBe(true)
    expect(usePaper.getState().translations['b1']?.text).toBe('译文')
  })

  it('remaining 归零即结束', () => {
    usePaper.getState().applyProgress(progress({ remaining: 0 }))
    expect(usePaper.getState().translating).toBe(false)
  })

  it('别的论文的进度一律丢弃', () => {
    usePaper.getState().applyProgress(progress({ paperId: 'other', remaining: 5 }))
    expect(usePaper.getState().translating).toBe(false)
    expect(usePaper.getState().translations['b1']).toBeUndefined()
  })

  it('别的论文的用量也不许写进来（归属校验必须在最前）', () => {
    usePaper.getState().applyProgress(
      progress({ paperId: 'other', usage: { inputTokens: 999, outputTokens: 999 } })
    )
    expect(usePaper.getState().translateUsage).toBeNull()
  })
})

describe('暂停之后', () => {
  it('在途批次回报不许把「翻译中」重新点亮', () => {
    usePaper.setState({ translating: true })
    usePaper.setState({ translating: false, stopRequested: true }) // 等同点了暂停
    usePaper.getState().applyProgress(progress({ remaining: 120 }))
    expect(usePaper.getState().translating).toBe(false)
  })

  it('但在途译文照收——已经花掉的钱不浪费', () => {
    usePaper.setState({ translating: false, stopRequested: true })
    usePaper.getState().applyProgress(progress({ blockId: 'b9', text: '迟到的译文', remaining: 120 }))
    expect(usePaper.getState().translations['b9']?.text).toBe('迟到的译文')
  })

  it('重新开始翻译会清掉暂停标记', () => {
    usePaper.setState({ stopRequested: true })
    usePaper.setState({ stopRequested: false, translating: true }) // startTranslation 的效果
    usePaper.getState().applyProgress(progress({ remaining: 3 }))
    expect(usePaper.getState().translating).toBe(true)
  })
})

describe('暂停 [P4]', () => {
  it('整篇重译中途暂停：带旧译文的等待段只去 pending，译文原样保留', async () => {
    // stopTranslation 会经桥调主进程；测试里给个空桥
    ;(globalThis as unknown as { window: unknown }).window = {
      readarc: { stopTranslation: async () => {}, patchSettings: () => {} }
    }
    usePaper.setState({
      translating: true,
      translations: {
        b1: { text: '旧译文一', pending: true },
        b2: { pending: true },
        b3: { text: '已完成' }
      }
    })
    await usePaper.getState().stopTranslation()
    const tr = usePaper.getState().translations
    expect(tr['b1']).toEqual({ text: '旧译文一', pending: false })
    expect(tr['b2'].pending).toBe(false)
    expect(tr['b2'].text).toBeUndefined()
    expect(tr['b3']).toEqual({ text: '已完成' })
    expect(usePaper.getState().translating).toBe(false)
    expect(usePaper.getState().stopRequested).toBe(true)
  })
})

describe('启动翻译时的待译标记', () => {
  it('IPC 返回前就上报的跳过 / 缓存段不许被重新标成待译（参考文献整页变灰的根源）', async () => {
    const g = globalThis as unknown as { window?: unknown; document?: unknown }
    const savedWindow = g.window
    const savedDocument = g.document
    g.document = { querySelector: () => null }
    g.window = {
      readarc: {
        translatePaper: async () => {
          // 主进程一收到请求就同步上报「原样即译文」的段，此时 startTranslation 还在 await
          usePaper.getState().applyProgress(progress({ blockId: 'b1', text: 'Ref entry', model: 'identity', remaining: 1 }))
          return { started: true }
        },
        reportTranslateFocus: () => undefined
      }
    }
    try {
      usePaper.setState({
        bundle: {
          ...bundle(),
          blocks: [
            { block_id: 'b1', kind: 'para', page: 1, block_order: 0 },
            { block_id: 'b2', kind: 'para', page: 1, block_order: 1 }
          ] as PaperBundle['blocks']
        }
      })
      await usePaper.getState().startTranslation()
      expect(usePaper.getState().translations['b1']).toEqual({ text: 'Ref entry', model: 'identity' })
      expect(usePaper.getState().translations['b2']).toEqual({ pending: true })
      expect(usePaper.getState().translateTotal).toBe(1)
    } finally {
      g.window = savedWindow
      g.document = savedDocument
    }
  })
})
