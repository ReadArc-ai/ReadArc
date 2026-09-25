import { describe, expect, it } from 'vitest'
import { BUILTIN_PRESETS, parsePresetLines, presetChipLabel } from './persona-presets'
import { CHAT_PERSONAS } from '../../shared/models'

describe('自定义讲法的内置提问', () => {
  it('逐行解析：去空行、去首尾空白、去重、最多 4 条', () => {
    expect(parsePresetLines('  a  \n\n b\na\nc\nd\ne')).toEqual(['a', 'b', 'c', 'd'])
    expect(parsePresetLines('\n  \n')).toEqual([])
  })

  it('按钮文字：短问题原样，长问题截到 14 字加省略号', () => {
    expect(presetChipLabel('这篇论文能做成什么功能？')).toBe('这篇论文能做成什么功能？')
    expect(presetChipLabel('这篇论文能做成什么产品功能，最大的技术风险是什么？')).toBe('这篇论文能做成什么产品功能，…')
  })

  it('每种内置讲法都带两条内置提问', () => {
    for (const p of CHAT_PERSONAS) expect(BUILTIN_PRESETS[p]).toHaveLength(2)
  })
})
