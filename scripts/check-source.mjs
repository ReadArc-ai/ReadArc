import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))
const errors = []
const required = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'CONTRIBUTING.md',
  'PRIVACY.md', 'PRIVACY.en.md', 'README.md', 'README.en.md', 'package.json', 'package-lock.json',
  '.nvmrc', '.github/workflows/ci.yml', 'build/icon.icns', 'build/icon.png',
  'build/entitlements.mas.plist', 'build/entitlements.mas.inherit.plist', 'build/entitlements.mas.loginhelper.plist',
  'resources/dict/ecdict.sqlite', 'resources/dict/LICENSE.ECDICT', 'resources/models/README.md',
  'scripts/download-model.mjs', 'scripts/build-dict.mjs', 'scripts/verify-package.cjs', 'scripts/verify-package.test.cjs', 'scripts/check-source.mjs']
for (const name of required) {
  if (!files.has(name) || !existsSync(resolve(root, name))) errors.push(`缺少可提交的发布文件：${name}`)
}
for (const doc of ['README.md', 'README.en.md']) {
  const text = readFileSync(resolve(root, doc), 'utf8')
  for (const match of text.matchAll(/<img\b[^>]*src="([^"]+)"/g)) {
    if (!files.has(match[1]) || !existsSync(resolve(root, match[1]))) errors.push(`${doc} 缺少截图：${match[1]}`)
  }
}
const secrets = /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16})/
for (const file of files) {
  if (/(^|\/)(\.env(?:\..*)?|node_modules|release|local|design)(\/|$)|\.(p12|pfx|p8|pem|key|provisionprofile|mobileprovision|onnx|part)$/.test(file)) {
    errors.push(`不应提交的本地文件：${file}`)
    continue
  }
  const path = resolve(root, file)
  if (!existsSync(path)) { errors.push(`索引中的文件不存在：${file}`); continue }
  const stat = lstatSync(path)
  if (!stat.isFile()) continue
  if (stat.size > 50 * 1024 * 1024) errors.push(`超过 50 MiB 的源码文件：${file}`)
  const buf = readFileSync(path)
  if (buf.includes(0)) continue
  const lines = buf.toString('utf8').split('\n')
  lines.forEach((line, i) => {
    if (secrets.test(line)) errors.push(`疑似密钥（内容已隐藏）：${file}:${i + 1}`)
  })
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`源码候选文件检查通过（${files.size} 个文件）：发布资源齐全，常见密钥模式未命中。`)
console.log('此检查包含未跟踪文件；发布前仍需提交源码，并检查 Git 历史和公开仓库设置。')
