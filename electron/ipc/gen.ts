/** 摘要 / 阅读笔记 / 检索总结这类流式生成共用的小件：流式回传、重来清屏、可中止 */
import { ipcMain } from 'electron'
import { GEN_ABORTED, IPC } from '../../shared/ipc'

/**
 * 摘要 / 阅读笔记的在途请求：供应商挂住时用户点「停止」要能退出来。
 * 同一篇同一类只保留一个，重复触发先中止旧的。
 */
const genInflight = new Map<string, AbortController>()

export async function withGenAbort<T>(
  kind: 'summary' | 'notes',
  paperId: string,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const key = `${kind}:${paperId}`
  genInflight.get(key)?.abort()
  const ctrl = new AbortController()
  genInflight.set(key, ctrl)
  try {
    return await run(ctrl.signal)
  } catch (err) {
    // 用户自己按的停止：给一个可识别的错误，界面据此安静回到待命态，不显示报错
    if (ctrl.signal.aborted) throw new Error(GEN_ABORTED, { cause: err })
    throw err
  } finally {
    if (genInflight.get(key) === ctrl) genInflight.delete(key)
  }
}

// paperId 必须随流一起送：渲染进程要靠它判断这段流是不是当前这篇论文的，
// 否则生成过程中切换论文，新论文的面板会显示上一篇的流式草稿。
export const genDelta =
  (e: Electron.IpcMainInvokeEvent, kind: string, paperId?: string) =>
  (delta: string): void => {
    if (!e.sender.isDestroyed()) e.sender.send(IPC.genDelta, { kind, delta, paperId })
  }

/** 第一次输出不合格重来时：让渲染端把已流出的文字清掉再接收第二次 */
export const genReset =
  (e: Electron.IpcMainInvokeEvent, kind: string, paperId?: string) =>
  (): void => {
    if (!e.sender.isDestroyed()) e.sender.send(IPC.genDelta, { kind, delta: '', paperId, reset: true })
  }

export function registerGenIpc(): void {
  ipcMain.on(IPC.genStop, (_e, kind: 'summary' | 'notes', paperId: string) => {
    genInflight.get(`${kind}:${paperId}`)?.abort()
  })
}
