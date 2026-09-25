/** 设置 → 讲法：对话人设的内置预设与自定义 */
import { useState, type JSX } from 'react'
import { CHAT_PERSONAS, type CustomPersona } from '../../../shared/models'
import { useT } from '../../i18n'
import { useChat } from '../../store/chat'
import { BUILTIN_PRESETS, parsePresetLines } from '../../lib/persona-presets'
import { Section, Row, IconPersona } from './shared'


export function PersonaForm({
  initial,
  onSave,
  onCancel
}: {
  initial: CustomPersona
  onSave: (p: CustomPersona) => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  const [name, setName] = useState(initial.name)
  const [style, setStyle] = useState(initial.style)
  const [presetText, setPresetText] = useState((initial.presets ?? []).join('\n'))
  const [error, setError] = useState<string | null>(null)
  const submit = (): void => {
    if (!name.trim() || !style.trim()) {
      setError(t('set.persona-err'))
      return
    }
    const presets = parsePresetLines(presetText)
    onSave({
      id: initial.id || `custom-${Date.now().toString(36)}`,
      name: name.trim(),
      style: style.trim(),
      ...(presets.length > 0 ? { presets } : {})
    })
  }
  return (
    <Row
      title={initial.id ? initial.name : t('set.persona-new')}
      desc={error ?? t('set.persona-form-hint')}
      below={
        <div className="set-edit-form set-edit-form--stack">
          <input
            className="set-input"
            placeholder={t('set.persona-ph-name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            className="set-input set-textarea"
            rows={6}
            placeholder={t('set.persona-ph-style')}
            value={style}
            onChange={(e) => setStyle(e.target.value)}
          />
          <textarea
            className="set-input set-textarea set-textarea--short"
            rows={3}
            placeholder={t('set.persona-ph-presets')}
            value={presetText}
            onChange={(e) => setPresetText(e.target.value)}
          />
          <div className="set-edit-actions">
            <button className="btn-accent" onClick={submit}>
              {t('common.save')}
            </button>
            <button className="set-btn" onClick={onCancel}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      }
    />
  )
}

export function PersonasTab(): JSX.Element {
  const t = useT()
  const current = useChat((s) => s.persona)
  const custom = useChat((s) => s.customPersonas)
  const setPersona = useChat((s) => s.setPersona)
  const savePersona = useChat((s) => s.savePersona)
  const removePersona = useChat((s) => s.removePersona)
  // 正在编辑的一条；id 为空串表示新建
  const [editing, setEditing] = useState<CustomPersona | null>(null)
  const save = (p: CustomPersona): void => {
    savePersona(p)
    setEditing(null)
  }
  return (
    <>
      <Section icon={<IconPersona />} title={t('set.personas')}>
        <Row
          title={t('set.personas-current')}
          desc={t('set.personas-desc')}
          action={
            <select className="set-select" value={current} onChange={(e) => setPersona(e.target.value)}>
              {CHAT_PERSONAS.map((p) => (
                <option key={p} value={p}>
                  {t(`panel.persona.${p}`)}
                </option>
              ))}
              {custom.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          }
        />
      </Section>
      <Section icon={<IconPersona />} title={t('set.personas-builtin')}>
        {CHAT_PERSONAS.filter((p) => p !== 'default').map((p) => (
          <Row
            key={p}
            title={t(`panel.persona.${p}`)}
            desc={t(`set.persona-desc.${p}`)}
            hint={t('set.persona-presets', {
              list: BUILTIN_PRESETS[p].map((x) => t(x.label)).join(' · ')
            })}
          />
        ))}
      </Section>
      <Section
        icon={<IconPersona />}
        title={t('set.personas-custom')}
        meta={custom.length > 0 ? String(custom.length) : undefined}
        aside={
          !editing && (
            <button className="set-btn" onClick={() => setEditing({ id: '', name: '', style: '' })}>
              {t('common.add')}
            </button>
          )
        }
      >
        {custom.length === 0 && !editing && (
          <Row title={t('set.personas-empty')} desc={t('set.personas-empty-desc')} />
        )}
        {custom.map((p) =>
          editing?.id === p.id ? (
            <PersonaForm key={p.id} initial={p} onSave={save} onCancel={() => setEditing(null)} />
          ) : (
            <Row
              key={p.id}
              title={p.name}
              desc={p.style}
              hint={
                p.presets && p.presets.length > 0
                  ? t('set.persona-presets', { list: p.presets.join(' · ') })
                  : t('set.persona-presets-default')
              }
              action={
                <>
                  <button className="set-btn" onClick={() => setEditing(p)}>
                    {t('common.edit')}
                  </button>
                  <button className="set-btn" onClick={() => removePersona(p.id)}>
                    {t('common.delete')}
                  </button>
                </>
              }
            />
          )
        )}
        {editing && editing.id === '' && (
          <PersonaForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />
        )}
      </Section>
    </>
  )
}
