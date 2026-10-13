/**
 * 编辑论文信息：标题、中文标题、作者、年份、来源、DOI / arXiv 号与标签。
 * 本地导入的 PDF 只有版面识别出的标题，其余字段为空；填了编号可以一键从公开来源补全。
 * 只改数据库，不动 PDF 文件。主进程写库前会再校验一遍。
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import type { PaperRow } from '../../../shared/models'
import { MAX_TAGS, normalizeTags, splitAuthors } from '../../../shared/paper-meta'
import { useT } from '../../i18n'
import { errText } from '../../lib/errors'
import { useLibrary } from '../../store/library'

function parseAuthors(json: string | null): string[] {
  try {
    const v = JSON.parse(json ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string') : []
  } catch {
    return []
  }
}

export function PaperEditDialog(): JSX.Element | null {
  const editing = useLibrary((s) => s.editing)
  const paper = useLibrary((s) => s.papers.find((p) => p.id === s.editing))
  if (!editing || !paper) return null
  // key：换一篇论文编辑时表单整体重建，不残留上一篇的输入
  return <EditForm key={paper.id} paper={paper} />
}

function EditForm({ paper }: { paper: PaperRow }): JSX.Element {
  const t = useT()
  const close = (): void => useLibrary.getState().setEditing(null)
  const [title, setTitle] = useState(paper.title ?? '')
  const [titleZh, setTitleZh] = useState(paper.title_zh ?? '')
  const [authors, setAuthors] = useState(parseAuthors(paper.authors).join(', '))
  const [year, setYear] = useState(paper.year != null ? String(paper.year) : '')
  const [source, setSource] = useState(paper.source ?? '')
  const [doi, setDoi] = useState(paper.doi ?? '')
  const [arxiv, setArxiv] = useState(paper.arxiv_id ?? '')
  const [tags, setTags] = useState<string[]>(paper.tags ?? [])
  const [tagDraft, setTagDraft] = useState('')
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const tagInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    titleRef.current?.select()
  }, [])

  const addTag = (raw: string): void => {
    const next = normalizeTags([...tags, ...raw.split(/[,，]/)])
    setTags(next)
    setTagDraft('')
  }

  const save = async (): Promise<void> => {
    if (busy) return
    if (!title.trim()) {
      setStatus({ text: t('meta.title-required'), error: true })
      titleRef.current?.focus()
      return
    }
    const y = Number.parseInt(year, 10)
    setBusy(true)
    try {
      await useLibrary.getState().updateMeta(paper.id, {
        title: title.trim(),
        title_zh: titleZh.trim() || null,
        authors: splitAuthors(authors),
        year: Number.isFinite(y) ? y : null,
        source: source.trim() || null,
        doi: doi.trim() || null,
        arxiv_id: arxiv.trim() || null,
        // 输入框里还没回车的那个标签也算上
        tags: normalizeTags([...tags, ...tagDraft.split(/[,，]/)])
      })
      close()
    } catch (err) {
      setStatus({ text: errText(err), error: true })
    } finally {
      setBusy(false)
    }
  }

  const lookup = async (): Promise<void> => {
    setBusy(true)
    setStatus({ text: t('meta.looking'), error: false })
    try {
      const hit = await window.readarc.lookupPaperMeta({ doi: doi.trim() || null, arxiv_id: arxiv.trim() || null })
      if (hit.title) setTitle(hit.title)
      if (hit.authors.length > 0) setAuthors(hit.authors.join(', '))
      if (hit.year != null) setYear(String(hit.year))
      if (hit.source) setSource(hit.source)
      if (hit.doi) setDoi(hit.doi)
      if (hit.arxiv_id) setArxiv(hit.arxiv_id)
      setStatus({ text: t('meta.filled'), error: false })
    } catch (err) {
      setStatus({ text: errText(err), error: true })
    } finally {
      setBusy(false)
    }
  }

  // Esc 关闭；捕获阶段监听，压过论文库搜索框自己的 Esc 处理
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // 普通输入框里回车即保存（输入法组字中的回车不算）
  const onFieldKey = (e: React.KeyboardEvent): void => {
    e.stopPropagation()
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void save()
    }
  }

  const field = (label: string, value: string, set: (v: string) => void, opts: { placeholder?: string; mono?: boolean; ref?: React.Ref<HTMLInputElement> } = {}): JSX.Element => (
    <>
      <span className="meta-label">{label}</span>
      <input
        ref={opts.ref}
        className={opts.mono ? 'set-input meta-input meta-input--mono' : 'set-input meta-input'}
        value={value}
        placeholder={opts.placeholder}
        onChange={(e) => set(e.target.value)}
        onKeyDown={onFieldKey}
      />
    </>
  )

  return (
    <div className="dlg-overlay" onMouseDown={close}>
      <div className="dlg meta-dlg" role="dialog" aria-modal="true" aria-labelledby="meta-dlg-title" onMouseDown={(e) => e.stopPropagation()}>
        <p className="dlg-title" id="meta-dlg-title">
          {t('meta.title')}
        </p>
        <div className="meta-form">
          {field(t('meta.f.title'), title, setTitle, { ref: titleRef })}
          {field(t('meta.f.title-zh'), titleZh, setTitleZh)}
          {field(t('meta.f.authors'), authors, setAuthors, { placeholder: t('meta.f.authors-ph') })}
          <span className="meta-label">{t('meta.f.year')}</span>
          <span className="meta-row">
            <input
              className="set-input meta-input meta-input--year"
              value={year}
              inputMode="numeric"
              onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={onFieldKey}
            />
            <span className="meta-label meta-label--inline">{t('meta.f.source')}</span>
            <input
              className="set-input meta-input"
              value={source}
              placeholder={t('meta.f.source-ph')}
              onChange={(e) => setSource(e.target.value)}
              onKeyDown={onFieldKey}
            />
          </span>
          {field(t('meta.f.doi'), doi, setDoi, { mono: true, placeholder: '10.xxxx/…' })}
          <span className="meta-label">{t('meta.f.arxiv')}</span>
          <span className="meta-row">
            <input
              className="set-input meta-input meta-input--mono"
              value={arxiv}
              placeholder="2401.12345"
              onChange={(e) => setArxiv(e.target.value)}
              onKeyDown={onFieldKey}
            />
            <button className="set-btn" title={t('meta.lookup-tip')} disabled={busy || (!doi.trim() && !arxiv.trim())} onClick={() => void lookup()}>
              {t('meta.lookup')}
            </button>
          </span>
          <span className="meta-label">{t('meta.f.tags')}</span>
          {/* 点标签框的空白处也落到输入框上，和普通输入框一样 */}
          <span className="meta-tags" onClick={(e) => e.target === e.currentTarget && tagInputRef.current?.focus()}>
            {tags.map((tag) => (
              <span key={tag} className="meta-tag">
                {tag}
                <button className="meta-tag-x" title={t('meta.remove-tag')} onClick={() => setTags(tags.filter((x) => x !== tag))}>
                  ×
                </button>
              </span>
            ))}
            {tags.length < MAX_TAGS && (
              <input
                ref={tagInputRef}
                className="meta-tag-input"
                value={tagDraft}
                placeholder={tags.length === 0 ? t('meta.f.tags-ph') : ''}
                onChange={(e) => {
                  // 粘贴或输入逗号：逗号前的部分直接成标签
                  if (/[,，]/.test(e.target.value)) addTag(e.target.value)
                  else setTagDraft(e.target.value)
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    if (tagDraft.trim()) addTag(tagDraft)
                    else void save()
                  } else if (e.key === 'Backspace' && !tagDraft && tags.length > 0) {
                    setTags(tags.slice(0, -1))
                  }
                }}
              />
            )}
          </span>
        </div>
        <div className="meta-foot">
          <span className={status?.error ? 'meta-status is-error' : 'meta-status'}>{status?.text}</span>
          <div className="dlg-actions">
            <button className="dlg-btn" onClick={close}>
              {t('common.cancel')}
            </button>
            <button className="dlg-btn dlg-btn--primary" disabled={busy} onClick={() => void save()}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
