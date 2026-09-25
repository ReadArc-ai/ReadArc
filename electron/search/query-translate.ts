/**
 * 中文检索词转英文关键词：arXiv 和 Semantic Scholar 只认英文，用户按占位符里的中文例子搜会一无所获。
 * 走「问答」路由，一次几十个 token；同一句话进程内只翻一次。
 */
import type Database from 'better-sqlite3'
import { recordUsage } from '../db'
import { runTask } from '../model/router'
import { buildRouterContext } from '../translate/service'

const cache = new Map<string, string>()

export async function translateQueryToEnglish(db: Database.Database, query: string): Promise<string> {
  const key = query.trim()
  const hit = cache.get(key)
  if (hit) return hit
  const out = await runTask(
    'ask',
    {
      messages: [
        {
          role: 'system',
          content:
            'Rewrite the user\'s paper-search request as English academic search keywords for arXiv. Output only the keyword phrase, no quotes, punctuation or explanation.'
        },
        { role: 'user', content: key }
      ],
      temperature: 0,
      maxTokens: 60
    },
    buildRouterContext()
  )
  recordUsage(db, 'ask', out.attempt.slug, out.model, out.result.usage.inputTokens, out.result.usage.outputTokens)
  const en = out.result.text.split('\n')[0]?.replace(/^["'“”「」]+|["'“”「」.]+$/g, '').trim() ?? ''
  if (en) cache.set(key, en)
  return en
}
