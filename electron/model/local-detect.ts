/**
 * 本地模型探测：启动时敲 Ollama / LM Studio 的 /v1/models，
 * 探到就自动写入 providers:（走 saveProvider，同样遵守原地 patch 与无变化不写）。
 */
import { BUILTIN_PROFILES } from './profiles'
import { saveProvider } from '../config/provider-writer'
import { defaultRoots, type ConfigRoots } from '../config/providers-config'

export interface DetectedLocal {
  slug: string
  baseUrl: string
  models: string[]
}

async function probe(baseUrl: string, timeoutMs = 1200): Promise<string[] | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(baseUrl.replace(/\/+$/, '') + '/models', { signal: ctrl.signal })
    if (!res.ok) return null
    const parsed = (await res.json()) as { data?: { id?: string }[] }
    return (parsed.data ?? []).map((m) => m.id ?? '').filter(Boolean)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function detectLocalProviders(
  roots: ConfigRoots = defaultRoots(),
  overrides?: { slug: string; baseUrl: string }[]
): Promise<DetectedLocal[]> {
  const targets =
    overrides ??
    BUILTIN_PROFILES.filter((p) => p.local).map((p) => ({ slug: p.slug, baseUrl: p.baseUrl }))

  const found: DetectedLocal[] = []
  await Promise.all(
    targets.map(async (t) => {
      const models = await probe(t.baseUrl)
      if (models === null) return
      const profile = BUILTIN_PROFILES.find((p) => p.slug === t.slug)
      saveProvider(
        { slug: t.slug, name: profile?.name ?? t.slug, baseUrl: t.baseUrl },
        roots
      )
      found.push({ slug: t.slug, baseUrl: t.baseUrl, models })
    })
  )
  return found
}
