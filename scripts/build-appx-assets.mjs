// 从 build/icon.png 生成 Microsoft Store（MSIX）的磁贴、商店与任务栏图标，写入 build/appx/。
// 没有这些文件时 electron-builder 会塞进它自带的示例图标。图标改版后重跑：npm run appx:assets
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const OUT = 'build/appx'
const SCALES = [100, 125, 150, 200, 400]
// 任务栏、开始菜单列表、文件关联图标按像素尺寸取图（targetsize），不走缩放系数
const TARGET_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]

// [资源名, 100% 时的宽, 高, 图标边长占高度的比例]。磁贴的底色由 appx.backgroundColor 铺满，
// 图标缩小居中；商店图标与 44px 应用图标本身就是满版圆角方块，不再留白
const ASSETS = [
  ['StoreLogo', 50, 50, 1],
  ['Square44x44Logo', 44, 44, 1],
  ['SmallTile', 71, 71, 0.66],
  ['Square150x150Logo', 150, 150, 0.66],
  ['Wide310x150Logo', 310, 150, 0.66],
  ['LargeTile', 310, 310, 0.66]
]

const icon = await loadImage('build/icon.png')

function render(width, height, ratio) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const side = Math.round(height * ratio)
  ctx.drawImage(icon, Math.round((width - side) / 2), Math.round((height - side) / 2), side, side)
  return canvas.toBuffer('image/png')
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
let count = 0
const write = (name, png) => {
  writeFileSync(`${OUT}/${name}`, png)
  count++
}

for (const [name, w, h, ratio] of ASSETS) {
  for (const scale of SCALES) {
    write(`${name}.scale-${scale}.png`, render(Math.round((w * scale) / 100), Math.round((h * scale) / 100), ratio))
  }
}
for (const size of TARGET_SIZES) {
  const png = render(size, size, 1)
  write(`Square44x44Logo.targetsize-${size}.png`, png)
  // 图标自带深色底板，任务栏上不需要系统再垫一层强调色
  write(`Square44x44Logo.targetsize-${size}_altform-unplated.png`, png)
  write(`Square44x44Logo.targetsize-${size}_altform-lightunplated.png`, png)
}
console.log(`已生成 ${count} 个 MSIX 图标到 ${OUT}/`)
