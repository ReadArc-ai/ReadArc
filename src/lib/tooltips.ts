/**
 * 快速提示：原生 title 要等系统那将近一秒的延迟，且样式不受控。
 * 这里在 document 上做事件代理：悬停到带 title 的元素时把 title 挪进 data-tip（去掉原生提示），
 * 120ms 后在元素下方画一个小气泡。React 之后若改了 title 属性会重新写回 DOM，下次悬停再挪一次，
 * 所以动态变化的提示文字也跟得上。
 */
const DELAY_MS = 120
const GAP = 6

export function installTooltips(): () => void {
  const tip = document.createElement('div')
  tip.className = 'ui-tip'
  tip.hidden = true
  document.body.appendChild(tip)

  let timer: ReturnType<typeof setTimeout> | null = null
  let current: HTMLElement | null = null

  const hide = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    current = null
    tip.hidden = true
  }

  const show = (el: HTMLElement, text: string): void => {
    if (!el.isConnected) return
    tip.textContent = text
    tip.hidden = false
    const r = el.getBoundingClientRect()
    const tw = tip.offsetWidth
    const th = tip.offsetHeight
    let left = r.left + r.width / 2 - tw / 2
    left = Math.max(6, Math.min(window.innerWidth - tw - 6, left))
    let top = r.bottom + GAP
    if (top + th > window.innerHeight - 6) top = r.top - th - GAP
    tip.style.left = `${Math.round(left)}px`
    tip.style.top = `${Math.round(top)}px`
  }

  const onOver = (e: MouseEvent): void => {
    const target = e.target
    if (!(target instanceof Element)) return
    const el = target.closest('[title], [data-tip]') as HTMLElement | null
    if (!el) {
      if (current) hide()
      return
    }
    if (el === current) return
    hide()
    const title = el.getAttribute('title')
    if (title !== null) {
      el.dataset.tip = title
      el.removeAttribute('title')
    }
    const text = el.dataset.tip?.trim()
    if (!text) return
    current = el
    timer = setTimeout(() => show(el, text), DELAY_MS)
  }

  const onOut = (e: MouseEvent): void => {
    if (!current) return
    const to = e.relatedTarget
    if (to instanceof Node && current.contains(to)) return
    hide()
  }

  document.addEventListener('mouseover', onOver)
  document.addEventListener('mouseout', onOut)
  document.addEventListener('mousedown', hide, true)
  document.addEventListener('scroll', hide, true)
  window.addEventListener('blur', hide)
  return () => {
    document.removeEventListener('mouseover', onOver)
    document.removeEventListener('mouseout', onOut)
    document.removeEventListener('mousedown', hide, true)
    document.removeEventListener('scroll', hide, true)
    window.removeEventListener('blur', hide)
    tip.remove()
  }
}
