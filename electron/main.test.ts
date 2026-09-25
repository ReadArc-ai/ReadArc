import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lock: vi.fn(), quit: vi.fn(), ready: vi.fn(), resume: vi.fn(), register: vi.fn()
}))
vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: mocks.lock, quit: mocks.quit, on: vi.fn(), setPath: vi.fn(),
    whenReady: () => ({ then: mocks.ready })
  },
  BrowserWindow: {}, Menu: {}, nativeTheme: {}, shell: {}
}))
vi.mock('./settings-store', () => ({ flushSettings: vi.fn(), loadSettings: vi.fn(), patchSettings: vi.fn() }))
vi.mock('./library/service', () => ({
  resumePendingLayouts: mocks.resume, setLayoutNotifier: vi.fn(),
  sweepOrphanCopies: vi.fn(), sweepStaleFigures: vi.fn()
}))
vi.mock('./config/main-model', () => ({ absorbAskRouteIntoMain: vi.fn() }))
vi.mock('./ipc', () => ({ registerAllIpc: mocks.register }))

const originalMas = Object.getOwnPropertyDescriptor(process, 'mas')
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  Object.defineProperty(process, 'mas', { configurable: true, value: false })
})
afterEach(() => {
  if (originalMas) Object.defineProperty(process, 'mas', originalMas)
  else Reflect.deleteProperty(process, 'mas')
})

describe('应用启动与重复实例', () => {
  it('MAS 不因不可用的 Chromium 单实例 socket 退出', async () => {
    Object.defineProperty(process, 'mas', { configurable: true, value: true })
    mocks.lock.mockReturnValue(false)
    await import('./main')
    expect(mocks.lock).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(mocks.ready).toHaveBeenCalledOnce()
  })
  it('普通发行版持有锁时继续启动', async () => {
    mocks.lock.mockReturnValue(true)
    await import('./main')
    expect(mocks.lock).toHaveBeenCalledOnce()
    expect(mocks.quit).not.toHaveBeenCalled()
  })
  it('重复实例退出且不恢复后台任务或注册 IPC', async () => {
    mocks.lock.mockReturnValue(false)
    await import('./main')
    expect(mocks.quit).toHaveBeenCalledOnce()
    mocks.ready.mock.calls[0][0]()
    expect(mocks.resume).not.toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
  })
})
