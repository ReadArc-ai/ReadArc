/**
 * 双击选词的纯逻辑：原版页的透明文本层字符位置与画布字形有漂移（回退字体的字宽不同，
 * 整行按总宽缩放后中段能偏出好几个字母），所以哪一个词、词在哪，都以画布上的墨迹段为准，
 * 文本层只提供「这一行有哪些字」。这里不碰 DOM，便于测试。
 */

export const WORD_CH = /[A-Za-z0-9_']/ // 不含连字符：双击 machine-generated 只选点击的那半，与原生一致

export interface LineSeg {
  text: string
  /** 与前一段字形紧挨（同一个词被拆成两个 span），拼接时不补空格 */
  glued: boolean
}

export interface LineText {
  text: string
  /** 行文本每个字符来自哪一段的第几个字符；补出来的空格 seg = -1 */
  map: { seg: number; off: number }[]
}

/** 把一行里的若干 span 文本拼成一行：段与段之间除非「紧挨」否则补一个空格 */
export function buildLine(segs: LineSeg[]): LineText {
  let text = ''
  const map: LineText['map'] = []
  segs.forEach((s, i) => {
    if (i > 0 && !s.glued && text.length > 0 && !/\s$/.test(text) && !/^\s/.test(s.text)) {
      text += ' '
      map.push({ seg: -1, off: 0 })
    }
    for (let k = 0; k < s.text.length; k++) {
      text += s.text[k]
      map.push({ seg: i, off: k })
    }
  })
  return { text, map }
}

export interface Span01 {
  s: number
  e: number
}

/** 按空白切词，带字符区间 */
export function tokenize(text: string): Span01[] {
  const out: Span01[] = []
  for (const m of text.matchAll(/\S+/g)) out.push({ s: m.index ?? 0, e: (m.index ?? 0) + m[0].length })
  return out
}

export interface Run {
  L: number
  R: number
}

/** 列墨迹计数 → 墨迹段：连续空白列超过 gap 就断开 */
export function inkRuns(col: ArrayLike<number>, gap: number): Run[] {
  const runs: Run[] = []
  let runL = -1
  let blank = 0
  for (let x = 0; x < col.length; x++) {
    if (col[x] > 0) {
      if (runL < 0) runL = x
      blank = 0
    } else if (runL >= 0 && ++blank > gap) {
      runs.push({ L: runL, R: x - blank })
      runL = -1
    }
  }
  if (runL >= 0) runs.push({ L: runL, R: col.length - 1 })
  return runs
}

export interface Pick {
  tokenIdx: number
  runIdx: number
  /** 点击位置在该 token 内的字符占比 0..1 */
  frac: number
}

/**
 * 点击 x（与 runs 同坐标系）落在哪个墨迹段 → 对应哪个词。
 * 段数与词数相等时一一对应；不等时按「墨迹累计宽度 ↔ 字符累计数」的比例对应
 * （上标、脚注标记会让两边数量对不上，比例映射比文本层的漂移坐标更接近真值）。
 */
export function pickToken(tokens: Span01[], runs: Run[], clickX: number): Pick | null {
  if (tokens.length === 0 || runs.length === 0) return null
  let runIdx = runs.findIndex((r) => clickX >= r.L && clickX <= r.R)
  if (runIdx < 0) {
    let best = Infinity
    runs.forEach((r, i) => {
      const d = clickX < r.L ? r.L - clickX : clickX - r.R
      if (d < best) {
        best = d
        runIdx = i
      }
    })
  }
  const run = runs[runIdx]
  const within = Math.min(1, Math.max(0, (clickX - run.L) / Math.max(1, run.R - run.L)))
  if (runs.length === tokens.length) return { tokenIdx: runIdx, runIdx, frac: within }
  // 比例映射：点击处之前的墨迹宽度占全行墨迹宽度的比例 → 字符累计
  const widths = runs.map((r) => Math.max(1, r.R - r.L + 1))
  const totalInk = widths.reduce((a, b) => a + b, 0)
  const inkBefore = widths.slice(0, runIdx).reduce((a, b) => a + b, 0) + within * widths[runIdx]
  const f = inkBefore / totalInk
  const lens = tokens.map((t) => t.e - t.s)
  const totalCh = lens.reduce((a, b) => a + b, 0)
  let target = f * totalCh
  for (let i = 0; i < tokens.length; i++) {
    if (target < lens[i] || i === tokens.length - 1) {
      return { tokenIdx: i, runIdx, frac: Math.min(1, Math.max(0, target / Math.max(1, lens[i]))) }
    }
    target -= lens[i]
  }
  return null
}

/**
 * 字符位置 → 墨迹坐标。行里的词与墨迹段一一对应时按段内比例算；数量对不上
 * （小字号下词间空隙不足一个像素，整行并成一段）时按「字符累计 ↔ 墨迹累计」的比例算——
 * 否则高亮会按整段画，双击一个词却涂黑整行。
 */
export function inkXForChar(tokens: Span01[], runs: Run[], charPos: number): number | null {
  if (tokens.length === 0 || runs.length === 0) return null
  const widths = runs.map((r) => Math.max(1, r.R - r.L + 1))
  const totalInk = widths.reduce((a, b) => a + b, 0)
  const lens = tokens.map((t) => t.e - t.s)
  const totalCh = lens.reduce((a, b) => a + b, 0)
  if (totalCh <= 0) return null
  // charPos 是行文本里的下标：换算成「前面有多少个词字符」
  let chBefore = 0
  for (const t of tokens) {
    if (charPos >= t.e) chBefore += t.e - t.s
    else {
      if (charPos > t.s) chBefore += charPos - t.s
      break
    }
  }
  let target = (chBefore / totalCh) * totalInk
  for (let i = 0; i < runs.length; i++) {
    if (target <= widths[i] || i === runs.length - 1) return runs[i].L + Math.min(widths[i], target)
    target -= widths[i]
  }
  return null
}

/** token 内部按连字符 / 标点再切：取点击字符所在的那个词（"making," → "making"，"machine-generated" 只取一半） */
export function wordWithinToken(text: string, tok: Span01, frac: number): Span01 | null {
  const len = tok.e - tok.s
  if (len <= 0) return null
  let i = tok.s + Math.min(len - 1, Math.floor(frac * len))
  if (!WORD_CH.test(text[i] ?? '')) {
    // 点在标点上：找最近的词字符
    let l = i - 1
    let r = i + 1
    while (l >= tok.s || r < tok.e) {
      if (l >= tok.s && WORD_CH.test(text[l] ?? '')) {
        i = l
        break
      }
      if (r < tok.e && WORD_CH.test(text[r] ?? '')) {
        i = r
        break
      }
      l--
      r++
    }
    if (!WORD_CH.test(text[i] ?? '')) return null
  }
  let s = i
  let e = i + 1
  while (s > tok.s && WORD_CH.test(text[s - 1] ?? '')) s--
  while (e < tok.e && WORD_CH.test(text[e] ?? '')) e++
  return { s, e }
}
