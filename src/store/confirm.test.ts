import { describe, expect, it } from 'vitest'
import { confirmDialog, useConfirm } from './confirm'

describe('应用内确认框', () => {
  it('确认返回 true，取消返回 false，之后没有待决请求', async () => {
    const p = confirmDialog('删除？', { danger: true })
    expect(useConfirm.getState().pending?.message).toBe('删除？')
    expect(useConfirm.getState().pending?.options.danger).toBe(true)
    useConfirm.getState().settle(true)
    expect(await p).toBe(true)
    expect(useConfirm.getState().pending).toBeNull()

    const q = confirmDialog('清除？')
    useConfirm.getState().settle(false)
    expect(await q).toBe(false)
  })

  it('新请求顶掉旧请求：旧的按取消收场，不留悬空的 Promise', async () => {
    const first = confirmDialog('一')
    const second = confirmDialog('二')
    expect(await first).toBe(false)
    expect(useConfirm.getState().pending?.message).toBe('二')
    useConfirm.getState().settle(true)
    expect(await second).toBe(true)
  })

  it('没有待决请求时 settle 是空操作', () => {
    useConfirm.setState({ pending: null })
    expect(() => useConfirm.getState().settle(true)).not.toThrow()
  })
})
