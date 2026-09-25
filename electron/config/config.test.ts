import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProviders, parseProviders, type ConfigRoots } from './providers-config'
import { parseEnvFile, resolveApiKey } from './env-file'
import { deleteProvider, saveProvider } from './provider-writer'
import { loadTaskRoutes, saveTaskRoute } from './tasks-config'

/** 用户手写的 config.yaml：三种 base_url 别名、两种 key_env 别名各出现一次。 */
const USER_CONFIG = `# 用户手写配置
providers:
  siliconflow:
    name: "SiliconFlow"
    base_url: "https://api.siliconflow.cn/v1"
    key_env: "SILICONFLOW_API_KEY"
  proxy:
    name: "某中转"
    api: "https://relay.example.com/v1"     # api 别名写法
    api_key_env: "RELAY_KEY"                # api_key_env 别名写法
`

let base: string
let roots: ConfigRoots

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'readarc-cfg-'))
  roots = { readarcDir: join(base, '.readarc') }
  mkdirSync(roots.readarcDir, { recursive: true })
  writeFileSync(join(roots.readarcDir, 'config.yaml'), USER_CONFIG)
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
  delete process.env['READARC_ENV_FILE']
})

describe('providers 契约解析', () => {
  it('base_url / api / url 三种别名、key_env / api_key_env 两种别名都认', () => {
    const defs = parseProviders(USER_CONFIG, 'readarc')
    const sf = defs.find((d) => d.slug === 'siliconflow')!
    const proxy = defs.find((d) => d.slug === 'proxy')!
    expect(sf.baseUrl).toBe('https://api.siliconflow.cn/v1')
    expect(sf.keyEnv).toBe('SILICONFLOW_API_KEY')
    expect(proxy.baseUrl).toBe('https://relay.example.com/v1')
    expect(proxy.keyEnv).toBe('RELAY_KEY')
    expect(proxy.transport).toBe('openai_chat') // 缺省
  })

  it('唯一来源是 ~/.readarc/config.yaml', () => {
    writeFileSync(
      join(roots.readarcDir, 'config.yaml'),
      `providers:\n  siliconflow:\n    name: "SF·改"\n    base_url: "https://sf.example/v1"\n  ollama:\n    name: "Ollama"\n    base_url: "http://127.0.0.1:11434/v1"\n`
    )
    const { providers } = loadProviders(roots)
    expect(providers.find((p) => p.slug === 'siliconflow')!.name).toBe('SF·改')
    expect(providers.map((p) => p.slug).sort()).toEqual(['ollama', 'siliconflow'])
  })

  it('配置损坏不致命：解析失败等同没有配置', () => {
    writeFileSync(join(roots.readarcDir, 'config.yaml'), 'providers: [broken\n  yaml')
    expect(loadProviders(roots).providers).toEqual([])
  })

  it('配置文件不存在时返回空列表', () => {
    rmSync(join(roots.readarcDir, 'config.yaml'))
    expect(loadProviders(roots).providers).toEqual([])
  })
})

describe('.env 密钥解析', () => {
  it('解析引号/注释/export 前缀', () => {
    const env = parseEnvFile(
      `# keys\nexport SILICONFLOW_API_KEY=sk-abc\nRELAY_KEY="sk-def" \nEMPTY=\nBAD_LINE\nQUOTED='sk 空格'\nTAIL=sk-tail # 行尾注释\n`
    )
    expect(env['SILICONFLOW_API_KEY']).toBe('sk-abc')
    expect(env['RELAY_KEY']).toBe('sk-def')
    expect(env['QUOTED']).toBe('sk 空格')
    expect(env['TAIL']).toBe('sk-tail')
    expect(env['BAD_LINE']).toBeUndefined()
  })

  it('解析顺序：readarc/.env 先于 READARC_ENV_FILE 附加文件；缺失返回 null', () => {
    const extra = join(base, 'extra.env')
    writeFileSync(extra, 'SILICONFLOW_API_KEY=from-extra\n')
    process.env['READARC_ENV_FILE'] = extra
    expect(resolveApiKey('SILICONFLOW_API_KEY', roots)).toBe('from-extra')
    writeFileSync(join(roots.readarcDir, '.env'), 'SILICONFLOW_API_KEY=from-readarc\n')
    expect(resolveApiKey('SILICONFLOW_API_KEY', roots)).toBe('from-readarc')
    expect(resolveApiKey('NO_SUCH_KEY', roots)).toBeNull()
    expect(resolveApiKey(null, roots)).toBeNull()
  })

  it('附加文件未配置或不存在都不报错', () => {
    expect(resolveApiKey('SILICONFLOW_API_KEY', roots)).toBeNull()
    process.env['READARC_ENV_FILE'] = join(base, 'nope.env')
    expect(resolveApiKey('SILICONFLOW_API_KEY', roots)).toBeNull()
  })
})

describe('saveProvider 写回', () => {
  it('新条目写进 readarc config', () => {
    const changed = saveProvider(
      { slug: 'lmstudio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
      roots
    )
    expect(changed).toBe(true)
    expect(readFileSync(join(roots.readarcDir, 'config.yaml'), 'utf8')).toContain('lmstudio:')
  })

  it('无变化不落盘、不留备份', () => {
    const changed = saveProvider(
      {
        slug: 'siliconflow',
        name: 'SiliconFlow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        keyEnv: 'SILICONFLOW_API_KEY'
      },
      roots
    )
    expect(changed).toBe(false)
  })

  it('deleteProvider 移除条目且不动其他块', () => {
    expect(deleteProvider('proxy', roots)).toBe(true)
    expect(loadProviders(roots).providers.map((p) => p.slug)).toEqual(['siliconflow'])
    expect(deleteProvider('proxy', roots)).toBe(false) // 再删无变化
  })
})

describe('任务路由（只进 ~/.readarc）', () => {
  it('缺省全 auto', () => {
    const routes = loadTaskRoutes(roots)
    expect(routes.translate).toEqual({ provider: 'auto' })
    expect(routes.compare).toEqual({ provider: 'auto' })
  })

  it('保存后可读回，且不动 providers 块', () => {
    saveTaskRoute('translate', { provider: 'siliconflow', model: 'Qwen/Qwen3-32B' }, roots)
    const routes = loadTaskRoutes(roots)
    expect(routes.translate).toEqual({ provider: 'siliconflow', model: 'Qwen/Qwen3-32B' })
    expect(routes.ask).toEqual({ provider: 'auto' })
    expect(loadProviders(roots).providers.map((p) => p.slug).sort()).toEqual([
      'proxy',
      'siliconflow'
    ])
  })

  it('kind: gateway 的 localhost 来源不算本地模型；kind: local 的远程地址算本地', async () => {
    const { parseProviders } = await import('./providers-config')
    const { isLocalProvider } = await import('../model/profiles')
    const defs = parseProviders(
      `providers:\n  hub:\n    name: Hub\n    base_url: "http://127.0.0.1:15721/v1"\n    kind: gateway\n  box:\n    name: Box\n    base_url: "http://192.168.1.8:8000/v1"\n    kind: local\n  plain:\n    name: Plain\n    base_url: "http://127.0.0.1:8080/v1"\n`,
      'readarc'
    )
    const by = Object.fromEntries(defs.map((d) => [d.slug, d]))
    expect(isLocalProvider(by['hub'])).toBe(false)
    expect(isLocalProvider(by['box'])).toBe(true)
    expect(isLocalProvider(by['plain'])).toBe(true) // 没标注按地址猜
  })
})
