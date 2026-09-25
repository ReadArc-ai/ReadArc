import { describe, expect, it } from 'vitest'
import {
  setIdleTimeoutMs,
  listModels,
  pickChatModel,
  streamChat,
  withIdleWatchdog,
  TransportError,
  type ChatResult,
  type Endpoint
} from './transport'
import { startMockServer } from './mock-server'

async function drain(
  gen: AsyncGenerator<string, { text: string; usage: { inputTokens: number; outputTokens: number } }>
): Promise<{ chunks: string[]; text: string; usage: { inputTokens: number; outputTokens: number } }> {
  const chunks: string[] = []
  let out = await gen.next()
  while (!out.done) {
    chunks.push(out.value)
    out = await gen.next()
  }
  return { chunks, ...out.value }
}

describe('openai_chat 流式', () => {
  it('增量拼接 + usage 抓取 + Bearer 头', async () => {
    const mock = await startMockServer([
      {
        path: '/v1/chat/completions',
        sse: [
          JSON.stringify({ choices: [{ delta: { content: '我们' } }] }),
          JSON.stringify({ choices: [{ delta: { content: '提出' } }] }),
          JSON.stringify({ choices: [{ delta: {} }] }),
          JSON.stringify({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 8 } })
        ]
      }
    ])
    const ep: Endpoint = { baseUrl: mock.url + '/v1', apiKey: 'sk-test', transport: 'openai_chat' }
    const r = await drain(streamChat(ep, { model: 'qwen', messages: [{ role: 'user', content: 'hi' }] }))
    expect(r.chunks).toEqual(['我们', '提出'])
    expect(r.text).toBe('我们提出')
    expect(r.usage).toEqual({ inputTokens: 120, outputTokens: 8 })
    expect(mock.requests[0].headers.authorization).toBe('Bearer sk-test')
    const sent = JSON.parse(mock.requests[0].body)
    expect(sent.stream).toBe(true)
    expect(sent.model).toBe('qwen')
    await mock.close()
  })

  it('HTTP 错误 → TransportError 带状态码（降级链靠它判断原因）', async () => {
    const mock = await startMockServer([
      { path: '/v1/chat/completions', status: 401, json: { error: 'bad key' } }
    ])
    const ep: Endpoint = { baseUrl: mock.url + '/v1', apiKey: null, transport: 'openai_chat' }
    await expect(
      drain(streamChat(ep, { model: 'm', messages: [] }))
    ).rejects.toSatisfy((e: unknown) => e instanceof TransportError && e.status === 401)
    await mock.close()
  })
})

describe('anthropic_messages 流式', () => {
  it('content_block_delta 拼接、system 抽离、x-api-key 头', async () => {
    const mock = await startMockServer([
      {
        path: '/v1/messages',
        sse: [
          JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 55 } } }),
          JSON.stringify({ type: 'content_block_delta', delta: { text: 'Bonjour' } }),
          JSON.stringify({ type: 'content_block_delta', delta: { text: '!' } }),
          JSON.stringify({ type: 'message_delta', usage: { output_tokens: 3 } })
        ]
      }
    ])
    const ep: Endpoint = { baseUrl: mock.url, apiKey: 'sk-ant', transport: 'anthropic_messages' }
    const r = await drain(
      streamChat(ep, {
        model: 'claude',
        messages: [
          { role: 'system', content: '翻译成法语' },
          { role: 'user', content: 'Hello' }
        ]
      })
    )
    expect(r.text).toBe('Bonjour!')
    expect(r.usage).toEqual({ inputTokens: 55, outputTokens: 3 })
    expect(mock.requests[0].headers['x-api-key']).toBe('sk-ant')
    const sent = JSON.parse(mock.requests[0].body)
    expect(sent.system).toBe('翻译成法语')
    expect(sent.messages).toEqual([{ role: 'user', content: 'Hello' }])
    await mock.close()
  })
})

describe('listModels', () => {
  it('GET /v1/models → id 列表', async () => {
    const mock = await startMockServer([
      { path: '/v1/models', json: { data: [{ id: 'qwen3:8b' }, { id: 'llama3' }] } }
    ])
    const ep: Endpoint = { baseUrl: mock.url + '/v1', apiKey: null, transport: 'openai_chat' }
    expect(await listModels(ep)).toEqual(['qwen3:8b', 'llama3'])
    await mock.close()
  })

  it('Anthropic：走 /v1/models，认证用 x-api-key 而不是 Bearer', async () => {
    const mock = await startMockServer([
      { path: '/v1/models', json: { data: [{ id: 'claude-sonnet-5' }, { id: 'claude-haiku-4-5' }] } }
    ])
    const ep: Endpoint = { baseUrl: mock.url, apiKey: 'sk-ant', transport: 'anthropic_messages' }
    expect(await listModels(ep)).toEqual(['claude-sonnet-5', 'claude-haiku-4-5'])
    const h = mock.requests[0].headers
    expect(h['x-api-key']).toBe('sk-ant')
    expect(h['anthropic-version']).toBeTruthy()
    expect(h['authorization']).toBeUndefined()
    await mock.close()
  })

  it('pickChatModel：跳过向量、语音、图像模型', () => {
    expect(pickChatModel(['text-embedding-3-small', 'whisper-1', 'dall-e-3', 'gpt-5-mini'])).toBe('gpt-5-mini')
    expect(pickChatModel(['deepseek-chat'])).toBe('deepseek-chat')
    expect(pickChatModel(['text-embedding-3-small'])).toBe('text-embedding-3-small')
    expect(pickChatModel([])).toBeUndefined()
  })
})

describe('流式空闲看门狗', () => {
  it('长时间无分片 → 408 超时错误（不再永远挂住）', async () => {
    setIdleTimeoutMs(120)
    const server = await startMockServer([{ path: '/chat/completions', hang: true }])
    try {
      const ep = { baseUrl: server.url, apiKey: 'k', transport: 'openai_chat' as const }
      const gen = streamChat(ep, { model: 'm', messages: [] })
      await expect(
        (async () => {
          for (;;) {
            const r = await gen.next()
            if (r.done) return r.value
          }
        })()
      ).rejects.toSatisfy((e: unknown) => e instanceof TransportError && /超时/.test((e as Error).message))
    } finally {
      setIdleTimeoutMs(90_000)
      await server.close()
    }
  })

  it('推理模型思考阶段只有心跳事件、无正文分片：不应触发空闲超时', async () => {
    setIdleTimeoutMs(60)
    try {
      const ctrl = new AbortController()
      const beat = { touch: (): void => {} }
      const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      async function* inner(): AsyncGenerator<string, ChatResult> {
        // 模拟思考期（4 倍超时窗）：期间只有心跳事件、没有正文分片
        for (let i = 0; i < 12; i++) {
          await sleep(20)
          beat.touch()
        }
        yield '译文'
        return { text: '译文', usage: { inputTokens: 1, outputTokens: 1 } }
      }
      const gen = withIdleWatchdog(inner(), ctrl, beat)
      const out: string[] = []
      let r = await gen.next()
      while (!r.done) {
        out.push(r.value)
        r = await gen.next()
      }
      expect(out).toEqual(['译文'])
      expect(ctrl.signal.aborted).toBe(false)
    } finally {
      setIdleTimeoutMs(90_000)
    }
  })

  it('无任何事件的挂死连接：仍按空闲阈值超时中止', async () => {
    setIdleTimeoutMs(60)
    try {
      const ctrl = new AbortController()
      const beat = { touch: (): void => {} }
      // eslint-disable-next-line require-yield -- 模拟零产出的挂死流
      async function* inner(): AsyncGenerator<string, ChatResult> {
        await new Promise((r) => {
          ctrl.signal.addEventListener('abort', r, { once: true }) // 挂死直到被 abort
        })
        throw new Error('aborted')
      }
      const gen = withIdleWatchdog(inner(), ctrl, beat)
      await expect(gen.next()).rejects.toSatisfy(
        (e: unknown) => e instanceof TransportError && /超时/.test((e as Error).message)
      )
    } finally {
      setIdleTimeoutMs(90_000)
    }
  })
})

describe('推理模型的 <think> 思考流过滤', () => {
  it('标签被切在分片之间也能整段剔除；正文照常增量上屏', async () => {
    const mock = await startMockServer([
      {
        path: '/v1/chat/completions',
        sse: [
          JSON.stringify({ choices: [{ delta: { content: '<thi' } }] }),
          JSON.stringify({ choices: [{ delta: { content: 'nk>The user wants me to translate…' } }] }),
          JSON.stringify({ choices: [{ delta: { content: ' 让我想想</th' } }] }),
          JSON.stringify({ choices: [{ delta: { content: 'ink>\n\n我们' } }] }),
          JSON.stringify({ choices: [{ delta: { content: '提出 <b>x</b>' } }] }),
          JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } })
        ]
      }
    ])
    const ep: Endpoint = { baseUrl: mock.url + '/v1', apiKey: null, transport: 'openai_chat' }
    const r = await drain(streamChat(ep, { model: 'r1', messages: [] }))
    expect(r.text).toBe('\n\n我们提出 <b>x</b>')
    expect(r.chunks.join('')).toBe(r.text)
    expect(r.chunks.join('')).not.toContain('think')
    await mock.close()
  })

  it('没有思考标签时不改动任何字符，含 "<" 的普通文本也不被误扣', async () => {
    const mock = await startMockServer([
      {
        path: '/v1/chat/completions',
        sse: [
          JSON.stringify({ choices: [{ delta: { content: 'a < b 且 <' } }] }),
          JSON.stringify({ choices: [{ delta: { content: 'thin' } }] }),
          JSON.stringify({ choices: [{ delta: { content: 'g> 结束' } }] })
        ]
      }
    ])
    const ep: Endpoint = { baseUrl: mock.url + '/v1', apiKey: null, transport: 'openai_chat' }
    const r = await drain(streamChat(ep, { model: 'm', messages: [] }))
    expect(r.text).toBe('a < b 且 <thing> 结束')
    await mock.close()
  })
})

/* ---- 经代理：起一个最小 CONNECT 代理，请求必须从它过 ---- */
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import { fetchErrorText } from './transport'

async function startConnectProxy(): Promise<{ url: string; hits: string[]; close: () => void }> {
  const hits: string[] = []
  // http:// 目标走的是绝对 URL 转发（不建隧道），https:// 才是 CONNECT；两种都记一笔
  const srv = createHttpServer((req, res) => {
    const target = new URL(String(req.url))
    hits.push(target.host)
    const up = httpRequest(
      { host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers: req.headers },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers)
        upRes.pipe(res)
      }
    )
    up.on('error', () => {
      res.statusCode = 502
      res.end()
    })
    req.pipe(up)
  })
  srv.on('connect', (req, socket, head) => {
    hits.push(String(req.url))
    const [host, port] = String(req.url).split(':')
    const up = netConnect(Number(port), host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) up.write(head)
      up.pipe(socket)
      socket.pipe(up)
    })
    up.on('error', () => socket.destroy())
    socket.on('error', () => up.destroy())
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const addr = srv.address() as { port: number }
  return { url: `http://127.0.0.1:${addr.port}`, hits, close: () => srv.close() }
}

describe('代理', () => {
  it('绑定了代理的端点：请求经代理 CONNECT 到目标（用 npm undici 的 fetch，与 ProxyAgent 配套）', async () => {
    const mock = await startMockServer([{ path: '/v1/models', json: { data: [{ id: 'm1' }, { id: 'm2' }] } }])
    const proxy = await startConnectProxy()
    try {
      const ep: Endpoint = { baseUrl: mock.url + '/v1', apiKey: null, transport: 'openai_chat', proxyUrl: proxy.url }
      expect(await listModels(ep)).toEqual(['m1', 'm2'])
      expect(proxy.hits.length).toBe(1)
      expect(proxy.hits[0]).toBe(new URL(mock.url).host)
    } finally {
      proxy.close()
      await mock.close()
    }
  })

  it('代理连不上：错误消息带底层原因，不只是 fetch failed', async () => {
    // 找一个刚释放的端口当「没人监听」的代理（1 / 9 这类端口在 fetch 规范里是禁用端口，会先报 bad port）
    const tmp = createHttpServer()
    await new Promise<void>((r) => tmp.listen(0, '127.0.0.1', r))
    const dead = (tmp.address() as { port: number }).port
    await new Promise<void>((r) => tmp.close(() => r()))
    const ep: Endpoint = { baseUrl: 'http://127.0.0.1:65530/v1', apiKey: null, transport: 'openai_chat', proxyUrl: `http://127.0.0.1:${dead}` }
    await expect(listModels(ep)).rejects.toThrow(/ECONNREFUSED|connect/)
    expect(fetchErrorText(new Error('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }) }))).toBe('connect ECONNREFUSED 127.0.0.1:1')
  })
})

describe('思考流（reasoning）', () => {
  it('openai_chat：reasoning_content 走 onThinking，不进正文', async () => {
    const mock = await startMockServer([
      {
        path: '/v1/chat/completions',
        sse: [
          JSON.stringify({ choices: [{ delta: { reasoning_content: '先看' } }] }),
          JSON.stringify({ choices: [{ delta: { reasoning: '摘要' } }] }),
          JSON.stringify({ choices: [{ delta: { content: '答案' } }] }),
          JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } })
        ]
      }
    ])
    try {
      const thoughts: string[] = []
      const ep: Endpoint = { baseUrl: mock.url + '/v1', apiKey: null, transport: 'openai_chat' }
      const r = await drain(streamChat(ep, { model: 'r1', messages: [{ role: 'user', content: 'hi' }], onThinking: (d) => thoughts.push(d) }))
      expect(thoughts).toEqual(['先看', '摘要'])
      expect(r.text).toBe('答案')
    } finally {
      await mock.close()
    }
  })

  it('内联 <think> 标签：思考内容也交给 onThinking，正文照常剔除', async () => {
    const mock = await startMockServer([
      {
        path: '/v1/chat/completions',
        sse: [
          JSON.stringify({ choices: [{ delta: { content: '<think>让我想' } }] }),
          JSON.stringify({ choices: [{ delta: { content: '想</think>结论' } }] })
        ]
      }
    ])
    try {
      const thoughts: string[] = []
      const ep: Endpoint = { baseUrl: mock.url + '/v1', apiKey: null, transport: 'openai_chat' }
      const r = await drain(streamChat(ep, { model: 'q', messages: [{ role: 'user', content: 'hi' }], onThinking: (d) => thoughts.push(d) }))
      expect(thoughts.join('')).toBe('让我想想')
      expect(r.text).toBe('结论')
    } finally {
      await mock.close()
    }
  })
})

describe('截图提问：图片内容段', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo='
  it('openai_chat：多段内容转成 content parts，图片是 image_url', async () => {
    const mock = await startMockServer([{ path: '/v1/chat/completions', sse: [JSON.stringify({ choices: [{ delta: { content: '好' } }] })] }])
    try {
      const ep: Endpoint = { baseUrl: mock.url + '/v1', apiKey: null, transport: 'openai_chat' }
      await drain(streamChat(ep, { model: 'm', messages: [{ role: 'user', content: [{ type: 'image', dataUrl: png }, { type: 'text', text: '这是什么' }] }] }))
      const body = JSON.parse(mock.requests[0].body) as { messages: { content: unknown }[] }
      expect(body.messages[0].content).toEqual([
        { type: 'image_url', image_url: { url: png } },
        { type: 'text', text: '这是什么' }
      ])
    } finally {
      await mock.close()
    }
  })

  it('anthropic_messages：图片是 base64 source 块，system 只取文字', async () => {
    const mock = await startMockServer([{ path: '/v1/messages', sse: [JSON.stringify({ type: 'content_block_delta', delta: { text: '好' } })] }])
    try {
      const ep: Endpoint = { baseUrl: mock.url, apiKey: 'k', transport: 'anthropic_messages' }
      await drain(streamChat(ep, { model: 'm', messages: [{ role: 'system', content: '你是助手' }, { role: 'user', content: [{ type: 'image', dataUrl: png }, { type: 'text', text: '这是什么' }] }] }))
      const body = JSON.parse(mock.requests[0].body) as { system: string; messages: { content: unknown }[] }
      expect(body.system).toBe('你是助手')
      expect(body.messages[0].content).toEqual([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
        { type: 'text', text: '这是什么' }
      ])
    } finally {
      await mock.close()
    }
  })
})

describe('推理开关', () => {
  it('reasoning=true：openai_chat 请求带 reasoning_effort / thinking；anthropic 带 thinking 且不带 temperature', async () => {
    const mock = await startMockServer([
      { path: '/v1/chat/completions', sse: [JSON.stringify({ choices: [{ delta: { content: 'a' } }] })] },
      { path: '/v1/messages', sse: [JSON.stringify({ type: 'content_block_delta', delta: { text: 'a' } })] }
    ])
    try {
      await drain(streamChat({ baseUrl: mock.url + '/v1', apiKey: null, transport: 'openai_chat' }, { model: 'm', messages: [{ role: 'user', content: 'q' }], temperature: 0.4, reasoning: true }))
      const b1 = JSON.parse(mock.requests[0].body) as Record<string, unknown>
      expect(b1.reasoning_effort).toBe('medium')
      expect(b1.thinking).toEqual({ type: 'enabled' })
      await drain(streamChat({ baseUrl: mock.url, apiKey: 'k', transport: 'anthropic_messages' }, { model: 'm', messages: [{ role: 'user', content: 'q' }], temperature: 0.4, reasoning: true }))
      const b2 = JSON.parse(mock.requests[1].body) as Record<string, unknown>
      expect(b2.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 })
      expect(b2.temperature).toBeUndefined()
      expect(b2.max_tokens as number).toBeGreaterThan(4096)
    } finally {
      await mock.close()
    }
  })

  it('模型不认推理参数（400）：去掉参数重发一次，用户无感', async () => {
    const mock = await startMockServer([{ path: '/v1/chat/completions', sse: [JSON.stringify({ choices: [{ delta: { content: '答' } }] })] }])
    // 第一次带参数的请求让 mock 返回 400：用 hang/status 路由不好表达，直接改 mock 的 handler 行为——
    // 这里用一个小代理：首个含 reasoning_effort 的请求回 400
    const { createServer } = await import('node:http')
    const { request: httpRequest } = await import('node:http')
    let rejected = 0
    const proxy = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        if (body.includes('reasoning_effort')) {
          rejected++
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'Unsupported parameter: reasoning_effort' } }))
          return
        }
        const target = new URL(mock.url)
        const up = httpRequest({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (upRes) => {
          res.writeHead(upRes.statusCode ?? 502, upRes.headers)
          upRes.pipe(res)
        })
        up.end(body)
      })
    })
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
    const port = (proxy.address() as { port: number }).port
    try {
      const r = await drain(streamChat({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: null, transport: 'openai_chat' }, { model: 'm', messages: [{ role: 'user', content: 'q' }], reasoning: true }))
      expect(rejected).toBe(1)
      expect(r.text).toBe('答')
      expect(mock.requests.length).toBe(1) // 只有去掉参数的那次到达上游
    } finally {
      proxy.close()
      await mock.close()
    }
  })
})

describe('默认会思考的模型：没要求思考时明确关掉', () => {
  it('deepseek 模型不带 reasoning：请求带 thinking: disabled；其他模型什么推理参数都不带', async () => {
    const mock = await startMockServer([{ path: '/v1/chat/completions', sse: [JSON.stringify({ choices: [{ delta: { content: 'a' } }] })] }])
    try {
      const ep: Endpoint = { baseUrl: mock.url + '/v1', apiKey: null, transport: 'openai_chat' }
      await drain(streamChat(ep, { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'q' }] }))
      const b1 = JSON.parse(mock.requests[0].body) as Record<string, unknown>
      expect(b1.thinking).toEqual({ type: 'disabled' })
      expect(b1.reasoning_effort).toBeUndefined()
      await drain(streamChat(ep, { model: 'gpt-5', messages: [{ role: 'user', content: 'q' }] }))
      const b2 = JSON.parse(mock.requests[1].body) as Record<string, unknown>
      expect(b2.thinking).toBeUndefined()
      expect(b2.reasoning_effort).toBeUndefined()
    } finally {
      await mock.close()
    }
  })

  it('网关不认 thinking 参数（400）：去掉参数重发一次', async () => {
    const mock = await startMockServer([{ path: '/v1/chat/completions', sse: [JSON.stringify({ choices: [{ delta: { content: '答' } }] })] }])
    const { createServer, request: httpRequest } = await import('node:http')
    let rejected = 0
    const proxy = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        if (body.includes('"thinking"')) {
          rejected++
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'Unrecognized request argument supplied: thinking' } }))
          return
        }
        const target = new URL(mock.url)
        const up = httpRequest({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (upRes) => {
          res.writeHead(upRes.statusCode ?? 502, upRes.headers)
          upRes.pipe(res)
        })
        up.end(body)
      })
    })
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
    const port = (proxy.address() as { port: number }).port
    try {
      const r = await drain(streamChat({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: null, transport: 'openai_chat' }, { model: 'deepseek-chat', messages: [{ role: 'user', content: 'q' }] }))
      expect(rejected).toBe(1)
      expect(r.text).toBe('答')
      expect(mock.requests.length).toBe(1)
    } finally {
      proxy.close()
      await mock.close()
    }
  })
})
