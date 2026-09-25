/**
 * 术语表（P0：翻译时强制生效）。~/.readarc/glossary.yaml，纯文本可进 Git、可共享给课题组：
 *
 *   terms:
 *     ablation: 消融实验
 *     attention head: 注意力头
 *
 * version 由内容哈希导出——改术语表 → 版本变 → 译文缓存自然失效重译。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { defaultRoots, type ConfigRoots } from '../config/providers-config'

export interface Glossary {
  terms: Record<string, string>
  version: number
}

export const EMPTY_GLOSSARY: Glossary = { terms: {}, version: 0 }

function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function glossaryFromText(text: string): Glossary {
  let doc: unknown
  try {
    doc = parseYaml(text)
  } catch {
    return EMPTY_GLOSSARY
  }
  const raw = (doc as { terms?: Record<string, unknown> } | null)?.terms
  if (!raw || typeof raw !== 'object') return EMPTY_GLOSSARY
  const terms: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && k.trim()) terms[k.trim()] = v
  }
  const keys = Object.keys(terms)
  if (keys.length === 0) return EMPTY_GLOSSARY
  const canonical = keys
    .sort()
    .map((k) => `${k}=${terms[k]}`)
    .join('\n')
  return { terms, version: fnv1a32(canonical) }
}

export function loadGlossary(roots: ConfigRoots = defaultRoots()): Glossary {
  try {
    return glossaryFromText(readFileSync(join(roots.readarcDir, 'glossary.yaml'), 'utf8'))
  } catch {
    return EMPTY_GLOSSARY
  }
}
