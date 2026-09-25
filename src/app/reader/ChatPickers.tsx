/** 对话框底部的两个切换器：讲法（读者人设）与模型 */
import { type JSX } from 'react'
import { useApp } from '../../store/app'
import { useChat } from '../../store/chat'
import { useT } from '../../i18n'
import { useModels } from '../../store/models'
import { useModelOptions } from '../../lib/use-model-options'
import { CHAT_PERSONAS, isBuiltinPersona } from '../../../shared/models'


/** 讲法 id → 显示名：内置的走词典，自定义的用用户起的名字 */
export function usePersonaName(): (id: string) => string {
  const t = useT()
  const custom = useChat((s) => s.customPersonas)
  return (id) => (isBuiltinPersona(id) ? t(`panel.persona.${id}`) : (custom.find((c) => c.id === id)?.name ?? id))
}

export const MANAGE_PERSONAS = '__manage__'
export const CONNECT_MODEL = '__connect__'

/**
 * 讲法切换器（模型切换器左侧）：换一种读者人设讲这篇论文——
 * 内置的太奶模式 / 小学生 / 一步不跳 / 导师预演 / 审稿人挑刺，加上用户在设置里自定义的。
 * 只改讲解方式，引用规则不变；选择全局记住。末项「管理讲法…」跳设置页。
 */
export function PersonaPicker(): JSX.Element {
  const t = useT()
  const persona = useChat((s) => s.persona)
  const custom = useChat((s) => s.customPersonas)
  const setPersona = useChat((s) => s.setPersona)
  const onChange = (v: string): void => {
    if (v === MANAGE_PERSONAS) useApp.getState().setSettingsOpen(true, 'personas')
    else setPersona(v)
  }
  return (
    <span className="model-picker model-picker--persona" title={t('panel.persona.tip')}>
      <select value={persona} onChange={(e) => onChange(e.target.value)}>
        {CHAT_PERSONAS.map((p) => (
          <option key={p} value={p}>
            {t(`panel.persona.${p}`)}
          </option>
        ))}
        {custom.length > 0 && (
          <optgroup label={t('panel.persona.custom-group')}>
            {custom.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        )}
        <option value={MANAGE_PERSONAS}>{t('panel.persona.manage')}</option>
      </select>
      <svg className="model-picker-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 4.5l3 3 3-3" />
      </svg>
    </span>
  )
}

/**
 * 默认模型切换器（对话框底部）：
 * 改的是 config 里的 main:——对话、摘要、阅读笔记、翻译默认都走它；
 * 在设置里单独指定了模型的功能不受影响。与设置页「默认模型」是同一个值。
 */
export function ModelPicker(): JSX.Element | null {
  const t = useT()
  const state = useModels((s) => s.state)
  const saveMainModel = useModels((s) => s.saveMainModel)
  const { usable, lists } = useModelOptions()

  if (!state) return null
  const cur = state.mainModel
  const value = cur ? `${cur.provider}::${cur.model}` : ''
  // 当前模型不在任何列表里（列表拉取失败、或手填的模型名）时也要显示出来，
  // 否则 select 会静默落到第一项，看起来像换了模型
  const listed = cur ? (lists[cur.provider] ?? []).includes(cur.model) : true
  const curLabel = cur
    ? cur.model || state.providers.find((p) => p.slug === cur.provider)?.name || cur.provider
    : ''

  const onChange = (v: string): void => {
    if (v === CONNECT_MODEL) {
      useApp.getState().setSettingsOpen(true, 'models')
      return
    }
    const [provider, model] = v.split('::')
    if (!provider) return
    void saveMainModel(provider, model ?? '')
  }
  // 一个能用的模型都没有（第一次启动、没填 Key）：下拉里给一条「去接入」，点了直接到接入页
  const nothingUsable = !usable.some((p) => (lists[p.slug] ?? []).length > 0)

  return (
    <span className="model-picker" title={t('panel.model-tip')}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {!cur && <option value="">{t('panel.pick-model')}</option>}
        {nothingUsable && <option value={CONNECT_MODEL}>{t('panel.connect-model')}</option>}
        {cur && !listed && <option value={value}>{curLabel}</option>}
        {usable
          .filter((p) => (lists[p.slug] ?? []).length > 0)
          .map((p) => (
            <optgroup key={p.slug} label={p.name}>
              {(lists[p.slug] ?? []).map((m) => (
                <option key={m} value={`${p.slug}::${m}`}>
                  {m}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
      <svg className="model-picker-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 4.5l3 3 3-3" />
      </svg>
    </span>
  )
}
