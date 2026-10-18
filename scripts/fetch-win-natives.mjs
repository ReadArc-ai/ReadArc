// 商店包同时出 x64 与 arm64，但 npm ci 只装本机架构的 @napi-rs/canvas 平台包。
// 打包前把两个架构的平台包补进 node_modules，版本与已装的 @napi-rs/canvas 保持一致；
// npm pack 按 registry 记录的完整性哈希校验下载内容。
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const readVersion = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
const version = readVersion('node_modules/@napi-rs/canvas')

for (const arch of ['x64', 'arm64']) {
  const name = `@napi-rs/canvas-win32-${arch}-msvc`
  const dest = join('node_modules', name)
  if (existsSync(join(dest, 'package.json')) && readVersion(dest) === version) continue
  const tmp = mkdtempSync(join(tmpdir(), 'readarc-native-'))
  try {
    const [{ filename }] = JSON.parse(
      execSync(`npm pack ${name}@${version} --json --pack-destination "${tmp}"`, { encoding: 'utf8' })
    )
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dest, { recursive: true })
    execSync(`tar -xzf "${join(tmp, filename)}" -C "${dest}" --strip-components=1`)
    console.log(`已补齐 ${name}@${version}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
