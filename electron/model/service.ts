/** 模型配置聚合服务：设置界面的唯一数据源。 */
import { join } from 'node:path'
import { defaultRoots, loadProviders, type ConfigRoots } from '../config/providers-config'
import { loadEndpointProxy, loadProxies, proxyUrlForProvider, saveEndpointProxy } from '../config/proxies'
import { resolveApiKey } from '../config/env-file'
import { clearMainModel, loadMainModel, saveMainModel } from '../config/main-model'
import { loadTaskRoutes, saveTaskRoute, type TaskRoute, type TaskSlot } from '../config/tasks-config'
import { deleteProvider, saveProvider, type ProviderInput } from '../config/provider-writer'
import { upsertEnvVar } from '../config/env-writer'
import { BUILTIN_PROFILES, isLocalProvider } from './profiles'
import { detectLocalProviders } from './local-detect'
import { listModels, TransportError, type Endpoint } from './transport'
import { friendlyModelError } from './router'
import { uiText } from '../i18n'
import { costUsd, priceForModel } from './pricing'
import type Database from 'better-sqlite3'
import { monthUsage } from '../db'
import type { ModelState, ProviderTestResult, ProviderView, UsageOverview } from '../../shared/models'

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
      // App Store 版不放云厂商的开户/充值页链接（App Review 3.1.1 视为站外购买引导）；
      // 本地运行时的下载页是免费软件，照常保留
      signupUrl: p.local || process.mas !== true ? p.signupUrl : undefined
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
  const p = modelState(roots).providers.find((v) => v.slug === slug)
  if (!p) return []
  try {
    return await listModels(endpointFor(p, roots), AbortSignal.timeout(LIST_TIMEOUT_MS))
  } catch {
    return [] // 列表拿不到不致命：允许手填模型名
  }
}

const LIST_TIMEOUT_MS = 10_000

/** 与真实请求同一条路：同样的 Key、同样绑定的代理。走代理的中转站不带代理去拉列表，会一直拉不到 */
function endpointFor(p: ProviderView, roots: ConfigRoots): Endpoint {
  return {
    baseUrl: p.baseUrl,
    apiKey: p.keyEnv ? resolveApiKey(p.keyEnv, roots) : null,
    transport: p.transport,
    proxyUrl: proxyUrlForProvider(p.slug, roots)
  }
}

/**
 * 接入页的「测试连接」：拉一次模型列表，报连没连通、有几个模型、用了多久。
 * 不调对话接口，不花 token。失败原因给能照着改的话（Key、地址、网络）
 */
export async function testProvider(slug: string, roots: ConfigRoots = defaultRoots()): Promise<ProviderTestResult> {
  const p = modelState(roots).providers.find((v) => v.slug === slug)
  if (!p) return { ok: false, models: null, ms: 0, error: uiText('provider.test.missing') }
  if (p.keyEnv && !p.local && !p.hasKey) return { ok: false, models: null, ms: 0, error: uiText('provider.test.no-key') }
  const t0 = Date.now()
  try {
    const models = await listModels(endpointFor(p, roots), AbortSignal.timeout(LIST_TIMEOUT_MS))
    return { ok: true, models: models.length, ms: Date.now() - t0 }
  } catch (err) {
    const ms = Date.now() - t0
    // /models 404 多半是地址少了 /v1：中转站最常见的配置错误，单独说清楚
    if (err instanceof TransportError && err.status === 404) return { ok: false, models: null, ms, error: uiText('provider.test.not-found') }
    // 用户就在接入页：通用文案里的「请在设置 → 接入中检查」在这里是原地打转
    if (err instanceof TransportError && (err.status === 401 || err.status === 403)) return { ok: false, models: null, ms, error: uiText('provider.test.auth') }
    return { ok: false, models: null, ms, error: friendlyModelError(err instanceof Error ? err.message : String(err)) }
  }
}

/**
 * 删除自定义来源，并清掉指向它的设置：默认模型、按功能指定的模型、代理绑定。
 * 只删配置文件里的条目，不碰 .env 里的密钥（用户可能还要用）
 */
export function removeProvider(slug: string, roots: ConfigRoots = defaultRoots()): boolean {
  if (!deleteProvider(slug, roots)) return false
  if (loadMainModel(roots)?.provider === slug) clearMainModel(roots)
  for (const [slot, route] of Object.entries(loadTaskRoutes(roots)) as [TaskSlot, TaskRoute][]) {
    if (route.provider === slug) saveTaskRoute(slot, { provider: 'auto' }, roots)
  }
  if (loadEndpointProxy(roots)[slug]) saveEndpointProxy(slug, null, roots)
  return true
}
