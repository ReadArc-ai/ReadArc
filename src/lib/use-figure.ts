/** 图/表/公式区域截图的 data URL（导入时落盘）；带内存缓存。 */
import { useEffect, useState } from 'react'

/**
 * 缓存上限：一张截图的 data URL 通常一两百 KB，读一晚上论文会攒下几十上百张。
 * 原来是无上限的 Map，翻过的图永远留在内存里；这里按最近使用淘汰。
 */
const CACHE_MAX = 120

const cache = new Map<string, string | null>()

/** 取值并刷新最近使用（Map 按插入顺序，重新插入即置于末尾） */
export function figureCacheGet(key: string): string | null | undefined {
  if (!cache.has(key)) return undefined
  const v = cache.get(key)
  cache.delete(key)
  cache.set(key, v ?? null)
  return v ?? null
}

export function figureCacheSet(key: string, value: string | null): void {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function figureCacheSize(): number {
  return cache.size
}

export function figureCacheClear(): void {
  cache.clear()
}

export function useFigureSrc(paperId: string | undefined, blockId: string): string | null {
  const key = `${paperId}:${blockId}`
  const [src, setSrc] = useState<string | null>(figureCacheGet(key) ?? null)
  // 换了块（列表复用同一个组件实例）时先用缓存里的值：渲染期同步调整状态，
  // 不在 effect 里 setState，避免级联渲染
  const [seenKey, setSeenKey] = useState(key)
  if (seenKey !== key) {
    setSeenKey(key)
    setSrc(figureCacheGet(key) ?? null)
  }

  useEffect(() => {
    if (!paperId || figureCacheGet(key) !== undefined) return
    let cancelled = false
    void window.readarc.getFigure(paperId, blockId).then((url) => {
      figureCacheSet(key, url)
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [paperId, blockId, key])

  return src
}
