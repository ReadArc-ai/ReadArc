/** 主进程里用户可见产物的落点：笔记目录、数据页要展示的几条路径 */
import { app } from 'electron'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { defaultRoots } from '../config/providers-config'

// 非商店版把用户可见产物收在 ~/Documents/ReadArc/；MAS 沙盒无法稳定直写真实 Documents，
// 因此写进应用容器（设置 → 数据仍可定位）。外部 PDF 在导入时只读并复制进容器。
export function notesDir(): string {
  const root = process.mas ? join(app.getPath('userData'), 'ReadArc') : join(app.getPath('documents'), 'ReadArc')
  const dir = join(root, 'Notes')
  if (process.mas) return dir

  // 早期版本落在 ~/Documents/ReadArc Notes/，首次访问时整目录迁移过来。
  const legacy = join(app.getPath('documents'), 'ReadArc Notes')
  if (!existsSync(dir) && existsSync(legacy)) {
    try {
      mkdirSync(root, { recursive: true })
      renameSync(legacy, dir)
    } catch (err) {
      console.warn('notes dir migration failed, keep legacy path:', err)
      return legacy
    }
  }
  return dir
}

/** 设置 → 数据：路径、大小、按类清理用到的三个根目录 */
export function dataPaths(): { configDir: string; userDataDir: string; notesDir: string } {
  return {
    configDir: defaultRoots().readarcDir,
    userDataDir: app.getPath('userData'),
    notesDir: notesDir()
  }
}
