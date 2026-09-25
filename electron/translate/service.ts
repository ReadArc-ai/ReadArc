/** 翻译服务：组装 RouterContext，托管全文翻译任务，逐段推送进度事件。 */
import { uiText } from '../i18n'
import { LANG_TEXT, targetLang } from './target-lang'
import type { WebContents } from 'electron'
import { IPC } from '../../shared/ipc'
import { loadProviders } from '../config/providers-config'
import { resolveApiKey } from '../config/env-file'
import { loadMainModel } from '../config/main-model'
import { loadTaskRoutes } from '../config/tasks-config'
import { isFreeAttempt, resolveChain, runTask, type RouterContext } from '../model/router'
import { TranslationRunState } from './run-state'
import { estimateTranslation, CONFIRM_THRESHOLD_USD } from '../model/pricing'
import { appDb } from '../library/service'
import { recordUsage, getBlocks, getPaper } from '../db'
import { loadGlossary } from './glossary'
import { cachedTranslations, translateBlock, translateOutline, translateParas } from './translator'
import type { TranslateOverride, TranslateProgressEvent, TranslateStartResult } from '../../shared/models'

export function buildRouterContext(): RouterContext {
  return {
    providers: loadProviders().providers,
    routes: loadTaskRoutes(),
    mainModel: loadMainModel(),
    resolveKey: (keyEnv) => resolveApiKey(keyEnv)
  }
}

const runState = new TranslationRunState()

/**
 * 启动全文翻译。单次预估 > $0.5 且未确认 → 不启动，返回预估值与依据让 UI 先问 [P7]。
 */
export function startPaperTranslation(
  paperId: string,
  sender: WebContents,
  confirmed = false,
  /** 整篇重译：无视缓存、覆盖写回。换了模型或上一轮译得不好时用；预估按全文算，同样过 $0.5 确认 */
  force = false,
  /** 只用于这一次的模型：替换降级链第一跳，其余兜底不变；不写设置 */
  override?: TranslateOverride
): TranslateStartResult {
  // 已在跑：撤回还没被消化的停止请求（用户是要续译），不重复起一轮
  if (runState.resumeIfRunning(paperId)) return { started: true }
  // 版面识别还在跑：块 id 马上会换成模型的分段，现在译出来的会记在错的段落上
  if (getPaper(appDb(), paperId)?.layout_state === 'pending') throw new Error(uiText('translation.layout-wait'))

  const glossary = loadGlossary()
  const ctx = buildRouterContext()
  if (override) ctx.routes = { ...ctx.routes, translate: { provider: override.provider, model: override.model } }
  // 启动前预检：一条可用路由都没有就立刻报错（否则会静默地逐块失败）
  const chain = resolveChain('translate', ctx)
  if (chain.length === 0) {
    throw new Error(
      uiText('model.no-route')
    )
  }
  const cached = force ? {} : cachedTranslations(appDb(), paperId, glossary.version)
  const paras = getBlocks(appDb(), paperId).filter(
    (b) => (b.kind === 'para' || b.kind === 'heading') && !cached[b.block_id]
  )
  if (paras.length === 0) return { started: true }

  // 预估用链上第一跳的模型。是否免费只看这一跳的 endpoint 是不是本地地址——
  // 不能用 tier === 'local' 判断：本地端点若被设成默认模型，tier 是 'main'，
  // 于是预估按付费算、用量账本按 $0 算，同一个供应商两处对不上（P7 护栏要求一致）。
  const first = chain[0]
  const isLocal = isFreeAttempt(first, ctx.providers)
  const estimate = estimateTranslation(paras, first?.model || '(local)', isLocal, targetLang())

  if (!confirmed && estimate.usd !== null && estimate.usd > CONFIRM_THRESHOLD_USD) {
    return { started: false, estimate }
  }

  runState.begin(paperId) // 早退分支都过了，才真正占住这篇论文
  const deps = { ctx, glossary }
  const lang = targetLang()
  void translateParas(
    appDb(),
    deps,
    paperId,
    (p) => {
      if (sender.isDestroyed()) return
      const event: TranslateProgressEvent = { paperId, lang, ...p }
      sender.send(IPC.translateProgress, event)
    },
    () => runState.shouldStop(paperId) || sender.isDestroyed(),
    force
  )
    .catch(() => {
      /* 顶层失败已按段上报过 */
    })
    .finally(() => runState.end(paperId))

  return { started: true, estimate }
}

/** 暂停全文翻译：当前段跑完即停；已译段落入缓存，再点「翻译全文」自然续译。 */
/** 划词翻译：任意选中文本的一次性翻译，不落缓存。 */
export async function translateFragment(
  text: string,
  onChunk: (delta: string) => void = () => {}
): Promise<string> {
  const glossary = loadGlossary()
  const lang = targetLang()
  const glossaryLines =
    lang === 'zh'
      ? Object.entries(glossary.terms)
          .map(([en, zh]) => `${en} => ${zh}`)
          .join('\n')
      : ''
  const L = LANG_TEXT[lang]
  const system = [L.fragment, L.fragmentRules, glossaryLines ? `术语表（必须严格采用）：\n${glossaryLines}` : '']
    .filter(Boolean)
    .join('\n\n')
  const out = await runTask(
    'translate',
    { messages: [{ role: 'system', content: system }, { role: 'user', content: text }], temperature: 0.2 },
    buildRouterContext(),
    onChunk
  )
  recordUsage(appDb(), 'translate', out.attempt.slug, out.model, out.result.usage.inputTokens, out.result.usage.outputTokens)
  return out.result.text.trim()
}

export function stopPaperTranslation(paperId: string): void {
  runState.requestStop(paperId)
}

/** 目录单独翻译：一次批量调用，进度事件与全文翻译同通道（目录/镜像页实时刷新）。 */
export async function translateOutlineNow(
  paperId: string,
  sender: WebContents
): Promise<{ translated: number }> {
  const deps = { ctx: buildRouterContext(), glossary: loadGlossary() }
  const lang = targetLang()
  const translated = await translateOutline(appDb(), deps, paperId, (p) => {
    if (sender.isDestroyed()) return
    const event: TranslateProgressEvent = { paperId, lang, ...p }
    sender.send(IPC.translateProgress, event)
  })
  return { translated }
}

export async function retranslateOne(paperId: string, blockId: string): Promise<{ text: string }> {
  const blocks = getBlocks(appDb(), paperId)
  const paras = blocks.filter((b) => b.kind === 'para' || b.kind === 'heading')
  const idx = paras.findIndex((b) => b.block_id === blockId)
  if (idx === -1) throw new Error('block not found')
  const deps = { ctx: buildRouterContext(), glossary: loadGlossary() }
  const out = await translateBlock(
    appDb(),
    deps,
    paras[idx],
    { prev: paras[idx - 1]?.text, next: paras[idx + 1]?.text },
    true
  )
  return { text: out.text }
}
