/**
 * 模型单价表（USD / 百万 token）与成本估算 [P7]。
 * 价格会过时——这里是保守估计用于护栏与展示，不是账单；未知模型返回 null（不拦截但明示未知）。
 * 贡献接口：加一行 PRICING 即可。
 */
import { skipTranslation, type TargetLang } from '../../shared/lang'

export interface ModelPrice {
  /** USD per 1M input tokens */
  in: number
  /** USD per 1M output tokens */
  out: number
}

/** 按子串匹配（先匹配先赢，具体条目放前面）。 */
const PRICING: [pattern: string, price: ModelPrice][] = [
  // Anthropic
  ['claude-opus', { in: 15, out: 75 }],
  ['claude-sonnet', { in: 3, out: 15 }],
  ['claude-haiku', { in: 0.8, out: 4 }],
  ['claude', { in: 3, out: 15 }],
  // OpenAI
  ['gpt-5', { in: 10, out: 30 }],
  ['gpt-4o-mini', { in: 0.15, out: 0.6 }],
  ['gpt-4o', { in: 2.5, out: 10 }],
  ['o3', { in: 10, out: 40 }],
  // Google
  ['gemini-2.5-pro', { in: 1.25, out: 10 }],
  ['gemini-2.5-flash', { in: 0.15, out: 0.6 }],
  ['gemini', { in: 0.5, out: 1.5 }],
  // DeepSeek
  ['deepseek-reasoner', { in: 0.55, out: 2.19 }],
  ['deepseek', { in: 0.27, out: 1.1 }],
  // Qwen（SiliconFlow 档位近似）
  ['qwen3-235b', { in: 0.35, out: 1.4 }],
  ['qwen', { in: 0.1, out: 0.4 }],
  ['glm', { in: 0.1, out: 0.4 }],
  ['kimi', { in: 0.6, out: 2.5 }],
  ['llama', { in: 0.2, out: 0.6 }]
]

/** 本地端点一律 $0。 */
export function priceForModel(model: string, isLocal: boolean): ModelPrice | null {
  if (isLocal) return { in: 0, out: 0 }
  const m = model.toLowerCase()
  for (const [pattern, price] of PRICING) {
    if (m.includes(pattern)) return price
  }
  return null
}

export function costUsd(
  inputTokens: number,
  outputTokens: number,
  price: ModelPrice
): number {
  return (inputTokens * price.in + outputTokens * price.out) / 1_000_000
}

/**
 * 全文翻译预估 [P7]：token ≈ 字符/3.8（英文学术文平均），每段另加 ~90 token 提示词开销；
 * 中文输出按输入 0.9 倍估。给确认框展示「预估值与依据」用。
 */
export interface TranslateEstimate {
  paraCount: number
  inputTokens: number
  outputTokens: number
  /** null = 单价未知（未收录模型），不拦截但明示 */
  usd: number | null
  model: string
}

/** 与 translator 的 BATCH_MAX_PARAS 一致：一批最多几段 */
const PARAS_PER_BATCH = 6
/** 每批固定开销：系统提示 + 术语表 + 分段标记 */
const BATCH_OVERHEAD_TOKENS = 160

export function estimateTranslation(
  paras: { text: string }[],
  model: string,
  isLocal: boolean,
  targetLang: TargetLang = 'zh'
): TranslateEstimate {
  // 不会送去模型的段（中文原文、参考文献条目、纯符号）不算钱也不算段数，
  // 否则一篇中文论文会预估出一笔根本不会发生的花费
  const billable = paras.filter((p) => !skipTranslation(p.text, targetLang))
  const chars = billable.reduce((sum, p) => sum + p.text.length, 0)
  const textTokens = Math.ceil(chars / 3.8)
  // 翻译是按批发的（见 translator 的 makeBatches，一批最多 6 段），系统提示与术语表一批只发一次；
  // 原来按「每段 90 token」算开销，等于把批内共享的部分重复计了六遍，整体高估约 1.7 倍。
  // 这里的系数是拿 Attention 那篇实测校准的：128 段 30268 字符，实际 11385 输入 / 10222 输出 token。
  const inputTokens = textTokens + Math.ceil(billable.length / PARAS_PER_BATCH) * BATCH_OVERHEAD_TOKENS
  const outputTokens = Math.ceil(textTokens * 1.3)
  const price = priceForModel(model, isLocal)
  return {
    paraCount: billable.length,
    inputTokens,
    outputTokens,
    usd: price ? costUsd(inputTokens, outputTokens, price) : null,
    model
  }
}

/** 单次操作确认阈值（PRD P7）。 */
export const CONFIRM_THRESHOLD_USD = 0.5
