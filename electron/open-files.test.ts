import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  windows: vi.fn(), handle: vi.fn(), exists: vi.fn()
}))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: mocks.windows },
  ipcMain: { handle: mocks.handle }
}))
vi.mock('node:fs', () => ({ existsSync: mocks.exists }))

function fakeWindow(): { send: ReturnType<typeof vi.fn>; win: unknown } {
  const send = vi.fn()
  const win = {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send }
  }
  return { send, win }
}

/** 每个用例拿一份全新的模块状态（队列与就绪标记是模块级的） */
async function load(): Promise<typeof import('./open-files') & { take: () => string[] }> {
  vi.resetModules()
  const mod = await import('./open-files')
  mod.registerOpenFilesIpc()
  const take = mocks.handle.mock.calls.at(-1)?.[1] as () => string[]
  return { ...mod, take }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.exists.mockReturnValue(true)
})

describe('pdfPathsFromArgv', () => {
  it('只取存在的 .pdf 参数，跳过开关与应用目录', async () => {
    const m = await load()
    mocks.exists.mockImplementation((p: string) => p !== '/gone.pdf')
    const argv = ['.', '--remote-debugging-port=9333', '/a/Paper.PDF', '/gone.pdf', '/b/notes.txt']
    expect(m.pdfPathsFromArgv(argv)).toEqual(['/a/Paper.PDF'])
  })
})

describe('外部打开队列', () => {
  it('渲染端就绪前排队，取走后清空', async () => {
    const m = await load()
    const { send, win } = fakeWindow()
    mocks.windows.mockReturnValue([win])
    m.enqueueOpenFiles(['/z/storage/a.pdf'])
    m.enqueueOpenFiles(['/z/storage/a.pdf']) // 同一文件重复到达只开一次
    expect(send).not.toHaveBeenCalled()
    expect(m.take()).toEqual(['/z/storage/a.pdf'])
    expect(m.take()).toEqual([])
  })

  it('就绪后直接推送并把窗口带到前台', async () => {
    const m = await load()
    const { send, win } = fakeWindow()
    mocks.windows.mockReturnValue([win])
    m.take()
    m.enqueueOpenFiles(['/z/b.pdf'])
    expect(send).toHaveBeenCalledWith('open:files', ['/z/b.pdf'])
    expect((win as { focus: ReturnType<typeof vi.fn> }).focus).toHaveBeenCalled()
  })

  it('页面重新加载期间回到排队，不丢请求', async () => {
    const m = await load()
    const { send, win } = fakeWindow()
    mocks.windows.mockReturnValue([win])
    m.take()
    m.markRendererLoading()
    m.enqueueOpenFiles(['/z/c.pdf'])
    expect(send).not.toHaveBeenCalled()
    expect(m.take()).toEqual(['/z/c.pdf'])
  })

  it('没有窗口时留在队列里，等新窗口取走', async () => {
    const m = await load()
    m.take()
    mocks.windows.mockReturnValue([])
    m.enqueueOpenFiles(['/z/d.pdf'])
    expect(m.take()).toEqual(['/z/d.pdf'])
  })
})
