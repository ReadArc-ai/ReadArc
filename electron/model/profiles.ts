/**
 * 内置供应商档案：声明式表格，只收敛 ReadArc 需要的字段。
 * 贡献接口：加一个供应商 = 在这里加一个对象 + logo。
 * 用户 config 里的同名 slug 永远优先于内置档案。
 */
import type { ProviderDef, Transport } from '../config/providers-config'

export interface BuiltinProfile {
  slug: string
  name: string
  baseUrl: string
  keyEnv: string | null
  transport: Transport
  signupUrl?: string
  /** 本地运行时：无需密钥，启动时探测 */
  local?: boolean
}

export const BUILTIN_PROFILES: BuiltinProfile[] = [
  {
    slug: 'siliconflow',
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    keyEnv: 'SILICONFLOW_API_KEY',
    transport: 'openai_chat',
    signupUrl: 'https://siliconflow.cn'
  },
  {
    slug: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    keyEnv: 'DEEPSEEK_API_KEY',
    transport: 'openai_chat',
    signupUrl: 'https://platform.deepseek.com'
  },
  {
    slug: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    transport: 'openai_chat',
    signupUrl: 'https://platform.openai.com'
  },
  {
    slug: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    keyEnv: 'ANTHROPIC_API_KEY',
    transport: 'anthropic_messages',
    signupUrl: 'https://console.anthropic.com'
  },
  {
    slug: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    transport: 'openai_chat',
    signupUrl: 'https://aistudio.google.com'
  },
  {
    slug: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    transport: 'openai_chat',
    signupUrl: 'https://openrouter.ai'
  },
  {
    slug: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    keyEnv: null,
    transport: 'openai_chat',
    signupUrl: 'https://ollama.com',
    local: true
  },
  {
    slug: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    keyEnv: null,
    transport: 'openai_chat',
    signupUrl: 'https://lmstudio.ai',
    local: true
  }
]

export function profileToDef(p: BuiltinProfile): ProviderDef {
  return {
    slug: p.slug,
    name: p.name,
    baseUrl: p.baseUrl,
    keyEnv: p.keyEnv,
    transport: p.transport,
    source: 'readarc'
  }
}

/** 本地模型服务？显式标注优先（本地网关转发云端模型时地址也是 localhost，但不该当免费兜底），否则按地址猜 */
export function isLocalProvider(def: { baseUrl: string; local?: boolean }): boolean {
  if (def.local !== undefined) return def.local
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(def.baseUrl)
}
