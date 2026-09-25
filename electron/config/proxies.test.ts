import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  composeProxyUrl,
  deleteProxy,
  loadEndpointProxy,
  loadProxies,
  proxyPasswordEnv,
  proxyUrlForProvider,
  saveEndpointProxy,
  saveProxy
} from './proxies'
import type { ConfigRoots } from './providers-config'

let dir: string
let roots: ConfigRoots

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'readarc-px-'))
  roots = { readarcDir: dir }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('命名代理档案', () => {
  it('保存多个档案 → 读回；组合 URL（密码来自档案专属 env）', () => {
    saveProxy({ name: 'clash', protocol: 'http', host: '127.0.0.1', port: '7890', username: '' }, roots)
    saveProxy({ name: 'us-node', protocol: 'socks5', host: '10.0.0.2', port: '1080', username: 'me' }, roots)
    const names = loadProxies(roots).map((p) => p.name).sort()
    expect(names).toEqual(['clash', 'us-node'])

    writeFileSync(join(dir, '.env'), `${proxyPasswordEnv('us-node')}=s3cret\n`)
    const us = loadProxies(roots).find((p) => p.name === 'us-node')!
    expect(composeProxyUrl(us, roots)).toBe('socks5://me:s3cret@10.0.0.2:1080')
    const clash = loadProxies(roots).find((p) => p.name === 'clash')!
    expect(composeProxyUrl(clash, roots)).toBe('http://127.0.0.1:7890')
  })

  it('端点绑定：绑定/换绑/解绑；proxyUrlForProvider 解析', () => {
    saveProxy({ name: 'clash', protocol: 'http', host: '127.0.0.1', port: '7890', username: '' }, roots)
    saveEndpointProxy('openai', 'clash', roots)
    expect(loadEndpointProxy(roots)).toEqual({ openai: 'clash' })
    expect(proxyUrlForProvider('openai', roots)).toBe('http://127.0.0.1:7890')
    expect(proxyUrlForProvider('deepseek', roots)).toBe('')
    saveEndpointProxy('openai', null, roots)
    expect(proxyUrlForProvider('openai', roots)).toBe('')
  })

  it('删除档案：连带解除引用它的端点绑定', () => {
    saveProxy({ name: 'clash', protocol: 'http', host: '127.0.0.1', port: '7890', username: '' }, roots)
    saveEndpointProxy('openai', 'clash', roots)
    saveEndpointProxy('anthropic', 'clash', roots)
    expect(deleteProxy('clash', roots)).toBe(true)
    expect(loadProxies(roots)).toEqual([])
    expect(loadEndpointProxy(roots)).toEqual({})
    expect(proxyUrlForProvider('openai', roots)).toBe('')
  })

  it('旧版 network: 单代理一次性迁移为 proxies.default + 官方端点绑定', () => {
    writeFileSync(
      join(dir, 'config.yaml'),
      'network:\n  protocol: socks5\n  host: 10.0.0.9\n  port: "1080"\n  username: ""\n  official_via_proxy: "true"\ntasks:\n  translate:\n    provider: deepseek\n'
    )
    const proxies = loadProxies(roots)
    expect(proxies).toHaveLength(1)
    expect(proxies[0]).toMatchObject({ name: 'default', protocol: 'socks5', host: '10.0.0.9' })
    expect(loadEndpointProxy(roots)['openai']).toBe('default')
    const raw = readFileSync(join(dir, 'config.yaml'), 'utf8')
    expect(raw).not.toContain('network:')
    expect(raw).toContain('provider: deepseek') // 其他块原样
  })
})
