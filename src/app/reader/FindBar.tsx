/** ⌘F 论文内查找：原文与译文同时命中，段落级跳转。Esc 关闭。 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useT } from '../../i18n'
import { useApp } from '../../store/app'
import { usePaper } from '../../store/paper'
import { jumpToBlock } from '../../store/chat'

export function FindBar(): JSX.Element | null {
  const t = useT()
  const open = useApp((s) => s.findOpen)
  const setOpen = useApp((s) => s.setFindOpen)
  const bundle = usePaper((s) => s.bundle)
  const translations = usePaper((s) => s.translations)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [hasJumped, setHasJumped] = useState(false)

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !bundle) return []
    return bundle.blocks
      .filter((b) => {
        if (b.text.toLowerCase().includes(q)) return true
        const zh = translations[b.block_id]?.text
        return zh ? zh.toLowerCase().includes(q) : false
      })
      .map((b) => b.block_order)
  }, [query, bundle, translations])

  // 查询变化时重置游标：渲染期调整状态，避免 effect 级联渲染
  const [prevQuery, setPrevQuery] = useState(query)
  if (prevQuery !== query) {
    setPrevQuery(query)
    setIndex(0)
    setHasJumped(false)
  }

  if (!open || !bundle) return null

  const go = (next: number): void => {
    if (matches.length === 0) return
    const i = ((next % matches.length) + matches.length) % matches.length
    setIndex(i)
    jumpToBlock(matches[i])
  }

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        value={query}
        placeholder={t('find.placeholder')}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          // 首次 Enter 跳到当前命中，其后 Enter 逐处前进；Shift+Enter 回退
          go(e.shiftKey ? index - 1 : hasJumped ? index + 1 : index)
          setHasJumped(true)
        }}
      />
      <span className="find-count">
        {matches.length > 0 ? `${index + 1}/${matches.length}` : query ? '0' : ''}
      </span>
      <button onClick={() => go(index - 1)} title={t('find.prev')}>
        ↑
      </button>
      <button onClick={() => go(index + 1)} title={t('find.next')}>
        ↓
      </button>
      <button onClick={() => setOpen(false)} title={t('common.close-esc')}>
        ×
      </button>
    </div>
  )
}
