import { describe, expect, it } from 'vitest'
import { echoesContext, isMostlyChinese, looksLikeChineseDigest, looksLikeDigest } from './output-check'

const CONTEXT =
  'Title: ReAct\n## 3.3 Results\nReAct outperforms Act consistently Table 1 shows HotpotQA and Fever results using PaLM-540B as the base model with different prompting methods. We note that ReAct is better than Act on both tasks.'

describe('中文占主体', () => {
  it('中文摘要夹带英文术语算合格', () => {
    expect(isMostlyChinese('该论文提出完全基于注意力机制的 Transformer，在 WMT 2014 英德翻译上达到 28.4 BLEU，局限在于序列长度的二次复杂度。')).toBe(true)
  })
  it('英文正文、或只有零星汉字都不合格', () => {
    expect(isMostlyChinese('ReAct outperforms Act consistently on HotpotQA and Fever with PaLM-540B.')).toBe(false)
    expect(isMostlyChinese('总结：ReAct outperforms Act consistently on HotpotQA and Fever with PaLM-540B as the base model.')).toBe(false)
    expect(isMostlyChinese('好')).toBe(false)
  })
})

describe('原文照抄', () => {
  it('输出里的 40 字窗口原样出现在上下文里 → 照抄（空白差异不影响）', () => {
    expect(echoesContext('ReAct outperforms Act consistently Table 1 shows   HotpotQA and Fever results using PaLM-540B', CONTEXT)).toBe(true)
  })
  it('真正的概括不会命中', () => {
    expect(echoesContext('ReAct 在 HotpotQA 与 Fever 上稳定优于只行动的 Act 基线，说明推理轨迹能指导行动。', CONTEXT)).toBe(false)
  })
  it('短输出整体比对；空输出不算照抄', () => {
    expect(echoesContext('ReAct outperforms Act', CONTEXT)).toBe(true)
    expect(echoesContext('', CONTEXT)).toBe(false)
  })
})

describe('像一段中文概括', () => {
  it('用户遇到的情况：英文且照抄原文 → 不合格', () => {
    expect(
      looksLikeChineseDigest(
        'ReAct outperforms Act consistently Table 1 shows HotpotQA and Fever results using PaLM-540B as the base model with different prompting methods.',
        CONTEXT
      )
    ).toBe(false)
  })
  it('中文概括 → 合格', () => {
    expect(looksLikeChineseDigest('ReAct 把推理轨迹与行动交替生成，在问答与事实核查上稳定优于纯行动基线；结论只在 PaLM-540B 上验证过。', CONTEXT)).toBe(true)
  })
})

describe('looksLikeDigest 按目标语言', () => {
  const ctx = 'We propose a retrieval augmented model for speech recognition that stores exemplars in an index.'
  it('目标英文：英文概括合格，照抄原文和中文都不合格', () => {
    expect(looksLikeDigest('The paper adds retrieval to a speech recognizer and reports lower error rates on two benchmarks, with limits on latency.', ctx, 'en')).toBe(true)
    expect(looksLikeDigest(ctx, ctx, 'en')).toBe(false)
    expect(looksLikeDigest('这篇论文给语音识别加了检索，两个基准上错误率更低，延迟是代价。', ctx, 'en')).toBe(false)
  })
  it('目标中文：中文概括合格，英文不合格', () => {
    expect(looksLikeDigest('这篇论文给语音识别加了检索，两个基准上错误率更低，延迟是代价。', ctx, 'zh')).toBe(true)
    expect(looksLikeDigest('The paper adds retrieval to a speech recognizer and reports lower error rates.', ctx, 'zh')).toBe(false)
  })
})

describe('looksLikeDigest 日韩', () => {
  const ctx = 'We propose a retrieval augmented model for speech recognition that stores exemplars in an index.'
  it('日文摘要要有假名，韩文摘要要有谚文', () => {
    expect(looksLikeDigest('本論文は音声認識に検索機構を加え、二つのベンチマークで誤り率を下げたが、遅延が増える。', ctx, 'ja')).toBe(true)
    expect(looksLikeDigest('本文提出检索增强的语音识别模型，两个基准上错误率更低。', ctx, 'ja')).toBe(false)
    expect(looksLikeDigest('이 논문은 음성 인식에 검색을 더해 두 벤치마크에서 오류율을 낮췄지만 지연이 늘어난다.', ctx, 'ko')).toBe(true)
  })
})
