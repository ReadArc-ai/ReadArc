/** 响应式三档用 ResizeObserver 观测窗口宽度，不用媒体查询。 */
import { useEffect } from 'react'
import { tierForWidth, useApp } from '../store/app'

export function useTier(): void {
  const setTier = useApp((s) => s.setTier)

  useEffect(() => {
    const el = document.documentElement
    setTier(tierForWidth(el.clientWidth))
    const ro = new ResizeObserver(() => setTier(tierForWidth(el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [setTier])
}
