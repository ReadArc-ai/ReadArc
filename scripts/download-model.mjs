import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const MODEL_URL =
  'https://www.modelscope.cn/models/RapidAI/RapidLayout/resolve/v1.2.0/onnx/pp_doc_layout/pp_doc_layoutv2.onnx'
const EXPECTED_SHA256 = '0bd2ea0997fe0789f0300292291f8bbf897d890b44a9a3bd5be72afd6198aa90'
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = resolve(projectRoot, 'resources/models/pp_doc_layoutv2.onnx')
const temporary = `${destination}.part`
const verifyOnly = process.argv.includes('--verify')

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function isValid(path) {
  if (!existsSync(path)) return false
  const actual = await sha256(path)
  if (actual === EXPECTED_SHA256) return true
  console.error(`模型校验失败：期望 ${EXPECTED_SHA256}，实际 ${actual}`)
  return false
}

if (await isValid(destination)) {
  console.log(`PP-DocLayoutV2 已存在且 SHA-256 校验通过：${EXPECTED_SHA256}`)
  process.exit(0)
}

if (verifyOnly) {
  console.error('PP-DocLayoutV2 不存在或校验失败；运行 npm run model:download 获取经过校验的文件。')
  process.exit(1)
}

// 该环境变量会关闭 Node 的 TLS 证书校验。下载可执行模型时宁可失败，也不能降级为不安全连接。
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  throw new Error('拒绝在 NODE_TLS_REJECT_UNAUTHORIZED=0 时下载模型；请恢复 TLS 证书校验后重试。')
}

mkdirSync(dirname(destination), { recursive: true })
rmSync(temporary, { force: true })

try {
  console.log(`正在下载 PP-DocLayoutV2：${MODEL_URL}`)
  const response = await fetch(MODEL_URL, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`模型下载失败：HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }))

  const actual = await sha256(temporary)
  if (actual !== EXPECTED_SHA256) {
    throw new Error(`模型校验失败：期望 ${EXPECTED_SHA256}，实际 ${actual}`)
  }
  renameSync(temporary, destination)
  console.log(`模型下载完成，SHA-256：${actual}`)
} catch (error) {
  rmSync(temporary, { force: true })
  throw error
}
