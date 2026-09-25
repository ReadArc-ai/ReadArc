/**
 * 快捷键标签按平台显示。文案里统一写 mac 的符号（⌘、⌘⇧），
 * Windows / Linux 上显示时换成 Ctrl+ / Ctrl+Shift+，不然用户看到 ⌘ 不知道按哪个键。
 * 渲染进程的键盘处理本来就同时认 metaKey 和 ctrlKey，行为不用改，只改显示。
 */
export function keyLabelFor(text: string, mac: boolean): string {
  if (mac || !text.includes('⌘')) return text
  return text.replace(/⌘⇧/g, 'Ctrl+Shift+').replace(/⌘/g, 'Ctrl+')
}

const isMac = typeof window !== 'undefined' && window.readarc?.platform === 'darwin'

export function keyLabel(text: string): string {
  return keyLabelFor(text, isMac)
}

/**
 * 输入法正在上屏的回车：中文 / 日文输入法里按回车是确认候选词，不是提交。
 * Chromium 这时派发的 keydown 仍是 key === 'Enter'，要靠 isComposing（或老式的 keyCode 229）区分。
 */
export function isComposingKey(e: { nativeEvent?: { isComposing?: boolean; keyCode?: number }; isComposing?: boolean; keyCode?: number }): boolean {
  const n = e.nativeEvent ?? e
  return n.isComposing === true || n.keyCode === 229
}
