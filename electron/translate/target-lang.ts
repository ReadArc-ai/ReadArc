/**
 * 翻译 / 摘要 / 笔记的目标语言。设置里没选就跟界面语言走。
 * 缓存按语言分开：同一段的中文译文和英文译文不能互相命中，这里把版本号按语言错开，不动表结构。
 */
import { loadSettings } from '../settings-store'
import { uiText } from '../i18n'
import { resolveTargetLang, TARGET_LANGS, type TargetLang } from '../../shared/lang'

export function targetLang(): TargetLang {
  try {
    return resolveTargetLang(loadSettings())
  } catch {
    // 单元测试里没有 Electron 的 app 对象：按中文处理
    return 'zh'
  }
}

export function promptVersionFor(base: number, lang: TargetLang): number {
  return base + 1000 * Math.max(0, TARGET_LANGS.findIndex((l) => l.id === lang))
}

/** 各功能提示词里随目标语言变化的句子 */
interface LangText {
    translateSingle: string
    translateRules: string
    translateBatch: string
    translateBatchRules: string
    fragment: string
    fragmentRules: string
    /** 公式占位符对不上时重试的附加要求 */
    placeholderStrict: (need: string) => string
    /** 目录标题批量翻译 */
    headings: string
    headingsRules: string
    summary: string
    summaryRetry: string
    summaryFail: (model: string) => string
    notes: string
    notesRetry: string
    /** AI 阅读笔记落盘时的标题行 */
    notesHeading: string
    notesFail: (model: string) => string
    answerIn: string
    contradictionsTail: string
  searchSummaryTail: string
}

const ZH: LangText = {
    translateSingle: '你是学术论文翻译引擎。把【本段】译成准确、克制的中文学术文体。',
    translateRules:
      '规则：只输出【本段】的译文本身，不复述原文，不加 "Translation:" 之类前缀、解释或引号；' +
      '保留公式、引用标号、URL 与专有名词的原样写法；数字一律保留阿拉伯数字原样（「Hot 100」「4 种方法」「1980 年代」），不改写成汉字；保留行首列表序号（如 "1." "2."）；' +
      '粗体标记 **……**、上标 ^……^、下标 ~……~ 按原配对原样保留' +
      '（示例：「**Sparse (S)**, using x~i~.」→「**稀疏（S）**，使用 x~i~。」）；' +
      '⟦f1⟧ ⟦f2⟧ 这类占位符代表行内公式，必须逐个原样保留在译文对应位置，不翻译、不增减、不改写括号；上下文仅用于消歧，不要翻译它。',
    translateBatch: '你是学术论文翻译引擎，把给出的分段英文译成简体中文。',
    translateBatchRules:
      '规则：输入按【N】分段；输出必须保持完全相同的【N】标记，每个标记后紧跟该段译文；' +
      '公式、变量、引用标号（如 [12]）、URL、专有名词原样保留；数字一律保留阿拉伯数字原样，不改写成汉字；保留行首列表序号（如 "1." "2."）；' +
      '粗体标记 **……**、上标 ^……^、下标 ~……~ 按原配对原样保留；' +
      '⟦f1⟧ ⟦f2⟧ 这类占位符代表行内公式，必须逐个原样保留在译文对应位置，不翻译、不增减、不改写括号。' +
      '示例：输入「**Sparse (S)**, an approach using x~i~ weights.」→ 输出「**稀疏（S）**，一种使用 x~i~ 权重的方法。」' +
      '只输出译文本身：不复述原文，不加 "Translation:"、"Bold:"、"译文：" 之类的任何前缀或说明；不增减段。',
    fragment: '你是学术论文翻译引擎。把用户给出的选段译成准确、克制的中文学术文体。',
    fragmentRules: '规则：只输出译文本身，不复述原文，不加任何前缀、解释或引号；公式、引用标号、URL 与专有名词原样保留。',
    placeholderStrict: (need) => `特别注意：原文里的行内公式占位符是 ${need}，译文必须各保留一次、原样照抄在对应位置，不能漏掉，也不能自己新增其他 ⟦f…⟧ 编号。`,
    headings: '你是学术论文章节标题翻译引擎。逐行翻译给出的标题列表。',
    headingsRules: '规则：每行输出「编号) 译文」，编号与输入一致；保留标题中的章节编号（如 3.2）与专有名词原样写法；不加解释、不增减行。',
    summary:
      '用恰好三句中文概括这篇论文：第一句说它做了什么、第二句说方法与关键结果、第三句必须指出适用边界或局限。' +
      '克制、具体、不吹捧，不用「本文」开头套话。只输出这三句中文，不要英文，不要照抄原文。',
    summaryRetry: '上面这段不符合要求：必须是中文，必须是概括而不是原文照抄。现在只输出三句中文摘要。',
    summaryFail: (model) => uiText('summary.invalid', { model, language: uiText('language.zh') }),
    notes:
      '根据给定论文的结构摘要，产出 3–5 条中文要点笔记：每条一行、以「- 」开头，' +
      '覆盖：核心问题、方法关键点、主要结果（带数字）、局限或适用边界。' +
      '克制、具体、不吹捧；只输出要点行，不要标题和多余说明，不要英文，不要照抄原文。',
    notesRetry: '上面这段不符合要求：必须是中文要点，必须是概括而不是原文照抄。现在只输出 3–5 条中文要点行。',
    notesHeading: 'AI 阅读笔记',
    notesFail: (model) => uiText('notes.invalid', { model, language: uiText('language.zh') }),
    answerIn: '回答用中文',
    contradictionsTail: '中文，克制，不超过八句。',
    searchSummaryTail: '中文，不超过六句。'
}

function forLanguage(name: string): LangText {
  return {
    translateSingle: `You are an academic translation engine. Translate the 【本段】 passage into precise, restrained academic ${name}.`,
    translateRules:
      'Rules: output only the translation of 【本段】; do not repeat the source or add prefixes such as "Translation:", explanations or quotes; ' +
      'keep formulas, citation numbers, URLs and proper nouns exactly as written; keep every number as digits, never spell it out; keep leading list numbers ("1." "2."); ' +
      'keep bold **…**, superscript ^…^ and subscript ~…~ markers paired as in the source; ' +
      'placeholders such as ⟦f1⟧ ⟦f2⟧ stand for inline formulas: keep every one of them verbatim at the corresponding position, never translate, drop, add or rewrite them; the context is for disambiguation only, do not translate it.',
    translateBatch: `You are an academic translation engine. Translate the numbered passages into ${name}.`,
    translateBatchRules:
      'Rules: the input is split by 【N】 markers; the output must keep exactly the same 【N】 markers, each followed by that passage\'s translation; ' +
      'keep formulas, variables, citation numbers such as [12], URLs and proper nouns as written; keep every number as digits, never spell it out; keep leading list numbers ("1." "2."); ' +
      'keep bold **…**, superscript ^…^ and subscript ~…~ markers paired as in the source; ' +
      'placeholders such as ⟦f1⟧ ⟦f2⟧ stand for inline formulas: keep every one of them verbatim at the corresponding position, never translate, drop, add or rewrite them. ' +
      'Output only the translations: no repetition of the source, no prefixes such as "Translation:"; do not add or drop passages.',
    fragment: `You are an academic translation engine. Translate the user's selection into precise, restrained academic ${name}.`,
    fragmentRules: 'Rules: output only the translation, without repeating the source or adding prefixes, explanations or quotes; keep formulas, citation numbers, URLs and proper nouns as written.',
    placeholderStrict: (need) => `Important: the inline formula placeholders in the source are ${need}. Keep each of them exactly once, verbatim, at the corresponding position; do not drop any and do not invent other ⟦f…⟧ numbers.`,
    headings: `You translate academic paper section headings into ${name}. Translate the numbered list line by line.`,
    headingsRules: 'Rules: output each line as "N) translation" with the same number as the input; keep section numbers (such as 3.2) and proper nouns as written; no explanations, do not add or drop lines.',
    summary:
      `Summarize this paper in exactly three ${name} sentences: the first says what it does, the second the method and key result, the third must state its scope or limitations. ` +
      'Be concrete and restrained, no praise, no "This paper" boilerplate. Output only the three sentences; do not copy the source.',
    summaryRetry: `That did not meet the requirements: it must be a ${name} summary, not a copy of the source. Output only the three sentences now.`,
    summaryFail: (model) => uiText('summary.invalid', { model, language: name }),
    notes:
      `From the paper outline below, write 3–5 bullet notes in ${name}, one per line starting with "- ", covering: the core problem, key points of the method, main results with numbers, and limitations or scope. ` +
      'Be concrete and restrained; output only the bullet lines, no heading or commentary, and do not copy the source.',
    notesRetry: `That did not meet the requirements: it must be ${name} bullet notes, not a copy of the source. Output only 3–5 bullet lines now.`,
    notesHeading: 'AI reading notes',
    notesFail: (model) => uiText('notes.invalid', { model, language: name }),
    answerIn: `Answer in ${name}`,
    contradictionsTail: `In ${name}, restrained, at most eight sentences.`,
    searchSummaryTail: `In ${name}, at most six sentences.`
  }
}

/** 各功能提示词里随目标语言变化的句子：中文单独写，其余语言共用英文模板并带上语言名 */
export const LANG_TEXT: Record<TargetLang, LangText> = Object.fromEntries(
  TARGET_LANGS.map((l) => [l.id, l.id === 'zh' ? ZH : forLanguage(l.english)])
) as Record<TargetLang, LangText>
