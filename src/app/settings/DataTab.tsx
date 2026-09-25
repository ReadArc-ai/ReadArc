/** 设置 → 数据：存储位置、大小与清理 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import { type DataClearKind, type DataOverview } from '../../../shared/models'
import { useT, type I18nKey } from '../../i18n'
import { confirmDialog } from '../../store/confirm'
import { useChat } from '../../store/chat'
import { usePaper } from '../../store/paper'
import { formatBytes } from '../../lib/format'
import { IconDrive, Section, Row } from './shared'


/* ---- 关于页 ---- */

/* ---- 数据：每类数据的路径与大小、按类清理、全部重置 ---- */

export const DATA_ROWS: { id: DataOverview['entries'][number]['id']; title: I18nKey; desc: I18nKey }[] = [
  { id: 'db', title: 'set.data.db', desc: 'set.data.db.desc' },
  { id: 'papers', title: 'set.data.papers', desc: 'set.data.papers.desc' },
  { id: 'figures', title: 'set.data.figures', desc: 'set.data.figures.desc' },
  { id: 'notes', title: 'set.data.notes', desc: 'set.data.notes.desc' },
  { id: 'settings', title: 'set.data.settings', desc: 'set.data.settings.desc' },
  { id: 'config', title: 'set.data.config', desc: 'set.data.config.desc' }
]

export const CLEAR_KINDS: Exclude<DataClearKind, 'all'>[] = ['search-cache', 'figures', 'translations', 'summaries', 'chats', 'usage']

export function DataTab(): JSX.Element {
  const t = useT()
  const [data, setData] = useState<DataOverview | null>(null)
  const [busy, setBusy] = useState<DataClearKind | null>(null)
  const [done, setDone] = useState<DataClearKind | null>(null)
  const refresh = useCallback((): void => {
    window.readarc
      .dataOverview()
      .then(setData)
      .catch(() => {})
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])

  const dbEntry = data?.entries.find((e) => e.id === 'db')
  const counts = dbEntry?.counts
  const sizes = dbEntry?.sizes
  const figures = data?.entries.find((e) => e.id === 'figures')
  // 每类：条数 · 占用（库内按表页统计，含索引）
  const amount = (kind: DataClearKind): string => {
    if (!counts || !sizes) return ''
    // 空表也占着根页与索引页，条数为 0 时只显示 0，不显示那几 KB 的空壳
    const pair = (n: number, b: number): string => (n === 0 ? '0' : `${n} · ${formatBytes(b)}`)
    switch (kind) {
      case 'search-cache':
        return pair(counts.searchCache, sizes.searchCache)
      case 'figures':
        return figures ? pair(figures.files, figures.bytes) : ''
      case 'translations':
        return pair(counts.translations, sizes.translations)
      case 'summaries':
        return pair(counts.summaries, sizes.summaries)
      case 'chats':
        return pair(counts.chats, sizes.chats)
      case 'usage':
        return pair(counts.usage, sizes.usage)
      default:
        return ''
    }
  }

  const clear = async (kind: DataClearKind): Promise<void> => {
    const ok = await confirmDialog(
      kind === 'all' ? t('set.data.reset-confirm') : t('set.data.clear-confirm', { what: t(`set.data.clear.${kind}` as I18nKey) }),
      { danger: true }
    )
    if (!ok) return
    setBusy(kind)
    try {
      const r = await window.readarc.dataClear(kind)
      if (r.relaunch) return // 进程随后重启
      // 内存里的译文 / 摘要 / 会话已经过期：当前论文重新加载，会话列表重取
      const paperId = usePaper.getState().bundle?.paper.id
      if (paperId && (kind === 'translations' || kind === 'summaries')) void usePaper.getState().loadPaper(paperId)
      if (kind === 'chats') {
        useChat.setState({ sessionsByPaper: {}, activeSessionByPaper: {}, messagesBySession: {} })
        if (paperId) void useChat.getState().loadSessions(paperId)
      }
      setDone(kind)
      refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Section icon={<IconDrive />} title={t('set.data')} meta={data ? t('set.data.total', { size: formatBytes(data.total) }) : undefined}>
        <p className="set-note">{t('set.data-desc')}</p>
        {DATA_ROWS.map((row) => {
          const e = data?.entries.find((x) => x.id === row.id)
          return (
            <Row
              key={row.id}
              title={
                <span className="data-title">
                  {t(row.title)}
                  {e && <span className="data-size">{formatBytes(e.bytes)}</span>}
                  {e && e.id !== 'db' && e.id !== 'settings' && e.files > 0 && (
                    <span className="data-files">{t('set.data.files', { n: e.files })}</span>
                  )}
                </span>
              }
              desc={row.id === 'db' && counts ? t('set.data.counts', counts) : t(row.desc)}
              hint={e?.path}
              action={
                <button className="set-btn" onClick={() => void window.readarc.dataReveal(row.id)}>
                  {t('common.open')}
                </button>
              }
            />
          )
        })}
      </Section>
      <Section icon={<IconDrive />} title={t('set.data.clean')}>
        <p className="set-note">{t('set.data.clean-desc')}</p>
        {CLEAR_KINDS.map((kind) => (
          <Row
            key={kind}
            title={
              <span className="data-title">
                {t(`set.data.clear.${kind}` as I18nKey)}
                {counts && <span className="data-size">{amount(kind)}</span>}
              </span>
            }
            action={
              <button className="set-btn" disabled={busy !== null} onClick={() => void clear(kind)}>
                {done === kind ? t('set.data.cleared') : t('common.clear')}
              </button>
            }
          />
        ))}
        <Row
          title={t('set.data.reset')}
          desc={t('set.data.reset.desc')}
          action={
            <button className="set-btn set-btn--danger" disabled={busy !== null} onClick={() => void clear('all')}>
              {t('set.data.reset')}
            </button>
          }
        />
      </Section>
    </>
  )
}
