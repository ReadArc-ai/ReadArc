/** 设置 → 数据：路径、大小、按类清理。全部重置后重启进程（库文件已删） */
import { app, ipcMain, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { IPC } from '../../shared/ipc'
import type { DataClearKind, DataEntryId } from '../../shared/models'
import { clearData, dataOverview } from '../data/manage'
import { appDb, closeAppDb } from '../library/service'
import { dataPaths } from './paths'

export function registerDataIpc(): void {
  ipcMain.handle(IPC.dataOverview, () => dataOverview(appDb(), dataPaths()))
  ipcMain.handle(IPC.dataClear, (_e, kind: DataClearKind) => {
    const r = clearData(appDb(), dataPaths(), kind, closeAppDb)
    if (r.relaunch) {
      app.relaunch()
      setTimeout(() => app.exit(0), 200)
    }
    return r
  })
  ipcMain.handle(IPC.dataReveal, (_e, id: DataEntryId) => {
    const entry = dataOverview(appDb(), dataPaths()).entries.find((x) => x.id === id)
    if (!entry) return
    if (id === 'db' || id === 'settings') shell.showItemInFolder(entry.path)
    else {
      mkdirSync(entry.path, { recursive: true })
      void shell.openPath(entry.path)
    }
  })
}
