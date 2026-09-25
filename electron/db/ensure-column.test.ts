import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { MIGRATIONS } from './schema'
import { ensureColumn, openDb } from './index'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('已跑过旧 v8（只有 image 列）的库', () => {
  it('打开时补上 thinking 列，再开一次不重复加', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'readarc-db-')), 'readarc.db')
    // 造一个「旧 v8」库：跑到 v7，然后只加 image 列并把版本标成 8
    const raw = new Database(path)
    for (let v = 0; v < 7; v++) raw.exec(MIGRATIONS[v])
    raw.exec('ALTER TABLE chat_messages ADD COLUMN image TEXT')
    raw.pragma('user_version = 8')
    raw.close()

    const db = openDb(path)
    const cols = (db.pragma('table_info(chat_messages)') as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('image')
    expect(cols).toContain('thinking')
    expect(ensureColumn(db, 'chat_messages', 'thinking', 'TEXT')).toBe(false)
    db.prepare("INSERT INTO papers(id, file_path, added_at) VALUES ('p', '/x.pdf', 1)").run()
    db.prepare("INSERT INTO chat_sessions(id, paper_id, created_at, updated_at) VALUES ('s', 'p', 1, 1)").run()
    db.prepare("INSERT INTO chat_messages(session_id, role, text, created_at, thinking) VALUES ('s', 'assistant', 'a', 1, 't')").run()
    expect((db.prepare('SELECT thinking FROM chat_messages').get() as { thinking: string }).thinking).toBe('t')
    db.close()
  })
})
