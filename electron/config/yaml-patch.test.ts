import { describe, expect, it } from 'vitest'
import { patchYamlValue, upsertYamlMap, removeYamlBlock } from './yaml-patch'

/** 带注释、字段顺序、产品不认识字段的用户配置——这些都必须原样活下来。 */
const FIXTURE = `# 我的配置，手写勿动
providers:
  siliconflow:
    name: "SiliconFlow"
    base_url: "https://api.siliconflow.cn/v1"  # 国内直连
    key_env: SILICONFLOW_API_KEY
    transport: openai_chat   # readarc 不认识也得保住
  ollama:
    name: "Ollama · 本地"
    base_url: "http://127.0.0.1:11434/v1"

model:
  default: "anthropic/claude-opus-4.6"
`

describe('patchYamlValue', () => {
  it('只改目标行的值，注释与其余内容逐字节不动', () => {
    const { text, changed } = patchYamlValue(
      FIXTURE,
      ['providers', 'siliconflow', 'base_url'],
      'https://api.example.com/v1'
    )
    expect(changed).toBe(true)
    expect(text).toContain('base_url: "https://api.example.com/v1"  # 国内直连')
    // 其余行完全一致
    const before = FIXTURE.split('\n')
    const after = text.split('\n')
    expect(after.length).toBe(before.length)
    const diff = before.filter((l, i) => after[i] !== l)
    expect(diff).toEqual(['    base_url: "https://api.siliconflow.cn/v1"  # 国内直连'])
  })

  it('值相同 → changed:false 且返回原文（无变化不重写文件）', () => {
    const { text, changed } = patchYamlValue(
      FIXTURE,
      ['providers', 'siliconflow', 'key_env'],
      'SILICONFLOW_API_KEY'
    )
    expect(changed).toBe(false)
    expect(text).toBe(FIXTURE)
  })

  it('同名字段不跨块误改：model.default 不受 providers 内路径影响', () => {
    const { changed } = patchYamlValue(FIXTURE, ['providers', 'nonexist', 'base_url'], 'x')
    expect(changed).toBe(false)
  })
})

describe('upsertYamlMap', () => {
  it('新增供应商：追加在 providers 块内，其余不动', () => {
    const { text, changed } = upsertYamlMap(FIXTURE, ['providers', 'lmstudio'], {
      name: 'LM Studio',
      base_url: 'http://127.0.0.1:1234/v1'
    })
    expect(changed).toBe(true)
    expect(text).toContain('  lmstudio:')
    expect(text).toContain('    name: LM Studio')
    // 追加位置在 providers 块内（model: 之前）
    expect(text.indexOf('lmstudio:')).toBeLessThan(text.indexOf('model:'))
    expect(text).toContain('# 我的配置，手写勿动')
    expect(text).toContain('transport: openai_chat   # readarc 不认识也得保住')
  })

  it('已有供应商只 patch 变化字段', () => {
    const { text, changed } = upsertYamlMap(FIXTURE, ['providers', 'ollama'], {
      name: 'Ollama · 本地', // 同值
      base_url: 'http://127.0.0.1:11435/v1' // 变化
    })
    expect(changed).toBe(true)
    expect(text).toContain('base_url: "http://127.0.0.1:11435/v1"')
    expect(text.match(/ollama:/g)?.length).toBe(1)
  })

  it('全部同值 → changed:false 且原文返回', () => {
    const { text, changed } = upsertYamlMap(FIXTURE, ['providers', 'ollama'], {
      base_url: 'http://127.0.0.1:11434/v1'
    })
    expect(changed).toBe(false)
    expect(text).toBe(FIXTURE)
  })

  it('空文件从零建块（readarc 首次写 tasks:）', () => {
    const { text } = upsertYamlMap('', ['tasks', 'translate'], {
      provider: 'siliconflow',
      model: 'Qwen/Qwen3-32B'
    })
    expect(text).toContain('tasks:')
    expect(text).toContain('  translate:')
    expect(text).toContain('    provider: siliconflow')
    expect(text).toContain('    model: Qwen/Qwen3-32B')
  })
})

describe('新建块的排版', () => {
  it('新顶层块的字段紧跟在块名下一行，中间不夹空行', () => {
    const src = '# 我的配置\nproviders:\n  x:\n    base_url: "https://a/v1"\n'
    const { text } = upsertYamlMap(src, ['budget'], { monthly_usd: '25' })
    expect(text).toContain('budget:\n  monthly_usd: 25')
    expect(text).not.toContain('budget:\n\n')
  })

  it('保留文件结尾换行（新字段不许挤掉它）', () => {
    const src = 'providers:\n  x:\n    base_url: "https://a/v1"\n'
    const { text } = upsertYamlMap(src, ['tasks', 'translate'], { provider: 'gw' })
    expect(text.endsWith('\n')).toBe(true)
    expect(text).not.toContain('\n\n  provider: gw')
  })

  it('往已有块补字段时也不会掉到块尾的空行后面', () => {
    const src = 'providers:\n  x:\n    base_url: "https://a/v1"\n\n# 下面是别的东西\nmain:\n  provider: x\n'
    const { text } = upsertYamlMap(src, ['providers', 'x'], { key_env: 'K' })
    const lines = text.split('\n')
    const i = lines.findIndex((l) => l.includes('base_url'))
    expect(lines[i + 1].trim()).toBe('key_env: K') // 紧跟在后面
    expect(text).toContain('# 下面是别的东西') // 注释没被挤掉
  })
})

describe('删除块不许碰用户写的注释', () => {
  it('删供应商时，它后面那条介绍下一个块的注释必须活下来', () => {
    const src = [
      'providers:',
      '  a:',
      '    base_url: "https://a/v1"',
      '  doomed:',
      '    base_url: "https://d/v1"',
      '',
      '# 这条注释介绍下面的 main 块',
      'main:',
      '  provider: a',
      ''
    ].join('\n')
    const { text, changed } = removeYamlBlock(src, ['providers', 'doomed'])
    expect(changed).toBe(true)
    expect(text).toContain('# 这条注释介绍下面的 main 块')
    expect(text).not.toContain('doomed')
    expect(text).toContain('  a:') // 别的供应商不受影响
  })
})

describe('旧版本写出的配置（块名后带空行、结尾无换行）仍能正确改', () => {
  // 这是修复前的 upsertYamlMap 生成的真实形状，存量用户的文件就长这样
  const LEGACY = [
    'providers:',
    '',
    '  my-gateway:',
    '    name: My Gateway',
    '    base_url: "http://127.0.0.1:8080/v1"',
    '',
    'main:',
    '',
    '  provider: my-gateway',
    '  model: deepseek-v4-pro',
    '',
    'tasks:',
    '',
    '  ask:',
    '    provider: auto'
  ].join('\n') // 刻意不以换行结尾

  it('改既有字段的值', () => {
    const { text, changed } = patchYamlValue(LEGACY, ['main', 'model'], 'qwen3-32b')
    expect(changed).toBe(true)
    expect(text).toContain('  model: qwen3-32b')
    expect(text).toContain('  provider: my-gateway')
  })

  it('往块里补字段，落点在块内而不是块名后的空行前', () => {
    const { text } = upsertYamlMap(LEGACY, ['providers', 'my-gateway'], { key_env: 'K' })
    const lines = text.split('\n')
    const i = lines.findIndex((l) => l.includes('base_url'))
    expect(lines[i + 1].trim()).toBe('key_env: K')
  })

  it('补新的任务路由，不破坏已有的 ask', () => {
    const { text } = upsertYamlMap(LEGACY, ['tasks', 'translate'], { provider: 'my-gateway' })
    expect(text).toContain('  ask:\n    provider: auto')
    expect(text).toContain('  translate:\n    provider: my-gateway')
  })

  it('新增顶层块时给缺失的结尾换行补上，不粘连', () => {
    const { text } = upsertYamlMap(LEGACY, ['budget'], { monthly_usd: '30' })
    expect(text).toContain('budget:\n  monthly_usd: 30')
    expect(text).not.toMatch(/provider: auto[^\n]*budget:/) // 不许粘在同一行
    expect(text).toContain('provider: auto\n\nbudget:') // 空行分隔
  })
})
