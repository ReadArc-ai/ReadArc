/** 面板 → 对话：会话列表、消息流、内置提问、输入框与截图提问 */
import { useEffect, useRef, useState, type JSX } from 'react'
import { useApp } from '../../store/app'
import { usePaper } from '../../store/paper'
import { useChat, jumpToBlock, type ChatMessageUI } from '../../store/chat'
import { Markdown } from '../../lib/md'
import { formatTokens } from '../../lib/format'
import { confirmDialog } from '../../store/confirm'
import { useT } from '../../i18n'
import { ThinkingBlock } from './Thinking'
import { fileToPngDataUrl, imageFileFrom } from '../../lib/paste-image'
import { IconSend, IconStop } from '../shell/icons'
import { isBuiltinPersona } from '../../../shared/models'
import { BUILTIN_PRESETS, presetChipLabel } from '../../lib/persona-presets'
import { usePersonaName, PersonaPicker, ModelPicker } from './ChatPickers'
import { isComposingKey } from '../../lib/keys'


export const EMPTY_MESSAGES: ChatMessageUI[] = []
export const EMPTY_SESSIONS: import('../../../shared/models').ChatSession[] = []

/** 对话回答里的思考流：思考阶段（还没有正文）为 live */
export function ThinkingRow({ msg }: { msg: ChatMessageUI }): JSX.Element | null {
  return <ThinkingBlock thinking={msg.thinking} live={!!msg.pending && msg.text === ''} />
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 回答文本：Markdown 渲染；[B#] 标注转内联引用 chip（点击回跳原文）。
 *  未在 citations 里的标号是模型编的——宁可不给引用，也不给错引用。 */
export function AnswerText({ msg }: { msg: ChatMessageUI }): JSX.Element {
  const valid = new Map((msg.citations ?? []).map((c) => [c.order, c]))
  const withChips = msg.text.replace(/\[B(\d+)\]/g, (_all, n: string) => {
    const cite = valid.get(Number(n))
    if (!cite) return ''
    // 章节号后、页码两侧用不换行空格：chip 折行时只断在章节名的词之间，
    // 章节号总跟着第一个词，「· p.N」总跟着最后一个词
    const section = escapeHtml(cite.section ?? '§').replace(/^([\d.]+) /, '$1\u00a0')
    return ` <a class="cite-chip" data-cite="${cite.order}">${section}\u00a0·\u00a0p.${cite.page}</a>`
  })
  return <Markdown text={withChips} onCite={jumpToBlock} />
}

export function ChatTab(): JSX.Element {
  const paperId = usePaper((s) => s.bundle?.paper.id)
  const sessions = useChat((s) => (paperId ? s.sessionsByPaper[paperId] : undefined)) ?? EMPTY_SESSIONS
  const activeSessionId = useChat((s) => (paperId ? s.activeSessionByPaper[paperId] : undefined)) ?? null
  // 快照必须引用稳定：每次返回新 [] 会让 useSyncExternalStore 无限循环直至 React 崩溃
  const messages = useChat((s) => (activeSessionId ? s.messagesBySession[activeSessionId] : undefined)) ?? EMPTY_MESSAGES
  const loaded = useChat((s) => (paperId ? s.loadedPapers[paperId] : false))
  const loadingSessionId = useChat((s) => s.loadingSessionId)
  const historyError = useChat((s) => s.historyError)
  const loadSessions = useChat((s) => s.loadSessions)
  const selectSession = useChat((s) => s.selectSession)
  const newSession = useChat((s) => s.newSession)
  const deleteSession = useChat((s) => s.deleteSession)
  const renameSession = useChat((s) => s.renameSession)
  // 重命名：会话栏的下拉临时换成输入框，Enter 保存、Esc 取消、失焦保存
  const [renameDraft, setRenameDraft] = useState<string | null>(null)
  const renameRef = useRef<HTMLInputElement | null>(null)
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const startRename = (): void => {
    if (!activeSession) return
    setRenameDraft(activeSession.title ?? '')
    requestAnimationFrame(() => renameRef.current?.select())
  }
  const commitRename = (): void => {
    if (renameDraft === null || !paperId || !activeSessionId) return
    const next = renameDraft.trim()
    setRenameDraft(null)
    if (next !== (activeSession?.title ?? '')) void renameSession(paperId, activeSessionId, next)
  }
  const asking = useChat((s) => s.asking)
  const ask = useChat((s) => s.ask)
  const stop = useChat((s) => s.stop)
  const quote = useChat((s) => s.quote)
  const image = useChat((s) => s.image)
  const setImage = useChat((s) => s.setImage)
  const clearQuote = useChat((s) => s.clearQuote)
  const persona = useChat((s) => s.persona)
  const customPersonas = useChat((s) => s.customPersonas)
  const personaName = usePersonaName()
  const t = useT()
  const [input, setInput] = useState('')
  // 靠下停靠：对话页三栏（会话列表 | 消息 | 输入），会话栏改成左侧列表
  const bottomDock = useApp((s) => s.panelDock === 'bottom' && s.tier !== 'sm')
  const removeActive = (): void => {
    if (!paperId || !activeSessionId) return
    void confirmDialog(t('panel.chat.delete-confirm'), { confirmLabel: t('common.delete'), danger: true }).then((ok) => {
      if (ok) void deleteSession(paperId, activeSessionId)
    })
  }
  const pencil = (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11.5 2.5l2 2L6 12H4v-2z" />
      <path d="M3 14h10" />
    </svg>
  )
  const renameInput = (
    <input
      ref={renameRef}
      className="chat-session-rename"
      value={renameDraft ?? ''}
      placeholder={t('panel.chat.rename-ph')}
      maxLength={80}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setRenameDraft(e.target.value)}
      onBlur={commitRename}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isComposingKey(e)) commitRename()
        else if (e.key === 'Escape') setRenameDraft(null)
        e.stopPropagation()
      }}
    />
  )
  const listRef = useRef<HTMLDivElement | null>(null)

  // 当前讲法的内置提问：内置讲法查表；自定义讲法用设置里逐行填的提问，没填就用通用的一条
  const customPresets = customPersonas.find((c) => c.id === persona)?.presets ?? []
  const presets = isBuiltinPersona(persona)
    ? BUILTIN_PRESETS[persona].map((p) => ({ label: t(p.label), q: t(p.q), whole: p.whole }))
    : customPresets.length > 0
      ? customPresets.map((q) => ({ label: presetChipLabel(q), q, whole: true }))
      : [{ label: t('panel.preset.custom.label'), q: t('panel.preset.custom'), whole: true }]
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const atBottom = useRef(true)

  useEffect(() => {
    if (paperId) void loadSessions(paperId)
  }, [paperId, loadSessions])

  // 「问」塞入引用 / ⌘L 后聚焦输入框
  const focusNonce = useChat((s) => s.focusNonce)
  useEffect(() => {
    if (focusNonce > 0) inputRef.current?.focus()
  }, [focusNonce])

  // 流式贴底：用户上滚后不再自动贴底，回到底部恢复
  useEffect(() => {
    const el = listRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const submit = (): void => {
    if ((!input.trim() && !image) || asking) return
    void ask(input)
    setInput('')
  }

  return (
    <div className="chat-tab">
      {/* 会话栏：靠右停靠时是顶部一条（下拉 + 按钮）；靠下停靠时是左侧一列会话列表 */}
      {bottomDock ? (
        <div className="chat-sessions">
          <div className="chat-sessions-head">
            <span>{t('panel.chat.history')}</span>
            <button
              className="chat-session-action"
              disabled={asking || !paperId}
              onClick={() => paperId && newSession(paperId)}
              title={t('panel.chat.new')}
              aria-label={t('panel.chat.new')}
            >
              ＋
            </button>
          </div>
          <div className="chat-sessions-list">
            {!activeSessionId && <div className="chat-session-row is-on">{t('panel.chat.new')}</div>}
            {sessions.map((session) => {
              const on = session.id === activeSessionId
              return (
                <div
                  key={session.id}
                  className={on ? 'chat-session-row is-on' : 'chat-session-row'}
                  onClick={() => {
                    if (!paperId || on || asking) return
                    void selectSession(paperId, session.id)
                  }}
                >
                  {on && renameDraft !== null ? (
                    renameInput
                  ) : (
                    <span className="chat-session-title">{session.title || t('panel.chat.untitled')}</span>
                  )}
                  {on && renameDraft === null && (
                    <span className="chat-session-row-actions">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          startRename()
                        }}
                        title={t('panel.chat.rename')}
                        aria-label={t('panel.chat.rename')}
                      >
                        {pencil}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeActive()
                        }}
                        title={t('panel.chat.delete')}
                        aria-label={t('panel.chat.delete')}
                      >
                        ×
                      </button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="chat-session-bar">
          {renameDraft !== null ? (
            renameInput
          ) : (
            <span className="chat-session-picker" title={t('panel.chat.history')}>
              <select
                value={activeSessionId ?? '__new__'}
                disabled={asking || !paperId}
                onChange={(e) => {
                  if (!paperId) return
                  if (e.target.value === '__new__') newSession(paperId)
                  else void selectSession(paperId, e.target.value)
                }}
              >
                {!activeSessionId && <option value="__new__">{t('panel.chat.new')}</option>}
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title || t('panel.chat.untitled')}
                  </option>
                ))}
              </select>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 4.5l3 3 3-3" />
              </svg>
            </span>
          )}
          <button
            className="chat-session-action"
            disabled={asking || !paperId}
            onClick={() => paperId && newSession(paperId)}
            title={t('panel.chat.new')}
            aria-label={t('panel.chat.new')}
          >
            ＋
          </button>
          <button
            className="chat-session-action chat-session-action--icon"
            disabled={asking || !paperId || !activeSessionId || renameDraft !== null}
            onClick={startRename}
            title={t('panel.chat.rename')}
            aria-label={t('panel.chat.rename')}
          >
            {pencil}
          </button>
          <button
            className="chat-session-action"
            disabled={asking || !paperId || !activeSessionId}
            onClick={removeActive}
            title={t('panel.chat.delete')}
            aria-label={t('panel.chat.delete')}
          >
            ×
          </button>
        </div>
      )}
      <div
        className="chat-list"
        ref={listRef}
        onScroll={() => {
          const el = listRef.current
          if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {/* 讲法只在 composer 底栏切换一处，空状态不再重复摆一排 */}
        {(!loaded || (activeSessionId && loadingSessionId === activeSessionId)) && (
          <p className="placeholder-note">{t('panel.chat.loading')}</p>
        )}
        {loaded && loadingSessionId !== activeSessionId && messages.length === 0 && (
          <p className="placeholder-note">{t('panel.chat.empty')}</p>
        )}
        {historyError && <div className="zh-error"><span>{historyError}</span></div>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg--${m.role}`}>
            {m.role === 'user' && m.persona && (
              <span className="chat-msg-tag">{personaName(m.persona)}</span>
            )}
            {m.image && <img className="chat-msg-img" src={m.image} alt="" />}
            {m.role === 'assistant' && <ThinkingRow msg={m} />}
            {m.role === 'assistant' ? <AnswerText msg={m} /> : m.text}
            {m.pending && m.text === '' && !m.thinking && <span className="chat-cursor">▍</span>}
            {m.error && <div className="zh-error"><span>{m.error}</span></div>}
            {m.hops && m.hops.length > 0 && (
              <div className="chat-hops">{m.hops.join('；')}</div>
            )}
            {(m.model || m.stopped) && (
              // 每轮就地可见：哪个模型答的 + token 数，不显金额（金额在左栏用量块与设置成本页里看）
              <div className="chat-model">
                {m.stopped && t('panel.stopped')}
                {m.stopped && m.model && ' · '}
                {m.model}
                {m.tokens !== undefined && m.tokens > 0 ? ` · ${formatTokens(m.tokens)} tok` : ''}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="chat-input-area">
        {image && (
          <div className="chat-attach">
            <img src={image} alt="" />
            <span>{t('panel.attach-image')}</span>
            <button onClick={() => setImage(null)} title={t('common.remove')}>×</button>
          </div>
        )}
        {quote && (
          <div className="chat-quote">
            <span>{quote.slice(0, 120)}…</span>
            <button onClick={clearQuote}>×</button>
          </div>
        )}
        <div className="chat-presets">
          {presets.map((p) => (
            <button key={p.q} title={p.q} onClick={() => void ask(p.q, { whole: p.whole })} disabled={asking}>
              {p.label}
            </button>
          ))}
        </div>
        {/* composer：输入区 + 底栏（模型切换 / 发送或停止）装在同一个框里，
            和常见 AI 对话产品一致；发送中按钮变成「停止」，已生成的部分会保留 */}
        <div className="chat-composer">
          <textarea
            className="chat-input"
            ref={inputRef}
            rows={2}
            placeholder={
              persona === 'default'
                ? t('panel.chat.placeholder')
                : t('panel.chat.placeholder.persona', { mode: personaName(persona) })
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !isComposingKey(e)) {
                e.preventDefault()
                submit()
              }
            }}
            // 系统截图工具截完直接粘贴 / 把图片文件拖进来：都当截图附件
            onPaste={(e) => {
              const f = imageFileFrom(e.clipboardData)
              if (!f) return
              e.preventDefault()
              void fileToPngDataUrl(f).then(setImage).catch(() => {})
            }}
            onDragOver={(e) => {
              if (imageFileFrom(e.dataTransfer)) e.preventDefault()
            }}
            onDrop={(e) => {
              const f = imageFileFrom(e.dataTransfer)
              if (!f) return
              e.preventDefault()
              e.stopPropagation()
              void fileToPngDataUrl(f).then(setImage).catch(() => {})
            }}
          />
          <div className="chat-composer-bar">
            <PersonaPicker />
            <ModelPicker />
            {asking ? (
              <button className="chat-send chat-send--stop" onClick={stop} title={t('panel.stop')}>
                <IconStop />
              </button>
            ) : (
              <button className="chat-send" onClick={submit} disabled={!input.trim() && !image} title={t('panel.send')}>
                <IconSend />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
