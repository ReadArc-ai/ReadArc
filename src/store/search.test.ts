import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSearch } from './search'
import { usePaper } from './paper'
import { useApp } from './app'
import type { PaperBundle, SearchOutcome, SearchResultInput } from '../../shared/models'

const outcome = (over: Partial<SearchOutcome> = {}): SearchOutcome => ({
  results: [],
  sources: [{ slug: 'arxiv', name: 'arXiv', count: 0, error: null }],
  rawCount: 0,
  fromCache: false,
  ...over
})
const result: SearchResultInput = {
  id: 'r1', source: 'arxiv', title: 'T', authors: [], year: 2024, pdfUrl: 'https://x/a.pdf'
} as unknown as SearchResultInput
const bundle = (id: string): PaperBundle => ({
  paper: { id, file_path: '/x.pdf', title: 'X', progress: 0, last_section: null } as PaperBundle['paper'],
  blocks: [], outline: [], translations: {}, translationModels: {}
})

const bridge = {
  runSearch: vi.fn(async () => outcome()),
  addSearchResult: vi.fn(async () => ({ paperId: 'p9', existed: false })),
  openPaper: vi.fn(async (id: string) => bundle(id)),
  patchSettings: vi.fn()
}

beforeEach(() => {
  ;(globalThis as unknown as { window: unknown }).window = { readarc: bridge }
  useSearch.setState({ query: '', outcome: null, searching: false, added: {} })
  useApp.setState({ screen: 'library' })
  usePaper.setState({ bundle: null })
  bridge.runSearch.mockClear()
  bridge.addSearchResult.mockClear()
})

describe('搜索 store', () => {
  it('run：空查询不发请求；正常查询把结果放进 store', async () => {
    await useSearch.getState().run()
    expect(bridge.runSearch).not.toHaveBeenCalled()
    useSearch.getState().setQuery('  attention ')
    await useSearch.getState().run()
    expect(bridge.runSearch).toHaveBeenCalledWith('attention')
    expect(useSearch.getState().outcome?.sources[0]?.name).toBe('arXiv')
    expect(useSearch.getState().searching).toBe(false)
  })

  it('applyProgress：只认当前这次检索的中间结果', () => {
    useSearch.setState({ query: 'attention', searching: true })
    useSearch.getState().applyProgress({ query: 'other', outcome: outcome({ rawCount: 9 }) })
    expect(useSearch.getState().outcome).toBeNull()
    useSearch.getState().applyProgress({ query: 'attention', outcome: outcome({ rawCount: 3, partial: true }) })
    expect(useSearch.getState().outcome?.rawCount).toBe(3)
    useSearch.setState({ searching: false })
    useSearch.getState().applyProgress({ query: 'attention', outcome: outcome({ rawCount: 7 }) })
    expect(useSearch.getState().outcome?.rawCount).toBe(3)
  })

  it('add：下载完直接打开论文并切到阅读器', async () => {
    await useSearch.getState().add(result)
    expect(useSearch.getState().added['r1']).toEqual({ paperId: 'p9', existed: false })
    expect(usePaper.getState().bundle?.paper.id).toBe('p9')
    expect(useApp.getState().screen).toBe('reader')
  })

  it('add：失败时记下错误，不跳转', async () => {
    bridge.addSearchResult.mockRejectedValueOnce(new Error('PDF 下载失败 HTTP 404'))
    await useSearch.getState().add(result)
    expect(useSearch.getState().added['r1']).toEqual({ error: 'PDF 下载失败 HTTP 404' })
    expect(useApp.getState().screen).toBe('library')
  })

  it('applyAddProgress：完成之后迟到的进度事件丢弃', () => {
    useSearch.setState({ added: { r1: { paperId: 'p9', existed: false } } })
    useSearch.getState().applyAddProgress({ id: 'r1', stage: 'download', received: 1, total: 2 })
    expect(useSearch.getState().added['r1']).toEqual({ paperId: 'p9', existed: false })
    useSearch.setState({ added: { r2: { busy: true, stage: 'download', received: 0, total: 0 } } })
    useSearch.getState().applyAddProgress({ id: 'r2', stage: 'import', received: 5, total: 5 })
    expect(useSearch.getState().added['r2']).toMatchObject({ busy: true, stage: 'import', received: 5 })
  })
})
