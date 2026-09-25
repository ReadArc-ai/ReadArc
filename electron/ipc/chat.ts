/** 对话：提问、停止、会话管理、截图提问用的区域截图 */
import { uiText } from '../i18n'
import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { ChatAskOptions, ChatHistoryItem } from '../../shared/models'
import {
  appendChatTurn,
  chatSessionBelongsToPaper,
  createChatSession,
  deleteChatSession,
  listChatMessages,
  listChatSessions,
  renameChatSession
} from '../chat/history'
import { askQuestion, stopQuestion } from '../chat/service'
import { appDb } from '../library/service'
import { loadSettings } from '../settings-store'

export function registerChatIpc(): void {
  ipcMain.handle(
    IPC.chatAsk,
    async (e, paperId: string, question: string, history: ChatHistoryItem[], options?: ChatAskOptions) => {
      const sessionId = options?.sessionId
      if (!sessionId || !chatSessionBelongsToPaper(appDb(), sessionId, paperId)) {
        throw new Error(uiText('chat.missing'))
      }
      const answer = await askQuestion(
        appDb(),
        paperId,
        question,
        history,
        (delta, kind) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.chatDelta, { paperId, sessionId, delta, kind })
        },
        // 推理开关以设置文件为准（渲染进程传的不算）
        { ...options, reasoning: loadSettings().chatReasoning === true },
        loadSettings().chatPersonas ?? []
      )
      appendChatTurn(appDb(), paperId, sessionId, question, options?.persona, answer, options?.image)
      return answer
    }
  )
  ipcMain.on(IPC.chatStop, (_e, paperId: string) => stopQuestion(paperId))
  ipcMain.handle(IPC.chatSessionsList, (_e, paperId: string) => listChatSessions(appDb(), paperId))
  ipcMain.handle(IPC.chatSessionCreate, (_e, paperId: string) => createChatSession(appDb(), paperId))
  ipcMain.handle(IPC.chatSessionMessages, (_e, paperId: string, sessionId: string) =>
    listChatMessages(appDb(), paperId, sessionId)
  )
  ipcMain.handle(IPC.chatSessionDelete, (_e, paperId: string, sessionId: string) =>
    deleteChatSession(appDb(), paperId, sessionId)
  )
  ipcMain.handle(IPC.chatSessionRename, (_e, paperId: string, sessionId: string, title: string) =>
    renameChatSession(appDb(), paperId, sessionId, String(title ?? ''))
  )
  // 截图提问：按窗口 CSS 坐标截一块实际渲染像素（镜像译文页是 DOM，没有 canvas 可裁）
  ipcMain.handle(IPC.captureRegion, async (e, rect: { x: number; y: number; width: number; height: number }) => {
    const r = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    }
    if (r.width > 4000 || r.height > 4000) throw new Error(uiText('chat.image-size'))
    const img = await e.sender.capturePage(r)
    return img.toDataURL()
  })
}
