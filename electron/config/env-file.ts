/**
 * .env 解析与密钥解析（config.yaml 只存变量名，真值在 .env / Keychain）。
 * 解析顺序：进程环境变量 → ~/.readarc/.env → READARC_ENV_FILE 指向的附加文件。
 * .env 永不写入 config、永不进日志。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConfigRoots } from './providers-config'
import { defaultRoots } from './providers-config'

/** KEY=value / KEY="value" / 注释与空行。不支持多行值——密钥用不到。 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      // 未加引号时去掉行尾注释
      const hash = value.indexOf(' #')
      if (hash >= 0) value = value.slice(0, hash).trim()
    }
    if (key) out[key] = value
  }
  return out
}

function readEnv(path: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

/** 按 keyEnv 变量名解析密钥真值；找不到返回 null（本地模型无需密钥是常态）。 */
export function resolveApiKey(
  keyEnv: string | null,
  roots: ConfigRoots = defaultRoots()
): string | null {
  if (!keyEnv) return null
  if (process.env[keyEnv]) return process.env[keyEnv] ?? null
  const readarc = readEnv(join(roots.readarcDir, '.env'))
  if (readarc[keyEnv]) return readarc[keyEnv]
  // 附加密钥文件（可选）：已有 .env 的用户不必搬家，指过来即可
  const extra = process.env['READARC_ENV_FILE']
  if (extra) {
    const more = readEnv(extra)
    if (more[keyEnv]) return more[keyEnv]
  }
  return null
}
