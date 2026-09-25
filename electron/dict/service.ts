/**
 * 内置离线词典（ECDICT 精简库，MIT）：划词查单词零延迟、零成本、离线可用。
 * 只服务单词/简单词形——句子与短语交给 LLM 翻译。
 */
import type Database from 'better-sqlite3'
import { sqliteDriver } from '../db/driver'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface DictEntry {
  word: string
  phonetic: string
  translation: string
}

let db: Database.Database | null | undefined

function dictPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'dict', 'ecdict.sqlite')
    : join(app.getAppPath(), 'resources', 'dict', 'ecdict.sqlite')
}

function dictDb(): Database.Database | null {
  if (db !== undefined) return db
  const p = dictPath()
  db = existsSync(p) ? new (sqliteDriver())(p, { readonly: true, fileMustExist: true }) : null
  return db
}

/** 朴素词形还原：查词优先精确命中，其次常见屈折变化逐个回退。 */
function lemmaCandidates(w: string): string[] {
  const out = [w]
  const push = (s: string): void => {
    if (s.length >= 2 && !out.includes(s)) out.push(s)
  }
  if (w.endsWith('ies')) push(w.slice(0, -3) + 'y')
  if (w.endsWith('es')) push(w.slice(0, -2))
  if (w.endsWith('s')) push(w.slice(0, -1))
  if (w.endsWith('ing')) {
    push(w.slice(0, -3))
    push(w.slice(0, -3) + 'e')
  }
  if (w.endsWith('ed')) {
    push(w.slice(0, -2))
    push(w.slice(0, -1))
  }
  if (w.endsWith('er')) push(w.slice(0, -2))
  if (w.endsWith('est')) push(w.slice(0, -3))
  if (w.endsWith('ly')) push(w.slice(0, -2))
  if (w.endsWith('al')) push(w.slice(0, -2))
  // 双写辅音变形：occurred/spanning 剥缀后再去一个重复辅音
  for (const c of [...out]) {
    if (/([b-df-hj-np-tv-z])\1$/.test(c)) push(c.slice(0, -1))
  }
  // 常见构词前缀：unmodeled → modeled、multiwavelength → wavelength
  for (const p of ['un', 'non', 'multi', 'sub', 'inter', 'anti', 'over', 'under']) {
    if (w.startsWith(p) && w.length - p.length >= 4) push(w.slice(p.length))
  }
  return out
}

/** 单词查询；未命中或词典缺失返回 null（上层回退 LLM）。 */
export function lookupWord(term: string): DictEntry | null {
  const d = dictDb()
  if (!d) return null
  const w = term.trim().toLowerCase()
  if (!/^[a-z][a-z'-]{0,23}$/.test(w)) return null
  const stmt = d.prepare('SELECT word, phonetic, translation FROM dict WHERE word = ?')
  for (const cand of lemmaCandidates(w)) {
    const hit = stmt.get(cand) as DictEntry | undefined
    if (hit) return hit
  }
  return null
}
