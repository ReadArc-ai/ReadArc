/**
 * 渲染进程 pdf.js 的资源加载：CMap、标准字体、wasm 都走 IPC 从主进程读，
 * 不依赖页面用什么协议加载（打包后是 file://，fetch 不到 node_modules）。
 * 缺 CMap 时非内嵌中文字体的 PDF 会整页空白。
 */
type Kind = 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl'

const cache = new Map<string, Promise<Uint8Array>>()

/** pdf.js 的 BinaryDataFactory 接口：构造参数是三个 baseUrl（这里用不上），fetch 按类型 + 文件名给字节 */
export class IpcBinaryDataFactory {
  constructor(_opts: { cMapUrl?: string | null; standardFontDataUrl?: string | null; wasmUrl?: string | null }) {}

  fetch({ kind, filename }: { kind: Kind; filename: string }): Promise<Uint8Array> {
    const key = `${kind}/${filename}`
    let p = cache.get(key)
    if (!p) {
      p = window.readarc.pdfAsset(kind, filename).then((buf) => {
        if (!buf) throw new Error(`pdf.js asset missing: ${key}`)
        return new Uint8Array(buf)
      })
      cache.set(key, p)
      p.catch(() => cache.delete(key))
    }
    return p
  }
}

/** 传给 getDocument 的公共参数：资源 URL 只是占位，真正的读取在 IpcBinaryDataFactory */
export function pdfAssetOptions(): {
  useWorkerFetch: false
  cMapUrl: string
  cMapPacked: true
  standardFontDataUrl: string
  wasmUrl: string
  BinaryDataFactory: typeof IpcBinaryDataFactory
} {
  return {
    useWorkerFetch: false,
    cMapUrl: 'ipc://cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'ipc://standard_fonts/',
    wasmUrl: 'ipc://wasm/',
    BinaryDataFactory: IpcBinaryDataFactory
  }
}
