import { describe, expect, it } from 'vitest'
import { isCjkDominant, paperLang, resolveTargetLang, skipTranslation, textLang } from './lang'

describe('isCjkDominant', () => {
  it('中文段落（夹英文术语）算中文', () => {
    expect(isCjkDominant('本文提出一种面向长文档的稀疏注意力机制，在 Transformer 上验证。')).toBe(true)
    expect(isCjkDominant('基于稀疏注意力的长文档建模方法研究')).toBe(true)
  })
  it('英文段落不算，哪怕带个别汉字', () => {
    expect(isCjkDominant('The dominant sequence transduction models are based on complex recurrent networks.')).toBe(false)
    expect(isCjkDominant('We evaluate on the 中文 dataset with many English words in this sentence.')).toBe(false)
    expect(isCjkDominant('')).toBe(false)
    expect(isCjkDominant('1.2 3.4 (5)')).toBe(false)
  })
})

describe('skipTranslation', () => {
  it('中文段落、纯符号、参考文献条目都不调模型', async () => {
    const { skipTranslation } = await import('./lang')
    expect(skipTranslation('本文提出一种面向长文档的稀疏注意力机制。')).toBe(true)
    expect(skipTranslation('3.14 (2)')).toBe(true)
    expect(skipTranslation('Ashish Vaswani, Noam Shazeer, and Niki Parmar. Attention is all you need. In Advances in Neural Information Processing Systems, 2017.')).toBe(true)
  })
  it('普通英文段落要翻译', async () => {
    const { skipTranslation } = await import('./lang')
    expect(skipTranslation('The dominant sequence transduction models are based on complex recurrent networks that include an encoder and a decoder.')).toBe(false)
  })
})

describe('编号式参考文献', () => {
  it('[N] 开头、带年份与人名写法的条目算参考文献；正文里以 [N] 开头的句子不算', async () => {
    const { looksReferenceEntry } = await import('./lang')
    expect(looksReferenceEntry('[1] Vaswani A, et al. Attention Is All You Need. NeurIPS 2017.')).toBe(true)
    expect(looksReferenceEntry('[2] Beltagy I, et al. Longformer: The Long-Document Transformer. 2020.')).toBe(true)
    expect(looksReferenceEntry('[12] reported a 2019 baseline that we could not reproduce in our own runs.')).toBe(false)
    expect(looksReferenceEntry('The model was trained in 2017 on eight GPUs for three days.')).toBe(false)
  })
})

describe('目标语言', () => {
  it('目标英文时跳过已经是英文的段，翻译中文段', () => {
    expect(skipTranslation('We propose a retrieval augmented model for speech tasks.', 'en')).toBe(true)
    expect(skipTranslation('我们提出一种面向语音任务的检索增强模型。', 'en')).toBe(false)
    expect(skipTranslation('我们提出一种面向语音任务的检索增强模型。', 'zh')).toBe(true)
  })
  it('按正文抽样判断论文语言', () => {
    expect(paperLang(['Attention is all you need.', 'We propose a new architecture.'])).toBe('en')
    expect(paperLang(['本文提出一种新的网络结构。', '实验表明 BLEU 提升 2.1。'])).toBe('zh')
    expect(paperLang([])).toBe('en')
  })
  it('设置里没选目标语言就跟界面语言', () => {
    expect(resolveTargetLang({ lang: 'en' })).toBe('en')
    expect(resolveTargetLang({ lang: 'en', targetLang: 'zh' })).toBe('zh')
  })
})

describe('多语种', () => {
  it('按文字系统与功能词判断语言', () => {
    expect(textLang('本研究では、注意機構のみに基づく新しいネットワーク構造を提案する。')).toBe('ja')
    expect(textLang('본 연구에서는 어텐션 메커니즘만으로 구성된 새로운 구조를 제안한다.')).toBe('ko')
    expect(textLang('我们提出一种完全基于注意力机制的网络结构。')).toBe('zh')
    expect(textLang('Wir schlagen eine neue Architektur vor, die nur auf Aufmerksamkeit basiert und ist schneller.')).toBe('de')
    expect(textLang('Nous proposons une nouvelle architecture qui est fondée sur les mécanismes d\'attention pour la traduction.')).toBe('fr')
    expect(textLang('Proponemos una nueva arquitectura que se basa en los mecanismos de atención para la traducción.')).toBe('es')
    expect(textLang('We propose a new simple network architecture based solely on attention.')).toBe('en')
  })
  it('目标日文时英文段要翻，日文段跳过；目标中文时日文段也要翻', () => {
    expect(skipTranslation('We propose a new simple network architecture based solely on attention.', 'ja')).toBe(false)
    expect(skipTranslation('本研究では、注意機構のみに基づく新しいネットワーク構造を提案する。', 'ja')).toBe(true)
    expect(skipTranslation('本研究では、注意機構のみに基づく新しいネットワーク構造を提案する。', 'zh')).toBe(false)
  })
})

describe('语言判断的误判', () => {
  it('英文段落里的「et al.」不会让它被认成法文', () => {
    const en = 'Vaswani et al. introduced the Transformer, and Devlin et al. later pretrained it on large corpora for many downstream tasks.'
    expect(textLang(en)).toBe('en')
    expect(skipTranslation(en, 'fr')).toBe(false)
  })

  it('纯韩文、纯假名的段落照常翻译', () => {
    expect(skipTranslation('이 논문은 주의 메커니즘만으로 번역 모델을 구성한다', 'zh')).toBe(false)
    expect(skipTranslation('このモデルはとてもはやくてかんたんです', 'en')).toBe(false)
  })
})
