import { describe, expect, it } from 'vitest'
import { costUsd, estimateTranslation, priceForModel, CONFIRM_THRESHOLD_USD } from './pricing'

describe('priceForModel', () => {
  it('子串匹配，具体条目优先；本地一律 $0；未知返回 null', () => {
    expect(priceForModel('claude-opus-4-6', false)).toEqual({ in: 15, out: 75 })
    expect(priceForModel('Qwen/Qwen3-32B', false)).toEqual({ in: 0.1, out: 0.4 })
    expect(priceForModel('gpt-4o-mini-2024', false)!.in).toBe(0.15)
    expect(priceForModel('qwen3:8b', true)).toEqual({ in: 0, out: 0 })
    expect(priceForModel('my-custom-model', false)).toBeNull()
  })

  it('成本换算', () => {
    expect(costUsd(1_000_000, 0, { in: 3, out: 15 })).toBe(3)
    expect(costUsd(500_000, 100_000, { in: 3, out: 15 })).toBeCloseTo(3.0)
  })
})

describe('estimateTranslation', () => {
  const paras = Array.from({ length: 100 }, () => ({ text: 'x'.repeat(400) }))

  it('token 估算按批计提示词开销；未知模型 usd=null（不拦截但明示）', () => {
    const est = estimateTranslation(paras, 'Qwen/Qwen3-32B', false)
    expect(est.inputTokens).toBe(Math.ceil(40000 / 3.8) + Math.ceil(100 / 6) * 160)
    expect(est.usd).toBeGreaterThan(0)
    expect(estimateTranslation(paras, 'mystery-model', false).usd).toBeNull()
    expect(estimateTranslation(paras, 'anything', true).usd).toBe(0) // 本地
  })

  it('一篇 8 千词论文走 Flash 档在 ~$0.03 量级', () => {
    // 8000 词 ≈ 48k 字符 ≈ 40 段
    const paper = Array.from({ length: 40 }, () => ({ text: 'w'.repeat(1200) }))
    const est = estimateTranslation(paper, 'gemini-2.5-flash', false)
    expect(est.usd!).toBeGreaterThan(0.005)
    expect(est.usd!).toBeLessThan(CONFIRM_THRESHOLD_USD) // 便宜档不该触发确认
  })

  it('贵模型大论文触发 $0.5 确认线', () => {
    const paper = Array.from({ length: 60 }, () => ({ text: 'w'.repeat(1500) }))
    const est = estimateTranslation(paper, 'claude-opus-4-6', false)
    expect(est.usd!).toBeGreaterThan(CONFIRM_THRESHOLD_USD)
  })
})

describe('预估排除不翻译的段', () => {
  it('中文段落与参考文献条目不计入段数与花费', () => {
    const paras = [
      { text: 'The dominant sequence transduction models are based on complex recurrent networks.' },
      { text: '本文提出一种面向长文档的稀疏注意力机制，把序列切分为固定长度的块。' },
      { text: '[1] Vaswani A, et al. Attention Is All You Need. NeurIPS 2017.' }
    ]
    const est = estimateTranslation(paras, 'Qwen/Qwen3-32B', false)
    expect(est.paraCount).toBe(1)
    const only = estimateTranslation([paras[0]], 'Qwen/Qwen3-32B', false)
    expect(est.inputTokens).toBe(only.inputTokens)
    expect(est.usd).toBe(only.usd)
  })
  it('整篇都是中文：预估为零段、零花费', () => {
    const est = estimateTranslation([{ text: '长文档理解需要模型在数万词元的上下文中保持稳定的注意力分布。' }], 'Qwen/Qwen3-32B', false)
    expect(est.paraCount).toBe(0)
    expect(est.usd).toBe(0)
  })
})

describe('预估与实测的偏差', () => {
  it('按 Attention 那篇实测（128 段 30268 字符 → 11385 输入 / 10222 输出）校准，误差在两成内', () => {
    const paras = Array.from({ length: 128 }, () => ({ text: 'w'.repeat(Math.round(30268 / 128)) }))
    const est = estimateTranslation(paras, 'deepseek-v4-flash', false)
    expect(est.inputTokens).toBeGreaterThan(11385 * 0.8)
    expect(est.inputTokens).toBeLessThan(11385 * 1.2)
    expect(est.outputTokens).toBeGreaterThan(10222 * 0.8)
    expect(est.outputTokens).toBeLessThan(10222 * 1.2)
  })
})
