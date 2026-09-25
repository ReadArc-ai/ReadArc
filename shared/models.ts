/** 渲染进程与主进程共享的数据模型（不依赖 Node/Electron）。 */
import type { TargetLang } from './lang'

export interface PaperRow {
  id: string
  file_path: string
  title: string | null
  title_zh: string | null
  authors: string | null
  year: number | null
  source: string | null
  arxiv_id: string | null
  doi: string | null
  status: 'new' | 'reading' | 'done'
  progress: number
  last_section: string | null
  scroll_position: number
  added_at: number
  last_opened_at: number | null
  /** 版面识别：pending = 启发式分段先开页，模型结果在后台补；旧库缺省视为 done */
  layout_state?: 'pending' | 'done'
  /** 按哪一版版面解析规则识别的（低于当前版本会在启动时重识别） */
  layout_version?: number
  /** 翻译进度（listPapers 附带；其他查询可缺省）：可译块总数 / 已译块数 */
  trans_total?: number
  trans_done?: number
}

export interface BlockRow {
  block_id: string
  paper_id: string
  page: number
  block_order: number
  /** margin = 页眉页脚 / 页码 / 侧边水印：只在镜像页按原位原文显示，不翻译、不进目录 */
  kind: 'para' | 'heading' | 'figure' | 'table' | 'equation' | 'margin'
  section: string | null
  text: string
  bbox: string | null
  simhash: string
  heading_level: number | null
  /** 原始字号（PDF pt，取块内 text item 中位数）；旧数据/启发式解析为 null */
  font_size: number | null
  /** 行内公式截图记录（JSON InlineFormula[]，见 shared/inline-formula.ts）；正文里对应 ⟦fN⟧ 占位符。无则 null */
  inlines?: string | null
}

export interface OutlineEntry {
  title: string
  level: number
  page: number
  order: number
}

export interface ImportOutcome {
  paperId: string
  blockCount: number
  outline: OutlineEntry[]
  /** 内容一样的论文已经在库里：没有复制文件，也没有重新解析，直接打开已有的那篇 */
  existing?: boolean
}

/** 批量导入结果：坏文件不拖垮整批，逐个失败原因带回给 UI。 */
export interface ImportBatchResult {
  outcomes: ImportOutcome[]
  failures: { file: string; error: string }[]
}

/** 导入解析进度：版面识别逐页推送（page/pages），file 为当前文件名。 */
export interface ImportProgressEvent {
  file: string
  page: number
  pages: number
}

/** 打开一篇论文时一次性交给渲染进程的数据包。 */
/** 后台版面识别进度；done 之后紧跟一条 paperBlocksUpdated */
export interface LayoutProgressEvent {
  paperId: string
  page: number
  pages: number
  done: boolean
  /** 还在排队：前面还有几篇（正在识别的那篇也算）；0 = 下一个就是它 */
  ahead?: number
}

export interface PaperBundle {
  paper: PaperRow
  blocks: BlockRow[]
  outline: OutlineEntry[]
  /** 当前术语表/提示词版本下已缓存的译文（blockId → 中文） */
  translations: Record<string, string>
  /** 每段译文出自哪个模型（blockId → 模型名），横幅「由 X 翻译」与重译选模型的依据 */
  translationModels: Record<string, string>
}

/** 只用于这一次翻译的模型指定（重译时在横幅上选的），不改设置里的路由 */
export interface TranslateOverride {
  provider: string
  model: string
}

export interface TranslateProgressEvent {
  paperId: string
  blockId: string
  text?: string
  /** 这段译文出自哪个模型 */
  model?: string
  error?: string
  remaining: number
  /** 本轮累计 token 消耗 */
  usage?: { inputTokens: number; outputTokens: number }
  /** 这一轮的目标语言：途中改了目标语言，渲染端丢掉旧语言的回报 */
  lang?: TargetLang
}

export interface ProgressUpdate {
  progress: number
  scrollPosition: number
  lastSection: string | null
}

/* ---- 模型配置（设置界面） ---- */

export interface ProviderView {
  slug: string
  name: string
  baseUrl: string
  keyEnv: string | null
  transport: 'openai_chat' | 'anthropic_messages'
  source: 'readarc' | 'builtin'
  /** 官方厂商（slug 在内置档案里）。用户填过 Key 后 config.yaml 里会有同名条目、source 变成 readarc，
   *  分组不能看 source，得看这个 */
  official: boolean
  local: boolean
  /** 密钥已可解析（或本地端点无需密钥） */
  hasKey: boolean
  /** 官方厂商的控制台/注册页（拿 Key 的地方） */
  signupUrl?: string
}

/** 按功能指定模型的槽位：translate / summary / notes 在设置里可改；其余为老配置兼容 */
export type TaskSlot = 'translate' | 'summary' | 'notes' | 'ask' | 'glossary' | 'outline' | 'compare'

export interface TaskRoute {
  provider: string
  model?: string
}

export interface ModelState {
  providers: ProviderView[]
  routes: Record<TaskSlot, TaskRoute>
  mainModel: { provider: string; model: string } | null
  configPaths: { readarc: string }
  /** 命名代理档案（密码单独走 .env，不进状态） */
  proxies: ProxyView[]
  /** providerSlug → 代理档案名（未绑定 = 直连） */
  endpointProxy: Record<string, string>
}

export interface ProxyView {
  name: string
  protocol: 'http' | 'https' | 'socks5'
  host: string
  port: string
  username: string
}

export interface ProxySaveInput extends ProxyView {
  /** 有值才更新（写入 .env 的 READARC_PROXY_<NAME>_PASSWORD） */
  password?: string
}

export interface ProviderSaveInput {
  slug: string
  name: string
  baseUrl: string
  keyEnv?: string | null
  apiKey?: string
  /** true = 本地模型服务，false = 网关 / 中转 */
  local?: boolean
}

export interface DetectedLocal {
  slug: string
  baseUrl: string
  models: string[]
}

export interface MonthUsage {
  inputTokens: number
  outputTokens: number
}

/** 左栏/设置页的用量总览 [P7]。花费按公开牌价估算，实际账单以供应商为准。 */
export interface UsageOverview extends MonthUsage {
  /** 已知单价部分的美元支出 */
  spendUsd: number
  unknownModels: string[]
}

export interface TranslateEstimateView {
  paraCount: number
  inputTokens: number
  outputTokens: number
  usd: number | null
  model: string
}

export interface TranslateStartResult {
  started: boolean
  /** started=false 时必有：给确认框展示预估值与依据 */
  estimate?: TranslateEstimateView
}

export interface PaperSummary {
  text: string
  model: string
  created_at: number
}

/* ---- 对话面板 ---- */

export interface ChatHistoryItem {
  role: 'user' | 'assistant'
  content: string
}

/** 一篇论文下的一次独立对话。标题取首个问题，可为空（尚未发送的新对话）。 */
export interface ChatSession {
  id: string
  paperId: string
  title: string | null
  createdAt: number
  updatedAt: number
}

/** 从本地数据库恢复到渲染进程的完整消息。 */
export interface ChatStoredMessage {
  role: 'user' | 'assistant'
  text: string
  /** 截图提问附的图（PNG data URL） */
  image?: string
  /** 推理模型的思考流（回答那条上） */
  thinking?: string
  persona?: ChatPersona
  citations?: ChatCitation[]
  model?: string
  costUsd?: number | null
  tokens?: number
  hops?: string[]
  stopped?: boolean
}

export interface ChatCitation {
  marker: string
  order: number
  page: number
  section: string | null
}

export interface ChatAnswer {
  text: string
  citations: ChatCitation[]
  model: string
  usage: MonthUsage
  /** 本轮花费（USD）；单价未知为 null */
  costUsd: number | null
  /** 用户中途点了停止：text 是已生成的部分 */
  stopped?: boolean
  /** 发生过降级时每一跳的用户可读说明 */
  hops: string[]
  /** 推理模型的思考流全文（随历史落库） */
  thinking?: string
}

export interface ChatDeltaEvent {
  paperId: string
  sessionId: string
  delta: string
  /** 缺省为正文；'thinking' 是推理模型的思考流，界面单独折叠展示 */
  kind?: 'text' | 'thinking'
}

/* ---- 对话讲法（读者人设） ---- */

/**
 * 讲法只改「怎么讲」，不改「只依据片段、引用必须可跳转」的规则。
 * 内置的五种对应流行的读论文套路：grandma 太奶模式（当 80 岁老人讲）、kid 小学生、
 * stepwise 一步不跳、advisor 导师提问预演、reviewer 审稿人挑刺；用户可在设置里自定义更多。
 */
export const CHAT_PERSONAS = ['default', 'grandma', 'kid', 'stepwise', 'advisor', 'reviewer'] as const
export type BuiltinPersonaId = (typeof CHAT_PERSONAS)[number]
/** 讲法 id：内置 id，或自定义讲法的 id（custom-…） */
export type ChatPersona = string

export function isBuiltinPersona(id: string): id is BuiltinPersonaId {
  return (CHAT_PERSONAS as readonly string[]).includes(id)
}

/** 用户自定义讲法（设置 → 讲法），落 settings.json */
export interface CustomPersona {
  id: string
  name: string
  /** 提示词里的讲法要求，原样拼在事实规则之后 */
  style: string
  /** 内置提问（输入框上方的快捷按钮），最多 4 条；空则用通用的「讲一遍这篇论文」 */
  presets?: string[]
}

export interface ChatAskOptions {
  persona?: ChatPersona
  /** 整篇维度的提问（内置提问）：上下文按目录取各节首段而不是按问句检索，让「讲整篇」有东西可讲 */
  whole?: boolean
  /** 渲染进程当前会话；仅用于流式路由和回答完成后的本地持久化。 */
  sessionId?: string
  /** 截图提问：从原版页框选出来的图（PNG data URL），随问题一起发给模型；需要模型支持看图 */
  image?: string
  /** 要求模型先思考再回答（由主进程按设置填，渲染进程不用传） */
  reasoning?: boolean
}

/* ---- 笔记 ---- */

export interface NoteAnchorView {
  block_id: string
  char_start: number
  char_end: number
  simhash: string
  excerpt: string
  /** 高亮选区矩形（PDF 坐标 [page, x, y, w, h]，y 向上） */
  rects?: [number, number, number, number, number][]
}

export interface NoteView {
  anchorId: string
  stamp: string
  text: string
  anchor: NoteAnchorView | null
}

export interface PaperNotes {
  /** 落盘文件名（页脚展示，提示笔记是普通文件） */
  file: string
  entries: NoteView[]
  /** 高亮：id → 锚点（与笔记同文件落盘） */
  highlights: Record<string, NoteAnchorView>
}

/* ---- 搜索 ---- */

export interface SearchResultInput {
  id: string
  title: string
  authors: string[]
  year: number | null
  source: string
  url: string
  pdfUrl: string | null
  doi: string | null
  arxivId: string | null
  citations: number | null
  abstract: string | null
}

export interface SearchOutcome {
  results: (SearchResultInput & {
    /** 中文兜底文案；渲染端优先按 whyKind / whyHits 用界面语言组句 */
    why: string
    whyKind?: 'hits' | 'cited' | 'related' | 'id'
    whyHits?: string[]
  })[]
  sources: { slug: string; name: string; count: number; error: string | null; pending?: boolean }[]
  rawCount: number
  fromCache: boolean
  /** 中文检索词被翻成了英文再查：实际发给各源的词 */
  queryUsed?: string
  /** 中文转英文失败（没接模型等）：照原词查了，界面提示用英文试 */
  translateError?: string | null
  /** 还有源没回来：快的源先渲染，慢的源到了再补 */
  partial?: boolean
}

/** 检索中间结果（某个源先回来了） */
export interface SearchProgressEvent {
  query: string
  outcome: SearchOutcome
}

/* ---- 应用数据管理（设置 → 数据） ---- */

export type DataEntryId = 'db' | 'papers' | 'figures' | 'notes' | 'settings' | 'config'

export interface DataEntry {
  id: DataEntryId
  path: string
  bytes: number
  files: number
  /** 只有数据库条目带：各表行数 */
  counts?: {
    papers: number
    translations: number
    summaries: number
    chats: number
    usage: number
    searchCache: number
  }
  /** 只有数据库条目带：各类数据在库文件里占的字节数（含索引） */
  sizes?: {
    translations: number
    summaries: number
    chats: number
    usage: number
    searchCache: number
  }
}

export interface DataOverview {
  entries: DataEntry[]
  total: number
}

export type DataClearKind =
  | 'search-cache'
  | 'figures'
  | 'translations'
  | 'summaries'
  | 'chats'
  | 'usage'
  | 'all'
