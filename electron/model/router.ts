/**
 * ModelRouter：对上暴露任务，对下适配供应商。
 * 失败降级链 [P4]：任务模型 → 默认模型 → 本地模型 → 就地报错并保留原文。
 * 每一跳都附带用户可读的原因说明——降级必须对用户透明，不允许静默切换模型。
 */
import { uiText } from '../i18n'
import type { ProviderDef } from '../config/providers-config'
import type { TaskRoutes, TaskSlot } from '../config/tasks-config'
import type { MainModel } from '../config/main-model'
import { BUILTIN_PROFILES, isLocalProvider, profileToDef } from './profiles'
import { proxyUrlForProvider } from '../config/proxies'
import { listModels, pickChatModel, streamChat, type ChatRequest, type ChatResult, type Endpoint } from './transport'

export interface RouterContext {
  providers: ProviderDef[]
  routes: TaskRoutes
  mainModel: MainModel | null
  resolveKey(keyEnv: string | null): string | null
}

export interface RouteAttempt {
  slug: string
  /** 空串 = 运行时经 GET /v1/models 取第一个（本地兜底常见） */
  model: string
  tier: 'task' | 'main' | 'local'
  why: string
}

function findProvider(ctx: RouterContext, slug: string): ProviderDef | null {
  const user = ctx.providers.find((p) => p.slug === slug)
  if (user) return user
  const builtin = BUILTIN_PROFILES.find((p) => p.slug === slug)
  return builtin ? profileToDef(builtin) : null
}

/** 构造降级链（纯函数，可单测）。链上不重复同一 slug+model。 */
export function resolveChain(slot: TaskSlot, ctx: RouterContext): RouteAttempt[] {
  const chain: RouteAttempt[] = []
  const seen = new Set<string>()
  const push = (a: RouteAttempt): void => {
    const key = `${a.slug}::${a.model}`
    if (seen.has(key)) return
    if (!findProvider(ctx, a.slug)) return
    seen.add(key)
    chain.push(a)
  }

  const route = ctx.routes[slot]
  if (route.provider !== 'auto') {
    push({
      slug: route.provider,
      model: route.model ?? '',
      tier: 'task',
      why: uiText('model.task')
    })
  }

  if (ctx.mainModel && ctx.mainModel.provider !== 'auto') {
    push({
      slug: ctx.mainModel.provider,
      model: ctx.mainModel.model,
      tier: 'main',
      why: uiText('model.default')
    })
  } else {
    // 还没选默认模型：先用第一个配了密钥的云端来源（模型留空 = 该来源的默认模型）。
    // 新用户配完 Key 就能直接翻译、提问，不必先去选模型；选了默认模型后这条不再生效
    const keyed = ctx.providers.find((p) => !isLocalProvider(p) && p.keyEnv && ctx.resolveKey(p.keyEnv))
    if (keyed) push({ slug: keyed.slug, model: '', tier: 'main', why: uiText('model.first-key') })
  }

  for (const p of ctx.providers) {
    if (isLocalProvider(p)) {
      push({ slug: p.slug, model: '', tier: 'local', why: uiText('model.local') })
    }
  }

  return chain
}

/**
 * 这一跳是不是免费。判据只看 endpoint 是不是本地地址，**不看 tier**：
 * 本地端点被设成默认模型时 tier 是 'main'，若按 tier 判，翻译预估会按付费算、
 * 用量账本却按 $0 算，同一个供应商两处对不上。账本与预估必须用同一把尺 [P7]。
 */
export function isFreeAttempt(
  attempt: RouteAttempt | undefined,
  providers: ProviderDef[]
): boolean {
  if (!attempt) return false
  const def = providers.find((p) => p.slug === attempt.slug)
  return def ? isLocalProvider(def) : attempt.tier === 'local'
}

export interface Hop {
  attempt: RouteAttempt
  error: string
}

export interface TaskRunResult {
  result: ChatResult
  attempt: RouteAttempt
  model: string
  /** 之前失败的跳，UI 就地展示原因 [P4] */
  hops: Hop[]
}

export type AttemptRunner = (
  ep: Endpoint,
  model: string,
  req: ChatRequest,
  onChunk: (text: string) => void
) => Promise<ChatResult>

export const defaultRunner: AttemptRunner = async (ep, model, req, onChunk) => {
  const gen = streamChat(ep, { ...req, model }, onChunk, req.signal)
  let out = await gen.next()
  while (!out.done) out = await gen.next()
  return out.value
}

/**
 * 模型调用失败的原始错误 → 用户能看懂的一句话。
 * 原样透出的是「chat/completions HTTP 401: {"error":{"message":"Invalid API key provided"}}」
 * 这种带 JSON 的技术串，读者只想知道「是 Key 不对还是网断了、我该做什么」。
 */
export function friendlyModelError(raw: string): string {
  const status = /HTTP (\d{3})/.exec(raw)?.[1]
  if (status === '401' || status === '403') return uiText('model.auth')
  if (status === '402') return uiText('model.payment')
  if (status === '404') return uiText('model.missing')
  if (status === '429') return uiText('model.limit')
  if (status && Number(status) >= 500) return uiText('model.server', { status })
  if (/超时|timeout|idle/i.test(raw)) return uiText('model.timeout')
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|network|socket/i.test(raw))
    return uiText('model.network')
  if (/does not support image|vision/i.test(raw)) return uiText('model.vision')
  // 认不出来的：去掉 JSON 壳，只留供应商给的那句话
  const msg = /"message"\s*:\s*"([^"]{1,160})"/.exec(raw)?.[1]
  return msg ? msg : raw.slice(0, 160)
}

export class NoRouteError extends Error {
  constructor(readonly hops: Hop[]) {
    super(
      hops.length === 0
        ? uiText('model.no-route')
        : // 同一个供应商可能在链上出现两次（显式模型 + 「取端点第一个模型」的本地兜底），
          // 端点整个连不上时两跳的报错一模一样。去重，别让用户读到「X（失败）；X（失败）」
          uiText('model.all-failed', { errors: [
            ...new Set(hops.map((h) => `${h.attempt.slug}（${friendlyModelError(h.error)}）`))
          ].join('; ') })
    )
  }
}

export async function runTask(
  slot: TaskSlot,
  req: Omit<ChatRequest, 'model'>,
  ctx: RouterContext,
  onChunk: (text: string) => void = () => {},
  runner: AttemptRunner = defaultRunner
): Promise<TaskRunResult> {
  const hops: Hop[] = []
  for (const attempt of resolveChain(slot, ctx)) {
    const def = findProvider(ctx, attempt.slug)!
    const ep: Endpoint = {
      baseUrl: def.baseUrl,
      apiKey: ctx.resolveKey(def.keyEnv),
      transport: def.transport,
      proxyUrl: proxyUrlForProvider(attempt.slug)
    }
    try {
      let model = attempt.model
      if (!model) {
        const models = await listModels(ep, req.signal)
        const picked = pickChatModel(models)
        if (!picked) throw new Error(uiText('model.none'))
        model = picked
      }
      // 拉列表期间用户点了停止：不再发请求
      if (req.signal?.aborted) throw new Error('aborted')
      const result = await runner(ep, model, { ...req, model }, onChunk)
      return { result, attempt, model, hops }
    } catch (err) {
      // 用户主动中止不是「这一跳失败」：不能顺着降级链去下一家再跑一遍（又花一次钱）
      if (req.signal?.aborted) throw err
      hops.push({ attempt, error: err instanceof Error ? err.message : String(err) })
    }
  }
  throw new NoRouteError(hops)
}
