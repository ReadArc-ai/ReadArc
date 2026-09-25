/**
 * 笔记落盘：每篇论文一个 Markdown 文件，锚点写在 YAML front-matter（[P6]）。
 * 文件必须能被 Obsidian / grep / Git 直接读——格式为先，程序迁就格式。
 *
 * ---
 * paper: <sha1>
 * title: "..."
 * anchors:
 *   a1: { block_id: "...", char_start: 0, char_end: 42, simhash: "...", excerpt: "..." }
 * ---
 *
 * ## a1 · 2026-08-20 18:20
 * 笔记正文……
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export interface NoteAnchorMeta {
  block_id: string
  char_start: number
  char_end: number
  simhash: string
  /** 原文摘录，供解析器升级后 simhash 重定位兜底 */
  excerpt: string
  /** 高亮专用：选区矩形（PDF 坐标 [page, x, y, w, h]，y 向上），原版页据此绘制 */
  rects?: [number, number, number, number, number][]
}

export interface NotesFrontMatter {
  paper: string
  title: string
  anchors: Record<string, NoteAnchorMeta>
  /** 高亮与笔记同文件落盘 [P6]：h1/h2… → 锚点 */
  highlights: Record<string, NoteAnchorMeta>
}

export interface NotesFile {
  meta: NotesFrontMatter
  body: string
}

const FM_DELIM = '---'

export function parseNotesFile(content: string): NotesFile {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== FM_DELIM) {
    throw new Error('notes file missing front-matter')
  }
  const end = lines.indexOf(FM_DELIM, 1)
  if (end === -1) throw new Error('notes file front-matter not closed')
  const raw = parseYaml(lines.slice(1, end).join('\n')) as Partial<NotesFrontMatter>
  return {
    meta: {
      paper: raw.paper ?? '',
      title: raw.title ?? '',
      anchors: raw.anchors ?? {},
      highlights: raw.highlights ?? {}
    },
    body: lines.slice(end + 1).join('\n')
  }
}

export function serializeNotesFile(file: NotesFile): string {
  const fm = stringifyYaml(file.meta).trimEnd()
  return `${FM_DELIM}\n${fm}\n${FM_DELIM}\n${file.body}`
}

export function newNotesFile(paper: string, title: string): NotesFile {
  return { meta: { paper, title, anchors: {}, highlights: {} }, body: '\n' }
}

function nextId(existing: Record<string, NoteAnchorMeta>, prefix: string): string {
  let n = 1
  while (existing[`${prefix}${n}`]) n++
  return `${prefix}${n}`
}

/** 新增高亮：只动 front-matter，正文不变。 */
export function addHighlight(
  file: NotesFile,
  anchor: NoteAnchorMeta
): { file: NotesFile; id: string } {
  const id = nextId(file.meta.highlights, 'h')
  return {
    file: {
      ...file,
      meta: { ...file.meta, highlights: { ...file.meta.highlights, [id]: anchor } }
    },
    id
  }
}

export function removeHighlight(file: NotesFile, id: string): NotesFile {
  const highlights = { ...file.meta.highlights }
  delete highlights[id]
  return { ...file, meta: { ...file.meta, highlights } }
}

export interface NoteEntry {
  anchorId: string
  stamp: string
  text: string
}

/** 从正文解析笔记条目：`## a1 · 2026-08-20 18:20` 到下一个 `## ` 之间为一条。
 *  用户手写的其他内容不属于任何条目，解析时忽略但序列化时原样保留。 */
export function listEntries(file: NotesFile): NoteEntry[] {
  const entries: NoteEntry[] = []
  const re = /^## (a\d+) · (.+)$/
  let current: NoteEntry | null = null
  for (const line of file.body.split('\n')) {
    const m = re.exec(line)
    if (m) {
      if (current) entries.push({ ...current, text: current.text.trim() })
      current = { anchorId: m[1], stamp: m[2].trim(), text: '' }
    } else if (current) {
      if (line.startsWith('## ')) {
        entries.push({ ...current, text: current.text.trim() })
        current = null
      } else {
        current.text += line + '\n'
      }
    }
  }
  if (current) entries.push({ ...current, text: current.text.trim() })
  return entries
}


/** 追加一条带锚点的笔记，返回新文件内容与分配的锚点 id。只追加，不重排已有正文。 */
export function appendNote(
  file: NotesFile,
  anchor: NoteAnchorMeta,
  text: string,
  now: Date = new Date()
): { file: NotesFile; anchorId: string } {
  const anchorId = nextId(file.meta.anchors, 'a')
  const stamp = localStamp(now)
  const section = `\n## ${anchorId} · ${stamp}\n\n${text.trimEnd()}\n`
  return {
    file: {
      meta: {
        ...file.meta,
        anchors: { ...file.meta.anchors, [anchorId]: anchor }
      },
      body: file.body.trimEnd() + '\n' + section
    },
    anchorId
  }
}

/** 条目时间戳按本机时区写（之前写的是 UTC，用户看到的时间差好几个小时） */
export function localStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 删除一条笔记：正文里 `## aN · …` 到下一个 `## ` 之间整节去掉，front-matter 里对应锚点一并删；
 *  其余正文（包括用户手写的内容）原样保留。 */
export function removeNote(file: NotesFile, anchorId: string): NotesFile {
  const anchors = { ...file.meta.anchors }
  delete anchors[anchorId]
  const lines = file.body.split('\n')
  const start = lines.findIndex((l) => l.startsWith(`## ${anchorId} · `))
  if (start === -1) return { ...file, meta: { ...file.meta, anchors } }
  let end = start + 1
  while (end < lines.length && !lines[end].startsWith('## ')) end++
  // 这一节前面的空行一起去掉，避免删完留下连续空行
  let head = start
  while (head > 0 && lines[head - 1].trim() === '') head--
  const body = [...lines.slice(0, head), '', ...lines.slice(end)].join('\n')
  return { meta: { ...file.meta, anchors }, body }
}
