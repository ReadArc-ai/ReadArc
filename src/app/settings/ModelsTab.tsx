/** 设置 → 接入：官方厂商 / 网关中转 / 本地模型的接入与密钥 */
import { useState, type JSX } from 'react'
import { errText } from '../../lib/errors'
import { type ProviderView } from '../../../shared/models'
import { useT } from '../../i18n'
import { useModels } from '../../store/models'
import { confirmDialog } from '../../store/confirm'
import openaiLogo from '../../assets/logos/openai.svg'
import ollamaLogo from '../../assets/logos/ollama.svg'
import lmstudioLogo from '../../assets/logos/lmstudio.svg'
import openrouterLogo from '../../assets/logos/openrouter.svg'
import claudeLogo from '../../assets/logos/claude-color.svg'
import geminiLogo from '../../assets/logos/gemini-color.svg'
import { IconChip, IconRoute, Section } from './shared'

export const MONO_LOGOS: Record<string, string> = {
  openai: openaiLogo,
  ollama: ollamaLogo,
  lmstudio: lmstudioLogo,
  openrouter: openrouterLogo
}
export const COLOR_LOGOS: Record<string, string> = { anthropic: claudeLogo, gemini: geminiLogo }

export function ProviderLogo({ slug, name }: { slug: string; name: string }): JSX.Element {
  if (COLOR_LOGOS[slug]) return <img className="provider-logo" src={COLOR_LOGOS[slug]} alt="" />
  if (MONO_LOGOS[slug]) {
    // 构建后 SVG 会内联成含引号的 data URL，url() 里必须加引号，否则整条声明无效，只剩一个色块
    return (
      <span
        className="provider-logo provider-logo-mono"
        style={{ WebkitMaskImage: `url("${MONO_LOGOS[slug]}")`, maskImage: `url("${MONO_LOGOS[slug]}")` }}
      />
    )
  }
  return <span className="provider-logo provider-logo-letter">{name[0]}</span>
}

/* ---- 接入页：每个来源一行「名称 + 状态 + 一个按钮」，细节收进展开区 ---- */

/**
 * 一行只回答两个问题：这个来源现在能不能用、要做什么。
 * 名称下面一行是状态（已配置 / 未配置 / 运行中 / 未运行）+ 代理 + 地址；
 * 右侧只放一个主按钮（粘贴 Key / 设置 / 下载）。API Key、代理、地址、删除全在展开区里，
 * 按「标签：控件」竖排，不再把五个控件横着挤在一行。
 */
export function ProviderRow({ p }: { p: ProviderView }): JSX.Element {
  const t = useT()
  const saveProvider = useModels((s) => s.saveProvider)
  const load = useModels((s) => s.load)
  const detected = useModels((s) => s.detected)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [name, setName] = useState(p.name)
  const [baseUrl, setBaseUrl] = useState(p.baseUrl)
  const [saved, setSaved] = useState(false)
  // 自定义 = 非官方（官方厂商填过 Key 后 config 里也会有同名条目，但仍按官方对待：不给改名 / 改地址 / 删除）
  const custom = !p.official
  const builtinLocal = p.local && p.official
  const detectedEntry = detected?.find((d) => d.slug === p.slug)
  const remote = !p.local
  const proxies = useModels((s) => s.state?.proxies ?? [])
  const bound = useModels((s) => s.state?.endpointProxy[p.slug] ?? '')

  const flash = (): void => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }
  const submitKey = async (): Promise<void> => {
    if (!key.trim() || !p.keyEnv) return
    await saveProvider({ slug: p.slug, name: p.name, baseUrl: p.baseUrl, keyEnv: p.keyEnv, apiKey: key.trim() })
    setKey('')
    flash()
  }
  const submitEdit = async (): Promise<void> => {
    if (!name.trim() || !/^https?:\/\//.test(baseUrl.trim())) return
    await saveProvider({
      slug: p.slug,
      name: name.trim(),
      baseUrl: baseUrl.trim().replace(/\/$/, ''),
      keyEnv: p.keyEnv ?? undefined,
      apiKey: key.trim() || undefined,
      local: p.local
    })
    setKey('')
    flash()
  }
  const remove = async (): Promise<void> => {
    const ok = await confirmDialog(t('set.prov.delete-confirm', { name: p.name }), { confirmLabel: t('common.delete'), danger: true })
    if (!ok) return
    await window.readarc.deleteProvider(p.slug)
    await load()
  }
  const bindProxy = async (proxyName: string): Promise<void> => {
    await window.readarc.saveEndpointProxy(p.slug, proxyName || null)
    await load()
  }

  // 状态短语：一眼分出「能用 / 不能用」
  const ready = builtinLocal ? !!detectedEntry : p.local ? true : p.hasKey
  const stateText = builtinLocal
    ? detected === null
      ? t('set.detecting')
      : detectedEntry
        ? t('set.running-models', { n: detectedEntry.models.length })
        : t('set.not-running')
    : p.local
      ? t('set.local-nokey')
      : p.hasKey
        ? t('set.key-set')
        : t('set.key-unset')

  // 主按钮：本地内置只有「下载」；远程且有 Key 槽位但还没配的是「粘贴 Key」；其余「设置」
  const needsKey = remote && !!p.keyEnv && !p.hasKey
  const primary = builtinLocal ? (
    !detectedEntry && p.signupUrl ? (
      <button className="set-btn set-btn--link" title={p.signupUrl} onClick={() => window.open(p.signupUrl)}>
        {t('set.download')}
      </button>
    ) : null
  ) : (
    <button className={open ? 'set-btn is-on' : needsKey ? 'btn-accent' : 'set-btn'} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      {open ? t('set.prov.collapse') : needsKey ? t('set.prov.setup') : t('set.prov.settings')}
    </button>
  )

  return (
    <div className={open ? 'prov-row is-open' : 'prov-row'}>
      <div className="prov-main">
        <div className="prov-title">
          <ProviderLogo slug={p.slug} name={p.name} />
          <span className="prov-name">{p.name}</span>
        </div>
        <div className="prov-state">
          <span className={ready ? 'prov-dot is-ready' : 'prov-dot'} aria-hidden />
          <span className={ready ? 'prov-state-text is-ready' : 'prov-state-text'}>{stateText}</span>
          {bound && <span className="prov-state-sep">· {t('set.prov.via', { name: bound })}</span>}
          <span className="prov-url" title={p.baseUrl}>
            · {p.baseUrl}
          </span>
        </div>
        {builtinLocal && detected !== null && !detectedEntry && <div className="set-row-desc">{t('set.local-hint')}</div>}
      </div>
      <div className="prov-action">{primary}</div>
      {open && (
        <div className="prov-detail">
          {!p.local && p.keyEnv && (
            <>
              <span className="prov-label">{t('set.prov.key-label')}</span>
              <span className="prov-field">
                <input
                  className="set-input set-input--wide"
                  type="password"
                  placeholder={p.hasKey ? t('set.prov.keep-key') : t('set.paste-key')}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void submitKey()}
                />
                <button className="btn-accent" onClick={() => void submitKey()} disabled={!key.trim()}>
                  {saved ? t('set.prov.saved') : t('common.save')}
                </button>
                {p.signupUrl && (
                  <button className="set-btn set-btn--link" title={p.signupUrl} onClick={() => window.open(p.signupUrl)}>
                    {t('set.get-key')}
                  </button>
                )}
              </span>
            </>
          )}
          {remote && (
            <>
              <span className="prov-label">{t('set.prov.proxy-label')}</span>
              <span className="prov-field">
                {proxies.length > 0 ? (
                  <select className="set-select" value={bound} onChange={(e) => void bindProxy(e.target.value)} title={t('set.proxy-pick')}>
                    <option value="">{t('set.direct')}</option>
                    {proxies.map((px) => (
                      <option key={px.name} value={px.name}>
                        {t('set.via-proxy', { name: px.name })}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="set-row-desc">{t('set.prov.no-proxy')}</span>
                )}
              </span>
            </>
          )}
          {custom && (
            <>
              <span className="prov-label">{t('set.prov.kind')}</span>
              <span className="prov-field">
                <select
                  className="set-select"
                  value={p.local ? 'local' : 'gateway'}
                  onChange={(e) => void saveProvider({ slug: p.slug, name: p.name, baseUrl: p.baseUrl, keyEnv: p.keyEnv ?? undefined, local: e.target.value === 'local' })}
                >
                  <option value="gateway">{t('set.prov.kind.gateway')}</option>
                  <option value="local">{t('set.prov.kind.local')}</option>
                </select>
                <span className="set-row-desc">{t('set.prov.kind.desc')}</span>
              </span>
              <span className="prov-label">{t('set.prov.name-label')}</span>
              <span className="prov-field">
                <input className="set-input" placeholder={t('set.name')} value={name} onChange={(e) => setName(e.target.value)} />
              </span>
              <span className="prov-label">{t('set.prov.url-label')}</span>
              <span className="prov-field">
                <input className="set-input set-input--wide" placeholder={t('set.base-url')} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                <button className="btn-accent" onClick={() => void submitEdit()} disabled={name === p.name && baseUrl === p.baseUrl}>
                  {t('common.save')}
                </button>
              </span>
              <span className="prov-label" />
              <span className="prov-field">
                <button className="set-btn set-btn--danger" onClick={() => void remove()}>
                  {t('set.prov.delete')}
                </button>
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** 添加自定义来源：表单和来源行一个样式，竖排「标签：控件」 */
export function AddCustomEndpoint({ onDone, kind: initialKind }: { onDone: () => void; kind: 'gateway' | 'local' }): JSX.Element {
  const t = useT()
  const saveProvider = useModels((s) => s.saveProvider)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [key, setKey] = useState('')
  const [kind, setKind] = useState<'gateway' | 'local'>(initialKind)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (!slug || !/^https?:\/\//.test(baseUrl.trim())) {
      setError(t('set.err-name-url'))
      return
    }
    setError(null)
    try {
      await saveProvider({
        slug,
        name: name.trim(),
        baseUrl: baseUrl.trim().replace(/\/$/, ''),
        keyEnv: `${slug.toUpperCase().replace(/-/g, '_')}_API_KEY`,
        apiKey: key.trim() || undefined,
        local: kind === 'local'
      })
      onDone()
    } catch (err) {
      setError(errText(err))
    }
  }

  return (
    <div className="prov-row is-open prov-row--new">
      <div className="prov-main">
        <div className="prov-title">
          <span className="prov-name">{t('set.add-custom')}</span>
        </div>
        <div className="set-row-desc">{error ?? t('set.add-custom-hint')}</div>
      </div>
      <div className="prov-action">
        <button className="set-btn" onClick={onDone}>
          {t('common.cancel')}
        </button>
      </div>
      <div className="prov-detail">
        <span className="prov-label">{t('set.prov.kind')}</span>
        <span className="prov-field">
          <select className="set-select" value={kind} onChange={(e) => setKind(e.target.value as 'gateway' | 'local')}>
            <option value="gateway">{t('set.prov.kind.gateway')}</option>
            <option value="local">{t('set.prov.kind.local')}</option>
          </select>
          <span className="set-row-desc">{t('set.prov.kind.desc')}</span>
        </span>
        <span className="prov-label">{t('set.prov.name-label')}</span>
        <span className="prov-field">
          <input className="set-input" placeholder={t('set.ph-name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </span>
        <span className="prov-label">{t('set.prov.url-label')}</span>
        <span className="prov-field">
          <input className="set-input set-input--wide" placeholder={t('set.ph-baseurl')} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </span>
        <span className="prov-label">{t('set.prov.key-label')}</span>
        <span className="prov-field">
          <input className="set-input set-input--wide" type="password" placeholder={t('set.ph-key-local')} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
          <button className="btn-accent" onClick={() => void submit()}>
            {t('common.save')}
          </button>
        </span>
      </div>
    </div>
  )
}

export function ModelsTab(): JSX.Element {
  const t = useT()
  const { state, detected, detectLocal } = useModels()
  const official = state?.providers.filter((p) => p.official && !p.local) ?? []
  const customRemote = state?.providers.filter((p) => !p.official && !p.local) ?? []
  const local = state?.providers.filter((p) => p.local) ?? []
  const [adding, setAdding] = useState<null | 'gateway' | 'local'>(null)
  const readyOfficial = official.filter((p) => p.hasKey).length
  const runningLocal = local.filter((p) => detected?.some((d) => d.slug === p.slug) || !p.official).length

  return (
    <>
      <Section icon={<IconChip />} title={t('set.official')} meta={t('set.prov.ready-count', { n: readyOfficial, total: official.length })}>
        <p className="set-note">{t('set.official-desc')}</p>
        {official.map((p) => (
          <ProviderRow key={p.slug} p={p} />
        ))}
      </Section>

      <Section
        icon={<IconRoute />}
        title={t('set.prov.gateways')}
        meta={`${customRemote.length}`}
        aside={
          adding !== 'gateway' && (
            <button className="set-btn" onClick={() => setAdding('gateway')}>
              {t('common.add')}
            </button>
          )
        }
      >
        <p className="set-note">{t('set.prov.gateways-desc')}</p>
        {adding === 'gateway' && <AddCustomEndpoint kind="gateway" onDone={() => setAdding(null)} />}
        {customRemote.map((p) => (
          <ProviderRow key={p.slug} p={p} />
        ))}
        {customRemote.length === 0 && adding !== 'gateway' && <div className="prov-empty">{t('set.prov.gateways-empty')}</div>}
      </Section>

      <Section
        icon={<IconChip />}
        title={t('set.prov.local')}
        meta={t('set.prov.ready-count', { n: runningLocal, total: local.length })}
        aside={
          <span className="set-inline">
            <button className="set-btn" onClick={() => void detectLocal()}>
              {t('set.detect-local')}
            </button>
            {adding !== 'local' && (
              <button className="set-btn" onClick={() => setAdding('local')}>
                {t('common.add')}
              </button>
            )}
          </span>
        }
      >
        <p className="set-note">{t('set.prov.local-desc')}</p>
        {adding === 'local' && <AddCustomEndpoint kind="local" onDone={() => setAdding(null)} />}
        {local.map((p) => (
          <ProviderRow key={p.slug} p={p} />
        ))}
      </Section>
    </>
  )
}
