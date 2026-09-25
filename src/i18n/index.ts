import type { Lang } from '../../shared/ipc'
import { keyLabel } from '../lib/keys'
import { useApp } from '../store/app'

const dict = {
  'set.tab.privacy': { zh: '隐私政策', en: 'Privacy policy' },
  'nav.reader': { zh: '阅读', en: 'Reader' },
  'nav.library': { zh: '论文库', en: 'Library' },
  'nav.discover': { zh: '搜索', en: 'Search' },
  'nav.models': { zh: '设置', en: 'Settings' },
  'titlebar.search': { zh: '搜索论文或功能、向 AI 提问…', en: 'Search papers or actions, ask AI…' },
  'usage.label': { zh: '本月用量', en: 'This month' },
  'reader.empty.title': { zh: '尚未打开论文', en: 'No paper open' },
  'reader.empty.drop': { zh: '拖入一个 PDF', en: 'Drop in a PDF' },
  'reader.empty.doi': { zh: '粘贴 DOI 或 arXiv ID', en: 'Paste a DOI or arXiv ID' },
  'reader.empty.pick': { zh: '选择 PDF 文件…', en: 'Choose a PDF…' },
  'reader.importing': { zh: '正在解析论文…', en: 'Parsing paper…' },
  'doc.layout-pending': { zh: '正在识别版面 {page}/{pages}', en: 'Analyzing layout {page}/{pages}' },
  'doc.layout-pending-tip': { zh: '版面识别完成后，图表、段落和目录将自动更新。', en: 'Figures, paragraphs and the outline will update when layout analysis finishes.' },
  'outline.pending': { zh: '版面识别完成后显示目录', en: 'The outline will appear after layout analysis' },
  'doc.layout-queued': { zh: '准备识别版面…', en: 'Preparing layout detection…' },
  'doc.layout-waiting': { zh: '排队识别版面，前面还有 {n} 篇', en: 'Waiting for layout detection, {n} ahead' },
  'doc.layout-wait': { zh: '版面识别完成后可翻译', en: 'Translate after layout detection finishes' },
  'reader.import-finalize': { zh: '正在整理段落和图表…', en: 'Organizing paragraphs and figures…' },
  'reader.import-layout': { zh: '版面识别', en: 'Analyzing layout' },
  'import.drop-here': { zh: '松开即导入 PDF', en: 'Drop to import the PDF' },
  'import.drop-not-pdf': { zh: '仅支持导入 PDF 文件', en: 'Only PDF files can be imported' },
  'import.exists': { zh: '论文已在库中，已为你打开。', en: 'This paper is already in your library and has been opened.' },
  'import.exists-many': { zh: '所选论文均已在库中。', en: 'All selected papers are already in your library.' },
  'import.drop-no-path': {
    zh: '无法读取文件路径。请先将文件保存到本机，或通过「导入」选择文件。',
    en: 'Could not read the file path. Save the file locally first, or select it using Import.'
  },
  'reader.view.page': { zh: '原版对照', en: 'Side by side' },
  'reader.view.orig': { zh: '原文', en: 'Original' },
  'reader.view.zh': { zh: '译文', en: 'Translation' },
  'reader.view.tip': { zh: '⌘T 轮流切换', en: '⌘T cycles views' },
  'reader.view.layout-wait': { zh: '版面识别完成后显示译文视图', en: 'Translation views appear after layout detection finishes' },
  'reader.gen-notes': { zh: 'AI 生成阅读笔记', en: 'Generate AI reading notes' },
  'reader.gen-notes.title': { zh: '生成 3–5 条要点，保存到这篇论文的笔记文件。', en: 'Generate 3–5 key points and save them to this paper’s notes file.' },
  'reader.outline': { zh: '目录', en: 'Outline' },
  'outline.translate': { zh: '译', en: 'Translate' },
  'outline.translate-title': { zh: '翻译目录', en: 'Translate outline' },
  'reader.translate-all': { zh: '翻译全文', en: 'Translate all' },
  'reader.translating': { zh: '翻译中', en: 'Translating' },
  'reader.paras-untranslated': { zh: '段未翻译', en: 'paragraphs untranslated' },
  'reader.retry': { zh: '重试', en: 'Retry' },
  'panel.chat': { zh: '对话', en: 'Chat' },
  'panel.notes': { zh: '笔记', en: 'Notes' },
  'panel.chat.empty': {
    zh: '可以询问论文的方法、实验或结论，点击回答中的引用查看原文。',
    en: 'Ask about the method, experiments or conclusions. Click a citation in an answer to view the passage.'
  },
  'panel.chat.history': { zh: '历史会话', en: 'Conversation history' },
  'panel.chat.new': { zh: '新对话', en: 'New conversation' },
  'panel.chat.untitled': { zh: '未命名对话', en: 'Untitled conversation' },
  'panel.chat.loading': { zh: '正在载入对话…', en: 'Loading conversation…' },
  'panel.chat.rename': { zh: '重命名当前会话', en: 'Rename current conversation' },
  'panel.chat.rename-ph': { zh: '会话名称（留空使用自动标题）', en: 'Conversation name (leave blank for an automatic title)' },
  'panel.chat.delete': { zh: '删除当前会话', en: 'Delete current conversation' },
  'panel.chat.delete-confirm': {
    zh: '删除当前会话及全部消息？此操作无法撤销。',
    en: 'Delete this conversation and all its messages? This cannot be undone.'
  },
  'panel.chat.placeholder': { zh: '就这篇论文提问…', en: 'Ask about this paper…' },
  'panel.chat.quoted-question': { zh: '关于这段文字：「{quote}」\n\n{question}', en: 'About this passage: “{quote}”\n\n{question}' },
  'panel.send': { zh: 'Enter 发送 · Shift+Enter 换行', en: 'Enter to send · Shift+Enter for a new line' },
  'panel.stop': { zh: '停止生成', en: 'Stop generating' },
  'panel.stopped': { zh: '已停止', en: 'Stopped' },
  'panel.thinking': { zh: '思考中…', en: 'Thinking…' },
  'panel.thought': { zh: '思考过程', en: 'Reasoning' },
  'panel.thinking-tokens': { zh: '约 {n} tokens', en: '~{n} tokens' },
  'panel.thinking-tip': { zh: '模型返回的思考过程，点击展开或收起', en: 'Reasoning returned by the model. Click to expand or collapse.' },
  'panel.preset.method': {
    zh: '概述这篇论文的方法，包括核心思路、关键步骤和与常用方法的区别。',
    en: 'Summarize the method: its core idea, key steps and differences from common approaches.'
  },
  'panel.preset.method.label': { zh: '解释方法', en: 'Explain the method' },
  'panel.preset.weakness': {
    zh: '分析这篇论文的主要局限，并引用相关段落说明依据。',
    en: 'Analyze the paper’s main limitations, citing relevant passages.'
  },
  'panel.preset.weakness.label': { zh: '分析局限', en: 'Analyze limitations' },
  /* 讲法（读者人设）：流行的读论文套路做成一键切换 */
  'panel.persona.tip': {
    zh: '选择回答的讲解风格',
    en: 'Choose an explanation style'
  },
  'panel.persona.default': { zh: '默认风格', en: 'Default style' },
  'panel.persona.grandma': { zh: '太奶模式', en: 'Grandma mode' },
  'panel.persona.kid': { zh: '小学生', en: 'Third-grader' },
  'panel.persona.stepwise': { zh: '一步不跳', en: 'Step by step' },
  'panel.persona.advisor': { zh: '导师预演', en: 'Advisor drill' },
  'panel.persona.reviewer': { zh: '审稿人挑刺', en: 'Harsh reviewer' },
  'panel.chat.placeholder.persona': { zh: '{mode}：就这篇论文提问…', en: '{mode}: ask about this paper…' },
  'panel.preset.grandma.1': {
    zh: '用通俗的语言概述这篇论文：研究问题、方法和主要结果。',
    en: 'Explain the paper in plain language: the research question, method and main findings.'
  },
  'panel.preset.grandma.1.label': { zh: '概述论文', en: 'Explain the paper' },
  'panel.preset.grandma.2': {
    zh: '用日常生活中的例子解释这篇论文的方法，并说明类比的局限。',
    en: 'Explain the method using everyday examples, and note where the comparisons fall short.'
  },
  'panel.preset.grandma.2.label': { zh: '举例解释方法', en: 'Explain with examples' },
  'panel.preset.kid.1': {
    zh: '用一个简单的故事解释这篇论文的研究问题、解决方法和结果。',
    en: 'Use a simple story to explain the research question, approach and results.'
  },
  'panel.preset.kid.1.label': { zh: '用故事理解论文', en: 'Explain as a story' },
  'panel.preset.kid.2': {
    zh: '选出这篇论文的一个核心概念，用简短的说明和例子解释。',
    en: 'Choose one central concept in the paper and explain it briefly with an example.'
  },
  'panel.preset.kid.2.label': { zh: '解释核心概念', en: 'Explain a key concept' },
  'panel.preset.stepwise.1': {
    zh: '逐步解释这篇论文的方法，说明每一步的目的，以及前后步骤的联系。',
    en: 'Explain the method step by step, including the purpose of each step and how they connect.'
  },
  'panel.preset.stepwise.1.label': { zh: '一步步讲方法', en: 'Method, step by step' },
  'panel.preset.stepwise.2': {
    zh: '把论文里最关键的公式或算法拆开讲：每个符号是什么、每一项在干什么、为什么这样组合。',
    en: 'Break down the key formula or algorithm: what each symbol means, what each term does, and why they combine this way.'
  },
  'panel.preset.stepwise.2.label': { zh: '解释关键公式', en: 'Explain a key formula' },
  'panel.preset.advisor.1': {
    zh: '列出汇报这篇论文时可能被问到的 8 个问题，给出参考回答及原文依据。原文无法回答的部分请注明。',
    en: 'List 8 questions that may come up when presenting this paper. Suggest answers with supporting passages, and note what the paper does not address.'
  },
  'panel.preset.advisor.1.label': { zh: '准备汇报问答', en: 'Prepare for questions' },
  'panel.preset.advisor.2': {
    zh: '整理汇报这篇论文需要掌握的知识点，区分核心内容和补充背景。',
    en: 'Outline the knowledge needed to present this paper, separating core points from background.'
  },
  'panel.preset.advisor.2.label': { zh: '核心知识点清单', en: 'Key points checklist' },
  'panel.preset.reviewer.1': {
    zh: '逐节审阅这篇论文，分析逻辑、方法和数据中可能存在的问题。每条意见请引用原文，并区分明确的问题与待验证的疑问。',
    en: 'Review the paper section by section for potential issues in its reasoning, methods and data. Cite each point and distinguish supported concerns from open questions.'
  },
  'panel.preset.reviewer.1.label': { zh: '逐节审阅', en: 'Review each section' },
  'panel.preset.reviewer.2': {
    zh: '评估这篇论文的实验设计与数据：基线是否公平、指标是否完整、消融实验是否充分，以及结论是否得到结果支持。',
    en: 'Assess the experiments and data: fairness of baselines, completeness of metrics, adequacy of ablations and support for the conclusions.'
  },
  'panel.preset.reviewer.2.label': { zh: '评估实验设计', en: 'Assess experiments' },
  'panel.persona.custom-group': { zh: '自定义', en: 'Custom' },
  'panel.persona.manage': { zh: '管理讲解风格…', en: 'Manage styles…' },
  'panel.preset.custom.label': { zh: '解释这篇论文', en: 'Explain this paper' },
  'panel.preset.custom': {
    zh: '按当前讲解风格介绍这篇论文的研究问题、方法、结果和局限。',
    en: 'Use the current style to explain the paper’s research question, method, results and limitations.'
  },
  'notes.empty-title': { zh: '还没有笔记', en: 'No notes yet' },
  'notes.empty': {
    zh: '选中一段文字后点击「记笔记」，或使用 AI 生成阅读要点。',
    en: 'Select a passage and choose Note, or use AI to generate key points.'
  },
  'notes.count': { zh: '{n} 条笔记', en: 'Notes: {n}' },
  'notes.ai-kind': { zh: 'AI · 阅读笔记', en: 'AI · Reading notes' },
  'notes.anchor-tip': { zh: '点击跳回原文这一段', en: 'Jump back to this passage' },
  'notes.delete': { zh: '删除这条笔记', en: 'Delete this note' },
  'notes.delete-confirm': {
    zh: '删除这条笔记？此操作无法撤销。',
    en: 'Delete this note? This cannot be undone.'
  },
  'notes.placeholder': { zh: 'Enter 保存 · Esc 取消', en: 'Enter to save · Esc to cancel' },
  'notes.save': { zh: '保存', en: 'Save' },
  'notes.cancel': { zh: '取消', en: 'Cancel' },
  'offline.badge': { zh: '离线', en: 'Offline' },
  'offline.title': {
    zh: '当前离线。仍可阅读已保存的论文、译文和笔记；云端 AI 和在线搜索需要网络连接。',
    en: 'You are offline. Saved papers, translations and notes remain available. Cloud AI and online search require a connection.'
  },
  'offline.reader': {
    zh: '当前离线。仍可阅读原文和已保存的译文；云端 AI 需要网络连接。',
    en: 'You are offline. Original papers and saved translations remain available. Cloud AI requires a connection.'
  },
  'offline.search': {
    zh: '当前离线，可查看过去 24 小时内缓存的搜索结果。',
    en: 'You are offline. Cached results from the past 24 hours are available.'
  },
  'notes.footer-hint': {
    zh: '笔记保存为 Markdown 文件，可使用其他编辑器打开。',
    en: 'Notes are saved as Markdown files and can be opened in other editors.'
  },
  'library.title': { zh: '论文库', en: 'Library' },
  'library.continue': { zh: '继续阅读', en: 'Continue reading' },
  'library.all': { zh: '全部', en: 'All papers' },
  'discover.title': { zh: '搜索', en: 'Search' },
  'discover.hint': {
    zh: '输入研究主题、论文标题或 arXiv ID，搜索多个论文来源。',
    en: 'Search across paper sources by topic, title or arXiv ID.'
  },
  /* ---- 通用 ---- */
  'common.save': { zh: '保存', en: 'Save' },
  'common.cancel': { zh: '取消', en: 'Cancel' },
  'common.edit': { zh: '编辑', en: 'Edit' },
  'common.delete': { zh: '删除', en: 'Delete' },
  'common.confirm': { zh: '确定', en: 'Confirm' },
  'common.add': { zh: '添加', en: 'Add' },
  'common.retry': { zh: '重试', en: 'Retry' },
  'common.stop': { zh: '停止', en: 'Stop' },
  'common.saved': { zh: '已保存', en: 'Saved' },
  'common.close-esc': { zh: '关闭 Esc', en: 'Close · Esc' },
  'common.open-settings': { zh: '打开设置', en: 'Open settings' },
  'common.got-it': { zh: '知道了', en: 'Got it' },
  'common.open': { zh: '打开', en: 'Open' },

  /* ---- 设置：供应商行 ---- */
  'set.detecting': { zh: '探测中…', en: 'Detecting…' },
  'set.running-models': { zh: '运行中 · {n} 个模型', en: 'Running · models: {n}' },
  'set.not-running': { zh: '未运行', en: 'Not running' },
  'set.local-nokey': { zh: '本地 · 无需密钥', en: 'Local · no key needed' },
  'set.key-set': { zh: '已配置', en: 'Configured' },
  'set.key-unset': { zh: '未配置', en: 'Not configured' },
  'set.local-hint': {
    zh: '未检测到服务。请安装并启动本地模型服务后重试。',
    en: 'No service detected. Install and start a local model server, then try again.'
  },
  'set.proxy-pick': { zh: '选择代理', en: 'Choose a proxy' },
  'set.direct': { zh: '直连', en: 'Direct' },
  'set.via-proxy': { zh: '代理：{name}', en: 'Proxy: {name}' },
  'set.download': { zh: '下载 ↗', en: 'Download ↗' },
  'set.get-key': { zh: '获取 API Key ↗', en: 'Get an API key ↗' },
  'set.paste-key': { zh: '粘贴 API Key', en: 'Paste API key' },
  'set.replace-key': { zh: '更换 API Key', en: 'Replace API key' },
  'set.name': { zh: '名称', en: 'Name' },
  'set.key-optional': { zh: 'API Key（留空不改）', en: 'API key (blank keeps current)' },

  /* ---- 设置：自定义来源 ---- */
  'set.err-name-url': {
    zh: '请输入名称，以及以 http:// 或 https:// 开头的接口地址。',
    en: 'Enter a name and a base URL starting with http:// or https://.'
  },
  'set.add-custom': { zh: '添加自定义供应商', en: 'Add a custom provider' },
  'set.add-custom-desc': {
    zh: '支持提供 OpenAI 兼容接口的网关、中转和自部署服务。',
    en: 'Connect a gateway, relay or self-hosted service with an OpenAI-compatible API.'
  },
  'set.add-custom-hint': {
    zh: '使用便于识别的名称，并填写服务提供的接口地址。',
    en: 'Choose a recognizable name and enter the base URL provided by the service.'
  },
  'set.ph-name': { zh: '名称（如 my-gateway）', en: 'Name (e.g. my-gateway)' },
  'set.base-url': { zh: '接口地址', en: 'Base URL' },
  'set.ph-baseurl': {
    zh: '接口地址（如 https://llm.example.com/v1）',
    en: 'Base URL (e.g. https://llm.example.com/v1)'
  },
  'set.ph-key-local': { zh: 'API Key（本地服务可留空）', en: 'API key (blank for local services)' },

  /* ---- 设置：接入页（厂商 Key / 自定义与本地来源） ---- */
  'set.official': { zh: '官方供应商', en: 'Official providers' },
  'set.official-desc': {
    zh: '配置供应商的 API Key。如需代理，可先在「网络」中添加，再为供应商选择。',
    en: 'Enter your provider’s API key. To use a proxy, add one under Network and select it for the provider.'
  },
  'set.custom': { zh: '自定义 / 本地', en: 'Custom & local' },
  'set.detect-local': { zh: '探测本地模型', en: 'Detect local models' },
  'set.custom-desc': {
    zh: '连接本地模型或网关。本地模型直接连接；网关可选择代理。',
    en: 'Connect local models or gateways. Local models connect directly; gateways can use a proxy.'
  },
  'set.detected': { zh: ' 探测到 {list}', en: ' Detected {list}' },
  'set.detected-item': { zh: '{slug}（{n} 个模型）', en: '{slug} (models: {n})' },
  'set.detect-none': {
    zh: ' 未检测到本地模型。请确认 Ollama 或 LM Studio 已启动并加载模型。',
    en: ' No local models detected. Make sure Ollama or LM Studio is running with a model loaded.'
  },

  /* ---- 设置：默认模型 ---- */
  'set.err-need-both': { zh: '请选择供应商并填写模型名称。', en: 'Choose a provider and enter a model name.' },
  'set.main-model': { zh: '默认模型', en: 'Default model' },
  'set.current': { zh: '当前：{provider} / {model}', en: 'Current: {provider} / {model}' },
  'set.main-desc': {
    zh: '对话及未单独指定模型的功能使用此模型。也可在对话框底部切换。',
    en: 'Used for chat and features without a separate model. You can also change it below the chat input.'
  },
  'set.provider': { zh: '供应商', en: 'Provider' },
  'set.no-provider': {
    zh: '暂无可用模型。请在「接入」中配置 API Key，或启动本地模型服务。',
    en: 'No models available. Configure an API key under Connect, or start a local model server.'
  },
  'set.pick-provider': { zh: '选择供应商', en: 'Choose a provider' },
  'set.suffix-local': { zh: ' · 本地', en: ' · local' },
  'set.paren-not-running': { zh: '（未运行）', en: ' (not running)' },
  'set.paren-no-key': { zh: '（未配置 API Key）', en: ' (no API key)' },
  'set.model': { zh: '模型', en: 'Model' },
  'set.loading-models': { zh: '正在获取模型列表…', en: 'Loading models…' },
  'set.models-count': { zh: '可选模型：{n}', en: 'Available models: {n}' },
  'set.models-none': {
    zh: '未获取到模型列表，可手动输入模型名称。',
    en: 'Could not load the model list. You can enter a model name manually.'
  },
  'set.current-paren': { zh: '{model}（当前）', en: '{model} (current)' },
  'set.pick-model': { zh: '选择模型…', en: 'Choose a model…' },
  'set.ph-model': { zh: '模型名', en: 'Model name' },

  /* ---- 设置：翻译模型 ---- */
  'set.slot.translate': { zh: '全文翻译', en: 'Translation' },
  'set.slot.translate.desc': {
    zh: '全文翻译的文本量较大，可根据质量、速度和费用选择模型。',
    en: 'Full-paper translation processes more text. Choose a model based on quality, speed and cost.'
  },
  'set.slot.summary': { zh: 'AI 摘要', en: 'AI summary' },
  'set.slot.summary.desc': {
    zh: '用于生成论文页首的简短摘要。',
    en: 'Generates the short summary at the top of a paper.'
  },
  'set.slot.notes': { zh: 'AI 阅读笔记', en: 'AI reading notes' },
  'set.slot.notes.desc': {
    zh: '用于「AI 生成阅读笔记」。',
    en: 'Used for Generate AI reading notes.'
  },
  'set.auto-main': { zh: '跟随默认模型', en: 'Same as default model' },
  'set.provider-default': { zh: '自动选择模型', en: 'Select automatically' },
  'set.ph-model-optional': { zh: '模型名称（留空自动选择）', en: 'Model name (leave blank to select automatically)' },
  'set.routes': { zh: '按功能选择模型', en: 'Models by feature' },
  'set.routes-desc': {
    zh: '以下功能可单独选择模型，未指定时使用默认模型。',
    en: 'Choose a separate model for each feature, or use the default model.'
  },

  /* ---- 设置：网络 ---- */
  'set.err-proxy-name': {
    zh: '请输入代理名称。',
    en: 'Enter a proxy name.'
  },
  'set.err-host': { zh: '主机必填', en: 'Host is required' },
  'set.testing': { zh: '测试中…', en: 'Testing…' },
  'set.reachable': { zh: '连通 ✓', en: 'Reachable ✓' },
  'set.failed': { zh: '失败：{error}', en: 'Failed: {error}' },
  'set.unreachable': { zh: '无法连接', en: 'Unreachable' },
  'set.ph-proxy-name': { zh: '名称（如 clash）', en: 'Name (e.g. clash)' },
  'set.ph-host': { zh: '主机（127.0.0.1）', en: 'Host (127.0.0.1)' },
  'set.ph-port': { zh: '端口', en: 'Port' },
  'set.ph-user': { zh: '用户名（可选）', en: 'Username (optional)' },
  'set.ph-pass': { zh: '密码（可选）', en: 'Password (optional)' },
  'set.test-conn': { zh: '测试连接', en: 'Test connection' },
  'set.test': { zh: '测试', en: 'Test' },
  'set.proxy-bound': { zh: '{n} 个供应商使用此代理', en: 'Providers using this proxy: {n}' },
  'set.proxy-unused': { zh: '暂无供应商使用此代理', en: 'No providers use this proxy' },
  'set.proxies': { zh: '代理配置', en: 'Proxies' },
  'set.add-proxy': { zh: '添加代理', en: 'Add a proxy' },
  'set.proxies-desc': {
    zh: '添加代理后，可在「接入」中为远程供应商选择。默认直接连接，本地模型不使用代理。代理密码保存在本机。',
    en: 'Add proxies here, then assign them to remote providers under Connect. Connections are direct by default; local models do not use proxies. Proxy passwords are stored locally.'
  },
  'set.no-proxy': { zh: '尚未添加代理', en: 'No proxies added' },
  'set.no-proxy-desc': {
    zh: '点击「添加代理」，然后在「接入」中为供应商选择。',
    en: 'Choose Add a proxy, then assign it to a provider under Connect.'
  },

  /* ---- 设置：成本 ---- */
  'set.cost': { zh: '用量与成本', en: 'Usage & cost' },
  'set.usage-month': { zh: '本月用量', en: 'This month' },
  'set.unknown-models': {
    zh: '以下模型缺少价格信息，未计入费用估算：{list}',
    en: 'Excluded from cost estimates because pricing is unavailable: {list}'
  },
  'set.usage-month-desc': {
    zh: '费用按公开价格估算，以供应商账单为准。单次翻译预计超过 $0.50 时，会请求确认。',
    en: 'Costs are estimated from published prices; actual charges depend on your provider’s bill. You will be asked to confirm translations estimated to cost over $0.50.'
  },

  'set.tab.general': { zh: '通用', en: 'General' },
  'set.tab.models': { zh: '模型', en: 'Models' },
  'set.tab.endpoint': { zh: '接入', en: 'Connect' },
  'set.prov.ready-count': { zh: '{n} / {total} 可用', en: '{n} / {total} ready' },
  'set.prov.setup': { zh: '配置 API Key', en: 'Add API key' },
  'set.prov.settings': { zh: '设置', en: 'Settings' },
  'set.prov.collapse': { zh: '收起', en: 'Collapse' },
  'set.prov.saved': { zh: '已保存', en: 'Saved' },
  'set.prov.key-label': { zh: 'API Key', en: 'API key' },
  'set.prov.keep-key': { zh: '已配置，输入新的 API Key 可替换', en: 'Configured. Enter a new API key to replace it.' },
  'set.prov.proxy-label': { zh: '代理', en: 'Proxy' },
  'set.prov.no-proxy': { zh: '尚未添加代理，可在「网络」中添加。', en: 'No proxies added. Add one under Network.' },
  'set.prov.name-label': { zh: '名称', en: 'Name' },
  'set.prov.url-label': { zh: '接口地址', en: 'Base URL' },
  'set.prov.delete': { zh: '删除供应商', en: 'Remove provider' },
  'set.prov.delete-confirm': { zh: '删除供应商「{name}」？使用该供应商的模型设置将无法继续使用。', en: 'Remove “{name}”? Model settings that use this provider will no longer work.' },
  'set.prov.via': { zh: '经 {name} 代理', en: 'via {name}' },
  'set.prov.gateways': { zh: '网关 / 中转', en: 'Gateways & relays' },
  'set.prov.gateways-desc': { zh: '连接提供 OpenAI 兼容接口的网关、中转或自部署服务，可为其配置代理。', en: 'Connect a gateway, relay or self-hosted service with an OpenAI-compatible API. A proxy can be configured for each.' },
  'set.prov.gateways-empty': { zh: '还没有添加', en: 'None added yet' },
  'set.prov.local': { zh: '本地模型', en: 'Local models' },
  'set.prov.local-desc': { zh: '连接在本机运行的模型服务，如 Ollama 或 LM Studio。请先启动服务并加载模型。其他已配置模型调用失败时，会尝试本地模型。', en: 'Connect a model server running on this computer, such as Ollama or LM Studio. Start the server and load a model first. Local models are tried if other configured models fail.' },
  'set.prov.kind': { zh: '类型', en: 'Type' },
  'set.prov.kind.gateway': { zh: '网关 / 中转（转发云端模型）', en: 'Gateway / relay (forwards to cloud models)' },
  'set.prov.kind.local': { zh: '本地模型服务（在本机运行模型）', en: 'Local model server (runs models on this computer)' },
  'set.prov.kind.desc': { zh: '转发云端请求的服务请选择「网关」，即使其地址是 127.0.0.1。本地模型会作为备用模型尝试使用。', en: 'Choose Gateway for services that forward requests to the cloud, even at 127.0.0.1. Local model servers are also used as fallbacks.' },
  'set.tab.network': { zh: '网络', en: 'Network' },
  'set.tab.data': { zh: '数据', en: 'Data' },
  'set.reasoning': { zh: '启用模型思考', en: 'Enable model reasoning' },
  'set.reasoning.desc': {
    zh: '向支持的模型请求思考过程。可能增加响应时间和 token 用量，效果取决于模型。',
    en: 'Request reasoning from models that support it. This may increase response time and token usage; results vary by model.'
  },
  'set.word-lookup': { zh: '双击单词显示释义', en: 'Double-click a word for its definition' },
  'set.word-lookup.desc': { zh: '使用内置词典查询，无需调用 AI。词典未收录的单词不提供释义。', en: 'Looks up words in the built-in dictionary without calling AI. Definitions are unavailable for words not in the dictionary.' },

  /* ---- 设置：数据 ---- */
  'set.data': { zh: '应用数据', en: 'App data' },
  'set.data-desc': {
    zh: '论文、笔记和应用数据保存在本机。使用 AI 时，所需内容会发送到你配置的接口地址。「全部重置」会保留配置、密钥和笔记。',
    en: 'Papers, notes and app data are stored locally. AI features send the required content to your configured endpoint. Reset all keeps configuration, keys and notes.'
  },
  'set.data.total': { zh: '共占用 {size}', en: '{size} in total' },
  'set.data.files': { zh: '{n} 个文件', en: '{n} files' },
  'set.data.db': { zh: '数据库', en: 'Database' },
  'set.data.db.desc': { zh: '论文解析结果、译文、摘要、对话记录、用量记录、搜索缓存', en: 'Parsed papers, translations, summaries, chat history, usage log, search cache' },
  'set.data.counts': {
    zh: '{papers} 篇论文 · {translations} 段译文 · {summaries} 篇摘要 · {chats} 个会话 · {usage} 条用量 · {searchCache} 条搜索缓存',
    en: '{papers} papers · {translations} translated paragraphs · {summaries} summaries · {chats} chats · {usage} usage rows · {searchCache} cached searches'
  },
  'set.data.papers': { zh: '论文 PDF 副本', en: 'PDF copies' },
  'set.data.papers.desc': { zh: '导入时复制进库的原文件；从论文库删除论文时一并删除', en: 'Copies made at import; removed when you delete a paper from the library' },
  'set.data.figures': { zh: '图表截图与封面', en: 'Figure crops & covers' },
  'set.data.figures.desc': { zh: '清除后，打开论文时会重新生成。', en: 'Regenerated when you open a paper after clearing them.' },
  'set.data.notes': { zh: '笔记', en: 'Notes' },
  'set.data.notes.desc': { zh: '每篇论文保存为一个 Markdown 笔记文件。', en: 'One Markdown notes file per paper.' },
  'set.data.settings': { zh: '界面设置', en: 'UI settings' },
  'set.data.settings.desc': { zh: '主题、字号和面板位置等偏好设置', en: 'Preferences such as theme, text size and panel position' },
  'set.data.config': { zh: '配置与密钥', en: 'Config & keys' },
  'set.data.config.desc': { zh: '供应商配置和 API Key，分别保存在 config.yaml 和 .env 中。', en: 'Provider configuration and API keys, stored in config.yaml and .env respectively.' },
  'set.data.clean': { zh: '清理', en: 'Clean up' },
  'set.data.clean-desc': {
    zh: '清除操作无法撤销。译文和摘要可重新生成，但可能再次产生费用；对话和用量记录无法恢复。',
    en: 'Clearing data cannot be undone. Translations and summaries can be regenerated, which may incur new charges. Chat history and usage records cannot be restored.'
  },
  'set.data.clear.search-cache': { zh: '搜索缓存', en: 'Search cache' },
  'set.data.clear.figures': { zh: '图表截图与封面', en: 'Figure crops & covers' },
  'set.data.clear.translations': { zh: '全部译文', en: 'All translations' },
  'set.data.clear.summaries': { zh: '全部摘要', en: 'All summaries' },
  'set.data.clear.chats': { zh: '全部对话记录', en: 'All chat history' },
  'set.data.clear.usage': { zh: '用量记录', en: 'Usage log' },
  'set.data.clear-confirm': { zh: '清除{what}？不可恢复。', en: 'Clear {what}? This cannot be undone.' },
  'set.data.cleared': { zh: '已清除', en: 'Cleared' },
  'set.data.reset': { zh: '全部重置', en: 'Reset all' },
  'set.data.reset.desc': {
    zh: '删除数据库、PDF 副本、图表截图和界面设置，然后重启。密钥和笔记保留。',
    en: 'Deletes the database, PDF copies, figure crops and UI settings, then restarts. Keys and notes are kept.'
  },
  'set.data.reset-confirm': {
    zh: '全部重置？论文库、译文、摘要、对话记录、用量记录和界面设置将被删除，无法恢复。配置、密钥和笔记会保留，随后应用将重启。',
    en: 'Reset all? The library, translations, summaries, chat history, usage records and UI settings will be permanently deleted. Configuration, keys and notes will be kept, and the app will restart.'
  },
  'common.clear': { zh: '清除', en: 'Clear' },
  'set.tab.personas': { zh: '讲解风格', en: 'Styles' },
  'set.title': { zh: '设置', en: 'Settings' },
  'set.site': { zh: '官网', en: 'Website' },

  /* ---- 设置：讲法（读者人设） ---- */
  'set.personas': { zh: '讲解风格', en: 'Explanation styles' },
  'set.personas-desc': {
    zh: '选择适合你的讲解方式，用于后续对话。',
    en: 'Choose how papers are explained in subsequent messages.'
  },
  'set.personas-current': { zh: '当前风格', en: 'Current style' },
  'set.personas-builtin': { zh: '内置风格', en: 'Built-in styles' },
  'set.persona-desc.grandma': { zh: '面向没有专业背景的读者，用日常语言和生活中的例子解释论文。', en: 'Explains papers in everyday language with familiar examples, assuming no technical background.' },
  'set.persona-desc.kid': { zh: '用简短的故事和类比介绍基础概念，一次解释一个知识点。', en: 'Introduces basic concepts through short stories and comparisons, one idea at a time.' },
  'set.persona-desc.stepwise': { zh: '逐步解释方法和推导，说明每一步的目的、联系及符号含义。', en: 'Works through methods and derivations step by step, explaining their purpose, connections and notation.' },
  'set.persona-desc.advisor': { zh: '整理汇报要点和可能的提问，并结合原文准备参考回答。', en: 'Organizes presentation points and likely questions, with suggested answers grounded in the paper.' },
  'set.persona-desc.reviewer': { zh: '从审稿角度分析论证、方法和数据，结合原文指出问题与局限。', en: 'Examines the reasoning, methods and data from a reviewer’s perspective, with references to the paper.' },
  'set.personas-custom': { zh: '自定义风格', en: 'Custom styles' },
  'set.personas-empty': { zh: '尚未添加自定义风格', en: 'No custom styles added' },
  'set.personas-empty-desc': {
    zh: '点击「添加」，设置读者背景、讲解方式和快捷提问。',
    en: 'Choose Add to define the reader’s background, explanation style and suggested questions.'
  },
  'set.persona-new': { zh: '新建讲解风格', en: 'New explanation style' },
  'set.persona-form-hint': {
    zh: '名称用于切换风格。请说明读者背景和讲解要求；快捷提问每行一条，最多 4 条。',
    en: 'The name appears in the style picker. Describe the reader’s background and preferred explanation style. Add up to 4 suggested questions, one per line.'
  },
  'set.persona-presets': { zh: '快捷提问：{list}', en: 'Suggested questions: {list}' },
  'set.persona-presets-default': {
    zh: '未设置快捷提问，默认使用「解释这篇论文」。',
    en: 'No suggested questions set. Uses “Explain this paper” by default.'
  },
  'set.persona-err': { zh: '请输入名称和讲解要求。', en: 'Enter a name and explanation instructions.' },
  'set.persona-ph-name': { zh: '名称，例如「产品经理视角」', en: 'Name, e.g. “Product perspective”' },
  'set.persona-ph-style': {
    zh: '讲解要求，例如：面向刚入门的产品经理，先说明应用场景，再解释技术方法和术语。',
    en: 'Instructions, e.g. explain for a new product manager: start with possible applications, then explain the method and terminology.'
  },
  'set.persona-ph-presets': {
    zh: '快捷提问（可选），每行一条，例如：\n这项研究有哪些应用场景？\n实现时需要关注哪些技术风险？',
    en: 'Suggested questions (optional), one per line, e.g.:\nWhat are the possible applications?\nWhat technical risks should be considered?'
  },

  /* ---- 设置：通用 ---- */
  'set.general': { zh: '通用', en: 'General' },
  'set.lang': { zh: '界面语言', en: 'Interface language' },
  'set.target-lang': { zh: '翻译目标语言', en: 'Translate into' },
  'set.target-lang.desc': {
    zh: '用于翻译、AI 摘要和 AI 阅读笔记。论文与目标语言相同时，不显示翻译入口。',
    en: 'Used for translations, AI summaries and AI reading notes. Translation controls are hidden when the paper is already in this language.'
  },
  'set.theme': { zh: '主题', en: 'Theme' },
  'set.theme-desc': { zh: '按 ⌘D 切换深色与浅色主题', en: 'Press ⌘D to switch between dark and light themes' },
  'set.theme.system': { zh: '跟随系统', en: 'Follow system' },
  'set.theme.dark': { zh: '深色', en: 'Dark' },
  'set.theme.light': { zh: '浅色', en: 'Light' },

  /* ---- 论文库 ---- */
  'lib.confirm-delete': {
    zh: '删除《{title}》？\n\n库中的 PDF 副本、译文、摘要、对话记录和阅读进度将一并删除，无法恢复。笔记文件会保留。',
    en: 'Delete “{title}”?\n\nThe library’s PDF copy, translations, summary, chat history and reading progress will be permanently deleted. The notes file will be kept.'
  },
  'lib.status.done': { zh: '已读', en: 'Finished' },
  'lib.status.reading': { zh: '在读 {pct}%', en: 'Reading {pct}%' },
  'lib.status.unread': { zh: '待读', en: 'Unread' },
  'lib.trans.done': { zh: '已译', en: 'Translated' },
  'lib.trans.pct': { zh: '译 {pct}%', en: '{pct}% translated' },
  'lib.delete-paper': { zh: '删除论文', en: 'Delete paper' },
  'lib.col.title': { zh: '标题', en: 'Title' },
  'lib.col.authors': { zh: '作者', en: 'Authors' },
  'lib.col.year': { zh: '年份', en: 'Year' },
  'lib.col.source': { zh: '来源', en: 'Source' },
  'lib.col.status': { zh: '状态', en: 'Status' },
  'lib.col.progress': { zh: '进度', en: 'Progress' },
  'lib.filter.all': { zh: '全部', en: 'All' },
  'lib.filter.unread': { zh: '待读', en: 'Unread' },
  'lib.filter.reading': { zh: '在读', en: 'Reading' },
  'lib.filter.done': { zh: '已读', en: 'Finished' },
  'lib.load-failed': {
    zh: '无法加载论文库。请重启应用后重试；若问题持续，请在备份应用数据后联系支持。',
    en: 'Could not load the library. Restart the app and try again. If the problem continues, back up your app data and contact support.'
  },
  'lib.collections': { zh: '合集', en: 'Collections' },
  'lib.view.cover': { zh: '封面', en: 'Covers' },
  'lib.view.list': { zh: '列表', en: 'List' },
  'lib.import': { zh: '导入', en: 'Import' },
  'lib.contradictions': { zh: '比较笔记', en: 'Compare notes' },
  'lib.contradictions.tip': {
    zh: '使用 AI 比较不同论文的笔记，查找结论可能不一致的地方。至少需要两条笔记。',
    en: 'Use AI to compare notes across papers for potentially conflicting conclusions. Requires at least two notes.'
  },
  'lib.contradictions.label': { zh: 'AI · 笔记对比', en: 'AI · Notes comparison' },
  'lib.contradictions.busy': { zh: '正在比对笔记…', en: 'Comparing notes…' },
  'lib.empty.title': { zh: '尚未添加论文', en: 'No papers added' },
  'lib.empty.hint': {
    zh: '拖入 PDF、点击「导入」，或从搜索结果中添加论文。',
    en: 'Drop in a PDF, choose Import, or add a paper from Search.'
  },
  'lib.empty.filter': { zh: '这个分类下还没有论文', en: 'No papers in this collection yet' },
  'lib.search': { zh: '搜索论文库…', en: 'Search your library…' },
  'lib.search-short': { zh: '搜索…', en: 'Search…' },
  'lib.empty.search': { zh: '没有匹配「{q}」的论文', en: 'No papers match “{q}”' },

  /* ---- 搜索 ---- */
  'search.parsing': { zh: '解析中…', en: 'Parsing…' },
  'search.downloading-pct': { zh: '下载 {pct}%', en: 'Downloading {pct}%' },
  'search.downloading-mb': { zh: '已下载 {mb} MB', en: 'Downloaded {mb} MB' },
  'search.connecting': { zh: '连接中…', en: 'Connecting…' },
  'search.cited': { zh: '被引 {n}', en: 'Cited by {n}' },
  'search.add': { zh: '加入论文库', en: 'Add to library' },
  'search.why-hits': { zh: '匹配关键词：{terms}', en: 'Matching keywords: {terms}' },
  'search.why-sep': { zh: '、', en: ', ' },
  'search.why-cited': { zh: '同主题高被引（{n}）', en: 'Highly cited on this topic ({n})' },
  'search.why-related': { zh: '同领域相关结果', en: 'Related work in the same field' },
  'search.why-id': { zh: 'arXiv 编号完全匹配', en: 'Exact arXiv ID match' },
  'search.summary-label': { zh: 'AI · 搜索结果总结', en: 'AI · Results summary' },
  'search.summarizing': { zh: '总结中…', en: 'Summarizing…' },
  'search.summarizing-hint': {
    zh: '正在等待模型响应…',
    en: 'Waiting for the model to respond…'
  },
  'search.source-pending': { zh: '正在等待此来源返回结果…', en: 'Waiting for results from this source…' },
  'search.which-first': { zh: '推荐阅读顺序', en: 'Suggest a reading order' },
  'search.placeholder': {
    zh: '输入主题、论文标题或 arXiv ID',
    en: 'Enter a topic, paper title or arXiv ID'
  },
  'search.searching': { zh: '搜索中…', en: 'Searching…' },
  'search.go': { zh: '搜索', en: 'Search' },
  'search.deduped': { zh: '{n} 条结果', en: 'Results: {n}' },
  'search.from-cache': { zh: ' · 缓存结果', en: ' · cached results' },
  'search.raw-count': { zh: ' · 合并前 {n}', en: ' · {n} before merging' },
  'search.used-en': { zh: '已按英文搜索：{q}', en: 'Searched as: {q}' },
  'search.no-hits-cjk': {
    zh: '这些来源对英文关键词的支持更好。可改用英文搜索，或配置模型以自动转换关键词。',
    en: 'These sources work better with English keywords. Try searching in English, or configure a model to translate queries automatically.'
  },
  'search.translate-failed': { zh: '无法转换为英文关键词：{err}。可尝试直接使用英文搜索。', en: 'Could not translate the query: {err}. Try searching with English keywords.' },
  'search.all-failed': {
    zh: '搜索失败：{errors}。请检查网络或代理设置，或稍后重试。',
    en: 'Search failed: {errors}. Check your network or proxy settings, or try again later.'
  },
  'search.no-hits': {
    zh: '在 {sources} 中未找到结果。请更换关键词，或输入 arXiv ID。',
    en: 'No results found in {sources}. Try different keywords or an arXiv ID.'
  },

  /* ---- 首次启动引导 ---- */
  'onboard.title': { zh: '开始使用 ReadArc', en: 'Get started with ReadArc' },
  'onboard.lede': {
    zh: '无需注册 ReadArc 账号。论文和笔记保存在本机；使用 AI 时，所需内容会发送到你配置的模型服务。',
    en: 'No ReadArc account required. Papers and notes are stored locally. AI features send the required content to the model service you configure.'
  },
  'onboard.step1.title': { zh: '接入模型（两种方式任选其一）', en: 'Connect a model (either option)' },
  'onboard.cloud.title': { zh: '云端 API Key', en: 'Cloud API key' },
  'onboard.step1.desc': {
    zh: '在「接入」中选择供应商并填写 API Key，也可添加提供 OpenAI 兼容接口的服务。',
    en: 'Choose a provider under Connect and enter your API key, or add a service with an OpenAI-compatible API.'
  },
  'onboard.step1.cta': { zh: '配置接入', en: 'Set up connection' },
  'onboard.step2.title': { zh: '本地模型', en: 'Local model' },
  'onboard.step2.desc': {
    zh: '启动 Ollama 或 LM Studio 并加载模型，然后检测可用的本地服务。',
    en: 'Start Ollama or LM Studio and load a model, then detect available local services.'
  },
  'onboard.detecting': { zh: '探测中…', en: 'Detecting…' },
  'onboard.detect': { zh: '探测本地模型', en: 'Detect local models' },
  'onboard.detected': { zh: '已接入 {list}', en: 'Connected: {list}' },
  'onboard.detect-none': {
    zh: '未检测到本地模型。请确认服务已启动并加载模型。',
    en: 'No local models detected. Make sure the server is running with a model loaded.'
  },
  'onboard.step3.title': { zh: '打开论文', en: 'Open a paper' },
  'onboard.step3.desc': {
    zh: '拖入 PDF 或选择本地文件。阅读原文无需配置模型。',
    en: 'Drop in a PDF or choose a local file. Reading the original does not require a model.'
  },
  'onboard.start': { zh: '选择 PDF', en: 'Choose a PDF' },
  'onboard.skip': { zh: '稍后设置', en: 'Set up later' },

  /* ---- 阅读器：摘要 / 翻译状态条 ---- */
  'doc.summary-label': { zh: 'AI · 论文摘要', en: 'AI · Paper summary' },
  'doc.generating': { zh: '生成中…', en: 'Generating…' },
  'doc.gen-summary': { zh: '生成摘要', en: 'Generate summary' },
  'doc.estimate': {
    zh: '预估 ',
    en: 'Estimated '
  },
  'doc.estimate-detail': {
    zh: '（{paras} 段 · 约 {k}k tokens · ',
    en: ' ({paras} paragraphs · ~{k}k tokens · '
  },
  'doc.continue-translate': { zh: '继续翻译', en: 'Continue translation' },
  'doc.regen-summary': { zh: '重新生成', en: 'Regenerate' },
  'doc.translated-all': { zh: '已全文翻译（{n} 段）', en: 'Fully translated ({n} paragraphs)' },
  'doc.retranslate-all': { zh: '重新翻译全文', en: 'Retranslate all' },
  'doc.retranslate-tip': {
    zh: '用设置里的翻译模型整篇重译并覆盖现有译文',
    en: 'Retranslate the whole paper with the translation model from Settings, replacing the existing translation'
  },
  'doc.regen-summary-tip': { zh: '重新生成（上次由 {model} 生成）', en: 'Regenerate (last generated by {model})' },
  'doc.translated-by': { zh: '由 {model} 翻译', en: 'Translated by {model}' },
  'doc.translated-by-mixed': { zh: '由 {model} 等 {n} 个模型翻译', en: 'Translated by {n} models, including {model}' },
  'doc.pause': { zh: '暂停', en: 'Pause' },
  'doc.jump-untranslated': { zh: '跳到未译处', en: 'Jump to untranslated' },
  'doc.no-text-layer': {
    zh: '此 PDF 没有可提取的文字，可能是扫描件。目前可查看原版页面，暂不支持翻译。',
    en: 'This PDF has no extractable text and may be a scan. You can view the original pages, but translation is unavailable.'
  },
  'doc.pdf-missing': {
    zh: '找不到 PDF 文件，可能已被移动或删除。',
    en: 'The PDF could not be found. It may have been moved or deleted.'
  },

  /* ---- 命令面板 ---- */
  'palette.reader': { zh: '阅读', en: 'Reader' },
  'palette.library': { zh: '论文库', en: 'Library' },
  'palette.discover': { zh: '搜索', en: 'Search' },
  'palette.settings': { zh: '设置', en: 'Settings' },
  'palette.unread': { zh: '待读', en: 'Unread' },
  'palette.ask': { zh: '问 AI：{q}', en: 'Ask AI: {q}' },
  'palette.current-paper': { zh: '当前论文', en: 'Current paper' },
  'palette.placeholder': {
    zh: '搜索论文或功能，也可输入问题向 AI 提问…',
    en: 'Search papers or actions, or enter a question for AI…'
  },
  'palette.no-match': { zh: '没有匹配项', en: 'No matches' },
  'palette.more': { zh: '还有 {n} 篇，可在论文库中查看', en: '{n} more papers available in Library' },

  /* ---- 面板 ---- */
  'panel.answered-by': { zh: '由 {model} 生成', en: 'Generated by {model}' },
  'panel.pick-model': { zh: '选择模型…', en: 'Choose a model…' },
  'panel.connect-model': { zh: '连接模型…', en: 'Connect a model…' },
  'panel.model-tip': {
    zh: '默认用于对话、摘要、笔记和翻译。可在设置中为各功能单独选择模型。',
    en: 'Default for chat, summaries, notes and translation. Choose separate models for individual features in Settings.'
  },
  'panel.gen-label': { zh: 'AI · 生成中', en: 'AI · Generating' },

  /* ---- 划词工具条 ---- */
  'sel.copy': { zh: '复制', en: 'Copy' },
  'sel.highlight': { zh: '高亮', en: 'Highlight' },
  'sel.ask': { zh: '问 AI', en: 'Ask AI' },
  'sel.note': { zh: '记笔记', en: 'Note' },
  'sel.translate': { zh: '翻译', en: 'Translate' },
  'sel.translating': { zh: '翻译中…', en: 'Translating…' },
  'sel.remove-highlight': { zh: '点击移除高亮', en: 'Click to remove highlight' },
  'sel.highlight-removed': { zh: '已移除高亮', en: 'Highlight removed' },
  'common.undo': { zh: '撤销', en: 'Undo' },
  'sel.jump-refs': { zh: '跳到参考文献', en: 'Jump to references' },

  /* ---- 查找条 ---- */
  'find.placeholder': { zh: '在原文和译文中查找…', en: 'Find in original and translated text…' },
  'find.prev': { zh: '上一处 Shift+Enter', en: 'Previous · Shift+Enter' },
  'find.next': { zh: '下一处 Enter', en: 'Next · Enter' },

  /* ---- 工具条 / 标题栏 / 侧栏 ---- */
  'tb.zoom-out': { zh: '缩小 ⌘−', en: 'Zoom out ⌘−' },
  'tb.zoom-reset': { zh: '点击恢复 100% 缩放，也可按住 ⌘ 滚动滚轮调整。', en: 'Click to reset zoom to 100%, or hold ⌘ and scroll to adjust.' },
  'tb.zoom-in': { zh: '放大 ⌘+', en: 'Zoom in ⌘+' },
  'tb.zh-scale-label': { zh: '译文', en: 'ZH' },
  'tb.retranslate': { zh: '重译', en: 'Retranslate' },
  'tb.translate-to': { zh: '翻译成', en: 'Translate to' },
  'tb.translate-pick': { zh: '选择语言', en: 'Choose' },
  'tb.translate-to-tip': {
    zh: '这篇论文的语言和目标语言相同。选一种语言就能翻译，设置里也能改。',
    en: 'This paper is already in your target language. Pick a language to translate it. You can also change this in Settings.'
  },
  'doc.summary-fold': { zh: '收起摘要', en: 'Collapse summary' },
  'doc.summary-unfold': { zh: '展开摘要', en: 'Expand summary' },
  'tb.zh-scale': {
    zh: '调整译文字号，页面长度会随文字大小变化。',
    en: 'Adjust translation text size. Page length changes with the text size.'
  },
  'tb.paper-dark': { zh: '使用深色纸面', en: 'Use dark paper' },
  'tb.paper-light': { zh: '使用浅色纸面', en: 'Use light paper' },
  'tb.focus': { zh: '专注模式 ⌘⇧F · 隐藏侧栏和面板', en: 'Focus mode ⌘⇧F · Hide sidebar and panels' },
  'tb.focus-off': { zh: '退出专注模式 ⌘⇧F', en: 'Leave focus mode ⌘⇧F' },
  'tb.crop': { zh: '截图提问 ⌘S · 框选公式或图表，需要支持图片的模型', en: 'Ask about a screenshot ⌘S · Select a formula or figure; requires a model that supports images' },
  'tb.crop-off': { zh: '退出截图 Esc', en: 'Exit screenshot Esc' },
  'crop.hint': { zh: '拖动框选公式或图表 · Esc 退出', en: 'Drag to select a formula or figure · Esc to exit' },
  'panel.attach-image': { zh: '已附图片，写下你的问题', en: 'Image attached; type your question' },
  'panel.image-read-failed': { zh: '无法读取图片，请重新选择文件。', en: 'Could not read the image. Select the file again.' },
  'panel.image-process-failed': { zh: '无法处理图片，请尝试其他图片。', en: 'Could not process the image. Try another image.' },
  'panel.image-decode-failed': { zh: '无法识别图片格式，请尝试 PNG 或 JPEG 文件。', en: 'Could not decode the image. Try a PNG or JPEG file.' },
  'panel.image-default-question': { zh: '请解释这张截图里的内容。', en: 'Please explain what is in this screenshot.' },
  'panel.no-vision': {
    zh: '当前模型不支持图片。请在对话框底部选择支持图片的模型后重试。错误详情：{detail}',
    en: 'The current model does not support images. Choose a model that does below the chat input and try again. Error details: {detail}'
  },
  'common.remove': { zh: '移除', en: 'Remove' },
  'tb.show-panel': { zh: '显示面板 ⌘\\', en: 'Show panel ⌘\\' },
  'tb.hide-panel': { zh: '隐藏面板 ⌘\\', en: 'Hide panel ⌘\\' },
  'tb.panel-layout': { zh: '面板位置。⌘\\ 显示或隐藏。', en: 'Panel position. ⌘\\ shows or hides it.' },
  'tb.dock-side': { zh: '停靠', en: 'Dock side' },
  'tb.panel-right': { zh: '面板靠右', en: 'Panel on the right' },
  'tb.panel-bottom': { zh: '面板靠下', en: 'Panel at the bottom' },
  'outline.expand': { zh: '展开目录', en: 'Show outline' },
  'outline.collapse': { zh: '收起目录', en: 'Hide outline' },
  'rail.expand': { zh: '展开侧栏', en: 'Expand sidebar' },
  'rail.collapse': { zh: '收起侧栏', en: 'Collapse sidebar' },

  /* ---- 崩溃兜底 ---- */
  'crash.title': { zh: '界面加载出错', en: 'The interface encountered an error' },
  'crash.body': {
    zh: '请尝试重新加载。若问题持续，可附上下方错误信息反馈问题。',
    en: 'Try reloading. If the problem continues, report it with the error details below.'
  },
  'crash.reload': { zh: '重新加载', en: 'Reload' },
} satisfies Record<string, Record<Lang, string>>

export type I18nKey = keyof typeof dict

/** 文案里的占位符写作 {name}，调用时传同名变量替换。 */
export type Vars = Record<string, string | number>

export function t(key: I18nKey, lang: Lang, vars?: Vars): string {
  // 快捷键符号按平台换（⌘ → Ctrl+），文案里统一写 mac 写法
  const raw = keyLabel(dict[key][lang])
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

/**
 * 组件外取译文（confirm 弹窗、模块级辅助函数等用不了 hook 的地方）。
 * 直接读 store 当前语言；组件内一律用 useT，那样语言切换才会触发重渲染。
 */
export function tNow(key: I18nKey, vars?: Vars): string {
  return t(key, useApp.getState().lang, vars)
}

export function useT(): (key: I18nKey, vars?: Vars) => string {
  const lang = useApp((s) => s.lang)
  return (key, vars) => t(key, lang, vars)
}
