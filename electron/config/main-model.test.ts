import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { absorbAskRouteIntoMain, loadMainModel, saveMainModel } from './main-model'
import { loadTaskRoutes } from './tasks-config'
import type { ConfigRoots } from './providers-config'

let base: string
let roots: ConfigRoots

const configPath = (): string => join(roots.readarcDir, 'config.yaml')
const write = (text: string): void => writeFileSync(configPath(), text)

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'readarc-main-'))
  roots = { readarcDir: join(base, '.readarc') }
  mkdirSync(roots.readarcDir, { recursive: true })
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('默认模型（main:）', () => {
  it('保存后可读回；只写 provider 时读回的 model 为空串（= 该来源默认模型）', () => {
    saveMainModel({ provider: 'deepseek', model: 'deepseek-chat' }, roots)
    expect(loadMainModel(roots)).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })

    saveMainModel({ provider: 'ollama', model: '' }, roots)
    expect(loadMainModel(roots)).toEqual({ provider: 'ollama', model: '' })
    // 旧的 model 行必须被清掉，否则路由会拿 ollama 去请求 deepseek-chat
    expect(readFileSync(configPath(), 'utf8')).not.toContain('deepseek-chat')
  })

  it('手写配置里 main 只有 provider 也能读', () => {
    write('main:\n  provider: siliconflow\n')
    expect(loadMainModel(roots)).toEqual({ provider: 'siliconflow', model: '' })
  })

  it('没有 main 块或 provider 为空 → null', () => {
    write('providers: {}\n')
    expect(loadMainModel(roots)).toBeNull()
    write('main:\n  provider: ""\n  model: x\n')
    expect(loadMainModel(roots)).toBeNull()
  })
})

describe('老配置迁移：tasks.ask 并入默认模型', () => {
  it('ask 指定了模型 → 成为默认模型，ask 复位为 auto，其余路由不动', () => {
    write(
      [
        '# 用户注释要保留',
        'main:',
        '  provider: siliconflow',
        '  model: Qwen/Qwen3-32B',
        'tasks:',
        '  translate:',
        '    provider: deepseek',
        '    model: deepseek-chat',
        '  ask:',
        '    provider: anthropic',
        '    model: claude-sonnet-4-5',
        ''
      ].join('\n')
    )
    expect(absorbAskRouteIntoMain(roots)).toBe(true)
    expect(loadMainModel(roots)).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5' })
    const routes = loadTaskRoutes(roots)
    expect(routes.ask).toEqual({ provider: 'auto' })
    expect(routes.translate).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
    expect(readFileSync(configPath(), 'utf8')).toContain('# 用户注释要保留')
  })

  it('ask 只指定了来源没指定模型 → 默认模型只带 provider', () => {
    write('tasks:\n  ask:\n    provider: ollama\n')
    expect(absorbAskRouteIntoMain(roots)).toBe(true)
    expect(loadMainModel(roots)).toEqual({ provider: 'ollama', model: '' })
    expect(loadTaskRoutes(roots).ask).toEqual({ provider: 'auto' })
  })

  it('ask 本来就是 auto → 不碰文件', () => {
    write('main:\n  provider: deepseek\n  model: deepseek-chat\ntasks:\n  ask:\n    provider: auto\n')
    const before = statSync(configPath()).mtimeMs
    expect(absorbAskRouteIntoMain(roots)).toBe(false)
    expect(statSync(configPath()).mtimeMs).toBe(before)
    expect(loadMainModel(roots)).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })

  it('没有配置文件 → 不报错、不创建文件', () => {
    expect(absorbAskRouteIntoMain(roots)).toBe(false)
    expect(() => statSync(configPath())).toThrow()
  })
})
