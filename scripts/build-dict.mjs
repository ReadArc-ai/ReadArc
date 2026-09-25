/**
 * 内置词典构建：ECDICT 全量 stardict.db → 按词频裁剪的精简库。
 * 用法：node scripts/build-dict.mjs <stardict.db 路径>
 * 产物：resources/dict/ecdict.sqlite（word/phonetic/translation 三列，
 * 取 BNC 或当代语料词频前 12 万 + 带柯林斯/牛津标记的词，约几 MB）。
 * 数据来源 skywind3000/ECDICT（MIT）。
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = process.argv[2]
if (!src) {
  console.error('用法: node scripts/build-dict.mjs <stardict.db>')
  process.exit(1)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = join(root, 'resources', 'dict', 'ecdict.sqlite')
mkdirSync(dirname(outPath), { recursive: true })

const full = new Database(src, { readonly: true })
const out = new Database(outPath)
out.pragma('journal_mode = OFF')
out.exec('DROP TABLE IF EXISTS dict')
out.exec('CREATE TABLE dict (word TEXT PRIMARY KEY, phonetic TEXT, translation TEXT)')
const ins = out.prepare('INSERT OR REPLACE INTO dict VALUES (?, ?, ?)')

const rows = full
  .prepare(
    `SELECT word, phonetic, translation FROM stardict
     WHERE translation IS NOT NULL AND translation != ''
       AND word NOT LIKE '% %' AND length(word) <= 24
       AND word GLOB '[a-z]*'
       AND (
         (frq > 0 AND frq <= 250000) OR (bnc > 0 AND bnc <= 250000)
         OR collins > 0 OR oxford > 0 OR tag != ''
         OR length(word) <= 4
         -- 不规则变形条目（began/shown："××的过去式/过去分词/…"）
         OR translation LIKE '%的过去式%' OR translation LIKE '%的过去分词%'
         OR translation LIKE '%的现在分词%' OR translation LIKE '%的复数%'
         OR translation LIKE '%的比较级%' OR translation LIKE '%的最高级%'
       )`
  )
  .all()

let n = 0
out.transaction(() => {
  for (const r of rows) {
    ins.run(String(r.word).toLowerCase(), r.phonetic ?? '', r.translation)
    n++
  }
})()
out.exec('VACUUM')
console.log(`词条 ${n} → ${outPath}`)
full.close()
out.close()
