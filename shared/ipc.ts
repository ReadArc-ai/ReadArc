/** 主进程与渲染进程共享的 IPC 契约。渲染进程不直接碰文件系统与网络，一切经由这里的通道。 */

export type ThemeMode = 'system' | 'dark' | 'light'
export type Lang = 'zh' | 'en'
export type LibView = 'cover' | 'list'

import type { TargetLang } from './lang'
import type {
  ChatAnswer,
  ChatAskOptions,
  ChatDeltaEvent,
  ChatHistoryItem,
  ChatPersona,
  ChatSession,
  ChatStoredMessage,
  CustomPersona,
  DetectedLocal,
  ImportBatchResult,
  ImportProgressEvent,
  ModelState,
  NoteView,
  PaperBundle,
  PaperNotes,
  PaperRow,
  PaperSummary,
  ProgressUpdate,
  ProviderSaveInput,
  SearchOutcome,
  SearchProgressEvent,
  SearchResultInput,
  TaskRoute,
  TaskSlot,
  TranslateProgressEvent,
  TranslateStartResult,
  UsageOverview,
  DataClearKind,
  DataEntryId,
  DataOverview,
  LayoutProgressEvent
} from './models'

/** 落盘到 userData/settings.json 的持久化设置。 */
export interface PersistedSettings {
  theme: ThemeMode
  lang: Lang
  /** 翻译 / 摘要 / 笔记的目标语言；缺省跟界面语言 */
  targetLang?: TargetLang
  libView: LibView
  windowBounds?: { x: number; y: number; width: number; height: number }
  /** [P1] 开机即读：上次打开的论文 */
  lastPaperId?: string | null
  /** [P5] 首次启动引导已完成/跳过 */
  onboarded?: boolean
  /** 左栏手动收起 */
  railCollapsed?: boolean
  /** 目录栏手动收起 */
  outlineCollapsed?: boolean
  /** 侧栏拖拽后的自定义宽度（px） */
  sidebar?: { rail?: number; outline?: number; panel?: number; panelHeight?: number }
  /** 对话/笔记面板停靠位置：靠右（默认）或靠下（像浏览器调试工具那样） */
  panelDock?: 'right' | 'bottom'
  /** 对话讲法（读者人设），全局记住 */
  chatPersona?: ChatPersona
  /** 用户自定义的讲法（设置 → 讲法） */
  chatPersonas?: CustomPersona[]
  /** 纸面深色（原文页反色、译文页深色配色）；未设置时跟随界面主题 */
  paperDark?: boolean
  /** 译文字号偏好（1 = 跟原文字号走） */
  zhTextScale?: number
  /** 页首 AI 摘要卡收起（只留标题行），全局记住 */
  summaryCollapsed?: boolean
  /** 双击单词弹内置词典释义（不花 token）；缺省开 */
  wordLookup?: boolean
  /** 对话时要求模型先思考再回答（Claude / OpenAI o 系列默认不思考）；缺省关 */
  chatReasoning?: boolean
}

export const DEFAULT_SETTINGS: PersistedSettings = {
  theme: 'system',
  lang: 'zh',
  libView: 'cover'
}

/** 用户按下「停止」时主进程抛出的标记错误：界面据此安静收起，不当报错显示 */
export const GEN_ABORTED = '__gen_aborted__'

export const IPC = {
  settingsGet: 'settings:get',
  dataOverview: 'data:overview',
  captureRegion: 'view:capture',
  dataClear: 'data:clear',
  dataReveal: 'data:reveal',
  settingsPatch: 'settings:patch',
  libraryImport: 'library:import',
  importProgress: 'import:progress',
  /* 菜单 → 渲染进程（应用菜单里的动作） */
  menuOpenSettings: 'menu:open-settings',
  menuOpenPrivacy: 'menu:open-privacy',
  menuImport: 'menu:import',
  libraryPick: 'library:pick',
  libraryList: 'library:list',
  paperOpen: 'paper:open',
  paperBlocksUpdated: 'paper:blocks-updated',
  layoutProgress: 'layout:progress',
  paperDelete: 'paper:delete',
  paperMenu: 'paper:menu',
  paperMenuDelete: 'paper:menu-delete',
  paperProgress: 'paper:progress',
  paperFile: 'paper:file',
  pdfAsset: 'pdf:asset',
  thumbSave: 'thumb:save',
  thumbGet: 'thumb:get',
  figureGet: 'figure:get',
  modelsState: 'models:state',
  modelsSaveProvider: 'models:save-provider',
  modelsSaveRoute: 'models:save-route',
  modelsDetectLocal: 'models:detect-local',
  proxiesSave: 'proxies:save',
  proxiesDelete: 'proxies:delete',
  endpointProxySave: 'endpoint-proxy:save',
  modelsSaveMain: 'models:save-main',
  networkTest: 'network:test',
  modelsDeleteProvider: 'models:delete-provider',
  modelsList: 'models:list',
  translatePaper: 'translate:paper',
  translateStop: 'translate:stop',
  translateText: 'translate:text',
  translateTextDelta: 'translate:text-delta',
  translateFocus: 'translate:focus',
  translateOutline: 'translate:outline',
  translateBlock: 'translate:block',
  translateProgress: 'translate:progress',
  usageMonth: 'usage:month',
  summaryGet: 'summary:get',
  summaryGenerate: 'summary:generate',
  chatAsk: 'chat:ask',
  chatStop: 'chat:stop',
  chatDelta: 'chat:delta',
  chatSessionsList: 'chat:sessions-list',
  chatSessionCreate: 'chat:session-create',
  chatSessionMessages: 'chat:session-messages',
  chatSessionDelete: 'chat:session-delete',
  chatSessionRename: 'chat:session-rename',
  genDelta: 'gen:delta',
  notesList: 'notes:list',
  notesAdd: 'notes:add',
  notesRemove: 'notes:remove',
  highlightAdd: 'highlight:add',
  highlightRemove: 'highlight:remove',
  searchRun: 'search:run',
  searchProgress: 'search:progress',
  searchAdd: 'search:add',
  searchAddProgress: 'search:add-progress',
  notesContradictions: 'notes:contradictions',
  notesGenerate: 'notes:generate',
  genStop: 'gen:stop',
  searchSummarize: 'search:summarize'
} as const

/** preload 暴露到 window.readarc 的桥接口。 */
export interface ReadArcBridge {
  getSettings(): Promise<PersistedSettings>
  patchSettings(patch: Partial<PersistedSettings>): void
  /** Node 的 process.platform 字符串；共享契约不依赖 Node 全局类型。 */
  platform: string
  /** 拖拽的 File 对象 → 绝对路径（Electron webUtils，沙箱下 File.path 不存在） */
  pathForFile(file: File): string
  importPdfs(paths: string[]): Promise<ImportBatchResult>
  /** 导入解析进度（版面识别逐页推送），长 PDF 的等待可见 */
  onImportProgress(cb: (e: ImportProgressEvent) => void): () => void
  /** 系统文件对话框选择 PDF 并导入；取消返回空结果 */
  /** 应用菜单触发的动作（打开设置 / 导入 PDF）；返回取消订阅 */
  onMenuAction(cb: (action: 'settings' | 'import' | 'privacy') => void): () => void
  /** 弹系统文件框选 PDF，只返回路径；导入走 importPdfs，进度提示才能统一 */
  pickPdfs(): Promise<string[]>
  listPapers(): Promise<PaperRow[]>
  openPaper(paperId: string): Promise<PaperBundle | null>
  /** 主进程在后台给老论文补完页边块后通知：当前论文就重新拉一次块列表 */
  onPaperBlocksUpdated(cb: (paperId: string) => void): () => void
  /** 后台版面识别进度；done 之后会再收到 paperBlocksUpdated */
  onLayoutProgress(cb: (e: LayoutProgressEvent) => void): () => void
  /** 划词翻译：一次性翻译任意选中文本（不缓存）；增量走 onTranslateTextDelta。
   *  dictOnly=true 只查内置词典，未命中返回 null（不触发 LLM，不花 token） */
  translateText(text: string, dictOnly?: boolean, reqId?: number): Promise<string | null>
  /** reqId 是发起 translateText 时带的编号：连续划两段时，前一段的迟到增量据此丢掉 */
  onTranslateTextDelta(cb: (delta: string, reqId: number | null) => void): () => void
  /** 删除论文（DB + 应用内文件拷贝；笔记 Markdown 保留）。不存在返回 false */
  deletePaper(paperId: string): Promise<boolean>
  /** 论文卡片右键菜单（原生）：在 Finder 中显示 / 删除论文 */
  showPaperMenu(paperId: string): void
  /** 右键菜单里点了「删除论文…」：渲染端接手确认流程 */
  onPaperMenuDelete(cb: (paperId: string) => void): () => void
  saveProgress(paperId: string, update: ProgressUpdate): void
  /** 论文原始字节（渲染进程画首页缩略图用） */
  paperFile(paperId: string): Promise<ArrayBuffer | null>
  /** pdf.js 附带资源（CMap / 标准字体 / wasm）：渲染进程画页面时按文件名取 */
  pdfAsset(kind: 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl', filename: string): Promise<ArrayBuffer | null>
  saveThumbnail(paperId: string, dataUrl: string): Promise<void>
  /** 已生成的缩略图 data URL；没有返回 null */
  getThumbnail(paperId: string): Promise<string | null>
  /** 图/表区域截图 data URL；没有返回 null（显示文本占位） */
  getFigure(paperId: string, blockId: string): Promise<string | null>
  modelState(): Promise<ModelState>
  saveProvider(input: ProviderSaveInput): Promise<boolean>
  saveTaskRoute(slot: TaskSlot, route: TaskRoute): Promise<boolean>
  detectLocal(): Promise<DetectedLocal[]>
  saveProxy(cfg: import('./models').ProxySaveInput): Promise<void>
  deleteProxy(name: string): Promise<boolean>
  saveEndpointProxy(slug: string, proxyName: string | null): Promise<void>
  saveMainModel(provider: string, model: string): Promise<void>
  testNetwork(
    cfg: import('./models').ProxySaveInput
  ): Promise<{ ok: boolean; error?: string }>
  listProviderModels(slug: string): Promise<string[]>
  deleteProvider(slug: string): Promise<boolean>
  /** 启动全文翻译；预估 > $0.5 且未确认时不启动并返回预估 [P7]。进度走 onTranslateProgress */
  /** force=true：无视已有译文整篇重译并覆盖缓存（换了模型、或上一次译得不好）；预估按全文算 */
  translatePaper(
    paperId: string,
    confirmed?: boolean,
    force?: boolean,
    /** 只用于这一次的模型（重译时在横幅上选的），不改设置 */
    override?: import('./models').TranslateOverride | null
  ): Promise<TranslateStartResult>
  stopTranslation(paperId: string): Promise<void>
  reportTranslateFocus(paperId: string, blockOrder: number): void
  /** 目录单独翻译（一次批量调用；进度走 onTranslateProgress） */
  translateOutline(paperId: string): Promise<{ translated: number }>
  /** 单段重译（force），成功返回新译文 */
  retranslateBlock(paperId: string, blockId: string): Promise<{ text: string }>
  onTranslateProgress(cb: (e: TranslateProgressEvent) => void): () => void
  monthUsage(): Promise<UsageOverview>
  getSummary(paperId: string): Promise<PaperSummary | null>
  /** force=true 无视已缓存的摘要重新生成（换了模型、或上一次生成得不好） */
  generateSummary(paperId: string, force?: boolean): Promise<PaperSummary>
  /** options：讲法（读者人设）与整篇维度标记，见 ChatAskOptions */
  askChat(
    paperId: string,
    question: string,
    history: ChatHistoryItem[],
    options?: ChatAskOptions
  ): Promise<ChatAnswer>
  listChatSessions(paperId: string): Promise<ChatSession[]>
  createChatSession(paperId: string): Promise<ChatSession>
  listChatMessages(paperId: string, sessionId: string): Promise<ChatStoredMessage[]>
  deleteChatSession(paperId: string, sessionId: string): Promise<boolean>
  /** 空标题 = 恢复自动标题（首个问题） */
  renameChatSession(paperId: string, sessionId: string, title: string): Promise<boolean>
  /** 停止当前这篇论文的在途回答；askChat 会以 stopped=true 带回已生成的部分 */
  stopChat(paperId: string): void
  onChatDelta(cb: (e: ChatDeltaEvent) => void): () => void
  /** paperId 只在与某篇论文绑定的流上出现（摘要/笔记）；找矛盾与检索总结是全局的。
   *  reset=true：第一次输出不合格要重来，已流出的文字作废 */
  onGenDelta(cb: (e: { kind: string; delta: string; paperId?: string; reset?: boolean }) => void): void
  /** 设置 → 数据：各类数据的路径与大小 / 按类清理 / 在访达里显示 */
  /** 截图提问：截取窗口内一块区域的实际渲染像素（PNG data URL）。原版页直接裁 canvas 更清晰，
   *  这个给镜像译文页这类 DOM 内容用 */
  captureRegion(rect: { x: number; y: number; width: number; height: number }): Promise<string>
  dataOverview(): Promise<DataOverview>
  dataClear(kind: DataClearKind): Promise<{ relaunch: boolean }>
  dataReveal(id: DataEntryId): Promise<void>
  listNotes(paperId: string): Promise<PaperNotes>
  addNote(paperId: string, blockId: string, text: string, selection?: string): Promise<NoteView>
  removeNote(paperId: string, anchorId: string): Promise<void>
  addHighlight(
    paperId: string,
    blockId: string,
    selection: string,
    rects?: [number, number, number, number, number][],
    hintRange?: [number, number]
  ): Promise<{ id: string }>
  removeHighlight(paperId: string, id: string): Promise<void>
  runSearch(query: string): Promise<SearchOutcome>
  /** 某个源先回来时的中间结果（outcome.partial=true）；最终结果仍由 runSearch 返回 */
  onSearchProgress(cb: (e: SearchProgressEvent) => void): () => void
  addSearchResult(result: SearchResultInput): Promise<{ paperId: string; existed: boolean }>
  onSearchAddProgress(
    cb: (e: { id: string; stage: 'download' | 'import'; received: number; total: number }) => void
  ): void
  /** 找矛盾：跨论文笔记里结论相反的组合（唯一的笔记 AI 功能） */
  findContradictions(): Promise<{ text: string; model: string }>
  generateNotes(paperId: string): Promise<import('./models').NoteView>
  /** 停止在途的摘要 / 阅读笔记生成（服务器不回时用户得有办法退出） */
  stopGen(kind: 'summary' | 'notes', paperId: string): void
  summarizeSearch(query: string, results: SearchResultInput[]): Promise<{ text: string; model: string }>
}
