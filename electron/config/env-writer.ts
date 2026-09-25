/**
 * 密钥写入 ~/.readarc/.env（行级 upsert，0600 权限）。
 * 只写这一个文件；附加密钥文件（READARC_ENV_FILE）只读不写。
 * 解析顺序里 readarc 在前，所以这里写的值优先生效。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultRoots, type ConfigRoots } from './providers-config'

export function upsertEnvVar(
  keyEnv: string,
  value: string,
  roots: ConfigRoots = defaultRoots()
): void {
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(keyEnv)) {
    throw new Error(`非法环境变量名：${keyEnv}`)
  }
  const path = join(roots.readarcDir, '.env')
  const src = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const lines = src.split('\n')
  const re = new RegExp(`^(export\\s+)?${keyEnv}=`)
  const idx = lines.findIndex((l) => re.test(l.trim()))
  const entry = `${keyEnv}=${value}`
  if (idx >= 0) lines[idx] = entry
  else {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    lines.push(entry, '')
  }
  mkdirSync(roots.readarcDir, { recursive: true })
  writeFileSync(path, lines.join('\n'), 'utf8')
  chmodSync(path, 0o600)
}
