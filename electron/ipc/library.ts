/** 论文库：导入、打开、删除、封面 / 图表截图、阅读进度 */
import { uiText } from '../i18n'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '../../shared/ipc'
import type { ProgressUpdate } from '../../shared/models'
import { getPaper } from '../db'
import { figureFileName } from '../library/import'
import {
  allPapers,
  appDb,
  deletePaper,
  ensureFigureQuality,
  ensureMarginBlocks,
  importPdfFiles,
  openPaperBundle,
  saveProgress,
  renotifyRefineQueueSoon,
  scheduleLayoutRefine
} from '../library/service'
import { readPdfAsset, type PdfAssetKind } from '../docengine/pdf-assets'
import { loadSettings, patchSettings } from '../settings-store'
import { stopPaperTranslation } from '../translate/service'

export function registerLibraryIpc(): void {
  ipcMain.handle(IPC.libraryImport, (e, paths: string[]) =>
    importPdfFiles(paths, (ev) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.importProgress, ev)
    })
  )
  // 只负责选文件；解析由渲染进程随后调 library:import，这样有进度回调
  ipcMain.handle(IPC.libraryPick, async (): Promise<string[]> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    return canceled ? [] : filePaths
  })
  ipcMain.handle(IPC.libraryList, () => allPapers())
  ipcMain.handle(IPC.paperOpen, (e, paperId: string) => {
    // quick 导入后模型识别还没做完（或上次退出时中断）：接着做，做完会推 paperBlocksUpdated
    // 正在看的这篇插到队首（升级后多篇一起重新识别时不用排在最后）
    if (getPaper(appDb(), paperId)?.layout_state === 'pending') {
      void scheduleLayoutRefine(paperId, { urgent: true })
      renotifyRefineQueueSoon()
    }
    // 老版本解析缺页边块：后台补一遍，补完通知渲染进程刷新块列表（不阻塞打开）
    void ensureMarginBlocks(paperId)
      .then((added) => {
        if (added && !e.sender.isDestroyed()) e.sender.send(IPC.paperBlocksUpdated, paperId)
      })
      .catch((err) => console.warn('margin blocks upgrade failed:', err))
    return openPaperBundle(paperId)
  })
  ipcMain.on(IPC.paperMenu, (e, paperId: string) => {
    const paper = getPaper(appDb(), paperId)
    if (!paper) return
    const menu = Menu.buildFromTemplate([
      {
        label: process.platform === 'darwin' ? uiText('menu.finder') : uiText('menu.folder'),
        click: () => shell.showItemInFolder(paper.file_path)
      },
      { type: 'separator' },
      // 删除需要确认，交回渲染端走既有的 confirm 流程
      { label: uiText('menu.delete'), click: () => e.sender.send(IPC.paperMenuDelete, paperId) }
    ])
    const win = BrowserWindow.fromWebContents(e.sender)
    menu.popup(win ? { window: win } : {})
  })
  ipcMain.handle(IPC.paperDelete, (_e, paperId: string) => {
    // 先停翻译：否则在途批次会继续为一篇已删除的论文调用模型（真金白银），
    // 并在删除之后把译文写回来
    stopPaperTranslation(paperId)
    const ok = deletePaper(paperId)
    // 刚删的是「上次打开」的论文：清掉，避免下次启动去恢复一篇不存在的
    if (ok && loadSettings().lastPaperId === paperId) patchSettings({ lastPaperId: null })
    return ok
  })
  ipcMain.handle(IPC.paperFile, (_e, paperId: string) => {
    const paper = allPapers().find((p) => p.id === paperId)
    if (!paper) return null
    try {
      const buf = readFileSync(paper.file_path)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    } catch {
      return null // 文件被移动/删除：封面退回纹理占位即可
    }
  })
  ipcMain.handle(IPC.pdfAsset, (_e, kind: PdfAssetKind, filename: string) => {
    const buf = readPdfAsset(kind, filename)
    return buf ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : null
  })
  ipcMain.handle(IPC.thumbSave, (_e, paperId: string, dataUrl: string) => {
    const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl)
    if (!m || !/^[0-9a-f]{40}$/.test(paperId)) return
    const dir = join(app.getPath('userData'), 'thumbs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${paperId}.png`), Buffer.from(m[1], 'base64'))
  })
  ipcMain.handle(IPC.figureGet, async (_e, paperId: string, blockIdStr: string) => {
    // 块 id 后可带 :fN——段落里第 N 个行内公式的截图
    if (!/^[0-9a-f]{40}$/.test(paperId) || !/^[0-9a-f]{40}:\d+:\d+(?::f\d{1,3})?$/.test(blockIdStr)) return null
    // 老倍率裁的截图先按当前倍率重裁一遍（一篇只做一次）；失败就照旧返回老图
    try {
      await ensureFigureQuality(paperId)
    } catch (err) {
      console.warn('figure upgrade failed:', err)
    }
    try {
      const buf = readFileSync(join(app.getPath('userData'), 'figures', paperId, figureFileName(blockIdStr)))
      return `data:image/png;base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  })
  ipcMain.handle(IPC.thumbGet, (_e, paperId: string) => {
    if (!/^[0-9a-f]{40}$/.test(paperId)) return null
    try {
      const buf = readFileSync(join(app.getPath('userData'), 'thumbs', `${paperId}.png`))
      return `data:image/png;base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  })
  ipcMain.on(IPC.paperProgress, (_e, paperId: string, update: ProgressUpdate) => {
    saveProgress(paperId, update)
  })
}
