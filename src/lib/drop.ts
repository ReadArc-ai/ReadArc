/**
 * 拖入文件的分拣：哪些能导入，不能导入时是哪种情况——
 * 拖进来的不是 PDF，还是读不到路径（浏览器、云盘占位文件拖出来的 File 没有本机路径）。
 * 两种情况都要告诉用户，不能静默什么都不发生。
 */
export interface DropFile {
  name: string
  type: string
}

export type DropProblem = 'not-pdf' | 'no-path' | null

export interface DropVerdict {
  paths: string[]
  problem: DropProblem
}

export function classifyDrop<F extends DropFile>(files: F[], pathFor: (f: F) => string): DropVerdict {
  const paths = files.map((f) => pathFor(f)).filter((p) => /\.pdf$/i.test(p))
  if (paths.length > 0 || files.length === 0) return { paths, problem: null }
  const looksPdf = files.some((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf')
  return { paths, problem: looksPdf ? 'no-path' : 'not-pdf' }
}

/** dataTransfer 里带的是文件（而不是拖选的文字、链接） */
export function hasFiles(types: ArrayLike<string>): boolean {
  return Array.from(types).includes('Files')
}
