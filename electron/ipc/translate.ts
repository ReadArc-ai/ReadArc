/** 翻译与摘要：整篇 / 单段 / 划词、目录翻译、三句话摘要 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { TranslateOverride } from '../../shared/models'
import { lookupWord } from '../dict/service'
import { appDb } from '../library/service'
import {
  buildRouterContext,
  retranslateOne,
  startPaperTranslation,
  stopPaperTranslation,
  translateFragment,
  translateOutlineNow
} from '../translate/service'
import { generateSummary, getCachedSummary } from '../translate/summary'
import { setTranslateFocus } from '../translate/translator'
import { genDelta, genReset, withGenAbort } from './gen'

export function registerTranslateIpc(): void {
  ipcMain.handle(
    IPC.translatePaper,
    (e, paperId: string, confirmed: boolean, force = false, override: TranslateOverride | null = null) =>
      startPaperTranslation(paperId, e.sender, confirmed, force, override ?? undefined)
  )
  ipcMain.handle(IPC.translateText, (e, text: string, dictOnly = false, reqId: number | null = null) => {
    const t = String(text).slice(0, 4000).trim()
    // 单词优先走内置离线词典：零延迟、零成本；未命中回退 LLM
    if (/^[A-Za-z][A-Za-z'-]{0,23}$/.test(t)) {
      const hit = lookupWord(t)
      if (hit) {
        // 只留中文释义：去音标，逐行剥词性（n./vt.）与领域标记（[计]）。
        // 气泡贵在快与轻：只取首行前 3 个义项，一行搞定
        return hit.translation
          .split('\n')
          .map((line) => {
            let s = line.trim()
            for (;;) {
              const m2 = /^(?:[a-z]{1,6}\.|&|\[[^\]]{1,8}\])\s*/i.exec(s)
              if (!m2) break
              s = s.slice(m2[0].length)
            }
            return s.split(/[,，;；]\s*/).filter(Boolean).slice(0, 3).join(', ')
          })
          .filter(Boolean)
          .slice(0, 1)
          .join('')
      }
    }
    // 词典未命中且只允许词典 → 不走 LLM（自动弹出场景，不花 token）
    if (dictOnly) return null
    return translateFragment(t, (delta) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.translateTextDelta, delta, reqId)
    })
  })
  ipcMain.handle(IPC.translateStop, (_e, paperId: string) => stopPaperTranslation(paperId))
  ipcMain.on(IPC.translateFocus, (_e, paperId: string, blockOrder: number) => setTranslateFocus(paperId, blockOrder))
  ipcMain.handle(IPC.translateOutline, (e, paperId: string) => translateOutlineNow(paperId, e.sender))
  ipcMain.handle(IPC.translateBlock, (_e, paperId: string, blockId: string) => retranslateOne(paperId, blockId))

  ipcMain.handle(IPC.summaryGet, (_e, paperId: string) => getCachedSummary(appDb(), paperId))
  ipcMain.handle(IPC.summaryGenerate, (e, paperId: string, force = false) =>
    withGenAbort('summary', paperId, (signal) =>
      generateSummary(
        appDb(),
        buildRouterContext(),
        paperId,
        undefined,
        genDelta(e, 'summary', paperId),
        force,
        () => {
          genReset(e, 'summary', paperId)()
          genReset(e, 'summary:thinking', paperId)()
        },
        genDelta(e, 'summary:thinking', paperId),
        signal
      )
    )
  )
}
