/** 笔记与高亮：读写笔记文件、AI 生成阅读笔记、跨论文找矛盾 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { findContradictions } from '../chat/insights'
import { appDb } from '../library/service'
import { generateReadingNotes } from '../notes/gen'
import { addHighlight, addNote, notesForPaper, removeHighlight, removeNote } from '../notes/service'
import { buildRouterContext } from '../translate/service'
import { genDelta, genReset, withGenAbort } from './gen'
import { notesDir } from './paths'

export function registerNotesIpc(): void {
  ipcMain.handle(IPC.notesList, (_e, paperId: string) => notesForPaper(appDb(), notesDir(), paperId))
  ipcMain.handle(IPC.notesAdd, (_e, paperId: string, blockId: string, text: string, selection?: string) =>
    addNote(appDb(), notesDir(), paperId, blockId, text, selection)
  )
  ipcMain.handle(
    IPC.highlightAdd,
    (
      _e,
      paperId: string,
      blockId: string,
      selection: string,
      rects?: [number, number, number, number, number][],
      hintRange?: [number, number]
    ) => addHighlight(appDb(), notesDir(), paperId, blockId, selection, rects, hintRange)
  )
  ipcMain.handle(IPC.highlightRemove, (_e, paperId: string, id: string) => removeHighlight(appDb(), notesDir(), paperId, id))
  ipcMain.handle(IPC.notesRemove, (_e, paperId: string, anchorId: string) => removeNote(appDb(), notesDir(), paperId, anchorId))

  ipcMain.handle(IPC.notesContradictions, (e) => findContradictions(appDb(), notesDir(), genDelta(e, 'contradictions')))
  ipcMain.handle(IPC.notesGenerate, (e, paperId: string) =>
    withGenAbort('notes', paperId, (signal) =>
      generateReadingNotes(
        appDb(),
        buildRouterContext(),
        notesDir(),
        paperId,
        undefined,
        genDelta(e, 'notes', paperId),
        () => {
          genReset(e, 'notes', paperId)()
          genReset(e, 'notes:thinking', paperId)()
        },
        genDelta(e, 'notes:thinking', paperId),
        signal
      )
    )
  )
}
