/** 测试用本地 HTTP mock：SSE 与 JSON 路由。仅测试引用。 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface MockRoute {
  path: string
  status?: number
  /** SSE：按顺序推送 data: 行 */
  sse?: string[]
  json?: unknown
  /** 挂死：打开流后不再发送任何数据也不关闭（测超时看门狗） */
  hang?: boolean
  /** SSE 分片之间的间隔（毫秒）：给「中途停止」留出观察窗口 */
  sseDelayMs?: number
}

export interface MockServer {
  url: string
  server: Server
  requests: { path: string; body: string; headers: Record<string, string | string[] | undefined> }[]
  close(): Promise<void>
}

export async function startMockServer(routes: MockRoute[]): Promise<MockServer> {
  const requests: MockServer['requests'] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      requests.push({ path: req.url ?? '', body, headers: req.headers })
      const route = routes.find((r) => req.url === r.path)
      if (!route) {
        res.writeHead(404).end('not found')
        return
      }
      if (route.hang) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(': open\n\n') // 头已到、无后续分片
        return
      }
      if (route.sse) {
        res.writeHead(route.status ?? 200, { 'Content-Type': 'text/event-stream' })
        const lines = route.sse
        if (route.sseDelayMs) {
          // 客户端中止后 socket 已关，继续写会触发 error 事件：吞掉，测试只关心客户端一侧
          res.on('error', () => {})
          let i = 0
          const tick = (): void => {
            if (res.destroyed) return
            if (i < lines.length) {
              res.write(`data: ${lines[i++]}\n\n`)
              setTimeout(tick, route.sseDelayMs)
            } else {
              res.write('data: [DONE]\n\n')
              res.end()
            }
          }
          tick()
        } else {
          for (const data of lines) res.write(`data: ${data}\n\n`)
          res.write('data: [DONE]\n\n')
          res.end()
        }
      } else {
        res.writeHead(route.status ?? 200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(route.json ?? {}))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
