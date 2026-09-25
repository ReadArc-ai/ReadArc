import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, recordUsage } from '../db'
import { saveProviderAndKey, usageOverview } from './service'
import { loadMainModel } from '../config/main-model'
import type { ConfigRoots } from '../config/providers-config'

let db: Database.Database
let base: string
let roots: ConfigRoots

/** 一个回环端点（本地模型或本机网关）+ 一个云端供应商。 */
const CONFIG = `providers:
  gateway:
    name: "本机网关"
    base_url: "http://127.0.0.1:15721/v1"
    key_env: "GATEWAY_KEY"
  siliconflow:
    name: "SiliconFlow"
    base_url: "https://api.siliconflow.cn/v1"
    key_env: "SILICONFLOW_API_KEY"
`

function writeConfig(extra = ''): void {
  writeFileSync(join(roots.readarcDir, 'config.yaml'), CONFIG + extra)
}

beforeEach(() => {
  db = openDb(':memory:')
  base = mkdtempSync(join(tmpdir(), 'readarc-usage-'))
  roots = { readarcDir: join(base, '.readarc') }
  mkdirSync(roots.readarcDir, { recursive: true })
  writeConfig()
})

afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

describe('usageOverview：本月用量与花费账本 [P7]', () => {
  it('云端供应商按单价计费', () => {
    // deepseek: $0.27 / $1.10 每百万 token
    recordUsage(db, 'translate', 'siliconflow', 'deepseek-chat', 1_000_000, 1_000_000)
    const o = usageOverview(db, roots)
    expect(o.inputTokens).toBe(1_000_000)
    expect(o.outputTokens).toBe(1_000_000)
    expect(o.spendUsd).toBeCloseTo(0.27 + 1.1, 5)
    expect(o.unknownModels).toEqual([])
  })

  it('回环端点一律 $0——哪怕模型名在单价表里', () => {
    recordUsage(db, 'translate', 'gateway', 'deepseek-chat', 1_000_000, 1_000_000)
    const o = usageOverview(db, roots)
    expect(o.inputTokens).toBe(1_000_000) // token 照记
    expect(o.spendUsd).toBe(0) // 但不计费
  })

  it('单价表里没有的模型不计入花费，但明示出来（不拦截、不假装知道）', () => {
    recordUsage(db, 'translate', 'siliconflow', '某个没收录的模型', 500_000, 500_000)
    const o = usageOverview(db, roots)
    expect(o.spendUsd).toBe(0)
    expect(o.unknownModels).toEqual(['某个没收录的模型'])
  })

  it('只统计本自然月：上个月的账不该混进这个月', () => {
    const lastMonth = new Date()
    lastMonth.setDate(1)
    lastMonth.setHours(0, 0, 0, 0)
    const beforeThisMonth = lastMonth.getTime() - 24 * 3600 * 1000
    db.prepare(
      `INSERT INTO usage_log (ts, task, provider, model, input_tokens, output_tokens)
       VALUES (?, 'translate', 'siliconflow', 'deepseek-chat', 9000000, 9000000)`
    ).run(beforeThisMonth)

    recordUsage(db, 'translate', 'siliconflow', 'deepseek-chat', 1_000_000, 1_000_000)
    const o = usageOverview(db, roots)
    expect(o.spendUsd).toBeCloseTo(0.27 + 1.1, 5) // 只有本月那一笔
  })

  it('没有任何用量时是干净的零，不报错', () => {
    const o = usageOverview(db, roots)
    expect(o).toMatchObject({ inputTokens: 0, outputTokens: 0, spendUsd: 0 })
    expect(o.unknownModels).toEqual([])
  })
})

describe('saveProviderAndKey', () => {
  it('第一把密钥落盘时默认模型指向该来源；已有默认模型不动', () => {
    saveProviderAndKey({ slug: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', keyEnv: 'SILICONFLOW_API_KEY', apiKey: 'sk-1' }, roots)
    expect(loadMainModel(roots)).toEqual({ provider: 'siliconflow', model: '' })
    saveProviderAndKey({ slug: 'gateway', name: '本机网关', baseUrl: 'http://127.0.0.1:15721/v1', keyEnv: 'GATEWAY_KEY', apiKey: 'sk-2' }, roots)
    expect(loadMainModel(roots)).toEqual({ provider: 'siliconflow', model: '' })
  })
})
