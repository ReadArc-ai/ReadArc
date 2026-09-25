/** ⌘K 命令面板：论文、目的地混合搜索；直接回车 = 问 AI。 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useT, type I18nKey } from '../../i18n'
import type { PaperRow } from '../../../shared/models'
import { useApp, type Screen } from '../../store/app'
import { usePaper } from '../../store/paper'
import { useChat } from '../../store/chat'
import { keyLabel, isComposingKey } from '../../lib/keys'

interface PaletteItem {
  key: string
  label: string
  hint: string
  run(): void
}

/** ⌘K 里最多列几篇论文，多的用一行提示带过 */
const PAPER_LIMIT = 6

const DESTINATIONS: { screen: Screen | 'settings'; label: I18nKey; key: string }[] = [
  { screen: 'reader', label: 'palette.reader', key: '⌘1' },
  { screen: 'library', label: 'palette.library', key: '⌘2' },
  { screen: 'discover', label: 'palette.discover', key: '⌘3' },
  { screen: 'settings', label: 'palette.settings', key: '⌘,' }
]

export function CommandPalette(): JSX.Element | null {
  const open = useApp((s) => s.paletteOpen)
  // 关闭即卸载：重开时内部状态自然归零
  if (!open) return null
  return <PaletteBody />
}

function PaletteBody(): JSX.Element {
  const t = useT()
  const setOpen = useApp((s) => s.setPaletteOpen)
  const [query, setQuery] = useState('')
  const [papers, setPapers] = useState<PaperRow[]>([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void window.readarc.listPapers().then(setPapers)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase()
    const out: PaletteItem[] = []

    const hits = papers.filter((p) => {
      if (!q) return true
      return (
        p.title?.toLowerCase().includes(q) ||
        p.title_zh?.toLowerCase().includes(q) ||
        p.authors?.toLowerCase().includes(q)
      )
    })
    const matchedPapers = hits.slice(0, PAPER_LIMIT)
    for (const p of matchedPapers) {
      out.push({
        key: `paper:${p.id}`,
        label: p.title ?? p.file_path,
        hint: p.last_section ?? (p.status === 'new' ? t('palette.unread') : `${Math.round(p.progress)}%`),
        run: () => {
          void usePaper
            .getState()
            .loadPaper(p.id)
            .then(() => useApp.getState().setScreen('reader'))
        }
      })
    }

    for (const d of DESTINATIONS) {
      // label 是 i18n 键，必须翻译后再显示与匹配——曾经把键名原样显示成 palette.reader
      const label = t(d.label)
      if (!q || label.toLowerCase().includes(q)) {
        out.push({
          key: `dest:${d.screen}`,
          label,
          hint: keyLabel(d.key),
          run: () =>
            d.screen === 'settings'
              ? useApp.getState().setSettingsOpen(true)
              : useApp.getState().setScreen(d.screen)
        })
      }
    }

    if (q && usePaper.getState().bundle) {
      out.push({
        key: 'ask',
        label: t('palette.ask', { q: query.trim() }),
        hint: t('palette.current-paper'),
        run: () => {
          useApp.getState().setScreen('reader')
          useApp.getState().setPanel('chat')
          void useChat.getState().ask(query.trim())
        }
      })
    }
    return out
  }, [query, papers, t])

  // 命中多于展示时要说一声：大库里搜一个常见词能中几十篇，只给 6 条又不吭声，
  // 用户会以为库里就这么几篇
  const more = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return 0
    const hits = papers.filter(
      (p) =>
        p.title?.toLowerCase().includes(q) ||
        p.title_zh?.toLowerCase().includes(q) ||
        p.authors?.toLowerCase().includes(q)
    ).length
    return Math.max(0, hits - PAPER_LIMIT)
  }, [query, papers])

  const runItem = (item: PaletteItem | undefined): void => {
    if (!item) return
    setOpen(false)
    item.run()
  }

  return (
    <div className="palette-overlay" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          placeholder={t('palette.placeholder')}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              setSelected((s) => Math.min(s + 1, items.length - 1))
              e.preventDefault()
            } else if (e.key === 'ArrowUp') {
              setSelected((s) => Math.max(s - 1, 0))
              e.preventDefault()
            } else if (e.key === 'Enter' && !isComposingKey(e)) {
              runItem(items[selected])
            }
          }}
        />
        <div className="palette-list">
          {items.map((item, i) => (
            <button
              key={item.key}
              className="palette-item"
              style={i === selected ? { background: 'var(--bg2)', color: 'var(--fg)' } : undefined}
              onMouseEnter={() => setSelected(i)}
              onClick={() => runItem(item)}
            >
              <span className="palette-label">{item.label}</span>
              <span className="palette-hint">{item.hint}</span>
            </button>
          ))}
          {items.length === 0 && <p className="placeholder-note">{t('palette.no-match')}</p>}
          {more > 0 && <p className="palette-more">{t('palette.more', { n: more })}</p>}
        </div>
      </div>
    </div>
  )
}
