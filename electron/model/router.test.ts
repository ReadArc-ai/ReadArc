import { describe, expect, it } from 'vitest'
import { isFreeAttempt, NoRouteError, resolveChain, runTask, type RouterContext } from './router'
import { DEFAULT_ROUTES } from '../config/tasks-config'
import { startMockServer } from './mock-server'
import type { ProviderDef } from '../config/providers-config'

const sf: ProviderDef = {
  slug: 'siliconflow',
  name: 'SiliconFlow',
  baseUrl: 'https://api.siliconflow.cn/v1',
  keyEnv: 'SILICONFLOW_API_KEY',
  transport: 'openai_chat',
  source: 'readarc'
}
const ollama: ProviderDef = {
  slug: 'ollama',
  name: 'Ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  keyEnv: null,
  transport: 'openai_chat',
  source: 'readarc'
}

function ctx(overrides: Partial<RouterContext> = {}): RouterContext {
  return {
    providers: [sf, ollama],
    routes: {
      ...DEFAULT_ROUTES,
      translate: { provider: 'siliconflow', model: 'Qwen/Qwen3-32B' }
    },
    mainModel: { provider: 'anthropic', model: 'claude-opus-4-6' },
    resolveKey: () => 'sk-test',
    ...overrides
  }
}

describe('resolveChain（降级链构造）', () => {
  it('任务模型 → 默认模型 → 本地模型，各带可读的降级原因', () => {
    const chain = resolveChain('translate', ctx())
    expect(chain.map((a) => [a.slug, a.tier])).toEqual([
      ['siliconflow', 'task'],
      ['anthropic', 'main'],
      ['ollama', 'local']
    ])
    expect(chain[1].why).toContain('默认模型')
    expect(chain[2].why).toContain('本地')
  })

  it('auto 任务直接从默认模型开始', () => {
    const chain = resolveChain('ask', ctx())
    expect(chain[0].tier).toBe('main')
  })

  it('没有默认模型：先用第一个配了密钥的云端来源，本地来源仍在其后', () => {
    const chain = resolveChain('ask', ctx({ mainModel: null, resolveKey: (env) => (env === 'SILICONFLOW_API_KEY' ? 'sk' : null) }))
    expect(chain[0]).toMatchObject({ slug: 'siliconflow', model: '', tier: 'main' })
    expect(chain.map((a) => a.slug)).toEqual(['siliconflow', 'ollama'])
  })

  it('没有默认模型也没有任何密钥：只剩本地来源', () => {
    const chain = resolveChain('ask', ctx({ mainModel: null, resolveKey: () => null }))
    expect(chain.map((a) => a.slug)).toEqual(['ollama'])
  })

  it('默认模型 provider 为 auto 时跳过；不认识的 slug 不入链', () => {
    // 没有任何密钥时 auto 只剩本地来源；有密钥的情况见上面「先用第一个配了密钥的来源」
    const chain = resolveChain('ask', ctx({ mainModel: { provider: 'auto', model: 'x' }, resolveKey: () => null }))
    expect(chain.map((a) => a.tier)).toEqual(['local'])
    const chain2 = resolveChain(
      'translate',
      ctx({ routes: { ...DEFAULT_ROUTES, translate: { provider: 'no-such' } } })
    )
    expect(chain2.find((a) => a.slug === 'no-such')).toBeUndefined()
  })
})

describe('runTask（失败降级 [P4]）', () => {
  it('第一跳失败记入 hops 并继续，第二跳成功', async () => {
    const calls: string[] = []
    const out = await runTask(
      'translate',
      { messages: [{ role: 'user', content: 'x' }] },
      ctx(),
      () => {},
      async (_ep, model) => {
        calls.push(model)
        if (model === 'Qwen/Qwen3-32B') throw new Error('HTTP 429: rate limited')
        return { text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } }
      }
    )
    expect(calls).toEqual(['Qwen/Qwen3-32B', 'claude-opus-4-6'])
    expect(out.attempt.tier).toBe('main')
    expect(out.hops).toHaveLength(1)
    expect(out.hops[0].attempt.slug).toBe('siliconflow')
    expect(out.hops[0].error).toContain('429')
  })

  it('本地兜底：无 model 时经 GET /v1/models 取第一个', async () => {
    const mock = await startMockServer([
      { path: '/v1/models', json: { data: [{ id: 'qwen3:8b' }] } }
    ])
    const local: ProviderDef = { ...ollama, baseUrl: mock.url + '/v1' }
    const out = await runTask(
      'ask',
      { messages: [] },
      ctx({ providers: [local], mainModel: null }),
      () => {},
      async (_ep, model) => ({ text: model, usage: { inputTokens: 0, outputTokens: 0 } })
    )
    expect(out.model).toBe('qwen3:8b')
    expect(out.attempt.tier).toBe('local')
    await mock.close()
  })

  it('全链失败 → NoRouteError 汇总每跳原因（就地报错，保留原文）', async () => {
    await expect(
      runTask(
        'translate',
        { messages: [] },
        ctx({ providers: [sf], mainModel: null, resolveKey: () => null }),
        () => {},
        async () => {
          throw new Error('boom')
        }
      )
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof NoRouteError && e.hops.length === 1 && /boom/.test(e.message)
    )
  })

  it('没有任何供应商 → 引导先接一个模型', async () => {
    await expect(
      runTask('ask', { messages: [] }, ctx({ providers: [], mainModel: null }))
    ).rejects.toSatisfy((e: unknown) => e instanceof NoRouteError && /API Key|Ollama/.test(e.message))
  })
})

describe('isFreeAttempt：账本与预估共用同一把尺 [P7]', () => {
  const localMain: ProviderDef = {
    slug: 'gateway',
    name: '本机网关',
    baseUrl: 'http://127.0.0.1:15721/v1',
    keyEnv: 'GATEWAY_KEY',
    transport: 'openai_chat',
    source: 'readarc'
  }

  it('本地 endpoint 当默认模型时也算免费（tier 是 main，不能按 tier 判）', () => {
    const chain = resolveChain(
      'translate',
      ctx({
        providers: [localMain, sf],
        routes: { ...DEFAULT_ROUTES },
        mainModel: { provider: 'gateway', model: 'deepseek-v4-pro' }
      })
    )
    expect(chain[0].slug).toBe('gateway')
    expect(chain[0].tier).toBe('main') // 不是 'local'
    expect(isFreeAttempt(chain[0], [localMain, sf])).toBe(true)
  })

  it('云端 endpoint 不免费', () => {
    expect(isFreeAttempt({ slug: 'siliconflow', model: 'x', tier: 'task', why: '' }, [sf, ollama])).toBe(false)
  })

  it('供应商已不在列表时退回按 tier 判，且 undefined 不算免费', () => {
    expect(isFreeAttempt({ slug: 'gone', model: 'x', tier: 'local', why: '' }, [sf])).toBe(true)
    expect(isFreeAttempt({ slug: 'gone', model: 'x', tier: 'main', why: '' }, [sf])).toBe(false)
    expect(isFreeAttempt(undefined, [sf])).toBe(false)
  })
})

describe('NoRouteError 的报错文案', () => {
  it('同一供应商在链上出现两次时，报错不重复列两遍', () => {
    const err = new NoRouteError([
      { attempt: { slug: 'gw', model: 'm', tier: 'main', why: '' }, error: 'fetch failed' },
      { attempt: { slug: 'gw', model: '', tier: 'local', why: '' }, error: 'fetch failed' }
    ])
    expect(err.message).toBe('模型调用失败：gw（无法连接模型服务，请检查服务状态、网络或代理设置。）')
  })

  it('不同失败原因仍然都列出来', () => {
    const err = new NoRouteError([
      { attempt: { slug: 'a', model: 'm', tier: 'main', why: '' }, error: '401' },
      { attempt: { slug: 'b', model: 'm', tier: 'local', why: '' }, error: 'fetch failed' }
    ])
    expect(err.message).toContain('a（401）') // 认不出来的原样保留
    expect(err.message).toContain('b（无法连接模型服务，请检查服务状态、网络或代理设置。）')
  })

  it('一条链都没有时给的是「怎么办」，不是「失败列表」', () => {
    expect(new NoRouteError([]).message).toContain('API Key')
  })
})

describe('friendlyModelError', () => {
  it('把 HTTP 状态与网络错误翻成一句「我该做什么」', async () => {
    const { friendlyModelError } = await import('./router')
    expect(friendlyModelError('chat/completions HTTP 401: {"error":{"message":"Invalid API key provided"}}')).toMatch(/Key 无效/)
    expect(friendlyModelError('chat/completions HTTP 429: rate limited')).toMatch(/过于频繁/)
    expect(friendlyModelError('chat/completions HTTP 503')).toMatch(/不可用.*503/)
    expect(friendlyModelError('chat/completions HTTP 404: no such model')).toMatch(/模型名/)
    expect(friendlyModelError('fetch failed')).toMatch(/无法连接/)
    expect(friendlyModelError('流式响应 60 秒无数据（超时）')).toMatch(/响应超时/)
  })
  it('认不出来的错误：剥掉 JSON 壳只留供应商那句话', async () => {
    const { friendlyModelError } = await import('./router')
    expect(friendlyModelError('{"error":{"message":"context length exceeded"}}')).toBe('context length exceeded')
    expect(friendlyModelError('something odd happened')).toBe('something odd happened')
  })
})
