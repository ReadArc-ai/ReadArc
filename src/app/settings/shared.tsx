/** 设置页公用的小件：分区标题、行式布局、导航图标 */
import { type JSX, type ReactNode } from 'react'


/* ---- 小图标（16px 线稿，风格与阅读器 icon 一致） ---- */
export const ic = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

export const IconChip = (): JSX.Element => (
  <svg viewBox="0 0 16 16" {...ic} aria-hidden>
    <rect x="4" y="4" width="8" height="8" rx="1.5" />
    <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" />
  </svg>
)
export const IconRoute = (): JSX.Element => (
  <svg viewBox="0 0 16 16" {...ic} aria-hidden>
    <circle cx="3.5" cy="3.5" r="1.8" />
    <circle cx="12.5" cy="12.5" r="1.8" />
    <path d="M5.3 3.5h4.2a3 3 0 0 1 3 3v4" />
  </svg>
)
export const IconGlobe = (): JSX.Element => (
  <svg viewBox="0 0 16 16" {...ic} aria-hidden>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M1.8 8h12.4M8 1.8c-3.4 3.6-3.4 8.8 0 12.4M8 1.8c3.4 3.6 3.4 8.8 0 12.4" />
  </svg>
)
export const IconCoin = (): JSX.Element => (
  <svg viewBox="0 0 16 16" {...ic} aria-hidden>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M10.2 6.2c-.4-.8-1.2-1.2-2.2-1.2-1.3 0-2.2.7-2.2 1.6 0 2.4 4.6.8 4.6 3 0 1-.9 1.6-2.4 1.6-1.1 0-1.9-.4-2.3-1.2M8 3.6v1.4M8 11v1.4" />
  </svg>
)
export const IconDrive = (): JSX.Element => (
  <svg viewBox="0 0 16 16" {...ic} aria-hidden>
    <ellipse cx="8" cy="4" rx="5.5" ry="2" />
    <path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
  </svg>
)

/* ---- 布局原语（行 / 分区） ---- */

export function Section({
  icon,
  title,
  meta,
  aside,
  children
}: {
  icon: JSX.Element
  title: string
  meta?: string
  aside?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <section className="set-section">
      <div className="set-section-head">
        <span className="set-section-icon">{icon}</span>
        <span>{title}</span>
        {meta && <span className="set-pill">{meta}</span>}
        {aside && <span className="set-section-aside">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

export function Row({
  title,
  desc,
  hint,
  action,
  below
}: {
  title: ReactNode
  desc?: ReactNode
  hint?: string
  action?: ReactNode
  below?: ReactNode
}): JSX.Element {
  return (
    <div className="set-row">
      <div className="set-row-main">
        <div className="set-row-title">{title}</div>
        {desc && <div className="set-row-desc">{desc}</div>}
        {hint && <div className="set-row-hint">{hint}</div>}
        {below}
      </div>
      {action && <div className="set-row-action">{action}</div>}
    </div>
  )
}

/* ---- 通用页：语言 / 主题。原先挤在标题栏右上角，桌面应用的惯例是放设置里 ---- */

export const IconGeneral = (): JSX.Element => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
    <path d="M2 4.5h12M2 8h12M2 11.5h12" />
    <circle cx="6" cy="4.5" r="1.6" fill="var(--bg1)" />
    <circle cx="10.5" cy="8" r="1.6" fill="var(--bg1)" />
    <circle cx="5" cy="11.5" r="1.6" fill="var(--bg1)" />
  </svg>
)

/* ---- 讲法页：内置的只读展示，自定义的增删改；当前讲法也可以在这里切 ---- */

export const IconPersona = (): JSX.Element => (
  <svg viewBox="0 0 16 16" {...ic} aria-hidden>
    <path d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-3.5 2.5V11.5h-2a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" />
    <path d="M5.5 7h5M5.5 9h3" />
  </svg>
)
