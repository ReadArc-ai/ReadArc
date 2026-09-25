import { describe, expect, it } from 'vitest'
import { resolvePersonaStyle } from './persona'

describe('讲法 id → 提示词段', () => {
  it('内置讲法查内置表；默认讲法与空值返回 null', () => {
    expect(resolvePersonaStyle('grandma')).toContain('80 岁')
    expect(resolvePersonaStyle('reviewer')).toContain('审稿人')
    expect(resolvePersonaStyle('default')).toBeNull()
    expect(resolvePersonaStyle(undefined)).toBeNull()
  })

  it('自定义讲法按 id 查用户列表，要求原样返回', () => {
    const custom = [{ id: 'custom-1', name: '产品经理版', style: '讲法：读者是产品经理。' }]
    expect(resolvePersonaStyle('custom-1', custom)).toBe('讲法：读者是产品经理。')
  })

  it('来路不明的 id、空白的自定义要求都回到默认', () => {
    expect(resolvePersonaStyle('nope')).toBeNull()
    expect(resolvePersonaStyle('custom-2', [{ id: 'custom-2', name: 'x', style: '   ' }])).toBeNull()
  })
})
