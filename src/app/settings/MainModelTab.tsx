/** 设置 → 模型：默认模型、推理开关、按功能指定模型、花费 */
import { useEffect, useState, type JSX } from 'react'
import { useT, type I18nKey } from '../../i18n'
import { useModels } from '../../store/models'
import { useApp } from '../../store/app'
import { formatTokens, formatUsd } from '../../lib/format'
import { IconChip, IconRoute, IconCoin, Section, Row } from './shared'


/* ---- 按功能指定模型 ---- */

/**
 * 设置页里暴露的任务槽位：全文翻译、AI 摘要、AI 阅读笔记——每个用到模型的功能
 * 都能在这里单独指定，不指定就跟随默认模型。对话本身用默认模型（对话框底部也能切）。
 * glossary / outline / compare 至今没有任何代码路径读取，不摆出来；配置文件里的
 * tasks: 块仍兼容解析这些键。
 */
export const ROUTE_SLOTS = ['translate', 'summary', 'notes'] as const
export type ConfigurableSlot = (typeof ROUTE_SLOTS)[number]

export const SLOT_KEYS: Record<ConfigurableSlot, { title: I18nKey; desc: I18nKey }> = {
  translate: { title: 'set.slot.translate', desc: 'set.slot.translate.desc' },
  summary: { title: 'set.slot.summary', desc: 'set.slot.summary.desc' },
  notes: { title: 'set.slot.notes', desc: 'set.slot.notes.desc' }
}

/* ---- 默认模型（与对话框底部的切换器是同一个值） ---- */

export function MainModelTab(): JSX.Element {
  const t = useT()
  const { state, load } = useModels()
  const cur = state?.mainModel
  const [provider, setProvider] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  // 模型列表带上归属的 provider，busy 由「已加载 ≠ 当前」派生——
  // 避免 effect 里同步 setState（级联渲染，react-hooks/set-state-in-effect）
  const [loaded, setLoaded] = useState<{ prov: string; models: string[] } | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const prov = provider ?? cur?.provider ?? ''
  const modelDraft = model ?? cur?.model ?? ''
  const detected = useModels((s) => s.detected)
  // 内置本地端点只有真在运行才算可用；自定义端点由用户显式配置，保留
  const usable =
    state?.providers.filter((p) =>
      p.local && p.official
        ? (detected?.some((d) => d.slug === p.slug) ?? false)
        : p.hasKey || p.local
    ) ?? []

  useEffect(() => {
    if (!prov) return
    let stale = false
    window.readarc
      .listProviderModels(prov)
      .then((ms) => {
        if (!stale) setLoaded({ prov, models: ms })
      })
      .catch(() => {
        if (!stale) setLoaded({ prov, models: [] })
      })
    return () => {
      stale = true
    }
  }, [prov])
  const models = loaded?.prov === prov ? loaded.models : []
  const busy = prov !== '' && loaded?.prov !== prov

  // 选完即存：下拉里选中模型、或手填模型名后回车 / 离开输入框，都直接写入，不需要再点保存
  const commit = async (nextProv: string, nextModel: string): Promise<void> => {
    const m = nextModel.trim()
    if (!nextProv || !m) return
    if (nextProv === cur?.provider && m === cur?.model) return
    await window.readarc.saveMainModel(nextProv, m)
    await load()
    setProvider(null)
    setModel(null)
    setStatus(t('common.saved'))
    setTimeout(() => setStatus(null), 1800)
  }

  return (
    <Section
      icon={<IconChip />}
      title={t('set.main-model')}
      aside={
        <span className="set-inline">
          {status && <span className="set-note set-status--ok" style={{ margin: 0 }}>{status}</span>}
          {cur && (
            <span className="set-mono">
              {t('set.current', { provider: cur.provider, model: cur.model })}
            </span>
          )}
        </span>
      }
    >
      <p className="set-note">{t('set.main-desc')}</p>
      <Row
        title={t('set.provider')}
        desc={usable.length === 0 ? t('set.no-provider') : undefined}
        action={
          <select
            className="set-select"
            value={prov}
            onChange={(e) => {
              setProvider(e.target.value)
              setModel(null)
            }}
          >
            <option value="">{t('set.pick-provider')}</option>
            {(usable.length > 0 ? usable : state?.providers ?? []).map((p) => (
              <option key={p.slug} value={p.slug} disabled={!usable.includes(p)}>
                {p.name}
                {p.local && !/本地|local/i.test(p.name) ? t('set.suffix-local') : ''}
                {!usable.includes(p)
                  ? p.local
                    ? t('set.paren-not-running')
                    : t('set.paren-no-key')
                  : ''}
              </option>
            ))}
          </select>
        }
      />
      <Row
        title={t('set.model')}
        desc={
          busy
            ? t('set.loading-models')
            : models.length > 0
              ? t('set.models-count', { n: models.length })
              : t('set.models-none')
        }
        action={
          models.length > 0 ? (
            <select
              className="set-select set-select--model"
              value={modelDraft}
              onChange={(e) => {
                setModel(e.target.value)
                void commit(prov, e.target.value)
              }}
            >
              {modelDraft && !models.includes(modelDraft) && (
                <option value={modelDraft}>{t('set.current-paren', { model: modelDraft })}</option>
              )}
              {!modelDraft && <option value="">{t('set.pick-model')}</option>}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="set-input set-input--model"
              placeholder={t('set.ph-model')}
              value={modelDraft}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => void commit(prov, modelDraft)}
              onKeyDown={(e) => e.key === 'Enter' && void commit(prov, modelDraft)}
            />
          )
        }
      />
      <ReasoningRow />
    </Section>
  )
}

/** 对话推理开关：Claude / OpenAI o 系列 / 多数网关默认不思考，要在请求里开；开了才有「思考中…」可看 */
export function ReasoningRow(): JSX.Element {
  const t = useT()
  const on = useApp((s) => s.chatReasoning)
  const setOn = useApp((s) => s.setChatReasoning)
  return (
    <Row
      title={t('set.reasoning')}
      desc={t('set.reasoning.desc')}
      action={
        <button className={on ? 'set-switch set-switch--on' : 'set-switch'} role="switch" aria-checked={on} aria-label={t('set.reasoning')} onClick={() => setOn(!on)}>
          <span className="set-switch-thumb" />
        </button>
      }
    />
  )
}

export function RouteRow({ slot }: { slot: ConfigurableSlot }): JSX.Element | null {
  const t = useT()
  const state = useModels((s) => s.state)
  const saveRoute = useModels((s) => s.saveRoute)
  const [model, setModel] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<{ prov: string; models: string[] } | null>(null)
  const provider = state?.routes[slot]?.provider ?? 'auto'
  useEffect(() => {
    if (provider === 'auto') return
    let stale = false
    window.readarc
      .listProviderModels(provider)
      .then((ms) => {
        if (!stale) setLoaded({ prov: provider, models: ms })
      })
      .catch(() => {
        if (!stale) setLoaded({ prov: provider, models: [] })
      })
    return () => {
      stale = true
    }
  }, [provider])
  const models = provider !== 'auto' && loaded?.prov === provider ? loaded.models : []
  if (!state) return null
  const route = state.routes[slot]
  const label = SLOT_KEYS[slot]
  const modelDraft = model ?? route.model ?? ''

  const save = async (provider: string, m: string): Promise<void> => {
    await saveRoute(slot, m.trim() ? { provider, model: m.trim() } : { provider })
    setModel(null)
  }

  return (
    <Row
      title={t(label.title)}
      desc={t(label.desc)}
      action={
        <span className="set-inline">
          <select
            className="set-select"
            value={route.provider}
            onChange={(e) => void save(e.target.value, modelDraft)}
          >
            <option value="auto">{t('set.auto-main')}</option>
            {state.providers.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
                {p.local && !/本地|local/i.test(p.name) ? t('set.suffix-local') : ''}
              </option>
            ))}
          </select>
          {provider !== 'auto' && models.length > 0 ? (
            <select
              className="set-select set-select--model"
              value={modelDraft}
              onChange={(e) => void save(route.provider, e.target.value)}
            >
              <option value="">{t('set.provider-default')}</option>
              {modelDraft && !models.includes(modelDraft) && (
                <option value={modelDraft}>{t('set.current-paren', { model: modelDraft })}</option>
              )}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : provider !== 'auto' ? (
            <input
              className="set-input"
              placeholder={t('set.ph-model-optional')}
              value={modelDraft}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => model !== null && void save(route.provider, modelDraft)}
              onKeyDown={(e) => e.key === 'Enter' && void save(route.provider, modelDraft)}
            />
          ) : null}
        </span>
      }
    />
  )
}

export function RoutesTab(): JSX.Element {
  const t = useT()
  return (
    <Section icon={<IconRoute />} title={t('set.routes')}>
      <p className="set-note">{t('set.routes-desc')}</p>
      {ROUTE_SLOTS.map((slot) => (
        <RouteRow key={slot} slot={slot} />
      ))}
    </Section>
  )
}

/* ---- 成本页 ---- */

/** 本月用量：放在「模型」页底部，和选模型的地方在一起，不单独占一个页 */
export function CostTab(): JSX.Element {
  const t = useT()
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof window.readarc.monthUsage>> | null>(null)

  useEffect(() => {
    void window.readarc.monthUsage().then(setUsage)
  }, [])

  return (
    <Section icon={<IconCoin />} title={t('set.cost')}>
      <Row
        title={t('set.usage-month')}
        desc={
          usage && usage.unknownModels.length > 0
            ? t('set.unknown-models', { list: usage.unknownModels.join('、') })
            : t('set.usage-month-desc')
        }
        action={
          <span className="set-mono">
            {usage
              ? `${formatTokens(usage.inputTokens + usage.outputTokens)} tok · ${formatUsd(usage.spendUsd)}`
              : '—'}
          </span>
        }
      />
    </Section>
  )
}
