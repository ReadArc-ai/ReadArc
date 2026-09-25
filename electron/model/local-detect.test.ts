import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectLocalProviders } from './local-detect'
import { startMockServer } from './mock-server'
import type { ConfigRoots } from '../config/providers-config'

let roots: ConfigRoots

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'readarc-detect-'))
  roots = { readarcDir: join(base, '.readarc') }
  mkdirSync(roots.readarcDir, { recursive: true })
})

afterEach(() => rmSync(join(roots.readarcDir, '..'), { recursive: true, force: true }))

describe('detectLocalProviders', () => {
  it('探到本地端点 → 自动写入 providers: 并返回模型列表', async () => {
    const mock = await startMockServer([
      { path: '/v1/models', json: { data: [{ id: 'qwen3:8b' }] } }
    ])
    const found = await detectLocalProviders(roots, [
      { slug: 'ollama', baseUrl: mock.url + '/v1' }
    ])
    expect(found).toHaveLength(1)
    expect(found[0].models).toEqual(['qwen3:8b'])
    const cfg = readFileSync(join(roots.readarcDir, 'config.yaml'), 'utf8')
    expect(cfg).toContain('ollama:')
    expect(cfg).toContain(mock.url + '/v1')
    await mock.close()
  })

  it('端口没人听 → 不写配置、不报错', async () => {
    const found = await detectLocalProviders(roots, [
      { slug: 'lmstudio', baseUrl: 'http://127.0.0.1:59999/v1' }
    ])
    expect(found).toEqual([])
    expect(existsSync(join(roots.readarcDir, 'config.yaml'))).toBe(false)
  })
})
