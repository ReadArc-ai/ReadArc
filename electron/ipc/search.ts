/** 论文检索：多源搜索、加入库、结果总结 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { SearchResultInput } from '../../shared/models'
import { summarizeSearch } from '../chat/insights'
import { addSearchResult, appDb } from '../library/service'
import { translateQueryToEnglish } from '../search/query-translate'
import { searchAll } from '../search/service'
import { genDelta } from './gen'

export function registerSearchIpc(): void {
  // 快的源先回渲染端（search:progress），最终结果走返回值
  ipcMain.handle(IPC.searchRun, (e, query: string) =>
    searchAll(appDb(), query, { translate: (q) => translateQueryToEnglish(appDb(), q) }, (outcome) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.searchProgress, { query, outcome })
    })
  )
  ipcMain.handle(IPC.searchAdd, (e, result: SearchResultInput) =>
    addSearchResult(result, (p) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.searchAddProgress, { id: result.id, ...p })
    })
  )
  ipcMain.handle(IPC.searchSummarize, (e, query: string, results: SearchResultInput[]) =>
    summarizeSearch(appDb(), query, results, genDelta(e, 'search-summary'))
  )
}
