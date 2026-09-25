import { isCjkDominant } from '../../../shared/lang'
import { useEffect, useState, type JSX } from 'react'
import { errText } from '../../lib/errors'
import type { SearchOutcome, SearchResultInput } from '../../../shared/models'
import { useApp } from '../../store/app'
import { usePaper } from '../../store/paper'
import { useSearch, type AddState } from '../../store/search'
import { useGen, useGenStream } from '../../store/gen'
import { Markdown } from '../../lib/md'
import { useT } from '../../i18n'
import { isComposingKey } from '../../lib/keys'

function ResultCard({
  r,
  index,
  added,
  onAdd
}: {
  r: SearchOutcome['results'][number]
  /** 列表序号（从 1 起）：AI 总结按这个号引用结果 */
  index: number
  added: AddState
  onAdd: () => void
}): JSX.Element {
  const t = useT()
  const open = (paperId: string): void => {
    void usePaper
      .getState()
      .loadPaper(paperId)
      .then(() => useApp.getState().setScreen('reader'))
  }

  const inLibrary = added && typeof added === 'object' && 'paperId' in added
  const busy = added && typeof added === 'object' && 'busy' in added ? added : null
  const mb = (n: number): string => (n / 1048576).toFixed(1)
  const busyLabel = busy
    ? busy.stage === 'import'
      ? t('search.parsing')
      : busy.total > 0
        ? t('search.downloading-pct', { pct: Math.round((busy.received / busy.total) * 100) })
        : busy.received > 0
          ? t('search.downloading-mb', { mb: mb(busy.received) })
          : t('search.connecting')
    : null

  return (
    <div className="search-card">
      <div className="search-card-main">
        <div className="search-card-meta">
          <span className="search-card-index">{index}</span>
          <span className="search-badge">{r.source}</span>
          {r.year && <span>{r.year}</span>}
          {r.citations !== null && <span>{t('search.cited', { n: r.citations })}</span>}
          {r.arxivId && <span>{r.arxivId}</span>}
        </div>
        <div className="search-card-title">{r.title}</div>
        {r.authors.length > 0 && (
          <div className="search-card-authors">{r.authors.slice(0, 4).join(', ')}</div>
        )}
        <div className="search-card-why">
          <span className="search-why-label">WHY</span>
          {/* 理由按界面语言组句；老结果没有 whyKind 时退回主进程给的中文 */}
          <span>
            {r.whyKind === 'hits' && r.whyHits?.length
              ? t('search.why-hits', { terms: r.whyHits.join(t('search.why-sep')) })
              : r.whyKind === 'cited'
                ? t('search.why-cited', { n: r.citations ?? 0 })
                : r.whyKind === 'related'
                  ? t('search.why-related')
                  : r.whyKind === 'id'
                    ? t('search.why-id')
                    : r.why}
          </span>
        </div>
        {added && typeof added === 'object' && 'error' in added && (
          <div className="search-card-error">{added.error}</div>
        )}
      </div>
      <div className="search-card-actions">
        {inLibrary ? (
          <button className="btn-accent" onClick={() => open(added.paperId)}>
            {t('common.open')}
          </button>
        ) : (
          <button className="btn-accent" onClick={onAdd} disabled={!!busy}>
            {busyLabel ?? t('search.add')}
          </button>
        )}
      </div>
    </div>
  )
}

/** AI 检索总结卡（结果末尾、虚线边框）。 */
function SearchSummaryCard({
  query,
  results
}: {
  query: string
  results: SearchResultInput[]
}): JSX.Element {
  const t = useT()
  const [result, setResult] = useState<{ text: string; model: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streaming = useGenStream('search-summary')
  // 推理模型在思考阶段不吐字：给一个跳动的秒数，让等待看得见
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (startedAt == null) return
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [startedAt])

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setElapsed(0)
    setStartedAt(Date.now())
    useGen.getState().clear('search-summary')
    try {
      setResult(await window.readarc.summarizeSearch(query, results))
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
      setStartedAt(null)
      useGen.getState().clear('search-summary')
    }
  }

  return (
    <div className="insight-card insight-card--dashed">
      <div className="summary-head">
        <span className="summary-label">{t('search.summary-label')}</span>
        {result && <span className="summary-meta">{result.model}</span>}
      </div>
      {result ? (
        <Markdown className="insight-text" text={result.text} />
      ) : busy && streaming ? (
        <Markdown className="insight-text insight-text--streaming" text={streaming} />
      ) : busy ? (
        <div className="insight-status">
          <span className="insight-status-dot" />
          <span>
            {t('search.summarizing')}
            {elapsed >= 3 && ` ${elapsed}s`}
          </span>
          {elapsed >= 8 && <span className="insight-status-hint">{t('search.summarizing-hint')}</span>}
        </div>
      ) : error ? (
        <div className="zh-error">
          <span>{error}</span>
          <button onClick={() => void run()}>{t('common.retry')}</button>
        </div>
      ) : (
        <button className="btn-accent" onClick={() => void run()} disabled={busy}>
          {busy ? t('search.summarizing') : t('search.which-first')}
        </button>
      )}
    </div>
  )
}

export function DiscoverScreen(): JSX.Element {
  const t = useT()
  const offline = useApp((s) => s.offline)
  const lang = useApp((s) => s.lang)
  // 状态在 store：切到别的屏再回来，检索结果与「加入库」进度都还在
  const query = useSearch((s) => s.query)
  const setQuery = useSearch((s) => s.setQuery)
  const outcome = useSearch((s) => s.outcome)
  const searching = useSearch((s) => s.searching)
  const added = useSearch((s) => s.added)
  const run = useSearch((s) => s.run)
  const add = useSearch((s) => s.add)

  return (
    <section className="screen">
      <div className="screen-body">
        <div className="search-content">
          <h1 className="search-title">{t('discover.title')}</h1>
          <p className="settings-note">{t('discover.hint')}</p>
          {offline && <div className="doc-notice">{t('offline.search')}</div>}
          <div className="search-box">
            <input
              value={query}
              placeholder={t('search.placeholder')}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isComposingKey(e) && void run()}
            />
            <button className="btn-accent" onClick={() => void run()} disabled={searching}>
              {searching ? t('search.searching') : t('search.go')}
            </button>
          </div>

          {outcome && (
            <div className="search-sources">
              {outcome.sources.map((s) => (
                <span
                  key={s.slug}
                  className={s.pending ? 'search-source-chip search-source-chip--pending' : 'search-source-chip'}
                  style={s.error ? { color: 'var(--vi)', borderColor: 'var(--vi)' } : undefined}
                  title={s.error ?? (s.pending ? t('search.source-pending') : undefined)}
                >
                  {s.name} {s.pending ? '…' : s.error ? '✕' : s.count}
                </span>
              ))}
              <span className="search-dedup">
                {t('search.deduped', { n: outcome.results.length })}
                {outcome.fromCache
                  ? t('search.from-cache')
                  : t('search.raw-count', { n: outcome.rawCount })}
              </span>
            </div>
          )}

          {outcome?.queryUsed && <p className="search-used">{t('search.used-en', { q: outcome.queryUsed })}</p>}

          {outcome?.results.length === 0 && (
            <p className="placeholder-note">
              {outcome.translateError
                ? t('search.translate-failed', { err: outcome.translateError })
                : outcome.sources.every((s) => s.error)
                  ? t('search.all-failed', {
                      // 各源的报错自带句号，模板后面还有一句：去掉结尾标点，别出现「。。」
                      errors: outcome.sources.map((s) => `${s.name} ${(s.error ?? '').replace(/[。.！!；;]+$/, '')}`).join(lang === 'zh' ? '；' : '; ')
                    })
                  : !outcome.queryUsed && isCjkDominant(query)
                  ? t('search.no-hits-cjk')
                  : t('search.no-hits', { sources: outcome.sources.map((s) => s.name).join(lang === 'zh' ? '、' : ', ') })}
            </p>
          )}

          <div className="search-results">
            {outcome?.results.map((r, i) => (
              <ResultCard key={r.id} r={r} index={i + 1} added={added[r.id]} onAdd={() => void add(r)} />
            ))}
          </div>
          {/* 总结卡等所有源都回来再出现：不该总结一半的结果 */}
          {outcome && outcome.results.length > 0 && !outcome.partial && (
            <SearchSummaryCard query={query} results={outcome.results} />
          )}
        </div>
      </div>
    </section>
  )
}
