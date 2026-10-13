/**
 * 外部程序交来的 PDF（Finder「打开方式」、设为默认阅读器后的 Zotero、命令行参数）。
 * 冷启动时 macOS 的 open-file 早于窗口到达，所以先排队：渲染端准备好后取走队列，
 * 之后再来的请求直接推送。渲染端重新加载期间回到排队状态，不丢请求。
 */
import { existsSync } from 'node:fs'
import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../shared/ipc'

const queue: string[] = []
let rendererReady = false

/** 命令行里的 PDF 路径（Windows / Linux 的打开方式走参数；开发时 `electron . a.pdf` 同理） */
export function pdfPathsFromArgv(argv: string[]): string[] {
  return argv.filter((a) => !a.startsWith('-') && /\.pdf$/i.test(a) && existsSync(a))
}

export function enqueueOpenFiles(paths: string[]): void {
  for (const p of paths) if (!queue.includes(p)) queue.push(p)
  flush()
}

function flush(): void {
  if (!rendererReady || queue.length === 0) return
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) return
  win.webContents.send(IPC.openFiles, queue.splice(0))
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 窗口开始（重新）加载页面：渲染端的订阅已失效，新请求先排队 */
export function markRendererLoading(): void {
  rendererReady = false
}

export function registerOpenFilesIpc(): void {
  ipcMain.handle(IPC.openFilesTake, () => {
    rendererReady = true
    return queue.splice(0)
  })
}
