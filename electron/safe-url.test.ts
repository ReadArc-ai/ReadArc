import { describe, expect, it } from 'vitest'
import { assertPublicDownloadUrl, fetchPublicDownload, isDownloadableUrl, isSafeExternalUrl } from './safe-url'

describe('外链协议白名单', () => {
  it('放行正常网页与邮件链接', () => {
    for (const u of [
      'https://arxiv.org/abs/1706.03762',
      'http://example.com/a?b=c#d',
      'mailto:someone@example.com',
      'HTTPS://Example.COM'
    ]) {
      expect(isSafeExternalUrl(u), u).toBe(true)
    }
  })

  it('不放行本地文件与自定义 scheme（PDF 注释是不可信内容）', () => {
    for (const u of [
      'file:///Applications/Calculator.app',
      'file:///etc/passwd',
      'smb://server/share',
      'zoommtg://zoom.us/join?confno=1',
      'ms-msdt:/id',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vscode://file/etc/hosts'
    ]) {
      expect(isSafeExternalUrl(u), u).toBe(false)
    }
  })

  it('解析不了的字符串一律不放行', () => {
    for (const u of ['', 'not a url', '///', '  ']) {
      expect(isSafeExternalUrl(u), JSON.stringify(u)).toBe(false)
    }
  })
})

describe('isDownloadableUrl：只从 http(s) 下载', () => {
  it('放行 http 与 https', () => {
    expect(isDownloadableUrl('https://arxiv.org/pdf/1706.03762v7')).toBe(true)
    expect(isDownloadableUrl('http://export.arxiv.org/pdf/x')).toBe(true)
    expect(isDownloadableUrl('HTTPS://Example.com/a.pdf')).toBe(true)
  })

  it('拒绝本地文件与其他 scheme（pdfUrl 来自检索源的响应）', () => {
    for (const u of ['file:///etc/passwd', 'data:application/pdf;base64,AAAA', 'ftp://x/y.pdf', 'smb://a/b']) {
      expect(isDownloadableUrl(u), u).toBe(false)
    }
  })

  it('解析不了的一律拒绝', () => {
    for (const u of ['', 'not a url', '   ']) expect(isDownloadableUrl(u), JSON.stringify(u)).toBe(false)
  })
})

describe('公网 PDF 下载防护', () => {
  it('拒绝本机、内网、保留地址与内网域名', async () => {
    for (const url of [
      'http://127.0.0.1/a.pdf',
      'http://10.1.2.3/a.pdf',
      'http://192.168.1.2/a.pdf',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/a.pdf',
      'http://[::ffff:127.0.0.1]/a.pdf',
      'http://service.internal/a.pdf',
      'http://printer.local/a.pdf',
      'http://intranet/a.pdf',
      'https://user:password@papers.example/a.pdf'
    ]) {
      await expect(assertPublicDownloadUrl(url), url).rejects.toThrow(/拒绝/)
    }
  })

  it('解析结果只要包含一个内网地址就拒绝', async () => {
    await expect(
      assertPublicDownloadUrl('https://papers.example/a.pdf', async () => ['93.184.216.34', '10.0.0.2'])
    ).rejects.toThrow(/内网|保留地址/)
  })

  it('允许解析到公网地址的下载链接', async () => {
    const parsed = await assertPublicDownloadUrl('https://papers.example/a.pdf', async () => ['93.184.216.34'])
    expect(parsed.href).toBe('https://papers.example/a.pdf')
  })

  it('每次重定向都重新校验，不能跳进内网', async () => {
    const fetchUrl = async (): Promise<Response> =>
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret.pdf' } })

    await expect(
      fetchPublicDownload('https://papers.example/a.pdf', {}, { resolveHost: async () => ['93.184.216.34'], fetchUrl })
    ).rejects.toThrow(/内网|保留地址/)
  })

  it('允许经过已校验的相对重定向下载', async () => {
    const visited: string[] = []
    const fetchUrl = async (url: string): Promise<Response> => {
      visited.push(url)
      return visited.length === 1
        ? new Response(null, { status: 302, headers: { location: '/files/a.pdf' } })
        : new Response('%PDF', { status: 200 })
    }

    const response = await fetchPublicDownload(
      'https://papers.example/download',
      {},
      { resolveHost: async () => ['93.184.216.34'], fetchUrl }
    )
    expect(response.status).toBe(200)
    expect(visited).toEqual(['https://papers.example/download', 'https://papers.example/files/a.pdf'])
  })
})

describe('代理 fake-ip', () => {
  it('域名解析到 198.18.x（Clash / Surge fake-ip）时放行，否则开着代理什么都下不了', async () => {
    const url = await assertPublicDownloadUrl('https://arxiv.org/pdf/2402.10517', async () => ['198.18.2.23'])
    expect(url.hostname).toBe('arxiv.org')
  })
})
