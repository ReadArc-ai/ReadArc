/**
 * YAML 文本原地拼接：
 * 读改写按行原地替换，绝不「解析成对象再整体写回」——那会吃掉用户的注释、
 * 字段顺序和产品还不认识的字段。配置文件属于用户，不属于程序。
 *
 * 能力刻意收窄：只处理「缩进式 map 的标量字段」——providers/tasks 两块契约只需要这些。
 * 列表、多行标量、锚点等复杂 YAML 一律不碰（读取用 yaml 库，写入只 patch 已知形状）。
 */

interface Located {
  /** 行号（0-based）；-1 = 未找到 */
  line: number
  indent: number
  /** 该 key 的块结束行（不含）：下一个缩进 <= indent 的非空行 */
  blockEnd: number
}

const KEY_RE = /^(\s*)([^\s#][^:]*):(.*)$/

function locate(lines: string[], path: string[], from = 0, to = lines.length, parentIndent = -1): Located {
  const [head, ...rest] = path
  for (let i = from; i < to; i++) {
    const m = KEY_RE.exec(lines[i])
    if (!m) continue
    const indent = m[1].length
    if (indent <= parentIndent) break // 离开父块
    if (m[2].trim() !== head) continue
    if (parentIndent >= 0 && indent <= parentIndent) continue
    // 找到本级 key；确定它的块范围
    let blockEnd = to
    for (let j = i + 1; j < to; j++) {
      const mj = KEY_RE.exec(lines[j])
      const nonEmpty = lines[j].trim().length > 0 && !lines[j].trim().startsWith('#')
      if (nonEmpty && mj && mj[1].length <= indent) {
        blockEnd = j
        break
      }
      if (nonEmpty && !mj && (lines[j].match(/^\s*/)?.[0].length ?? 0) <= indent) {
        blockEnd = j
        break
      }
    }
    // 块尾的空行与注释不算这个块的内容。少了这一步会出两种毛病：
    //   ① 新字段被插到它们后面——`budget:` 下先空一行才是 monthly_usd；
    //      文件结尾那个空元素（末尾换行）也会被挤到字段前，写出的文件没有结尾换行。
    //   ② removeYamlBlock 会把紧随其后的注释一起删掉——那通常是介绍**下一个**块的，
    //      是用户写的东西，删供应商不该顺手删掉它。
    while (blockEnd > i + 1) {
      const t = lines[blockEnd - 1].trim()
      if (t !== '' && !t.startsWith('#')) break
      blockEnd--
    }
    if (rest.length === 0) return { line: i, indent, blockEnd }
    return locate(lines, rest, i + 1, blockEnd, indent)
  }
  return { line: -1, indent: -1, blockEnd: -1 }
}

function needsQuotes(value: string): boolean {
  return /[:#{}[\],&*?|>'"%@`]|^\s|\s$|^$/.test(value) || /^(true|false|null|~|yes|no)$/i.test(value)
}

function formatValue(value: string): string {
  return needsQuotes(value) ? JSON.stringify(value) : value
}

/** 解析行内标量：`key: value  # comment` → { value, comment } */
function splitValueComment(raw: string): { value: string; comment: string } {
  // 引号值内的 # 不是注释；简化：先试引号形式
  const trimmed = raw.trim()
  const quoted = /^("(?:[^"\\]|\\.)*"|'[^']*')\s*(#.*)?$/.exec(trimmed)
  if (quoted) {
    const q = quoted[1]
    const inner = q.startsWith('"') ? (JSON.parse(q) as string) : q.slice(1, -1)
    return { value: inner, comment: quoted[2] ? '  ' + quoted[2] : '' }
  }
  const hash = trimmed.indexOf(' #')
  if (hash >= 0) {
    return { value: trimmed.slice(0, hash).trim(), comment: '  ' + trimmed.slice(hash + 1) }
  }
  return { value: trimmed, comment: '' }
}

export interface PatchResult {
  text: string
  changed: boolean
}

/**
 * 更新既有标量字段的值；保留行内注释。字段不存在或值相同 → changed: false 且原文原样返回
 * （无变化不重写文件的判据就来自这里）。
 */
export function patchYamlValue(src: string, path: string[], value: string): PatchResult {
  const lines = src.split('\n')
  const hit = locate(lines, path)
  if (hit.line === -1) return { text: src, changed: false }
  const m = KEY_RE.exec(lines[hit.line])!
  const { value: current, comment } = splitValueComment(m[3])
  if (current === value) return { text: src, changed: false }
  lines[hit.line] = `${m[1]}${m[2]}: ${formatValue(value)}${comment}`
  return { text: lines.join('\n'), changed: true }
}

/**
 * 确保 path 指向的 map 存在并含给定标量字段：
 * 已存在的字段值不同则原地 patch，缺失的字段/块在正确缩进处追加，其余内容一概不动。
 */
/** 移除 path 指向的整个块（key 行到 blockEnd）。未找到 = 无变化。 */
export function removeYamlBlock(src: string, path: string[]): PatchResult {
  const lines = src.split('\n')
  const loc = locate(lines, path)
  if (loc.line < 0) return { text: src, changed: false }
  lines.splice(loc.line, loc.blockEnd - loc.line)
  return { text: lines.join('\n'), changed: true }
}

export function upsertYamlMap(
  src: string,
  path: string[],
  entries: Record<string, string>
): PatchResult {
  let text = src
  let changed = false

  // 逐级确保路径块存在
  for (let depth = 1; depth <= path.length; depth++) {
    const sub = path.slice(0, depth)
    const lines = text.split('\n')
    if (locate(lines, sub).line !== -1) continue
    const parent = sub.slice(0, -1)
    const key = sub[sub.length - 1]
    if (parent.length === 0) {
      // 顶层块：文件尾追加（前面补空行分隔）
      const tail = text.endsWith('\n') || text === '' ? '' : '\n'
      text = `${text}${tail}${text.trim() === '' ? '' : '\n'}${key}:\n`
    } else {
      const p = locate(lines, parent)
      const indent = ' '.repeat(p.indent + 2)
      lines.splice(p.blockEnd, 0, `${indent}${key}:`)
      text = lines.join('\n')
    }
    changed = true
  }

  // 字段逐个 patch 或追加
  for (const [field, value] of Object.entries(entries)) {
    const patched = patchYamlValue(text, [...path, field], value)
    if (patched.changed) {
      text = patched.text
      changed = true
      continue
    }
    const lines = text.split('\n')
    if (locate(lines, [...path, field]).line !== -1) continue // 已存在且同值
    const map = locate(lines, path)
    const indent = ' '.repeat(map.indent + 2)
    lines.splice(map.blockEnd, 0, `${indent}${field}: ${formatValue(value)}`)
    text = lines.join('\n')
    changed = true
  }

  return { text, changed }
}
