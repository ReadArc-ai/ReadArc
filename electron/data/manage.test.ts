import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { openDb } from '../db'
import { clearData, dataOverview, measure } from './manage'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'readarc-data-'))
  const userDataDir = join(root, 'udd')
  const configDir = join(root, '.readarc')
  const notesDir = join(root, 'docs', 'ReadArc')
  mkdirSync(join(userDataDir, 'papers'), { recursive: true })
  mkdirSync(join(userDataDir, 'figures', 'p1'), { recursive: true })
  mkdirSync(join(userDataDir, 'thumbs'), { recursive: true })
  mkdirSync(configDir, { recursive: true })
  mkdirSync(join(notesDir, 'Notes'), { recursive: true })
  writeFileSync(join(userDataDir, 'papers', 'a.pdf'), Buffer.alloc(1000))
  writeFileSync(join(userDataDir, 'figures', 'p1', 'f.png'), Buffer.alloc(300))
  writeFileSync(join(userDataDir, 'thumbs', 'p1.png'), Buffer.alloc(200))
  writeFileSync(join(userDataDir, 'settings.json'), '{}')
  writeFileSync(join(configDir, '.env'), 'X=1')
  writeFileSync(join(notesDir, 'Notes', 'a.md'), '---\n---\n')
  const db = openDb(join(userDataDir, 'readarc.db'))
  db.prepare("INSERT INTO search_cache(query_norm, source, json, ts) VALUES ('q', 's', '[]', 1)").run()
  db.prepare("INSERT INTO usage_log(ts, task, provider, model, input_tokens, output_tokens) VALUES (1, 'ask', 'p', 'm', 1, 1)").run()
  return { db, paths: { userDataDir, configDir, notesDir } }
}

describe('数据总览与清理', () => {
  it('measure：目录递归求和，缺失路径按 0', () => {
    const { paths } = setup()
    expect(measure(join(paths.userDataDir, 'papers'))).toEqual({ bytes: 1000, files: 1 })
    expect(measure(join(paths.userDataDir, 'nope'))).toEqual({ bytes: 0, files: 0 })
  })

  it('overview：每类都有路径与大小，图表把缩略图一起算', () => {
    const { db, paths } = setup()
    const o = dataOverview(db, paths)
    const by = Object.fromEntries(o.entries.map((e) => [e.id, e]))
    expect(by['papers'].bytes).toBe(1000)
    expect(by['figures'].bytes).toBe(500)
    expect(by['notes'].files).toBe(1)
    expect(by['config'].path).toBe(paths.configDir)
    expect(by['db'].counts?.searchCache).toBe(1)
    expect(by['db'].counts?.usage).toBe(1)
    // 有行的表至少占一页；空表也有根页，但不该把别的表算进来
    expect(by['db'].sizes?.usage).toBeGreaterThan(0)
    expect(by['db'].sizes?.searchCache).toBeGreaterThan(0)
    expect(o.total).toBeGreaterThan(1500)
  })

  it('按类清理：只动自己那类', () => {
    const { db, paths } = setup()
    clearData(db, paths, 'search-cache')
    expect(dataOverview(db, paths).entries.find((e) => e.id === 'db')?.counts?.searchCache).toBe(0)
    expect(dataOverview(db, paths).entries.find((e) => e.id === 'db')?.counts?.usage).toBe(1)
    clearData(db, paths, 'figures')
    expect(existsSync(join(paths.userDataDir, 'figures'))).toBe(false)
    expect(existsSync(join(paths.userDataDir, 'papers', 'a.pdf'))).toBe(true)
  })

  it('全部重置：删库、副本、图表、设置；密钥与笔记保留；要求重启', () => {
    const { db, paths } = setup()
    let closed = false
    const r = clearData(db, paths, 'all', () => {
      closed = true
      ;(db as Database.Database).close()
    })
    expect(r.relaunch).toBe(true)
    expect(closed).toBe(true)
    expect(existsSync(join(paths.userDataDir, 'readarc.db'))).toBe(false)
    expect(existsSync(join(paths.userDataDir, 'papers'))).toBe(false)
    expect(existsSync(join(paths.userDataDir, 'settings.json'))).toBe(false)
    expect(existsSync(join(paths.configDir, '.env'))).toBe(true)
    expect(existsSync(join(paths.notesDir, 'Notes', 'a.md'))).toBe(true)
  })
})
