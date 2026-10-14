/**
 * arXiv 官方 HTML（LaTeXML 生成）→ 流式视图的单元。
 *
 * 原文：保留净化后的原版 HTML，公式是矢量 MathML、表格是真正的表格、引用可以点。
 * 送去翻译的文本：公式换成 ⟦fN⟧（译文回来再换回原来的 MathML），粗体 / 斜体写成 **…** / *…*，
 * 上下标写成 ^…^ / ~…~，于是和 PDF 段落共用同一套占位符校验、重试与修补。
 * 脚注从段落里拿出来，跟在那一段后面单独成段。
 *
 * 页面来自网络，不可信：所有 HTML 都经 DOMPurify 净化（禁脚本、样式表、表单、外部资源），
 * 图片的 src 改成 data-arxiv-src，由主进程下载缓存后再给（应用的 CSP 不允许外部图片）。
 */
import DOMPurify from 'dompurify'

export type FlowUnitKind = 'heading' | 'para' | 'figure' | 'equation' | 'block'
export type FlowUnitRole = 'body' | 'title' | 'authors' | 'caption' | 'small' | 'ref'

export interface FlowUnit {
  /** 「论文 id:x:内容哈希」：arXiv 页面更新后，没变的段落仍能命中已有译文 */
  id: string
  kind: FlowUnitKind
  role: FlowUnitRole
  /** 标题层级：0 = 论文标题，1–3 = 节 / 小节 / 小小节 */
  level: number
  /** 净化后的原文 HTML（段落、标题是内部 HTML；图、公式、表是整块） */
  html: string
  /** 送去翻译的文本；不翻译的单元为空串 */
  text: string
  /** ⟦fN⟧ 对应的 MathML（下标 N-1） */
  maths: string[]
  translatable: boolean
}

const FORBID_TAGS = ['script', 'style', 'link', 'meta', 'base', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'source']

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    // 内联 SVG（TikZ 示意图、绘图）也要留：DOMPurify 的 SVG 白名单本身就去掉脚本与事件属性
    USE_PROFILES: { html: true, mathMl: true, svg: true, svgFilters: true },
    FORBID_TAGS,
    // 内联 style 只留给 LaTeXML 的表格缩放与图片比例；事件处理属性 DOMPurify 本来就去掉
    ALLOW_DATA_ATTR: true
  })
}

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'data', 'poster'])

/**
 * 解析后先自己清一遍，再交给 DOMPurify：危险标签整个删掉，事件处理属性（on*）与 javascript: 链接去掉。
 * 不只押在一个库上（应用的 CSP 也禁止内联脚本，这是第三层）
 */
function scrub(root: Element): void {
  root.querySelectorAll(FORBID_TAGS.join(',')).forEach((el) => el.remove())
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || (URL_ATTRS.has(name) && /^\s*(?:javascript|vbscript|data:text\/html)/i.test(attr.value))) el.removeAttribute(attr.name)
    }
  }
}

/** 简短稳定的字符串哈希（cyrb53），做单元 id 用 */
function hash(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

function has(el: Element, cls: string): boolean {
  return el.classList.contains(cls)
}

/**
 * 宽表套了 \resizebox 时，LaTeXML 不出 <table>，而是用 span.ltx_tabular / ltx_tr / ltx_td 拼表格，
 * 靠 arXiv 自己的样式表才排得成表；合并单元格（ltx_colspan_4）CSS 也表达不了。
 * 这里改写成真正的表格元素；由内往外改，单元格里嵌的小表也能还原。
 * 包着表格的 <p> 换成 <div>：HTML 解析器遇到 <table> 会把 <p> 提前闭合，表格就散了
 */
function spanTablesToTables(root: Element): void {
  const doc = root.ownerDocument
  const TAG: [string, string][] = [['ltx_thead', 'thead'], ['ltx_tbody', 'tbody'], ['ltx_tfoot', 'tfoot'], ['ltx_tr', 'tr'], ['ltx_th', 'th'], ['ltx_td', 'td']]
  const swap = (el: Element, tag: string): Element => {
    const next = doc.createElement(tag)
    for (const attr of [...el.attributes]) next.setAttribute(attr.name, attr.value)
    while (el.firstChild) next.appendChild(el.firstChild)
    el.replaceWith(next)
    return next
  }
  const tables = [...root.querySelectorAll('.ltx_tabular')].filter((el) => el.tagName.toLowerCase() !== 'table').reverse()
  for (const span of tables) {
    for (const part of [...span.querySelectorAll('.ltx_thead, .ltx_tbody, .ltx_tfoot, .ltx_tr, .ltx_td, .ltx_th')]) {
      if (part.closest('.ltx_tabular') !== span) continue
      const tag = TAG.find(([cls]) => has(part, cls))?.[1]
      if (!tag || part.tagName.toLowerCase() === tag) continue
      const cell = swap(part, tag)
      for (const [, kind, n] of cell.className.matchAll(/\bltx_(colspan|rowspan)_(\d+)\b/g)) cell.setAttribute(kind, n)
    }
    const table = swap(span, 'table')
    for (let p = table.parentElement; p && p !== root; p = p.parentElement) {
      if (p.tagName.toLowerCase() === 'p') {
        swap(p, 'div')
        break
      }
    }
  }
}

/**
 * LaTeXML 把 PDF 插图转成 SVG 后用 <object data="x.svg"> 嵌入。<object> 是插件容器，清洗时整个删掉，
 * 这里先改写成普通图片：SVG 作为 <img> 显示时里面的脚本不会执行
 */
function objectsToImages(root: Element): void {
  for (const obj of root.querySelectorAll('object[data]')) {
    const data = obj.getAttribute('data') ?? ''
    if (!/\.(svg|png|jpe?g|gif|webp)$/i.test(data)) continue
    const img = root.ownerDocument.createElement('img')
    for (const name of ['id', 'class', 'style', 'width', 'height']) {
      const v = obj.getAttribute(name)
      if (v != null) img.setAttribute(name, v)
    }
    img.setAttribute('src', data)
    img.setAttribute('alt', '')
    obj.replaceWith(img)
  }
}

/** 图片不直接加载：src 挪到 data-arxiv-src，由视图按需向主进程要 */
function deferImages(root: Element): void {
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src')
    if (src) img.setAttribute('data-arxiv-src', src)
    img.removeAttribute('src')
    img.removeAttribute('srcset')
  }
}

/** 送去翻译的文本：公式 → ⟦fN⟧，强调 / 上下标 → 行内标记，脚注 → 只留标号 */
function textOf(node: Node, maths: string[]): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeType !== 1) return ''
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  if (tag === 'math') {
    maths.push(sanitize(el.outerHTML))
    return `⟦f${maths.length}⟧`
  }
  if (has(el, 'ltx_note_outer')) return ''
  if (tag === 'br') return ' '
  const inner = (): string => [...el.childNodes].map((c) => textOf(c, maths)).join('')
  if (tag === 'sup' && has(el, 'ltx_note_mark')) return `^${(el.textContent ?? '').trim()}^`
  const wrap = (mark: string, s: string): string => {
    const t = s.trim()
    if (!t) return s
    const lead = s.slice(0, s.indexOf(t))
    const trail = s.slice(s.indexOf(t) + t.length)
    return `${lead}${mark}${t}${mark}${trail}`
  }
  if (tag === 'b' || tag === 'strong' || has(el, 'ltx_font_bold')) return wrap('**', inner())
  if (tag === 'i' || tag === 'em' || has(el, 'ltx_font_italic')) return wrap('*', inner())
  if (tag === 'sup' || tag === 'sub') {
    const s = inner().trim()
    const mark = tag === 'sup' ? '^' : '~'
    return s && s.length <= 16 && !/[\s^~]/.test(s) ? `${mark}${s}${mark}` : s
  }
  if (has(el, 'ltx_tag')) return `${inner()} `
  return inner()
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim()
}

export function parseArxivHtml(source: string, paperId: string): FlowUnit[] {
  const doc = new DOMParser().parseFromString(source, 'text/html')
  const article = doc.querySelector('article.ltx_document')
  if (!article) return []
  objectsToImages(article)
  spanTablesToTables(article)
  scrub(article)
  const units: FlowUnit[] = []
  const seen = new Map<string, number>()

  const push = (u: Omit<FlowUnit, 'id'>): void => {
    const key = hash(`${u.kind}|${u.role}|${u.text || u.html}`)
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    units.push({ ...u, id: `${paperId}:x:${key}${n > 0 ? `-${n}` : ''}` })
  }

  /** 一段正文：脚注拿出来跟在后面；整段没有文字（只剩空白）就不要 */
  const paragraph = (p: Element, role: FlowUnitRole, prefix = ''): void => {
    const clone = p.cloneNode(true) as Element
    const notes: Element[] = []
    for (const note of clone.querySelectorAll('.ltx_note.ltx_role_footnote')) {
      const content = note.querySelector('.ltx_note_content')
      if (content) notes.push(content.cloneNode(true) as Element)
      note.querySelector('.ltx_note_outer')?.remove()
    }
    deferImages(clone)
    const maths: string[] = []
    const text = cleanText(prefix + textOf(clone, maths))
    if (text) {
      const translatable = role !== 'ref' && role !== 'authors' && /[A-Za-z]{2,}/.test(text.replace(/⟦f\d+⟧/g, ''))
      push({ kind: 'para', role, level: 0, html: sanitize((prefix ? `<span class="flow-item-tag">${prefix.trim()}</span> ` : '') + clone.innerHTML), text: translatable ? text : '', maths: translatable ? maths : [], translatable })
    }
    for (const n of notes) {
      n.querySelectorAll(':scope > .ltx_note_mark, .ltx_note_type').forEach((m) => m.remove())
      paragraph(n, 'small')
    }
  }

  const heading = (h: Element, level: number): void => {
    const clone = h.cloneNode(true) as Element
    clone.querySelectorAll('.ltx_note_outer').forEach((n) => n.remove())
    const maths: string[] = []
    const text = cleanText(textOf(clone, maths))
    if (!text) return
    push({ kind: 'heading', role: level === 0 ? 'title' : 'body', level, html: sanitize(clone.innerHTML), text, maths, translatable: true })
  }

  /** 图、表、算法：内容整块显示，图注单独成一段可翻译；图注在上（表格常见）就先放图注 */
  const figure = (fig: Element): void => {
    const caption = fig.querySelector(':scope > figcaption') ?? fig.querySelector('figcaption.ltx_caption')
    const clone = fig.cloneNode(true) as Element
    clone.querySelectorAll('figcaption').forEach((c) => c.remove())
    // 表格单元格里的脚注和正文一样只留标号，脚注全文不挤进表头
    clone.querySelectorAll('.ltx_note_outer').forEach((n) => n.remove())
    deferImages(clone)
    const captionFirst = caption && fig.firstElementChild === caption
    if (caption && captionFirst) paragraph(caption, 'caption')
    if (clone.textContent?.trim() || clone.querySelector('img, math, table')) push({ kind: 'figure', role: 'body', level: 0, html: sanitize(clone.outerHTML), text: '', maths: [], translatable: false })
    if (caption && !captionFirst) paragraph(caption, 'caption')
  }

  const list = (l: Element): void => {
    for (const item of l.querySelectorAll(':scope > li')) {
      const tag = cleanText(item.querySelector(':scope > .ltx_tag')?.textContent ?? '')
      let first = true
      for (const child of item.children) {
        if (has(child, 'ltx_tag')) continue
        if (has(child, 'ltx_para')) {
          for (const c of child.children) {
            if (c.tagName.toLowerCase() === 'p') {
              paragraph(c, 'body', first && tag ? `${tag} ` : '')
              first = false
            } else walk(c)
          }
        } else walk(child)
      }
    }
  }

  function walk(el: Element): void {
    const tag = el.tagName.toLowerCase()
    if (tag === 'nav' || tag === 'footer' || tag === 'header' || has(el, 'ltx_TOC') || has(el, 'ltx_pagination') || has(el, 'ltx_dates') || has(el, 'ltx_page_logo')) return
    if (tag === 'h1' && has(el, 'ltx_title_document')) return heading(el, 0)
    if (/^h[1-6]$/.test(tag) && has(el, 'ltx_title')) {
      // 摘要标题在 LaTeXML 里是 h6，但它和第 1 节同级
      const lvl = tag === 'h2' || has(el, 'ltx_title_abstract') ? 1 : tag === 'h3' ? 2 : 3
      return heading(el, lvl)
    }
    if (has(el, 'ltx_authors')) {
      const clone = el.cloneNode(true) as Element
      clone.querySelectorAll('.ltx_note_outer, .ltx_author_notes').forEach((n) => n.remove())
      push({ kind: 'block', role: 'authors', level: 0, html: sanitize(clone.outerHTML), text: '', maths: [], translatable: false })
      return
    }
    if (has(el, 'ltx_bibliography')) {
      const title = el.querySelector('h2, h3')
      if (title) heading(title, 1)
      for (const item of el.querySelectorAll('li.ltx_bibitem')) paragraph(item, 'ref')
      return
    }
    if (tag === 'figure') return figure(el)
    if (tag === 'table' && (has(el, 'ltx_equation') || has(el, 'ltx_equationgroup'))) {
      push({ kind: 'equation', role: 'body', level: 0, html: sanitize(el.outerHTML), text: '', maths: [], translatable: false })
      return
    }
    if (tag === 'p') return paragraph(el, 'body')
    if (tag === 'ul' || tag === 'ol') return list(el)
    // 代码清单、算法这类：整块原样
    if (has(el, 'ltx_listing') || tag === 'pre') {
      push({ kind: 'block', role: 'body', level: 0, html: sanitize(el.outerHTML), text: '', maths: [], translatable: false })
      return
    }
    for (const child of el.children) walk(child)
  }

  walk(article)
  return units
}
