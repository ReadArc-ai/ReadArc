import { describe, expect, it } from 'vitest'
import {
  blockId,
  hammingDistance,
  relocateBlock,
  sha1,
  simhash64
} from './anchor'

describe('block_id', () => {
  it('由内容哈希+页码+块序构成，与文件路径无关 [P6]', () => {
    const hash = sha1('pdf-bytes')
    expect(blockId(hash, 4, 7)).toBe(`${hash}:4:7`)
  })
})

describe('simhash64', () => {
  it('相同文本（空白/大小写差异）哈希一致', () => {
    expect(simhash64('The  Quick\nBrown Fox')).toBe(simhash64('the quick brown fox'))
  })

  it('解析器扰动（连字符/标点/空白）距离近，无关文本距离远', () => {
    const base = simhash64(
      'We propose a retrieval-augmented speech recognition model that conditions decoding on retrieved exemplars.'
    )
    // 版面解析器升级的典型产物：连字符断词合并方式变化、标点丢失、空白不同
    const perturbed = simhash64(
      'We propose a retrieval aug- mented speech recognition model that conditions decoding on retrieved exemplars'
    )
    const unrelated = simhash64(
      'The training corpus consists of eight thousand hours of multilingual audio collected from public sources.'
    )
    expect(hammingDistance(base, perturbed)).toBeLessThanOrEqual(12)
    expect(hammingDistance(base, unrelated)).toBeGreaterThan(12)
  })
})

describe('relocateBlock（解析器升级后的重定位 [P6]）', () => {
  const oldText =
    'Our method achieves a 14.2% relative WER reduction over the baseline on the LibriSpeech test-other set.'
  const anchor = { text_simhash: simhash64(oldText), text: oldText }

  it('归一化全等直接命中', () => {
    const hit = relocateBlock(anchor, [
      { block_id: 'b1', text: '  our METHOD achieves a 14.2% relative WER reduction over the baseline on the LibriSpeech test-other set.' }
    ])
    expect(hit?.block_id).toBe('b1')
  })

  it('切分微变时按 simhash 近邻命中', () => {
    const hit = relocateBlock(anchor, [
      { block_id: 'other', text: 'Table 3 lists hyperparameters used across all ablation experiments.' },
      {
        block_id: 'moved',
        text: 'Our method achieves a 14.2 % relative WER reduction over the baseline on the LibriSpeech test-other set'
      }
    ])
    expect(hit?.block_id).toBe('moved')
  })

  it('没有足够近的候选返回 null——宁缺毋错', () => {
    const hit = relocateBlock(anchor, [
      { block_id: 'x', text: 'Acknowledgements: we thank the anonymous reviewers for their feedback.' }
    ])
    expect(hit).toBeNull()
  })
})
