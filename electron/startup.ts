// 只依赖 Electron / Node 内置模块；必须在业务依赖加载之前可用。
import { app, BrowserWindow, dialog } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function startupLogPath(): string | null {
  try {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    return join(dir, 'startup.log')
  } catch {
    return null
  }
}

export function logStartup(message: string): void {
  const line = `${new Date().toISOString()} ${message}`
  console.warn(line)
  const path = startupLogPath()
  if (!path) return
  try {
    appendFileSync(path, line + '\n')
  } catch {
    /* 日志写不进去不影响启动；终端启动仍可从 stderr 取证。 */
  }
}

export function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err)
}

export function reportFatal(kind: string, err: unknown): void {
  logStartup(`${kind}: ${describeError(err)}`)
  if (app.isReady() && BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible())) return
  // showErrorBox 支持 ready 之前调用；不能因依赖在 ready 前失败而吞掉提示。
  const path = startupLogPath()
  dialog.showErrorBox('ReadArc', `${err instanceof Error ? err.message : String(err)}\n\n${path ? `Log: ${path}` : ''}`)
}

export function initializeStartup(loadMain: () => void): void {
  process.on('uncaughtException', (err) => reportFatal('uncaughtException', err))
  process.on('unhandledRejection', (err) => reportFatal('unhandledRejection', err))
  process.on('exit', (code) => logStartup(`process exit: ${code}`))
  try {
    // 先应用测试目录，再写第一条日志，避免测试污染日常数据。
    if (process.env['READARC_USER_DATA']) app.setPath('userData', process.env['READARC_USER_DATA'])
    if (process.env['READARC_DOCUMENTS']) app.setPath('documents', process.env['READARC_DOCUMENTS'])
    if (process.env['NODE_TLS_REJECT_UNAUTHORIZED'] === '0') delete process.env['NODE_TLS_REJECT_UNAUTHORIZED']
    logStartup(`bootstrap entered: v${app.getVersion()} electron ${process.versions.electron} mas=${String(process.mas)} ${process.platform}/${process.arch} exe=${process.execPath}`)
    loadMain()
    logStartup('main module loaded')
  } catch (err) {
    reportFatal('main module load failed', err)
  }
}
