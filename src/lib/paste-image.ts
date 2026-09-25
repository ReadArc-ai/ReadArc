/**
 * 从剪贴板 / 拖放的数据里取一张图，转成 PNG data URL（宽度限到 1600px 控制请求体积）。
 * 用系统截图工具截完直接 ⌘V 到输入框就能附图，不必再用应用内的框选。
 */
import { tNow } from '../i18n'

export function imageFileFrom(dt: DataTransfer | null): File | null {
  if (!dt) return null
  for (const item of dt.items ?? []) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) return f
    }
  }
  for (const f of dt.files ?? []) if (f.type.startsWith('image/')) return f
  return null
}

export function fileToPngDataUrl(file: File, maxWidth = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    // 用 data URL 而不是 blob: URL 解码：渲染进程 CSP 只放行 data: 图片
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(tNow('panel.image-read-failed')))
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.naturalWidth)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error(tNow('panel.image-process-failed')))
        return
      }
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = () => reject(new Error(tNow('panel.image-decode-failed')))
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
