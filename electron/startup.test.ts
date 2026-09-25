import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  append: vi.fn(), mkdir: vi.fn(), path: vi.fn(), setPath: vi.fn(),
  ready: vi.fn(), windows: vi.fn(), errorBox: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getPath: mocks.path, setPath: mocks.setPath, isReady: mocks.ready, getVersion: () => '1.0.0' },
  BrowserWindow: { getAllWindows: mocks.windows }, dialog: { showErrorBox: mocks.errorBox }
}))
vi.mock('node:fs', () => ({ appendFileSync: mocks.append, mkdirSync: mocks.mkdir }))
import { initializeStartup, reportFatal } from './startup'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.path.mockReturnValue('/test/userData')
  mocks.ready.mockReturnValue(false)
  vi.spyOn(process, 'on').mockReturnValue(process)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('依赖加载前的启动诊断', () => {
  it('先写日志并安装异常处理器，再加载业务依赖', () => {
    initializeStartup(() => {
      expect(mocks.append).toHaveBeenCalledWith('/test/userData/startup.log', expect.stringContaining('bootstrap entered'))
      expect(process.on).toHaveBeenCalledWith('uncaughtException', expect.any(Function))
      expect(process.on).toHaveBeenCalledWith('unhandledRejection', expect.any(Function))
    })
    expect(mocks.append).toHaveBeenLastCalledWith('/test/userData/startup.log', expect.stringContaining('main module loaded'))
  })
  it('ready 前加载依赖失败，也有日志和系统错误框', () => {
    initializeStartup(() => { throw new Error('Cannot find module: example') })
    expect(mocks.append).toHaveBeenCalledWith('/test/userData/startup.log', expect.stringContaining('main module load failed: Error: Cannot find module: example'))
    expect(mocks.errorBox).toHaveBeenCalledWith('ReadArc', expect.stringContaining('Cannot find module: example'))
    expect(mocks.windows).not.toHaveBeenCalled()
  })
  it('日志目录不可写时不阻止启动，也不隐藏错误提示', () => {
    mocks.mkdir.mockImplementation(() => { throw new Error('EACCES') })
    const load = vi.fn()
    initializeStartup(load)
    expect(load).toHaveBeenCalledOnce()
    reportFatal('test', new Error('startup failure'))
    expect(mocks.errorBox).toHaveBeenCalledWith('ReadArc', expect.stringContaining('startup failure'))
  })
  it('业务加载前使用隔离目录并恢复 TLS 校验', () => {
    vi.stubEnv('READARC_USER_DATA', '/test/isolated')
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0')
    initializeStartup(() => {
      expect(mocks.setPath).toHaveBeenCalledWith('userData', '/test/isolated')
      expect(process.env['NODE_TLS_REJECT_UNAUTHORIZED']).toBeUndefined()
    })
  })
})
