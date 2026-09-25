import { describe, expect, it } from 'vitest'
import { isComposingKey, keyLabelFor } from './keys'

describe('keyLabelFor', () => {
  it('mac 原样保留 ⌘ 符号', () => {
    expect(keyLabelFor('专注模式 ⌘⇧F。只留正文。', true)).toBe('专注模式 ⌘⇧F。只留正文。')
  })
  it('非 mac 换成 Ctrl+ / Ctrl+Shift+，其余字符不动', () => {
    expect(keyLabelFor('专注模式 ⌘⇧F。只留正文。', false)).toBe('专注模式 Ctrl+Shift+F。只留正文。')
    expect(keyLabelFor('缩小 ⌘−', false)).toBe('缩小 Ctrl+−')
    expect(keyLabelFor('显示面板 ⌘\\', false)).toBe('显示面板 Ctrl+\\')
    expect(keyLabelFor('⌘K', false)).toBe('Ctrl+K')
    expect(keyLabelFor('没有快捷键', false)).toBe('没有快捷键')
  })
})

describe('isComposingKey', () => {
  it('输入法上屏的回车不算提交', () => {
    expect(isComposingKey({ nativeEvent: { isComposing: true, keyCode: 13 } })).toBe(true)
    expect(isComposingKey({ nativeEvent: { isComposing: false, keyCode: 229 } })).toBe(true)
    expect(isComposingKey({ nativeEvent: { isComposing: false, keyCode: 13 } })).toBe(false)
    expect(isComposingKey({ isComposing: true })).toBe(true)
  })
})
