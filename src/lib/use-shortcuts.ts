/**
 * 全局键盘。
 * 输入框聚焦时只有 ⌘K 与 Esc 生效；Esc 依次退出：设置 → 浮层面板 → 命令面板 → 查找条，
 * 一次只退一层，**永不离开阅读器**。
 */
import { useEffect } from 'react'
import { useApp } from '../store/app'
import { useChat } from '../store/chat'

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  )
}


/** Esc 能退出的层，从上到下。null = 没有可退的层（此时 Esc 不做任何事）。 */
export type EscLayer = 'settings' | 'panel' | 'palette' | 'find' | null

/**
 * 一次 Esc 只退一层，且**永不离开阅读器**。
 *
 * 这里是 Esc 的唯一裁决处：任何组件都不许再自己挂 Escape 监听。
 * 设置弹窗曾经另挂过一个无条件的，结果「设置 + 查找条同时开」时
 * 一次 Esc 把两层一起关掉了。
 */
export function escTarget(s: {
  settingsOpen: boolean
  tier: string
  panelOpen: boolean
  paletteOpen: boolean
  findOpen: boolean
}): EscLayer {
  if (s.settingsOpen) return 'settings'
  if (s.tier === 'sm' && s.panelOpen) return 'panel'
  if (s.paletteOpen) return 'palette'
  if (s.findOpen) return 'find'
  return null
}

export function useShortcuts(resolvedDark: boolean): void {
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent): void => {
      const s = useApp.getState()
      const mod = e.metaKey || e.ctrlKey
      const typing = isTyping(e.target)

      if (e.key === 'Escape' && !mod) {
        const layer = escTarget(s)
        if (layer === null) return
        if (layer === 'settings') s.setSettingsOpen(false)
        else if (layer === 'panel') s.togglePanel()
        else if (layer === 'palette') s.setPaletteOpen(false)
        else s.setFindOpen(false)
        e.preventDefault()
        return
      }

      if (!mod) return

      // ⌘K 在任何状态可用（包括输入框聚焦时）
      if (e.key === 'k') {
        s.setPaletteOpen(!s.paletteOpen)
        e.preventDefault()
        return
      }

      if (typing) return // 其余全局键在输入时让位

      switch (e.key) {
        case '1':
          s.setScreen('reader') // [P2] ⌘1 永远是阅读器
          break
        case '2':
          s.setScreen('library')
          break
        case '3':
          s.setScreen('discover')
          break
        case ',':
          s.setSettingsOpen(true)
          break
        case 'd':
          s.toggleTheme(resolvedDark)
          break
        case 't':
          if (s.screen === 'reader') s.cycleView()
          break
        case '\\':
          if (s.screen === 'reader') s.togglePanel()
          break
        case 'f':
          if (s.screen === 'reader') s.setFindOpen(true)
          break
        case 'F':
          // ⌘⇧F：专注模式（收起左栏、目录、面板）
          if (s.screen === 'reader') s.toggleFocus()
          break
        case 's':
          // ⌘S：截图提问（框选模式开关）。应用里没有「保存」概念，这个键给截图最好记
          if (s.screen === 'reader' && s.view !== 'zh') s.setCropMode(!s.cropMode)
          break
        case '=':
        case '+':
          if (s.screen === 'reader') s.setPageZoom(s.pageZoom + 0.15)
          break
        case '-':
          if (s.screen === 'reader') s.setPageZoom(s.pageZoom - 0.15)
          break
        case '0':
          if (s.screen === 'reader') s.setPageZoom(1)
          break
        case 'l':
          // 焦点移到对话输入框（面板收起时先展开）
          if (s.screen === 'reader') useChat.getState().focusInput()
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [resolvedDark])
}
