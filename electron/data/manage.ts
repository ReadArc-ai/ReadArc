/**
 * 应用数据总览与清理（设置 → 数据）。
 * 用户能看到每类数据存在哪、占多大，并按类清理；密钥与笔记是用户自己的东西，
 * 「全部重置」也不碰它们。路径都从调用方传入，便于测试隔离。
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { DataClearKind, DataEntry, DataOverview } from '../../shared/models'

export interface DataPaths {
  /** ~/.readarc：config.yaml 与 .env（密钥） */
  configDir: string
  /** userData：数据库、PDF 副本、图表截图、封面缩略图、settings.json */
  userDataDir: string
  /** 笔记 Markdown：普通版在 Documents/ReadArc，MAS 版在应用容器 */
  notesDir: string
}

/** 目录（或单个文件）的总字节数与文件数；不存在按 0 算 */
export function measure(path: string): { bytes: number; files: number } {
  if (!existsSync(path)) return { bytes: 0, files: 0 }
  const st = statSync(path)
  if (!st.isDirectory()) return { bytes: st.size, files: 1 }
  let bytes = 0
  let files = 0
  const stack = [path]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      const p = join(dir, name)
      let s
      try {
        s = statSync(p)
      } catch {
        continue
      }
      if (s.isDirectory()) stack.push(p)
      else {
        bytes += s.size
        files++
      }
    }
  }
  return { bytes, files }
}

function count(db: Database.Database, sql: string): number {
  try {
    return Number((db.prepare(sql).get() as { n: number }).n)
  } catch {
    return 0
  }
}

/** 各类数据在库文件里占的页字节数（dbstat 虚表，表与索引按名字归类）；不支持 dbstat 时全 0 */
export function tableBytes(db: Database.Database): NonNullable<DataEntry['sizes']> {
  const sizes = { translations: 0, summaries: 0, chats: 0, usage: 0, searchCache: 0 }
  let rows: { name: string; bytes: number }[] = []
  try {
    rows = db.prepare('SELECT name, sum(pgsize) AS bytes FROM dbstat GROUP BY name').all() as typeof rows
  } catch {
    return sizes
  }
  for (const r of rows) {
    const n = r.name
    const b = Number(r.bytes)
    if (n.includes('translations')) sizes.translations += b
    else if (n.includes('summaries')) sizes.summaries += b
    else if (n.includes('chat_')) sizes.chats += b
    else if (n.includes('usage')) sizes.usage += b
    else if (n.includes('search_cache')) sizes.searchCache += b
  }
  return sizes
}

export function dataOverview(db: Database.Database, paths: DataPaths): DataOverview {
  const u = paths.userDataDir
  const dbFiles = ['readarc.db', 'readarc.db-wal', 'readarc.db-shm'].map((f) => join(u, f))
  const dbSize = dbFiles.reduce((acc, f) => acc + measure(f).bytes, 0)
  const figures = measure(join(u, 'figures'))
  const thumbs = measure(join(u, 'thumbs'))
  const entries: DataEntry[] = [
    {
      id: 'db',
      path: join(u, 'readarc.db'),
      bytes: dbSize,
      files: 1,
      counts: {
        papers: count(db, 'SELECT count(*) AS n FROM papers'),
        translations: count(db, 'SELECT count(*) AS n FROM translations'),
        summaries: count(db, 'SELECT count(*) AS n FROM summaries'),
        chats: count(db, 'SELECT count(*) AS n FROM chat_sessions'),
        usage: count(db, 'SELECT count(*) AS n FROM usage_log'),
        searchCache: count(db, 'SELECT count(*) AS n FROM search_cache')
      },
      sizes: tableBytes(db)
    },
    { id: 'papers', path: join(u, 'papers'), ...measure(join(u, 'papers')) },
    { id: 'figures', path: join(u, 'figures'), bytes: figures.bytes + thumbs.bytes, files: figures.files + thumbs.files },
    { id: 'notes', path: paths.notesDir, ...measure(paths.notesDir) },
    { id: 'settings', path: join(u, 'settings.json'), ...measure(join(u, 'settings.json')) },
    { id: 'config', path: paths.configDir, ...measure(paths.configDir) }
  ]
  return { entries, total: entries.reduce((acc, e) => acc + e.bytes, 0) }
}

/**
 * 按类清理。返回是否需要重启（全部重置后数据库文件已删，进程必须重开）。
 * 全部重置保留：配置与密钥（configDir）、笔记（notesDir）。
 */
export function clearData(
  db: Database.Database,
  paths: DataPaths,
  kind: DataClearKind,
  closeDb: () => void = () => {}
): { relaunch: boolean } {
  const u = paths.userDataDir
  const rm = (p: string): void => {
    try {
      rmSync(p, { recursive: true, force: true })
    } catch (err) {
      console.warn('clear data failed:', p, err)
    }
  }
  switch (kind) {
    case 'search-cache':
      db.prepare('DELETE FROM search_cache').run()
      return { relaunch: false }
    case 'figures':
      rm(join(u, 'figures'))
      rm(join(u, 'thumbs'))
      return { relaunch: false }
    case 'translations':
      db.prepare('DELETE FROM translations').run()
      return { relaunch: false }
    case 'summaries':
      db.prepare('DELETE FROM summaries').run()
      return { relaunch: false }
    case 'chats':
      db.prepare('DELETE FROM chat_messages').run()
      db.prepare('DELETE FROM chat_sessions').run()
      return { relaunch: false }
    case 'usage':
      db.prepare('DELETE FROM usage_log').run()
      return { relaunch: false }
    case 'all':
      closeDb()
      for (const f of ['readarc.db', 'readarc.db-wal', 'readarc.db-shm', 'settings.json']) rm(join(u, f))
      rm(join(u, 'papers'))
      rm(join(u, 'figures'))
      rm(join(u, 'thumbs'))
      return { relaunch: true }
  }
}
