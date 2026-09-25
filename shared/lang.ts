/**
 * 原文语言判断（主进程与渲染进程共用）。
 * 中文论文不需要翻译：主进程遇到这类段落直接原样当译文、不调模型；
 * 渲染进程统计「未翻译」段数时也把它们排除，工具栏不再劝用户翻译一篇中文论文。
 */

/** 翻译 / 摘要 / 笔记的目标语言 */
export type TargetLang = 'zh' | 'en' | 'ja' | 'ko' | 'de' | 'fr' | 'es'

/** 顺序固定：译文缓存的版本号按下标错开，别调换 */
export const TARGET_LANGS: { id: TargetLang; name: string; english: string }[] = [
  { id: 'zh', name: '中文', english: 'Chinese' },
  { id: 'en', name: 'English', english: 'English' },
  { id: 'ja', name: '日本語', english: 'Japanese' },
  { id: 'ko', name: '한국어', english: 'Korean' },
  { id: 'de', name: 'Deutsch', english: 'German' },
  { id: 'fr', name: 'Français', english: 'French' },
  { id: 'es', name: 'Español', english: 'Spanish' }
]

export function isTargetLang(v: unknown): v is TargetLang {
  return TARGET_LANGS.some((l) => l.id === v)
}

/** 设置里没选目标语言时跟界面语言走 */
export function resolveTargetLang(s: { targetLang?: TargetLang | null; lang: 'zh' | 'en' }): TargetLang {
  return s.targetLang && isTargetLang(s.targetLang) ? s.targetLang : s.lang
}

export type Script = 'han' | 'kana' | 'hangul' | 'latin'

/** 各文字系统的字符数：汉字、假名、谚文、拉丁字母 */
export function scriptCounts(text: string): Record<Script, number> {
  const c = { han: 0, kana: 0, hangul: 0, latin: 0 }
  for (const ch of text) {
    const x = ch.charCodeAt(0)
    if ((x >= 0x4e00 && x <= 0x9fff) || (x >= 0x3400 && x <= 0x4dbf)) c.han++
    else if (x >= 0x3040 && x <= 0x30ff) c.kana++
    else if (x >= 0xac00 && x <= 0xd7af) c.hangul++
    else if ((x >= 0x41 && x <= 0x5a) || (x >= 0x61 && x <= 0x7a) || (x >= 0xc0 && x <= 0x24f)) c.latin++
  }
  return c
}

/** 目标语言写出来用的是哪套文字 */
export function scriptOf(lang: TargetLang): Script {
  return lang === 'zh' ? 'han' : lang === 'ja' ? 'kana' : lang === 'ko' ? 'hangul' : 'latin'
}

// 拉丁字母语言靠文字分不开，用高频功能词分：命中两个以上且占比够就认
const LATIN_MARKERS: Record<'de' | 'fr' | 'es', string[]> = {
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'ein', 'eine', 'wir', 'den', 'dem', 'von', 'zu', 'auf', 'werden', 'wird', 'für'],
  fr: ['le', 'les', 'des', 'une', 'est', 'et', 'dans', 'pour', 'nous', 'que', 'du', 'au', 'sur', 'pas', 'sont', 'avec', 'cette', 'ce'],
  es: ['el', 'los', 'las', 'una', 'es', 'y', 'en', 'para', 'con', 'por', 'del', 'que', 'se', 'como', 'más', 'son', 'este', 'esta']
}

/** 一段文字是哪种语言。日文按假名、韩文按谚文、中文按汉字；拉丁字母文本按功能词分德法西，其余算英文 */
export function textLang(text: string): TargetLang {
  const c = scriptCounts(text)
  const cjk = c.han + c.kana + c.hangul
  // 一个汉字顶一个英文单词，粗略按 4 个字母算一个词
  if (cjk > 0 && cjk >= c.latin / 4) {
    if (c.hangul >= cjk * 0.3) return 'ko'
    // 日文正文里假名通常占三成以上；中文里没有假名
    if (c.kana >= cjk * 0.15) return 'ja'
    return 'zh'
  }
  // 英文论文里遍地是「et al.」，别让这个 et 把英文段落认成法文
  const words = text
    .replace(/\bet\s+al\b\.?/gi, ' ')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
  if (words.length < 6) return 'en'
  let best: TargetLang = 'en'
  let bestScore = 0
  for (const [lang, markers] of Object.entries(LATIN_MARKERS) as ['de' | 'fr' | 'es', string[]][]) {
    const set = new Set(markers)
    const n = words.filter((w) => set.has(w)).length
    if (n >= 2 && n / words.length >= 0.04 && n > bestScore) {
      best = lang
      bestScore = n
    }
  }
  return best
}

/** 一篇论文的主要语言：抽样正文 */
export function paperLang(texts: string[]): TargetLang {
  return textLang(texts.slice(0, 80).join('\n'))
}

/** 中文（CJK）字符明显多于英文字母：视为已经是中文。夹杂的英文术语（Transformer、BLEU）不影响判断。 */
export function isCjkDominant(text: string): boolean {
  let cjk = 0
  let latin = 0
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x3040 && c <= 0x30ff) || (c >= 0xac00 && c <= 0xd7af)) cjk++
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin++
  }
  if (cjk === 0) return false
  // 一个汉字顶一个英文单词，粗略按 4 个字母算一个词
  return cjk >= latin / 4
}

/**
 * 作者—年份式参考文献条目（没有 [N] 编号）：首句是人名清单，正文带年份和书目特征
 * （卷:页码、pp.、arXiv、Proceedings、Journal、URL……）。模型对这类段原样返回是对的，
 * 不能按散文判据拒收——否则这一条永远翻不上，横幅一直显示「1 段未翻译」。
 */
export function looksReferenceEntry(text: string): boolean {
  const t = text.trim()
  if (t.length > 900 || !/\b(?:19|20)\d\d[a-z]?\b/.test(t)) return false
  // 编号式条目「[1] Vaswani A, et al. …… 2017.」：编号 + 年份 + 人名写法就够，
  // 不必再要求会议 / 期刊关键词（NeurIPS、ICLR 这类简称不在关键词表里）
  if (/^\[\d{1,3}\]\s/.test(t) && /\bet al\b|,\s*[A-Z]\.|[A-Z][a-z]+\s+[A-Z]\b/.test(t)) return true
  const marker =
    /\d+\s*:\s*\d+\s*[–-]\s*\d+|\bpp?\.\s*\d|\bpages?\s+\d|\barXiv\b|\bPreprint\b|\bProceedings\b|\bProc\.|\bJournal\b|\bTransactions\b|\bConference\b|\bWorkshop\b|\bvol(?:ume)?\.?\s*\d|\bdoi\b|https?:\/\/|\bIn\s+Advances\b|\bPress\b|\bUniversity\b/i
  if (!marker.test(t)) return false
  // 首句得像人名清单：大写开头的词占多数（"Ehsan Hosseini-Asl, Bryan McCann, and Richard Socher."）
  const first = t.split(/\.\s+/)[0] ?? ''
  const words = first.split(/\s+/).filter(Boolean)
  if (words.length < 2) return false
  const caps = words.filter((w) => /^[A-Z]/.test(w)).length
  return caps / words.length >= 0.6
}

/**
 * 这一段要不要调模型翻译。主进程与渲染进程共用：主进程据此跳过（原样当译文、不花 token），
 * 渲染进程据此统计「还有几段没翻译」。两边口径必须一致，否则工具栏会一直劝用户翻译已经跳过的段。
 */
export function skipTranslation(text: string, target: TargetLang = 'zh'): boolean {
  // 没有可译的文字（纯数字、符号）。假名、谚文也算文字：纯韩文、纯假名的段落要照常翻译
  if (!/[A-Za-z]{2,}/.test(text) && !/[一-鿿\u3040-\u30ff\uac00-\ud7af]/.test(text)) return true
  // 本来就是目标语言，译了也是原样
  if (textLang(text) === target) return true
  // 参考文献条目：人名 + 会议/期刊 + 年份，翻译没有意义，还常被模型原样退回
  return looksReferenceEntry(text)
}
