/**
 * 应用内确认框。替代 window.confirm：系统弹窗在 mac / Windows 长得完全不同，
 * 也不跟随应用的深浅主题。这里只放一个待决请求，界面层 ConfirmDialog 负责渲染。
 */
import { create } from 'zustand'

export interface ConfirmOptions {
  /** 确认按钮文案，默认「确定」 */
  confirmLabel?: string
  /** 取消按钮文案，默认「取消」 */
  cancelLabel?: string
  /** 破坏性操作：确认按钮用警示色 */
  danger?: boolean
}

interface PendingConfirm {
  message: string
  options: ConfirmOptions
  resolve: (ok: boolean) => void
}

interface ConfirmState {
  pending: PendingConfirm | null
  settle(ok: boolean): void
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  pending: null,
  settle: (ok) => {
    const p = get().pending
    if (!p) return
    set({ pending: null })
    p.resolve(ok)
  }
}))

/**
 * 弹出确认框，用户点确认返回 true，取消 / Esc / 点遮罩返回 false。
 * message 里第一段是标题，空行之后的内容作为说明文字。
 */
export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  // 前一个未决的请求按取消处理，避免悬空的 Promise
  useConfirm.getState().settle(false)
  return new Promise((resolve) => {
    useConfirm.setState({ pending: { message, options, resolve } })
  })
}
