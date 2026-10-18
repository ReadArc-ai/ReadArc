import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../i18n', () => ({ uiText: (k: string) => k }))
import { modelState, removeProvider, testProvider } from './service'
import { loadMainModel } from '../config/main-model'
import { loadTaskRoutes } from '../config/tasks-config'
import { loadEndpointProxy } from '../config/proxies'
import type { ConfigRoots } from '../config/providers-config'
import { startMockServer, type MockServer } from './mock-server'

let base: string
let roots: ConfigRoots
let mock: MockServer | null = null

function setup(config: string, env = ''): void {
  writeFileSync(join(roots.readarcDir, 'config.yaml'), config)
  writeFileSync(join(roots.readarcDir, '.env'), env)
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'readarc-provider-'))
  roots = { readarcDir: join(base, '.readarc') }
  mkdirSync(roots.readarcDir, { recursive: true })
})

afterEach(async () => {
  await mock?.close()
  mock = null
  rmSync(base, { recursive: true, force: true })
})

describe('厂商开户链接', () => {
  const originalMas = Object.getOwnPropertyDescriptor(process, 'mas')
  afterEach(() => {
    if (originalMas) Object.defineProperty(process, 'mas', originalMas)
    else Reflect.deleteProperty(process, 'mas')
  })
  const urls = (): Record<string, string | undefined> => {
    setup('')
    return Object.fromEntries(modelState(roots).providers.map((p) => [p.slug, p.signupUrl]))
  }

  it('App Store 版只保留本地运行时的下载页', () => {
    Object.defineProperty(process, 'mas', { configurable: true, value: true })
    const u = urls()
    expect(u['deepseek']).toBeUndefined()
    expect(u['openai']).toBeUndefined()
    expect(u['ollama']).toBe('https://ollama.com')
  })
  it('源码构建版照常给出云厂商链接', () => {
    Object.defineProperty(process, 'mas', { configurable: true, value: undefined })
    expect(urls()['deepseek']).toBe('https://platform.deepseek.com')
  })
})

describe('删除来源', () => {
  it('一并清掉指向它的默认模型、按功能指定的模型和代理绑定，别的不动', () => {
    setup(`providers:
  supe:
    name: Supe
    base_url: "https://supe.example.com/v1"
    key_env: SUPE_KEY
  vokly:
    name: Vokly
    base_url: "https://vokly.example.com/v1"
    key_env: VOKLY_KEY
main:
  provider: supe
  model: gpt-5.6-terra
tasks:
  translate:
    provider: supe
    model: gpt-5.6-terra
  summary:
    provider: vokly
    model: gpt-6.1-sol
proxies:
  home:
    protocol: http
    host: 127.0.0.1
    port: 10080
endpoint_proxy:
  supe: home
  vokly: home
`)
    expect(removeProvider('supe', roots)).toBe(true)
    expect(loadMainModel(roots)).toBeNull()
    const routes = loadTaskRoutes(roots)
    expect(routes.translate).toEqual({ provider: 'auto' })
    expect(routes.summary).toEqual({ provider: 'vokly', model: 'gpt-6.1-sol' })
    expect(loadEndpointProxy(roots)).toEqual({ vokly: 'home' })
    expect(modelState(roots).providers.some((p) => p.slug === 'supe')).toBe(false)
  })

  it('不存在的来源返回 false，不改文件', () => {
    setup('providers:\n  a:\n    name: A\n    base_url: "https://a.example.com/v1"\nmain:\n  provider: a\n')
    expect(removeProvider('missing', roots)).toBe(false)
    expect(loadMainModel(roots)).toEqual({ provider: 'a', model: '' })
  })
})

describe('测试连接', () => {
  const gateway = (url: string): string => `providers:
  gw:
    name: GW
    base_url: "${url}/v1"
    key_env: GW_KEY
    kind: gateway
`

  it('连通时报模型数，并且带上 Key', async () => {
    mock = await startMockServer([{ path: '/v1/models', json: { data: [{ id: 'a' }, { id: 'b' }] } }])
    setup(gateway(mock.url), 'GW_KEY=sk-test\n')
    const r = await testProvider('gw', roots)
    expect(r).toMatchObject({ ok: true, models: 2 })
    expect(mock.requests[0].headers.authorization).toBe('Bearer sk-test')
  })

  it('Key 无效、地址不对、没填 Key，各给能照着改的原因', async () => {
    mock = await startMockServer([{ path: '/v1/models', status: 401, json: { error: { message: 'bad key' } } }])
    setup(gateway(mock.url), 'GW_KEY=sk-wrong\n')
    expect(await testProvider('gw', roots)).toMatchObject({ ok: false, error: 'provider.test.auth' })

    // 地址少了 /v1：/models 落到 404
    setup(gateway(mock.url).replace('/v1"', '"'), 'GW_KEY=sk-test\n')
    expect(await testProvider('gw', roots)).toMatchObject({ ok: false, error: 'provider.test.not-found' })

    setup(gateway(mock.url), '')
    expect(await testProvider('gw', roots)).toMatchObject({ ok: false, error: 'provider.test.no-key' })
    expect(await testProvider('nope', roots)).toMatchObject({ ok: false, error: 'provider.test.missing' })
  })
})
