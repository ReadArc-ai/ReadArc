/**
 * 流式 chat transport：openai_chat（SSE）与 anthropic_messages。
 * 请求直连供应商，不经任何中间服务器（架构铁律）。
 */
import { fetch as undiciFetch, ProxyAgent, type RequestInit as UndiciRequestInit, type Response as UndiciResponse } from 'undici'
import type { Transport } from '../config/providers-config'
import { uiText } from '../i18n'

/**
 * 统一用 npm 包 undici 的 fetch 发请求，而不是全局 fetch：
 * Electron 主进程的全局 fetch 是 Node 自带那份 undici，与 npm 包不是同一版本，
 * 把 npm 包的 ProxyAgent 当 dispatcher 传给它会报「invalid onRequestStart method」，
 * 表现为所有走代理的请求一律 "fetch failed"。同一个包里的 fetch + ProxyAgent 才配套。
 * 出错时把底层原因（ECONNREFUSED、代理 407 之类）带进消息，别只剩一句 fetch failed。
 */
async function doFetch(url: string, init: UndiciRequestInit): Promise<UndiciResponse> {
  try {
    return await undiciFetch(url, init)
  } catch (err) {
    throw new Error(fetchErrorText(err), { cause: err })
  }
}

/** "fetch failed" 只是外壳，真正原因在 cause 链里（可能套好几层） */
export function fetchErrorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const parts: string[] = []
  let cur: unknown = err
  for (let i = 0; i < 4 && cur instanceof Error; i++) {
    const code = (cur as Error & { code?: string }).code
    const msg = cur.message
    if (msg && msg !== 'fetch failed') {
      const part = code && !msg.includes(code) ? `${msg} (${code})` : msg
      // 同一句话在 cause 链里常重复出现（外层包一次、内层再包一次），只留一次
      if (!parts.includes(part)) parts.push(part)
    }
    cur = (cur as Error & { cause?: unknown }).cause
  }
  return parts.length > 0 ? parts.join(' ← ') : err.message
}

/** 消息内容的一段：文字，或一张图（data URL；截图提问用） */
export type ChatPart = { type: 'text'; text: string } | { type: 'image'; dataUrl: string }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ChatPart[]
}

/** 只取文字部分（system 拼接、日志等用） */
export function textOf(content: string | ChatPart[]): string {
  return typeof content === 'string' ? content : content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n')
}

function splitDataUrl(dataUrl: string): { mediaType: string; data: string } {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl)
  return m ? { mediaType: m[1], data: m[2] } : { mediaType: 'image/png', data: dataUrl }
}

/** OpenAI 兼容格式：纯文字原样，多段用 content parts（image_url 带 data URL） */
function toOpenAIMessage(m: ChatMessage): { role: string; content: unknown } {
  if (typeof m.content === 'string') return { role: m.role, content: m.content }
  return {
    role: m.role,
    content: m.content.map((p) =>
      p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: p.dataUrl } }
    )
  }
}

/** Anthropic Messages 格式：图片是 base64 source 块 */
function toAnthropicMessage(m: ChatMessage): { role: string; content: unknown } {
  if (typeof m.content === 'string') return { role: m.role, content: m.content }
  return {
    role: m.role,
    content: m.content.map((p) => {
      if (p.type === 'text') return { type: 'text', text: p.text }
      const { mediaType, data } = splitDataUrl(p.dataUrl)
      return { type: 'image', source: { type: 'base64', media_type: mediaType, data } }
    })
  }
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  /** 调用方可中止（对话面板的「停止」）；只在主进程内传递，不过 IPC */
  signal?: AbortSignal
  /** 推理模型的思考流（reasoning_content / <think> / thinking_delta）：不算回答，只给界面展示进度 */
  onThinking?: (delta: string) => void
  /** 要求模型先思考再回答（Claude / OpenAI o 系列 / 网关默认不思考，得在请求里开）；
   *  模型或网关不认这些参数（HTTP 400）时自动去掉重发一次 */
  reasoning?: boolean
}

/**
 * 默认就会思考的模型：不带参数时每次调用都先输出一段 reasoning，翻译 / 摘要这类不需要
 * 思考的任务会多花约 3 倍输出 token、时间翻倍（DeepSeek V4 flash 实测 4.1s → 1.9s）。
 * 这类模型在没要求思考时明确发 thinking: disabled。
 */
export function thinksByDefault(model: string): boolean {
  return /deepseek/i.test(model)
}

/** 判断 400 是不是「不认推理参数」：认得出来就去掉参数重发，别让整条降级链因此换供应商 */
function rejectsReasoningParams(detail: string): boolean {
  return /reason|think|unsupported|unrecognized|unknown|not (?:a )?(?:valid|supported)|extra|invalid/i.test(detail)
}

/** 读一个非 2xx 响应的正文（截断），拿不到就空串 */
async function errorDetail(res: UndiciResponse): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return ''
  }
}


export interface Usage {
  inputTokens: number
  outputTokens: number
}

export interface ChatResult {
  text: string
  usage: Usage
}

export interface Endpoint {
  baseUrl: string
  apiKey: string | null
  transport: Transport
  /** 该端点绑定的代理 URL（空/缺省 = 直连）；由路由层按 endpoint_proxy 绑定解析 */
  proxyUrl?: string
}

/* ---- 代理调度器缓存：同一 URL 复用连接池 ---- */
const agents = new Map<string, ProxyAgent>()

function agentFor(url: string): ProxyAgent | undefined {
  if (!url) return undefined
  let a = agents.get(url)
  if (!a) {
    try {
      a = new ProxyAgent(url)
      agents.set(url, a)
    } catch {
      return undefined // 非法代理地址视为直连
    }
  }
  return a
}

/** 连通性测试：经给定代理（空 = 直连）请求 204 端点，5s 超时。 */
export async function testProxyConnectivity(proxyUrl: string): Promise<boolean> {
  const agent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await doFetch('https://www.gstatic.com/generate_204', {
      signal: ctrl.signal,
      dispatcher: agent
    })
    return res.status === 204 || res.ok
  } finally {
    clearTimeout(timer)
  }
}

/** 选请求调度器：端点绑定了代理就走它，否则直连。 */
export function dispatcherFor(ep: Endpoint): ProxyAgent | undefined {
  return agentFor(ep.proxyUrl ?? '')
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

/** SSE 行流：yield 每个 data: 载荷（不含 [DONE]）。 */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data && data !== '[DONE]') yield data
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path
}

async function requireBody(res: UndiciResponse, label: string): Promise<ReadableStream<Uint8Array>> {
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 300)
    } catch {
      /* 忽略读取失败 */
    }
    throw new TransportError(`${label} HTTP ${res.status}${detail ? `: ${detail}` : ''}`, res.status)
  }
  if (!res.body) throw new TransportError(`${label}: empty response body`)
  return res.body
}

/**
 * 推理模型经 OpenAI 兼容网关时常把思考过程以 <think>…</think> 混在 content 里流出来
 * （DeepSeek-R1 系、Qwen3、MiniMax 等）。思考不是回答：既不能上屏，也不能进翻译缓存——
 * 实测曾把「The user wants me to translate…」整段写进镜像译文页。
 * 标签可能被切在两个分片之间，所以按流做状态机，尾部留一小段待定。
 */
export function createThinkFilter(onThink?: (delta: string) => void): { push(delta: string): string; flush(): string } {
  const OPEN = '<think>'
  const CLOSE = '</think>'
  let inside = false
  let carry = ''
  // 尾部若是某个标签的前缀（如 "<thi"），先扣下来等下一片再判
  const tailCandidate = (s: string, tag: string): string => {
    for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) {
      if (tag.startsWith(s.slice(s.length - n))) return s.slice(s.length - n)
    }
    return ''
  }
  return {
    push(delta) {
      let s = carry + delta
      carry = ''
      let out = ''
      for (;;) {
        if (inside) {
          const j = s.indexOf(CLOSE)
          if (j < 0) {
            carry = tailCandidate(s, CLOSE)
            // 思考内容不上屏、不进缓存，但交给调用方展示进度
            const inner = s.slice(0, s.length - carry.length)
            if (inner && onThink) onThink(inner)
            return out
          }
          if (j > 0 && onThink) onThink(s.slice(0, j))
          s = s.slice(j + CLOSE.length)
          inside = false
        } else {
          const i = s.indexOf(OPEN)
          if (i < 0) {
            const t = tailCandidate(s, OPEN)
            out += s.slice(0, s.length - t.length)
            carry = t
            return out
          }
          out += s.slice(0, i)
          s = s.slice(i + OPEN.length)
          inside = true
        }
      }
    },
    flush() {
      const rest = inside ? '' : carry
      carry = ''
      return rest
    }
  }
}

/** 流活性心跳：任何 SSE 数据事件（含推理模型的思考流）都算「还活着」。 */
export interface Heartbeat {
  touch(): void
}

async function* streamOpenAI(
  ep: Endpoint,
  req: ChatRequest,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
  beat?: Heartbeat
): AsyncGenerator<string, ChatResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (ep.apiKey) headers['Authorization'] = `Bearer ${ep.apiKey}`
  // 推理参数三种形态：on = 要求思考；off = 明确关掉（默认会思考的模型，见 thinksByDefault）；
  // plain = 不带任何推理参数（模型不认这些参数时的回退）
  const bodyFor = (mode: 'on' | 'off' | 'plain'): string =>
    JSON.stringify({
      model: req.model,
      messages: req.messages.map(toOpenAIMessage),
      stream: true,
      stream_options: { include_usage: true },
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      // 推理开关：OpenAI o 系列 / 多数网关认 reasoning_effort；DeepSeek / 部分网关认 thinking
      ...(mode === 'on' ? { reasoning_effort: 'medium', thinking: { type: 'enabled' } } : {}),
      ...(mode === 'off' ? { thinking: { type: 'disabled' } } : {})
    })
  const post = (mode: 'on' | 'off' | 'plain'): Promise<UndiciResponse> =>
    doFetch(joinUrl(ep.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers,
      signal,
      dispatcher: dispatcherFor(ep),
      body: bodyFor(mode)
    })
  const mode = req.reasoning ? 'on' : thinksByDefault(req.model) ? 'off' : 'plain'
  let res = await post(mode)
  if (mode !== 'plain' && res.status === 400) {
    const detail = await errorDetail(res)
    if (rejectsReasoningParams(detail)) res = await post('plain')
    else throw new TransportError(`chat/completions HTTP 400${detail ? `: ${detail}` : ''}`, 400)
  }
  const body = await requireBody(res, 'chat/completions')

  let text = ''
  const usage: Usage = { inputTokens: 0, outputTokens: 0 }
  const think = createThinkFilter(req.onThinking)
  for await (const data of sseData(body)) {
    // 任何数据事件都重置空闲计时：推理模型（deepseek 等）会先输出较长的
    // reasoning_content 才产生正文——思考阶段连接是活跃的，不应触发空闲超时
    beat?.touch()
    let parsed: {
      choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    try {
      parsed = JSON.parse(data)
    } catch {
      continue
    }
    // 思考流：DeepSeek / SiliconFlow 用 reasoning_content，OpenRouter 等用 reasoning
    const d0 = parsed.choices?.[0]?.delta
    const reasoning = d0?.reasoning_content ?? d0?.reasoning
    if (reasoning && req.onThinking) req.onThinking(reasoning)
    const delta = d0?.content
    if (delta) {
      const visible = think.push(delta)
      if (visible) {
        text += visible
        onChunk(visible)
        yield visible
      }
    }
    if (parsed.usage) {
      usage.inputTokens = parsed.usage.prompt_tokens ?? 0
      usage.outputTokens = parsed.usage.completion_tokens ?? 0
    }
  }
  const rest = think.flush()
  if (rest) {
    text += rest
    onChunk(rest)
    yield rest
  }
  return { text, usage }
}

async function* streamAnthropic(
  ep: Endpoint,
  req: ChatRequest,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
  beat?: Heartbeat
): AsyncGenerator<string, ChatResult> {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01'
  }
  if (ep.apiKey) headers['x-api-key'] = ep.apiKey
  // 开思考时 Anthropic 不允许再设 temperature，且 max_tokens 必须大于思考预算
  const bodyFor = (reasoning: boolean): string => {
    const budget = 4096
    const maxTokens = req.maxTokens ?? 4096
    return JSON.stringify({
      model: req.model,
      max_tokens: reasoning ? Math.max(maxTokens, budget + 2048) : maxTokens,
      stream: true,
      ...(system ? { system } : {}),
      ...(req.temperature !== undefined && !reasoning ? { temperature: req.temperature } : {}),
      ...(reasoning ? { thinking: { type: 'enabled', budget_tokens: budget } } : {}),
      messages: req.messages.filter((m) => m.role !== 'system').map(toAnthropicMessage)
    })
  }
  const post = (reasoning: boolean): Promise<UndiciResponse> =>
    doFetch(joinUrl(ep.baseUrl, '/v1/messages'), {
      method: 'POST',
      dispatcher: dispatcherFor(ep),
      headers,
      signal,
      body: bodyFor(reasoning)
    })
  let res = await post(!!req.reasoning)
  if (req.reasoning && res.status === 400) {
    const detail = await errorDetail(res)
    if (rejectsReasoningParams(detail)) res = await post(false)
    else throw new TransportError(`v1/messages HTTP 400${detail ? `: ${detail}` : ''}`, 400)
  }
  const body = await requireBody(res, 'v1/messages')

  let text = ''
  const usage: Usage = { inputTokens: 0, outputTokens: 0 }
  for await (const data of sseData(body)) {
    beat?.touch() // thinking_delta 等事件同样算活性
    let parsed: {
      type?: string
      delta?: { type?: string; text?: string; thinking?: string }
      message?: { usage?: { input_tokens?: number } }
      usage?: { output_tokens?: number }
    }
    try {
      parsed = JSON.parse(data)
    } catch {
      continue
    }
    if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'thinking_delta' && parsed.delta.thinking) {
      req.onThinking?.(parsed.delta.thinking)
    } else if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
      text += parsed.delta.text
      onChunk(parsed.delta.text)
      yield parsed.delta.text
    } else if (parsed.type === 'message_start') {
      usage.inputTokens = parsed.message?.usage?.input_tokens ?? 0
    } else if (parsed.type === 'message_delta') {
      usage.outputTokens = parsed.usage?.output_tokens ?? 0
    }
  }
  return { text, usage }
}

/** 统一入口：流式产出增量文本，最终返回全文与用量。 */
/** 空闲看门狗阈值：连续无输出超过该时长视为连接挂死。测试可调小。 */
let idleTimeoutMs = 90_000
export function setIdleTimeoutMs(ms: number): void {
  idleTimeoutMs = ms
}

export async function* withIdleWatchdog(
  inner: AsyncGenerator<string, ChatResult>,
  ctrl: AbortController,
  beat?: { touch: () => void }
): AsyncGenerator<string, ChatResult> {
  let timedOut = false
  const fire = (): void => {
    timedOut = true
    ctrl.abort()
  }
  let timer = setTimeout(fire, idleTimeoutMs)
  // 传输层每收到一个 SSE 数据事件（含思考流）就重置计时——
  // 只有连接真正无事件静默超过阈值才判定超时
  if (beat) {
    beat.touch = () => {
      clearTimeout(timer)
      timer = setTimeout(fire, idleTimeoutMs)
    }
  }
  try {
    for (;;) {
      let r: IteratorResult<string, ChatResult>
      try {
        r = await inner.next()
      } catch (err) {
        if (timedOut) {
          throw new TransportError(uiText('model.stream-timeout', { seconds: Math.round(idleTimeoutMs / 1000) }), 408)
        }
        throw err
      }
      clearTimeout(timer)
      if (r.done) return r.value
      timer = setTimeout(fire, idleTimeoutMs)
      yield r.value
    }
  } finally {
    clearTimeout(timer)
  }
}

export function streamChat(
  ep: Endpoint,
  req: ChatRequest,
  onChunk: (text: string) => void = () => {},
  signal?: AbortSignal
): AsyncGenerator<string, ChatResult> {
  // 空闲监测：挂死的连接会永远占住翻译并发位——90s 无事件即中止，
  // 上层按普通失败走降级/重试。推理模型的思考流也计入活性（beat），
  // 否则长思考会被误判为超时，陷入「中止→重试→重新思考→再中止」的循环。
  const ctrl = new AbortController()
  // 已经中止的 signal 不会再派发 abort 事件：进来时就得看一眼
  if (signal?.aborted) ctrl.abort()
  else if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  const beat: Heartbeat = { touch: () => {} }
  const inner =
    ep.transport === 'anthropic_messages'
      ? streamAnthropic(ep, req, onChunk, ctrl.signal, beat)
      : streamOpenAI(ep, req, onChunk, ctrl.signal, beat)
  return withIdleWatchdog(inner, ctrl, beat)
}

/** GET /v1/models —— 模型列表发现；失败抛错，上层允许手填模型名。 */
export async function listModels(ep: Endpoint, signal?: AbortSignal): Promise<string[]> {
  const headers: Record<string, string> = {}
  // Anthropic 的列表在 /v1/models，认证用 x-api-key（与 /v1/messages 一致），不认 Bearer
  const anthropic = ep.transport === 'anthropic_messages'
  if (anthropic) {
    headers['anthropic-version'] = '2023-06-01'
    if (ep.apiKey) headers['x-api-key'] = ep.apiKey
  } else if (ep.apiKey) headers['Authorization'] = `Bearer ${ep.apiKey}`
  const res = await doFetch(joinUrl(ep.baseUrl, anthropic ? '/v1/models' : '/models'), {
    headers,
    dispatcher: dispatcherFor(ep),
    signal
  })
  if (!res.ok) throw new TransportError(`GET /models HTTP ${res.status}`, res.status)
  const parsed = (await res.json()) as { data?: { id?: string }[] }
  return (parsed.data ?? []).map((m) => m.id ?? '').filter(Boolean)
}

/** 列表里不能用来对话的模型：向量、语音、图像、审核、重排等 */
const NON_CHAT_MODEL = /embed|whisper|tts|speech|transcri|audio|realtime|dall-e|image|moderation|rerank|davinci|babbage|search/i

/** 没指定模型时从列表里挑一个能对话的；全被过滤掉就退回第一个 */
export function pickChatModel(models: string[]): string | undefined {
  return models.find((m) => !NON_CHAT_MODEL.test(m)) ?? models[0]
}
