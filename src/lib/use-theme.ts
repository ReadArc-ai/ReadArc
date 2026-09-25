/** data-theme 挂 body；跟随系统为默认，手动选择记忆。切换无过渡动画。 */
import { useEffect, useState } from 'react'
import { useApp } from '../store/app'

export function useResolvedTheme(): 'dark' | 'light' {
  const mode = useApp((s) => s.theme)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  useEffect(() => {
    document.body.dataset.theme = resolved
    // 纸面深浅默认跟随它；store 里留一份给工具栏与阅读器读
    useApp.setState({ resolvedTheme: resolved })
  }, [resolved])

  return resolved
}
