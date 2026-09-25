/** 模型配置聚合服务：设置界面的唯一数据源。 */
import { join } from 'node:path'
import { defaultRoots, loadProviders, type ConfigRoots } from '../config/providers-config'
import { loadEndpointProxy, loadProxies } from '../config/proxies'
import { resolveApiKey } from '../config/env-file'
import { loadMainModel, saveMainModel } from '../config/main-model'
import { loadTaskRoutes, saveTaskRoute, type TaskRoute, type TaskSlot } from '../config/tasks-config'
import { saveProvider, type ProviderInput } from '../config/provider-writer'
import { upsertEnvVar } from '../config/env-writer'
import { BUILTIN_PROFILES, isLocalProvider } from './profiles'
import { detectLocalProviders } from './local-detect'
import { listModels } from './transport'
import { costUsd, priceForModel } from './pricing'
import type Database from 'better-sqlite3'
import { monthUsage } from '../db'
import type { ModelState, ProviderView, UsageOverview } from '../../shared/models'

/** 本月美元支出（单价未知的模型不计入，单独列出）。左栏与设置页共用 [P7]。 */
export function usageOverview(db: Database.Database, roots: ConfigRoots = defaultRoots()): UsageOverview {
  const start = new Date()
  start.setDate(1)
  start.setHours(0, 0, 0, 0)
  const rows = db
    .prepare(
      `SELECT provider, model, SUM(input_tokens) AS i, SUM(output_tokens) AS o
       FROM usage_log WHERE ts >= ? GROUP BY provider, model`
    )
    .all(start.getTime()) as { provider: string; model: string; i: number; o: number }[]

  const { providers } = loadProviders(roots)
  const localSlugs = new Set(
    [...providers.filter(isLocalProvider).map((p) => p.slug),
     ...BUILTIN_PROFILES.filter((p) => p.local).map((p) => p.slug)]
  )

  let spendUsd = 0
  const unknownModels: string[] = []
  for (const r of rows) {
    const price = priceForModel(r.model, localSlugs.has(r.provider))
    if (price) spendUsd += costUsd(r.i, r.o, price)
    else unknownModels.push(r.model)
  }

  const tokens = monthUsage(db)
  return {
    ...tokens,
    spendUsd,
    unknownModels: [...new Set(unknownModels)]
  }
}

export function modelState(roots: ConfigRoots = defaultRoots()): ModelState {
  const { providers } = loadProviders(roots)
  const views = new Map<string, ProviderView>()

  const builtinSlugs = new Set(BUILTIN_PROFILES.map((p) => p.slug))
  for (const def of providers) {
    views.set(def.slug, {
      slug: def.slug,
      name: def.name,
      baseUrl: def.baseUrl,
      keyEnv: def.keyEnv,
      transport: def.transport,
      source: def.source,
      official: builtinSlugs.has(def.slug),
      local: isLocalProvider(def),
      hasKey: def.keyEnv ? resolveApiKey(def.keyEnv, roots) !== null : isLocalProvider(def)
    })
  }
  // 内置档案补位（用户 config 同名 slug 优先）
  for (const p of BUILTIN_PROFILES) {
    if (views.has(p.slug)) continue
    views.set(p.slug, {
      slug: p.slug,
      name: p.name,
      baseUrl: p.baseUrl,
      keyEnv: p.keyEnv,
      transport: p.transport,
      source: 'builtin',
      official: true,
      local: p.local ?? false,
      hasKey: p.keyEnv ? resolveApiKey(p.keyEnv, roots) !== null : (p.local ?? false),
      signupUrl: p.signupUrl
    })
  }

  // 官方厂商按内置顺序排在前面（config 里有同名条目时也不跳到最前），自定义来源随后
  const ordered = [
    ...BUILTIN_PROFILES.map((p) => views.get(p.slug)).filter((v): v is ProviderView => !!v),
    ...[...views.values()].filter((v) => !builtinSlugs.has(v.slug))
  ]
  return {
    providers: ordered,
    proxies: loadProxies(roots),
    endpointProxy: loadEndpointProxy(roots),
    routes: loadTaskRoutes(roots),
    mainModel: loadMainModel(roots),
    configPaths: {
      readarc: join(roots.readarcDir, 'config.yaml')
    }
  }
}

export function saveProviderAndKey(
  input: ProviderInput & { apiKey?: string },
  roots: ConfigRoots = defaultRoots()
): boolean {
  const changed = saveProvider(input, roots)
  if (input.apiKey && input.keyEnv) {
    upsertEnvVar(input.keyEnv, input.apiKey, roots)
    // 第一把密钥：默认模型还空着就指向这个来源，对话框底部的切换器立刻有东西可显示
    if (!loadMainModel(roots) && !isLocalProvider(input)) saveMainModel({ provider: input.slug, model: '' }, roots)
    return true
  }
  return changed
}

export function saveRoute(slot: TaskSlot, route: TaskRoute, roots?: ConfigRoots): boolean {
  return saveTaskRoute(slot, route, roots)
}

export async function detectLocal(roots?: ConfigRoots) {
  return detectLocalProviders(roots)
}

export async function modelsForProvider(
  slug: string,
  roots: ConfigRoots = defaultRoots()
): Promise<string[]> {
  const state = modelState(roots)
  const p = state.providers.find((v) => v.slug === slug)
  if (!p) return []
  try {
    return await listModels({
      baseUrl: p.baseUrl,
      apiKey: resolveApiKey(p.keyEnv, roots),
      transport: p.transport
    })
  } catch {
    return [] // 列表拿不到不致命：允许手填模型名
  }
}
