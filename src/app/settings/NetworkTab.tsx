/** 设置 → 网络：代理档案与端点绑定 */
import { useState, type JSX } from 'react'
import { useT } from '../../i18n'
import { useModels } from '../../store/models'
import { IconGlobe, Section, Row } from './shared'


/* ---- 网络页：命名代理档案 ---- */

export interface ProxyDraft {
  name: string
  protocol: 'http' | 'https' | 'socks5'
  host: string
  port: string
  username: string
  password: string
}

export const EMPTY_PROXY: ProxyDraft = { name: '', protocol: 'http', host: '', port: '', username: '', password: '' }

export function ProxyForm({
  init,
  nameLocked,
  onDone
}: {
  init: ProxyDraft
  /** 编辑已有档案时名称不可改（名称即 id） */
  nameLocked?: boolean
  onDone: () => void
}): JSX.Element {
  const t = useT()
  const load = useModels((s) => s.load)
  const [d, setD] = useState(init)
  const [status, setStatus] = useState<string | null>(null)
  const patch = (p: Partial<ProxyDraft>): void => setD({ ...d, ...p })

  const valid = (): string | null => {
    const name = d.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!name) return t('set.err-proxy-name')
    if (!d.host.trim()) return t('set.err-host')
    return null
  }

  const save = async (): Promise<void> => {
    const err = valid()
    if (err) {
      setStatus(err)
      return
    }
    const name = d.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    await window.readarc.saveProxy({
      name,
      protocol: d.protocol,
      host: d.host.trim(),
      port: d.port.trim(),
      username: d.username.trim(),
      password: d.password || undefined
    })
    await load()
    onDone()
  }

  const test = async (): Promise<void> => {
    const err = valid()
    if (err) {
      setStatus(err)
      return
    }
    setStatus(t('set.testing'))
    const r = await window.readarc.testNetwork({
      name: d.name.trim() || 'test',
      protocol: d.protocol,
      host: d.host.trim(),
      port: d.port.trim(),
      username: d.username.trim(),
      password: d.password || undefined
    })
    setStatus(r.ok ? t('set.reachable') : t('set.failed', { error: r.error ?? t('set.unreachable') }))
  }

  return (
    <div className="set-proxy-form">
      <div className="set-edit-form">
        <input
          className="set-input set-input--narrow"
          placeholder={t('set.ph-proxy-name')}
          value={d.name}
          disabled={nameLocked}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <select
          className="set-select"
          value={d.protocol}
          onChange={(e) => patch({ protocol: e.target.value as ProxyDraft['protocol'] })}
        >
          <option value="http">HTTP</option>
          <option value="https">HTTPS</option>
          <option value="socks5">SOCKS5</option>
        </select>
        <input
          className="set-input"
          placeholder={t('set.ph-host')}
          value={d.host}
          onChange={(e) => patch({ host: e.target.value })}
        />
        <input
          className="set-input set-input--narrow"
          placeholder={t('set.ph-port')}
          value={d.port}
          onChange={(e) => patch({ port: e.target.value.replace(/[^0-9]/g, '') })}
        />
      </div>
      <div className="set-edit-form">
        <input
          className="set-input"
          placeholder={t('set.ph-user')}
          value={d.username}
          onChange={(e) => patch({ username: e.target.value })}
        />
        <input
          className="set-input"
          type="password"
          placeholder={t('set.ph-pass')}
          value={d.password}
          onChange={(e) => patch({ password: e.target.value })}
        />
        <button className="set-btn" onClick={() => void test()}>
          {t('set.test-conn')}
        </button>
        <button className="btn-accent" onClick={() => void save()}>
          {t('common.save')}
        </button>
        <button className="set-btn" onClick={onDone}>
          {t('common.cancel')}
        </button>
        {status && <span className={status === t('set.reachable') ? 'set-note set-status--ok' : 'set-note'} style={{ margin: 0 }}>{status}</span>}
      </div>
    </div>
  )
}

export function ProxyRow({ p }: { p: { name: string; protocol: string; host: string; port: string; username: string } }): JSX.Element {
  const t = useT()
  const load = useModels((s) => s.load)
  const bound = useModels(
    (s) => Object.entries(s.state?.endpointProxy ?? {}).filter(([, n]) => n === p.name).length
  )
  const [editOpen, setEditOpen] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const remove = async (): Promise<void> => {
    await window.readarc.deleteProxy(p.name)
    await load()
  }

  const test = async (): Promise<void> => {
    setStatus(t('set.testing'))
    const r = await window.readarc.testNetwork({
      name: p.name,
      protocol: p.protocol as 'http' | 'https' | 'socks5',
      host: p.host,
      port: p.port,
      username: p.username
    })
    setStatus(r.ok ? t('set.reachable') : t('set.failed', { error: r.error ?? t('set.unreachable') }))
    setTimeout(() => setStatus(null), 4000)
  }

  return (
    <Row
      title={p.name}
      desc={bound > 0 ? t('set.proxy-bound', { n: bound }) : t('set.proxy-unused')}
      hint={`${p.protocol}://${p.username ? p.username + '@' : ''}${p.host}${p.port ? ':' + p.port : ''}`}
      action={
        <span className="set-inline">
          {status && <span className={status === t('set.reachable') ? 'set-key-state set-status--ok' : 'set-key-state'}>{status}</span>}
          <button className="set-btn" onClick={() => void test()}>
            {t('set.test')}
          </button>
          <button className="set-btn" onClick={() => setEditOpen((v) => !v)}>
            {t('common.edit')}
          </button>
          <button className="set-btn set-btn--danger" onClick={() => void remove()}>
            {t('common.delete')}
          </button>
        </span>
      }
      below={
        editOpen ? (
          <ProxyForm
            init={{
              name: p.name,
              protocol: p.protocol as ProxyDraft['protocol'],
              host: p.host,
              port: p.port,
              username: p.username,
              password: ''
            }}
            nameLocked
            onDone={() => setEditOpen(false)}
          />
        ) : undefined
      }
    />
  )
}

export function NetworkTab(): JSX.Element {
  const t = useT()
  const proxies = useModels((s) => s.state?.proxies ?? [])
  const [adding, setAdding] = useState(false)

  return (
    <Section
      icon={<IconGlobe />}
      title={t('set.proxies')}
      meta={`${proxies.length}`}
      aside={
        !adding && (
          <button className="set-btn" onClick={() => setAdding(true)}>
            {t('set.add-proxy')}
          </button>
        )
      }
    >
      <p className="set-note">{t('set.proxies-desc')}</p>
      {proxies.map((p) => (
        <ProxyRow key={p.name} p={p} />
      ))}
      {proxies.length === 0 && !adding && (
        <Row title={t('set.no-proxy')} desc={t('set.no-proxy-desc')} />
      )}
      {adding && <ProxyForm init={EMPTY_PROXY} onDone={() => setAdding(false)} />}
    </Section>
  )
}
