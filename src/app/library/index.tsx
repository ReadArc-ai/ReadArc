import { useEffect, useRef, useState, type JSX } from 'react'
import { create } from 'zustand'
import type { PaperRow } from '../../../shared/models'
import { useApp } from '../../store/app'
import { confirmDialog } from '../../store/confirm'
import { usePaper } from '../../store/paper'
import {
  useLibrary,
  filterByCollection,
  filterByQuery,
  filterByTag,
  continueReading,
  sortPapers,
  tagCounts,
  type Collection
} from '../../store/library'
import type { LibSort } from '../../../shared/ipc'
import { IconEdit, IconPin } from '../shell/icons'
import { PaperEditDialog } from './PaperEditDialog'
import { tNow, useT, type I18nKey } from '../../i18n'
import { errText } from '../../lib/errors'
import { Markdown } from '../../lib/md'
import { useGen, useGenStream } from '../../store/gen'

/**
 * 跨论文找矛盾：读所有论文的笔记，让模型指出结论互相打架的地方。
 * 主进程一直有这个能力，之前界面上没有入口，用户根本按不到。
 * 放在论文库（它是跨论文的事，不属于任何一篇），点了才花 token。
 * 按钮在标题栏、结果卡在下面，状态放模块级 store 让两处共用。
 */
interface ConflictState {
  open: boolean
  busy: boolean
  result: { text: string; model: string } | null
  error: string | null
  run(): Promise<void>
  close(): void
}

const useConflicts = create<ConflictState>((set) => ({
  open: false,
  busy: false,
  result: null,
  error: null,
  close: () => set({ open: false }),
  run: async () => {
    set({ open: true, busy: true, error: null, result: null })
    useGen.getState().clear('contradictions')
    try {
      set({ result: await window.readarc.findContradictions() })
    } catch (err) {
      set({ error: errText(err) })
    } finally {
      set({ busy: false })
      useGen.getState().clear('contradictions')
    }
  }
}))

function ContradictionsButton(): JSX.Element {
  const t = useT()
  const busy = useConflicts((s) => s.busy)
  const run = useConflicts((s) => s.run)
  return (
    <button className="set-btn lib-contradictions-btn" title={t('lib.contradictions.tip')} disabled={busy} onClick={() => void run()}>
      {t('lib.contradictions')}
    </button>
  )
}

function ContradictionsPanel(): JSX.Element | null {
  const t = useT()
  const { open, busy, result, error, run, close } = useConflicts()
  const streaming = useGenStream('contradictions')
  if (!open) return null
  return (
    <div className="insight-card insight-card--dashed lib-contradictions">
      <div className="summary-head">
        <span className="summary-label">{t('lib.contradictions.label')}</span>
        <span className="lib-contradictions-head-right">
          {result && <span className="summary-meta">{result.model}</span>}
          <button className="panel-close" onClick={close} title={t('common.close-esc')}>
            ×
          </button>
        </span>
      </div>
      {result ? (
        <Markdown className="insight-text" text={result.text} />
      ) : busy && streaming ? (
        <Markdown className="insight-text insight-text--streaming" text={streaming} />
      ) : busy ? (
        <div className="insight-status">
          <span className="insight-status-dot" />
          <span>{t('lib.contradictions.busy')}</span>
        </div>
      ) : (
        <div className="zh-error">
          <span>{error}</span>
          <button onClick={() => void run()}>{t('common.retry')}</button>
        </div>
      )}
    </div>
  )
}

function openPaper(id: string): void {
  void usePaper
    .getState()
    .loadPaper(id)
    .then(() => useApp.getState().setScreen('reader'))
}

function onCardMenu(e: React.MouseEvent, paperId: string): void {
  e.preventDefault()
  window.readarc.showPaperMenu(paperId)
}

async function confirmDelete(p: PaperRow): Promise<void> {
  const ok = await confirmDialog(tNow('lib.confirm-delete', { title: p.title ?? '' }), {
    confirmLabel: tNow('common.delete'),
    danger: true
  })
  if (ok) void useLibrary.getState().remove(p.id)
}

function statusLabel(p: PaperRow): { text: string; color: string } {
  if (p.status === 'done') return { text: tNow('lib.status.done'), color: 'var(--fg3)' }
  if (p.status === 'reading')
    return { text: tNow('lib.status.reading', { pct: Math.round(p.progress) }), color: 'var(--acc)' }
  return { text: tNow('lib.status.unread'), color: 'var(--fg2)' }
}

/** 翻译进度标签：全译 → 已译；部分 → 译 N%；未译 → null。 */
function transLabel(p: PaperRow): string | null {
  if (!p.trans_total || !p.trans_done) return null
  if (p.trans_done >= p.trans_total) return tNow('lib.trans.done')
  return tNow('lib.trans.pct', { pct: Math.round((p.trans_done / p.trans_total) * 100) })
}

/** 封面 = 论文首页：有缩略图用真首页，否则版面纹理占位。
 *  缩略图在卡片进入视野时才生成——大库不该一打开就渲染几百个 PDF 首页。 */
function Cover({ p, active }: { p: PaperRow; active: boolean }): JSX.Element {
  const thumb = useLibrary((s) => s.thumbs[p.id])
  const ensureThumb = useLibrary((s) => s.ensureThumb)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || thumb) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          ensureThumb(p.id)
          io.disconnect()
        }
      },
      { rootMargin: '400px' } // 提前一屏开始渲染，滚到时已经就位
    )
    io.observe(el)
    return () => io.disconnect()
  }, [p.id, thumb, ensureThumb])
  return (
    <div ref={ref} className="lib-cover" style={active ? { borderColor: 'var(--acc)' } : undefined}>
      <span className="lib-cover-source">
        {[p.source, p.year].filter(Boolean).join(' · ') || 'PDF'}
      </span>
      <span className="lib-cover-title">{p.title}</span>
      {thumb ? <img className="lib-cover-thumb" src={thumb} alt="" /> : <span className="lib-cover-texture" />}
      {/* 从未打开不画进度槽（空槽会被读成「读了 0%」） */}
      {p.progress > 0 && (
        <span className="lib-cover-progress">
          <span
            style={{
              width: `${Math.min(100, p.progress)}%`,
              background: p.status === 'done' ? 'var(--fg3)' : 'var(--acc)'
            }}
          />
        </span>
      )}
    </div>
  )
}

/** 卡片 / 行上的标签：最多显示 3 个，其余折成 +N */
function TagChips({ tags, max = 3 }: { tags?: string[]; max?: number }): JSX.Element | null {
  if (!tags || tags.length === 0) return null
  return (
    <span className="lib-tags">
      {tags.slice(0, max).map((tag) => (
        <span key={tag} className="lib-tag">
          {tag}
        </span>
      ))}
      {tags.length > max && <span className="lib-tag lib-tag--more">+{tags.length - max}</span>}
    </span>
  )
}

function EditButton({ p }: { p: PaperRow }): JSX.Element {
  const t = useT()
  return (
    <span
      className="lib-edit"
      title={t('lib.edit-paper')}
      onClick={(e) => {
        e.stopPropagation()
        useLibrary.getState().setEditing(p.id)
      }}
    >
      <IconEdit />
    </span>
  )
}

function CoverGrid({ papers }: { papers: PaperRow[] }): JSX.Element {
  const currentId = usePaper((s) => s.bundle?.paper.id)
  // 「继续读」书架始终按最近打开，不跟着当前排序和置顶走
  const opened = (p: PaperRow): number => p.last_opened_at ?? p.added_at
  const shelf = continueReading([...papers].sort((a, b) => opened(b) - opened(a)))
  const t = useT()

  return (
    <div className="lib-covers">
      {shelf.length > 0 && (
        <>
          <div className="lib-section-label">{t('library.continue')}</div>
          <div className="lib-shelf">
            {shelf.map((p) => (
              <button
                key={p.id}
                className="lib-shelf-card"
                onClick={() => openPaper(p.id)}
                onContextMenu={(e) => onCardMenu(e, p.id)}
              >
                <span className="lib-shelf-thumb">
                  <Cover p={p} active={p.id === currentId} />
                </span>
                <span className="lib-shelf-info">
                  <span className="lib-shelf-title">{p.title}</span>
                  {p.last_section && <span className="lib-shelf-section">{p.last_section}</span>}
                  <span className="lib-shelf-bar">
                    <span style={{ width: `${p.progress}%` }} />
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="lib-section-label">{t('library.all')}</div>
        </>
      )}
      <div className="lib-grid">
        {papers.map((p) => {
          const status = statusLabel(p)
          return (
            <button
              key={p.id}
              className="lib-card"
              onClick={() => openPaper(p.id)}
              onContextMenu={(e) => onCardMenu(e, p.id)}
            >
              <EditButton p={p} />
              <span
                className="lib-del"
                title={t('lib.delete-paper')}
                onClick={(e) => {
                  e.stopPropagation()
                  void confirmDelete(p)
                }}
              >
                ✕
              </span>
              <Cover p={p} active={p.id === currentId} />
              {/* 手填的中文标题优先，没有就用自动译名 */}
              {(p.title_zh || p.title_tr) && <span className="lib-card-zh">{p.title_zh || p.title_tr}</span>}
              {/* 没有作者信息就不占这一行：一个孤零零的「—」看着像坏了 */}
              {authorNames(p).length > 0 && <span className="lib-card-meta">{authorLine(p, t('lib.et-al'))}</span>}
              <span className="lib-card-status" style={{ color: status.color }}>
                {p.pinned_at && (
                  <span className="lib-pin lib-pin--inline" title={t('lib.pinned')}>
                    <IconPin />
                  </span>
                )}
                {status.text}
                {transLabel(p) && <span className="lib-trans-tag">{transLabel(p)}</span>}
              </span>
              <TagChips tags={p.tags} max={2} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 作者名单：去掉不含字母的杂项（arXiv 元数据里偶尔混进单独的「:」） */
function authorNames(p: PaperRow): string[] {
  try {
    const names = p.authors ? (JSON.parse(p.authors) as unknown[]) : []
    return names.filter((n): n is string => typeof n === 'string' && /\p{L}/u.test(n))
  } catch {
    return []
  }
}

/** 卡片作者行：两位以内全写，多了写「第一作者 等」（年份封面上已经有了） */
function authorLine(p: PaperRow, etAl: string): string {
  const names = authorNames(p)
  return names.length > 2 ? `${names[0]} ${etAl}` : names.join(', ')
}

function ListView({ papers }: { papers: PaperRow[] }): JSX.Element {
  const t = useT()
  const tier = useApp((s) => s.tier)
  // 列随档位丢弃而不是横向滚动
  const showAuthors = tier === 'lg'
  const showYearSource = tier !== 'sm'

  return (
    <table className="lib-table">
      <thead>
        <tr>
          <th />
          <th>{t('lib.col.title')}</th>
          {showAuthors && <th>{t('lib.col.authors')}</th>}
          {showYearSource && <th>{t('lib.col.year')}</th>}
          {showYearSource && <th>{t('lib.col.source')}</th>}
          <th>{t('lib.col.status')}</th>
          <th>{t('lib.col.progress')}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {papers.map((p) => {
          const status = statusLabel(p)
          return (
            <tr key={p.id} onClick={() => openPaper(p.id)} onContextMenu={(e) => onCardMenu(e, p.id)}>
              <td>
                <span className="lib-dot" style={{ background: status.color }} />
              </td>
              <td className="lib-td-title">
                {p.pinned_at && (
                  <span className="lib-pin lib-pin--inline" title={t('lib.pinned')}>
                    <IconPin />
                  </span>
                )}
                {p.title}
                {(p.title_zh || p.title_tr) && <span className="lib-td-zh">{p.title_zh || p.title_tr}</span>}
                <TagChips tags={p.tags} />
              </td>
              {showAuthors && (
                <td className="lib-td-dim">
                  {authorNames(p).slice(0, 2).join(', ') || '—'}
                </td>
              )}
              {showYearSource && <td className="lib-td-dim">{p.year ?? '—'}</td>}
              {showYearSource && <td className="lib-td-dim">{p.source ?? 'PDF'}</td>}
              <td style={{ color: status.color, fontSize: 11 }}>
                {status.text}
                {transLabel(p) && <span className="lib-trans-tag">{transLabel(p)}</span>}
              </td>
              <td className="lib-td-progress">
                {p.progress > 0 ? (
                  <span className="lib-row-bar">
                    <span
                      style={{
                        width: `${p.progress}%`,
                        background: p.status === 'done' ? 'var(--fg3)' : 'var(--acc)'
                      }}
                    />
                  </span>
                ) : null}
              </td>
              <td className="lib-td-del">
                <EditButton p={p} />
                <span
                  className="lib-del"
                  title={t('lib.delete-paper')}
                  onClick={(e) => {
                    e.stopPropagation()
                    void confirmDelete(p)
                  }}
                >
                  ✕
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const SORTS: { id: LibSort; label: I18nKey }[] = [
  { id: 'opened', label: 'lib.sort.opened' },
  { id: 'added', label: 'lib.sort.added' },
  { id: 'title', label: 'lib.sort.title' },
  { id: 'year', label: 'lib.sort.year' }
]

const COLLECTIONS: { id: Collection; label: I18nKey }[] = [
  { id: 'all', label: 'lib.filter.all' },
  { id: 'unread', label: 'lib.filter.unread' },
  { id: 'reading', label: 'lib.filter.reading' },
  { id: 'done', label: 'lib.filter.done' }
]

export function LibraryScreen(): JSX.Element {
  const { papers, collection, load, setCollection, loadError, sort, setSort, tag, setTag } = useLibrary()
  const libView = useApp((s) => s.libView)
  const setLibView = useApp((s) => s.setLibView)
  // 窄窗口下搜索框只剩 96px，长提示会被截成「Search yo」，换短的
  const narrow = useApp((s) => s.tier === 'sm')
  const t = useT()

  // 库大了以后靠滚是找不到论文的：标题 / 作者 / 年份就地过滤
  const [query, setQuery] = useState('')

  // 目标语言改了也重新加载：标题译名按语言各存一份
  const targetLang = useApp((s) => s.targetLang)
  const titlesTranslating = useLibrary((s) => s.titlesTranslating)
  useEffect(() => {
    void load()
  }, [load, targetLang])

  // 右键菜单里的「删除论文…」回到既有确认流程；「编辑信息…」打开编辑框；切换置顶后刷新
  useEffect(() => {
    const offDelete = window.readarc.onPaperMenuDelete((paperId) => {
      const p = useLibrary.getState().papers.find((x) => x.id === paperId)
      if (p) void confirmDelete(p)
    })
    const offEdit = window.readarc.onPaperMenuEdit((paperId) => useLibrary.getState().setEditing(paperId))
    const offPin = window.readarc.onPaperPinnedChanged(() => void useLibrary.getState().load())
    return () => {
      offDelete()
      offEdit()
      offPin()
    }
  }, [])

  const filtered = sortPapers(filterByQuery(filterByTag(filterByCollection(papers, collection), tag), query), sort)
  const tags = tagCounts(papers)

  const pickImport = (): void => {
    void usePaper.getState().pickAndImport()
  }

  return (
    <section className="screen">
      <div className="lib-layout">
        <aside className="lib-sidebar">
          <div className="lib-section-label">{t('lib.collections')}</div>
          {COLLECTIONS.map((c) => {
            const count = filterByCollection(papers, c.id).length
            return (
              <button
                key={c.id}
                className="lib-side-item"
                style={
                  collection === c.id
                    ? { background: 'var(--bg2)', color: 'var(--fg)' }
                    : undefined
                }
                onClick={() => setCollection(c.id)}
              >
                <span>{t(c.label)}</span>
                <span className="lib-side-count">{count}</span>
              </button>
            )
          })}
          {tags.length > 0 && (
            <>
              <div className="lib-section-label lib-section-label--tags">{t('lib.tags')}</div>
              {tags.map(({ tag: name, count }) => (
                <button
                  key={name}
                  className="lib-side-item"
                  style={tag === name ? { background: 'var(--bg2)', color: 'var(--fg)' } : undefined}
                  onClick={() => setTag(tag === name ? null : name)}
                >
                  <span className="lib-side-tag"># {name}</span>
                  <span className="lib-side-count">{count}</span>
                </button>
              ))}
            </>
          )}
        </aside>
        <div className="lib-main">
          <header className="screen-header">
            <h1>{t('library.title')}</h1>
            <span className="screen-hint">{filtered.length}</span>
            {titlesTranslating && <span className="screen-hint lib-titles-busy">{t('lib.titles-busy')}</span>}
            <span style={{ flex: 1 }} />
            <span className="lib-search">
              <input
                value={query}
                placeholder={t(narrow ? 'lib.search-short' : 'lib.search')}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQuery('')
                  e.stopPropagation()
                }}
              />
              {query && (
                <button className="lib-search-clear" onClick={() => setQuery('')} title={t('common.close-esc')}>
                  ×
                </button>
              )}
            </span>
            <select className="set-select lib-sort" value={sort} title={t('lib.sort.tip')} onChange={(e) => setSort(e.target.value as LibSort)}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {t(s.label)}
                </option>
              ))}
            </select>
            <div className="seg-control">
              <button
                className="seg-item"
                style={libView === 'cover' ? { background: 'var(--acc)', color: 'var(--on-acc)' } : undefined}
                onClick={() => setLibView('cover')}
              >
                {t('lib.view.cover')}
              </button>
              <button
                className="seg-item"
                style={libView === 'list' ? { background: 'var(--acc)', color: 'var(--on-acc)' } : undefined}
                onClick={() => setLibView('list')}
              >
                {t('lib.view.list')}
              </button>
            </div>
            <ContradictionsButton />
            <button className="btn-accent" onClick={pickImport}>
              {t('lib.import')}
            </button>
          </header>
          <ContradictionsPanel />
          {loadError && <div className="doc-notice">{t('lib.load-failed')}</div>}
          {/* 导入进度与失败由全局的 ImportToast 展示（拖入可能落在任何屏幕） */}
          <div className="screen-body">
            {filtered.length === 0 ? (
              // 空库要教用户怎么放第一篇进来；只是当前分类没论文则一句话说明即可，
              // 别再让「还没有在读的论文」这句阅读器的话出现在库里
              <div className="reader-empty">
                {papers.length === 0 ? (
                  <>
                    <h2>{t('lib.empty.title')}</h2>
                    <p className="placeholder-note">{t('lib.empty.hint')}</p>
                    <button className="btn-accent" onClick={pickImport}>
                      {t('reader.empty.pick')}
                    </button>
                  </>
                ) : query ? (
                  <h2>{t('lib.empty.search', { q: query })}</h2>
                ) : tag ? (
                  <h2>{t('lib.empty.tag')}</h2>
                ) : (
                  <h2>{t('lib.empty.filter')}</h2>
                )}
              </div>
            ) : libView === 'cover' ? (
              <CoverGrid papers={filtered} />
            ) : (
              <ListView papers={filtered} />
            )}
          </div>
        </div>
      </div>
      <PaperEditDialog />
    </section>
  )
}
