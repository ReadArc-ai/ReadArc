/** 16px 线性图标，currentColor。 */
import type { JSX } from 'react'

const p = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

export function BrandMark(): JSX.Element {
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden>
      <path d="M26 42 C26 16 74 16 74 42" stroke="currentColor" strokeWidth="11" strokeLinecap="round" />
      <line x1="21" y1="68" x2="39" y2="68" stroke="currentColor" strokeWidth="11" strokeLinecap="round" />
      <line x1="61" y1="68" x2="79" y2="68" stroke="currentColor" strokeWidth="11" strokeLinecap="round" opacity="0.42" />
      <line x1="21" y1="88" x2="39" y2="88" stroke="currentColor" strokeWidth="11" strokeLinecap="round" />
      <line x1="61" y1="88" x2="79" y2="88" stroke="currentColor" strokeWidth="11" strokeLinecap="round" opacity="0.42" />
    </svg>
  )
}

export function IconReader(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...p} aria-hidden>
      <path d="M8 3.5C6.8 2.4 5 2 3 2v11c2 0 3.8.4 5 1.5 1.2-1.1 3-1.5 5-1.5V2c-2 0-3.8.4-5 1.5Z" />
      <path d="M8 3.5v11" />
    </svg>
  )
}

export function IconLibrary(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...p} aria-hidden>
      <rect x="2" y="2" width="4.5" height="12" rx="1" />
      <rect x="9" y="2" width="4.5" height="12" rx="1" transform="rotate(8 11.25 8)" />
    </svg>
  )
}

export function IconSearch(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...p} aria-hidden>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3.5 3.5" />
    </svg>
  )
}

/** 侧栏开关：矩形分两栏，「开」时把对应一侧涂实——比 ⟨ ⟩ 这种字符一眼能认出是收起/展开 */
export function IconPanelLeft({ open }: { open: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...p} aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M6 2.5v11" />
      {open && <rect x="1.5" y="2.5" width="4.5" height="11" rx="1.5" fill="currentColor" stroke="none" opacity="0.5" />}
    </svg>
  )
}

export function IconPanelRight({ open }: { open: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...p} aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M10 2.5v11" />
      {open && <rect x="10" y="2.5" width="4.5" height="11" rx="1.5" fill="currentColor" stroke="none" opacity="0.5" />}
    </svg>
  )
}

export function IconSend(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...p} strokeWidth={1.8} aria-hidden>
      <path d="M8 13V3.5" />
      <path d="m4 7.5 4-4 4 4" />
    </svg>
  )
}

export function IconStop(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  )
}

/** 设置：齿轮。原来的「圆心 + 八根射线」和亮度 / 太阳图标撞了 */
export function IconSettings(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" {...p} strokeWidth={2.1} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

/** 纸面深浅切换：半填充的圆（对比度符号），on 时右半实心 */
export function IconContrast({ on }: { on: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...p} aria-hidden>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 1.8a6.2 6.2 0 0 1 0 12.4Z" fill="currentColor" stroke="none" opacity={on ? 1 : 0.35} />
    </svg>
  )
}

/** 面板停靠到底部（窗口框 + 下方实心条） */
export function IconDockBottom(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...p} aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M1.5 9.5h13" />
      <rect x="1.5" y="9.5" width="13" height="4" rx="1.5" fill="currentColor" stroke="none" opacity="0.5" />
    </svg>
  )
}

/** 面板已隐藏：只有窗口框 */
export function IconPanelNone(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...p} aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
    </svg>
  )
}

/** 专注模式：四个角括号（全屏 / 聚焦的通用符号） */
export function IconFocus(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...p} aria-hidden>
      <path d="M2 6V3.5A1.5 1.5 0 0 1 3.5 2H6M10 2h2.5A1.5 1.5 0 0 1 14 3.5V6M14 10v2.5a1.5 1.5 0 0 1-1.5 1.5H10M6 14H3.5A1.5 1.5 0 0 1 2 12.5V10" />
    </svg>
  )
}

/** 截图提问：取景框 */
export function IconCrop(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" {...p} aria-hidden>
      <path d="M4.5 1.5v10h10M1.5 4.5h10v10" />
    </svg>
  )
}
