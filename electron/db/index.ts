import type Database from 'better-sqlite3'
import { sqliteDriver } from './driver'
import { MIGRATIONS } from './schema'
import type { BlockRow, PaperRow } from '../../shared/models'
import { preservesInlineContent } from '../../shared/translation-integrity'
import { parseInlines } from '../../shared/inline-formula'

export type { BlockRow, PaperRow }

export function openDb(path: string): Database.Database {
  const db = new (sqliteDriver())(path)
  db.function('inline_content_matches', { deterministic: true }, (source, translated) =>
    typeof source === 'string' && typeof translated === 'string' && preservesInlineContent(source, translated) ? 1 : 0
  )
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
  // v8 发布后又往同一条迁移里加过 thinking 列：已经跑过旧 v8 的库 user_version 是 8 但没有这列。
  // 迁移一旦发出就不该再改——这里按实际表结构补列，幂等，兜住所有分支
  ensureColumn(db, 'chat_messages', 'image', 'TEXT')
  ensureColumn(db, 'chat_messages', 'thinking', 'TEXT')
}

/** 表里没有这一列就加上（SQLite 的 ADD COLUMN 没有 IF NOT EXISTS） */
export function ensureColumn(db: Database.Database, table: string, column: string, decl: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[]
  if (cols.some((c) => c.name === column)) return false
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`)
  return true
}

/* ---- papers ---- */

const PAPER_DEFAULTS = {
  title: null,
  title_zh: null,
  authors: null,
  year: null,
  source: null,
  arxiv_id: null,
  doi: null,
  status: 'new',
  progress: 0,
  last_section: null,
  scroll_position: 0,
  last_opened_at: null
} as const

export function upsertPaper(
  db: Database.Database,
  paper: Pick<PaperRow, 'id' | 'file_path' | 'added_at'> & Partial<PaperRow>
): void {
  db.prepare(
    `INSERT INTO papers (id, file_path, title, title_zh, authors, year, source, arxiv_id, doi, status, progress, last_section, scroll_position, added_at, last_opened_at)
     VALUES (@id, @file_path, @title, @title_zh, @authors, @year, @source, @arxiv_id, @doi, @status, @progress, @last_section, @scroll_position, @added_at, @last_opened_at)
     ON CONFLICT(id) DO UPDATE SET
       file_path = @file_path,
       title = COALESCE(@title, title)  -- 重复导入可修正启发式标题（解析改进后生效）`
  ).run({ ...PAPER_DEFAULTS, ...paper })
}

export function getPaper(db: Database.Database, id: string): PaperRow | undefined {
  return db.prepare('SELECT * FROM papers WHERE id = ?').get(id) as PaperRow | undefined
}

/** 删除一篇论文的全部 DB 痕迹：译文缓存、块（FTS 由触发器同步清理）、摘要、对话、论文行。
 *  用量日志（usage_log）是账本不删；笔记 Markdown 是用户文件更不碰 [P6]。 */
export function deletePaperData(db: Database.Database, paperId: string): void {
  db.transaction(() => {
    // block_id 以 paper id 为前缀（sha1(file):page:order），按前缀删能一并清掉
    // 「块已经没了、译文还在」的孤儿行——重解析留下的，以及删除时在途回写的。
    db.prepare('DELETE FROM translations WHERE block_id LIKE ?').run(`${paperId}:%`)
    db.prepare('DELETE FROM blocks WHERE paper_id = ?').run(paperId)
    db.prepare('DELETE FROM summaries WHERE paper_id = ?').run(paperId)
    db.prepare('DELETE FROM papers WHERE id = ?').run(paperId)
  })()
}

/** 用检索来源的权威元数据覆盖启发式解析结果；传入值缺失时保留原值。 */
export function enrichPaperMeta(
  db: Database.Database,
  id: string,
  meta: Partial<Pick<PaperRow, 'title' | 'authors' | 'year' | 'source' | 'doi' | 'arxiv_id'>>
): void {
  db.prepare(
    `UPDATE papers SET
       title    = COALESCE(@title, title),
       authors  = COALESCE(@authors, authors),
       year     = COALESCE(@year, year),
       source   = COALESCE(@source, source),
       doi      = COALESCE(@doi, doi),
       arxiv_id = COALESCE(@arxiv_id, arxiv_id)
     WHERE id = @id`
  ).run({ title: null, authors: null, year: null, source: null, doi: null, arxiv_id: null, ...meta, id })
}

export function findPaperByIds(
  db: Database.Database,
  doi: string | null,
  arxivId: string | null
): PaperRow | undefined {
  if (arxivId) {
    const hit = db.prepare('SELECT * FROM papers WHERE arxiv_id = ?').get(arxivId) as
      | PaperRow
      | undefined
    if (hit) return hit
  }
  if (doi) {
    return db.prepare('SELECT * FROM papers WHERE doi = ?').get(doi) as PaperRow | undefined
  }
  return undefined
}

/** 阅读进度按最深位置记录，只增不减。 */
export function recordProgress(
  db: Database.Database,
  id: string,
  progress: number,
  scrollPosition: number,
  lastSection: string | null
): void {
  db.prepare(
    `UPDATE papers SET
       progress = MAX(progress, @progress),
       scroll_position = @scrollPosition,
       last_section = @lastSection,
       status = CASE WHEN MAX(progress, @progress) >= 100 THEN 'done' ELSE 'reading' END,
       last_opened_at = @now
     WHERE id = @id`
  ).run({ id, progress, scrollPosition, lastSection, now: Date.now() })
}

/* ---- blocks ---- */

export function replaceBlocks(db: Database.Database, paperId: string, blocks: BlockRow[]): void {
  const insert = db.prepare(
    `INSERT INTO blocks (block_id, paper_id, page, block_order, kind, section, text, bbox, simhash, heading_level, font_size, inlines)
     VALUES (@block_id, @paper_id, @page, @block_order, @kind, @section, @text, @bbox, @simhash, @heading_level, @font_size, @inlines)`
  )
  db.transaction(() => {
    db.prepare('DELETE FROM blocks WHERE paper_id = ?').run(paperId)
    for (const b of blocks) insert.run({ ...b, inlines: b.inlines ?? null })
  })()
}

/** 追加块（不动已有的）：给老论文补页边块用；id 撞上就跳过 */
export function appendBlocks(db: Database.Database, blocks: BlockRow[]): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO blocks (block_id, paper_id, page, block_order, kind, section, text, bbox, simhash, heading_level, font_size, inlines)
     VALUES (@block_id, @paper_id, @page, @block_order, @kind, @section, @text, @bbox, @simhash, @heading_level, @font_size, @inlines)`
  )
  db.transaction(() => {
    for (const b of blocks) insert.run({ ...b, inlines: b.inlines ?? null })
  })()
}

export function setLayoutState(db: Database.Database, paperId: string, state: 'pending' | 'done', version?: number): void {
  if (version === undefined) db.prepare('UPDATE papers SET layout_state = ? WHERE id = ?').run(state, paperId)
  else db.prepare('UPDATE papers SET layout_state = ?, layout_version = ? WHERE id = ?').run(state, version, paperId)
}

/** 用旧版解析规则识别的论文置回 pending，交给后台队列按当前规则重识别；返回篇数 */
export function markStaleLayouts(db: Database.Database, version: number): number {
  return db.prepare("UPDATE papers SET layout_state = 'pending' WHERE layout_state = 'done' AND layout_version < ?").run(version).changes
}

/** 后台版面识别没做完的论文（应用中途退出过） */
export function pendingLayoutPaperIds(db: Database.Database): string[] {
  return (db.prepare("SELECT id FROM papers WHERE layout_state = 'pending'").all() as { id: string }[]).map((r) => r.id)
}

export function marginsReady(db: Database.Database, paperId: string): boolean {
  const row = db.prepare('SELECT margins_ready FROM papers WHERE id = ?').get(paperId) as
    | { margins_ready: number }
    | undefined
  return !!row && row.margins_ready === 1
}

export function markMarginsReady(db: Database.Database, paperId: string): void {
  db.prepare('UPDATE papers SET margins_ready = 1 WHERE id = ?').run(paperId)
}

/**
 * 重新解析后迁移译文缓存：块 id 绑着「页:序号」，解析器升级会让序号偏移，
 * 老译文变孤儿。按 simhash（内容指纹）把老块的译文搬到新块 id 上——
 * 内容没变的段落，重解析零损失。最后清掉本论文残留的孤儿行。
 */
export function migrateTranslationsBySimhash(
  db: Database.Database,
  paperId: string,
  oldBlocks: BlockRow[],
  newBlocks: BlockRow[]
): number {
  // 相似指纹不证明内容相同：新增一个脚注、改一个数字或否定词也可能只差几位。
  // 只忽略空白变化；公式序号相同时还须核对其实际内容，避免重分段后指向另一张公式图。
  const normalized = (text: string): string => text.replace(/\s+/g, ' ').trim()
  const sameContent = (a: BlockRow, b: BlockRow): boolean =>
    normalized(a.text) === normalized(b.text) &&
    JSON.stringify(parseInlines(a.inlines).map((f) => [f.n, normalized(f.text)])) ===
      JSON.stringify(parseInlines(b.inlines).map((f) => [f.n, normalized(f.text)]))
  const simToNew = new Map<string, string | null>()
  for (const b of newBlocks) {
    simToNew.set(b.simhash, simToNew.has(b.simhash) ? null : b.block_id)
  }
  const oldById = new Map(oldBlocks.map((b) => [b.block_id, b]))
  const newById = new Map(newBlocks.map((b) => [b.block_id, b]))

  interface TrRow {
    block_id: string
    glossary_version: number
    prompt_version: number
    model: string
    text: string
    created_at: number
  }
  let moved = 0
  const tx = db.transaction(() => {
    // 整读 → 清空 → 重键回写：新旧序号交错时新 id 位置可能残留「旧内容」的译文行，
    // 原地增量写会保住错的那条。未匹配的行原样保留（孤儿无害，且可供未来找回）。
    const rows = db
      .prepare(`SELECT * FROM translations WHERE block_id LIKE ?`)
      .all(`${paperId}:%`) as TrRow[]
    db.prepare(`DELETE FROM translations WHERE block_id LIKE ?`).run(`${paperId}:%`)
    const insert = db.prepare(
      `INSERT OR IGNORE INTO translations (block_id, glossary_version, prompt_version, model, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const r of rows) {
      const oldBlock = oldById.get(r.block_id)
      let newId: string | undefined
      if (oldBlock) {
        // ① 内容指纹精确匹配（跨位置搬家）
        const exact = simToNew.get(oldBlock.simhash)
        if (exact && sameContent(oldBlock, newById.get(exact)!)) newId = exact
        // ② 同位置也必须内容相同，不能把公式或脚注有变化的旧译文继续使用。
        if (!newId) {
          const same = newById.get(r.block_id)
          if (same && sameContent(oldBlock, same)) newId = same.block_id
        }
      }
      // ③ 未匹配：只有当该 id 已经空出来时才按原 id 保留——孤儿行本身无害，
      //    未来解析回摆还能对上；但若这个 id 已被「内容完全不同的新块」占用，
      //    留着就等于给新块挂了别人的译文（页面上会显示与原文毫不相干的内容）。
      if (!newId && newById.has(r.block_id)) continue
      if (newId && !preservesInlineContent(newById.get(newId)!.text, r.text)) continue
      insert.run(newId ?? r.block_id, r.glossary_version, r.prompt_version, r.model, r.text, r.created_at)
      if (newId && newId !== r.block_id) moved++
    }
  })
  tx()
  return moved
}

/** 一篇论文每个块的最新译文（对话检索用：中文问句只能在中文里找得到）。 */
export function listPaperTranslations(
  db: Database.Database,
  paperId: string
): { block_id: string; text: string }[] {
  return db
    .prepare(
      `SELECT t.block_id, t.text
         FROM translations t
         JOIN blocks b ON b.block_id = t.block_id
        WHERE b.paper_id = ? AND t.text NOT LIKE '%think>%'
          AND inline_content_matches(b.text, t.text)
        GROUP BY t.block_id
       HAVING t.created_at = MAX(t.created_at)`
    )
    .all(paperId) as { block_id: string; text: string }[]
}

export function getBlocks(db: Database.Database, paperId: string): BlockRow[] {
  return db
    .prepare('SELECT * FROM blocks WHERE paper_id = ? ORDER BY page, block_order')
    .all(paperId) as BlockRow[]
}

/** 只要论文行本身（不带翻译进度）：遍历全库时用，省掉两个子查询。 */
export function allPaperRows(db: Database.Database): PaperRow[] {
  return db.prepare('SELECT * FROM papers ORDER BY COALESCE(last_opened_at, added_at) DESC').all() as PaperRow[]
}

/**
 * 论文列表 + 翻译进度（库卡片展示）。
 *
 * 进度口径必须与阅读器一致，否则卡片显示「已全文翻译」而打开却提示「还有 N 段未翻译」：
 * 只算可译块（para/heading）、只算当前术语表与提示词版本、且空内容的行不算数。
 */
export function listPapers(
  db: Database.Database,
  glossaryVersion: number,
  promptVersion: number
): PaperRow[] {
  return db
    .prepare(
      `SELECT p.*,
         (SELECT COUNT(*) FROM blocks b
            WHERE b.paper_id = p.id AND b.kind IN ('para','heading')) AS trans_total,
         (SELECT COUNT(DISTINCT t.block_id) FROM translations t
            JOIN blocks b2 ON b2.block_id = t.block_id
            WHERE b2.paper_id = p.id AND b2.kind IN ('para','heading')
              AND t.glossary_version = @glossaryVersion
              AND t.prompt_version = @promptVersion
              AND trim(t.text) <> '' AND t.text NOT LIKE '%think>%'
              AND inline_content_matches(b2.text, t.text)) AS trans_done
       FROM papers p ORDER BY COALESCE(p.last_opened_at, p.added_at) DESC`
    )
    .all({ glossaryVersion, promptVersion }) as PaperRow[]
}

/** FTS5 检索，对话面板的上下文构造用（结构摘要 + 命中的 5–8 块）。 */
export function searchBlocks(
  db: Database.Database,
  paperId: string,
  query: string,
  limit = 8
): BlockRow[] {
  return db
    .prepare(
      `SELECT b.* FROM blocks_fts f
       JOIN blocks b ON b.rowid = f.rowid
       WHERE blocks_fts MATCH ? AND b.paper_id = ? AND b.kind != 'margin'
       ORDER BY rank LIMIT ?`
    )
    .all(query, paperId, limit) as BlockRow[]
}

/* ---- translations ---- */

export function getTranslation(
  db: Database.Database,
  blockId: string,
  glossaryVersion: number,
  promptVersion: number
): { text: string; model: string } | undefined {
  return db
    .prepare(
      `SELECT t.text, t.model FROM translations t
       LEFT JOIN blocks b ON b.block_id = t.block_id
       WHERE t.block_id = ? AND t.glossary_version = ? AND t.prompt_version = ?
         AND trim(t.text) <> '' AND t.text NOT LIKE '%think>%'
         AND (b.block_id IS NULL OR inline_content_matches(b.text, t.text))`
    )
    .get(blockId, glossaryVersion, promptVersion) as { text: string; model: string } | undefined
}

/* ---- usage ---- */

export function recordUsage(
  db: Database.Database,
  task: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): void {
  db.prepare(
    `INSERT INTO usage_log (ts, task, provider, model, input_tokens, output_tokens)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(Date.now(), task, provider, model, inputTokens, outputTokens)
}

/** 本月（自然月）用量合计，左栏用量块与设置页共用。 */
export function monthUsage(db: Database.Database): { inputTokens: number; outputTokens: number } {
  const start = new Date()
  start.setDate(1)
  start.setHours(0, 0, 0, 0)
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o
       FROM usage_log WHERE ts >= ?`
    )
    .get(start.getTime()) as { i: number; o: number }
  return { inputTokens: row.i, outputTokens: row.o }
}

export function putTranslation(
  db: Database.Database,
  blockId: string,
  glossaryVersion: number,
  promptVersion: number,
  model: string,
  text: string
): void {
  db.prepare(
    `INSERT INTO translations (block_id, glossary_version, prompt_version, model, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(block_id, glossary_version, prompt_version) DO UPDATE SET text = excluded.text, model = excluded.model`
  ).run(blockId, glossaryVersion, promptVersion, model, text, Date.now())
}
