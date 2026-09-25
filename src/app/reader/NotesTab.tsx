/** 面板 → 笔记：高亮与笔记条目、AI 生成阅读笔记 */
import { useEffect, useState, type JSX } from 'react'
import { errText } from '../../lib/errors'
import { GEN_ABORTED } from '../../../shared/ipc'
import { usePaper } from '../../store/paper'
import { jumpToBlock } from '../../store/chat'
import { useGen, useGenStream } from '../../store/gen'
import { Markdown } from '../../lib/md'
import { useNotes } from '../../store/notes'
import { confirmDialog } from '../../store/confirm'
import { useT } from '../../i18n'
import { StreamBox } from './StreamBox'
import { ThinkingBlock } from './Thinking'
import { isComposingKey } from '../../lib/keys'


export function NotesTab(): JSX.Element {
  const bundle = usePaper((s) => s.bundle)
  const paperId = bundle?.paper.id
  const notes = useNotes((s) => (paperId ? s.byPaper[paperId] : undefined))
  const composerBlockId = useNotes((s) => s.composerBlockId)
  const load = useNotes((s) => s.load)
  const submit = useNotes((s) => s.submit)
  const cancel = useNotes((s) => s.cancelComposer)
  const removeNote = useNotes((s) => s.removeNote)
  const t = useT()
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (paperId) void load(paperId)
  }, [paperId, load])

  const orderOf = (blockId: string): number | null =>
    bundle?.blocks.find((b) => b.block_id === blockId)?.block_order ?? null

  const composerSelection = useNotes((s) => s.composerSelection)
  const genDraft = useGenStream('notes', paperId)
  const genThinking = useGenStream('notes:thinking', paperId)
  const composerBlock = composerBlockId
    ? bundle?.blocks.find((b) => b.block_id === composerBlockId)
    : null

  // AI 阅读笔记（原在工具栏）：产出要点条目落盘到本文的笔记文件；流式草稿边生成边看
  const [genBusy, setGenBusy] = useState(false)
  const layoutPending = usePaper((s) => s.bundle?.paper.layout_state === 'pending')
  const [genError, setGenError] = useState<string | null>(null)
  const genNotes = async (): Promise<void> => {
    if (!paperId || genBusy) return
    setGenBusy(true)
    setGenError(null)
    useGen.getState().clear('notes')
    useGen.getState().clear('notes:thinking')
    try {
      await window.readarc.generateNotes(paperId)
      await load(paperId)
    } catch (err) {
      // 用户自己按的停止：安静回到待命态
      if (!errText(err).includes(GEN_ABORTED)) setGenError(errText(err))
    } finally {
      setGenBusy(false)
      useGen.getState().clear('notes')
      useGen.getState().clear('notes:thinking')
    }
  }

  return (
    <div className="notes-tab">
      {/* 头部：条数 + 右侧的 AI 生成（次级按钮，别抢过用户自己的笔记） */}
      <div className="notes-head">
        <span className="notes-count">{t('notes.count', { n: notes?.entries.length ?? 0 })}</span>
        <button
          className="set-btn"
          disabled={genBusy || layoutPending}
          onClick={() => void genNotes()}
          title={genError ?? t('reader.gen-notes.title')}
          style={genError ? { borderColor: 'var(--vi)', color: 'var(--vi)' } : undefined}
        >
          {genBusy ? t('doc.generating') : genError ? t('reader.retry') : t('reader.gen-notes')}
        </button>
        {/* 供应商挂住时至少能退出来 */}
        {genBusy && paperId && (
          <button className="set-btn" onClick={() => window.readarc.stopGen('notes', paperId)}>
            {t('common.stop')}
          </button>
        )}
      </div>
      <div className="notes-list">
        {composerBlock && (
          <div className="note-composer">
            <blockquote>{(composerSelection ?? composerBlock.text).slice(0, 120)}…</blockquote>
            <textarea
              rows={3}
              autoFocus
              placeholder={t('notes.placeholder')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isComposingKey(e)) {
                  e.preventDefault()
                  void submit(draft).then(() => setDraft(''))
                }
                if (e.key === 'Escape') cancel()
              }}
            />
            <div className="note-composer-actions">
              <button className="btn-accent" onClick={() => void submit(draft).then(() => setDraft(''))}>
                {t('notes.save')}
              </button>
              <button className="route-cancel" onClick={cancel}>
                {t('notes.cancel')}
              </button>
            </div>
          </div>
        )}
        {(genDraft != null || genThinking != null) && (
          <div className="note-item note-item--streaming">
            <div className="summary-head">
              <span className="summary-label">{t('panel.gen-label')}</span>
            </div>
            <ThinkingBlock thinking={genThinking} live={!genDraft} />
            {genDraft != null && <StreamBox className="note-text" text={genDraft} />}
          </div>
        )}
        {(!notes || notes.entries.length === 0) && !composerBlock && genDraft == null && genThinking == null && (
          <div className="notes-empty">
            <p className="notes-empty-title">{t('notes.empty-title')}</p>
            <p className="placeholder-note">{t('notes.empty')}</p>
          </div>
        )}
        {notes?.entries.map((n) => {
          // AI 生成的笔记：gen.ts 写成「**AI 阅读笔记**（模型）\n\n正文」，锚在全文首块——
          // 首块摘录（大写标题）对读者没意义，换成一个来源标识
          // 标题随目标语言写：中文「AI 阅读笔记」，其余语言「AI reading notes」
          const ai = /^\*\*(?:AI 阅读笔记|AI reading notes)\*\*（(.+?)）\n\n([\s\S]*)$/.exec(n.text)
          return (
            <div key={n.anchorId} className={ai ? 'note-item note-item--ai' : 'note-item'}>
              {ai ? (
                <span className="note-kind" title={t('panel.answered-by', { model: ai[1] })}>
                  {t('notes.ai-kind')}
                </span>
              ) : (
                n.anchor && (
                  <button
                    className="note-anchor"
                    title={t('notes.anchor-tip')}
                    onClick={() => {
                      const order = orderOf(n.anchor!.block_id)
                      if (order !== null) jumpToBlock(order)
                    }}
                  >
                    {n.anchor.excerpt.slice(0, 80)}…
                  </button>
                )
              )}
              <Markdown className="note-text" text={ai ? ai[2] : n.text} />
              <span className="note-stamp">{n.stamp}</span>
              {/* 删除：笔记文件是用户的，删的是文件里的一节，先确认 */}
              <button
                className="note-del"
                title={t('notes.delete')}
                aria-label={t('notes.delete')}
                onClick={() => {
                  void confirmDialog(t('notes.delete-confirm'), { confirmLabel: t('common.delete'), danger: true }).then((ok) => {
                    if (ok) void removeNote(n.anchorId)
                  })
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      {notes && notes.file && (
        <div className="notes-footer" title={t('notes.footer-hint')}>
          {notes.file}
        </div>
      )}
    </div>
  )
}
