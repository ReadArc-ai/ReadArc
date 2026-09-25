/**
 * 「可选模型」清单：已配好 Key 或本地可用的来源 → 各自的模型列表（GET /models）。
 * 对话框底部的默认模型切换器用它；列表按来源缓存在组件内，不重复请求。
 */
import { useEffect, useRef, useState } from 'react'
import { useModels } from '../store/models'
import type { ProviderView } from '../../shared/models'

export interface ModelOptions {
  usable: ProviderView[]
  lists: Record<string, string[]>
  loaded: boolean
}

export function useModelOptions(): ModelOptions {
  const state = useModels((s) => s.state)
  const load = useModels((s) => s.load)
  const [lists, setLists] = useState<Record<string, string[]>>({})

  useEffect(() => {
    if (!state) void load()
  }, [state, load])

  const usable = state?.providers.filter((p) => p.hasKey || p.local) ?? []
  const slugsKey = usable.map((p) => p.slug).join(',')
  // 已请求去重放 ref：effect 里不做同步 setState（级联渲染），结果只在回调里落
  const requested = useRef(new Set<string>())
  useEffect(() => {
    for (const slug of slugsKey.split(',').filter(Boolean)) {
      if (requested.current.has(slug)) continue
      requested.current.add(slug)
      void window.readarc
        .listProviderModels(slug)
        .then((ms) => setLists((s) => ({ ...s, [slug]: ms.slice(0, 120) })))
        .catch(() => setLists((s) => ({ ...s, [slug]: [] })))
    }
  }, [slugsKey])

  return { usable, lists, loaded: !!state }
}
