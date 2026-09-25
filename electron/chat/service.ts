/** 对话服务：构造上下文 → 走 ask 任务（含降级链）→ 解析引用 → 计量。 */
import { targetLang } from '../translate/target-lang'
import type Database from 'better-sqlite3'
import { recordUsage } from '../db'
import { defaultRunner, runTask, type AttemptRunner } from '../model/router'
import { costUsd, priceForModel } from '../model/pricing'
import { buildRouterContext } from '../translate/service'
import { buildChatContext, buildMessages, resolveCitations } from './context'
import { resolvePersonaStyle } from './persona'
import type { ChatAnswer, ChatAskOptions, ChatHistoryItem, CustomPersona } from '../../shared/models'

/** 每篇论文同时只有一轮在途问答；「停止」按 paperId 中止它。 */
const inflight = new Map<string, AbortController>()

export function stopQuestion(paperId: string): void {
  inflight.get(paperId)?.abort()
}

export async function askQuestion(
  db: Database.Database,
  paperId: string,
  question: string,
  history: ChatHistoryItem[],
  /** kind 缺省为正文；'thinking' 是推理模型的思考流，只用于界面展示 */
  onDelta: (delta: string, kind?: 'text' | 'thinking') => void,
  /** 讲法（读者人设）与整篇维度标记 */
  opts: ChatAskOptions = {},
  /** 用户自定义的讲法列表（settings.json），用来解析非内置的 persona id */
  customPersonas: readonly CustomPersona[] = []
): Promise<ChatAnswer> {
  const chatCtx = buildChatContext(db, paperId, question, {
    whole: opts.whole,
    style: resolvePersonaStyle(opts.persona, customPersonas, targetLang())
  })
  // 同一篇上一轮还没结束就又问：先停掉旧的，别让两路流同时往面板里写
  inflight.get(paperId)?.abort()
  const ctrl = new AbortController()
  inflight.set(paperId, ctrl)

  // 已经流出来的文字与实际用到的模型：中止时要把这些还给用户，而不是清空
  let partial = ''
  let thinkingText = ''
  let modelUsed = ''
  const runner: AttemptRunner = (ep, model, req, onChunk) => {
    modelUsed = model
    partial = '' // 换供应商重试时从头开始（上一跳的碎片不算数）
    thinkingText = ''
    return defaultRunner(ep, model, req, onChunk)
  }

  try {
    const out = await runTask(
      'ask',
      {
        messages: buildMessages(chatCtx, history, question, opts.image),
        temperature: 0.4,
        signal: ctrl.signal,
        reasoning: opts.reasoning === true,
        onThinking: (d) => {
          thinkingText += d
          onDelta(d, 'thinking')
        }
      },
      buildRouterContext(),
      (delta) => {
        partial += delta
        onDelta(delta)
      },
      runner
    )
    recordUsage(db, 'ask', out.attempt.slug, out.model, out.result.usage.inputTokens, out.result.usage.outputTokens)
    const price = priceForModel(out.model, out.attempt.tier === 'local')
    return {
      text: out.result.text,
      citations: resolveCitations(out.result.text, chatCtx.targets),
      model: out.model,
      usage: out.result.usage,
      ...(thinkingText ? { thinking: thinkingText } : {}),
      /** 本轮花费 [P7]；单价未知为 null（UI 退回显示 token 数） */
      costUsd: price ? costUsd(out.result.usage.inputTokens, out.result.usage.outputTokens, price) : null,
      /** 降级发生时的原因链，UI 就地说明 [P4] */
      hops: out.hops.map((h) => `${h.attempt.slug}：${h.error}（${h.attempt.why}）`)
    }
  } catch (err) {
    if (!ctrl.signal.aborted) throw err
    // 用户点了停止：已生成的部分照常返回并解析引用。用量在流结束时才回传，
    // 中止后拿不到，按 0 记（账本以供应商为准 [P7]）
    return {
      text: partial,
      citations: resolveCitations(partial, chatCtx.targets),
      model: modelUsed,
      usage: { inputTokens: 0, outputTokens: 0 },
      ...(thinkingText ? { thinking: thinkingText } : {}),
      costUsd: null,
      hops: [],
      stopped: true
    }
  } finally {
    if (inflight.get(paperId) === ctrl) inflight.delete(paperId)
  }
}
