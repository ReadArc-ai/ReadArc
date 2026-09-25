import type { LayoutProgressEvent } from '../shared/models'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type PersistedSettings, type ReadArcBridge } from '../shared/ipc'
import type {
  ChatAskOptions,
  ChatDeltaEvent,
  ChatHistoryItem,
  ImportProgressEvent,
  ProgressUpdate,
  ProviderSaveInput,
  SearchProgressEvent,
  SearchResultInput,
  TaskRoute,
  TaskSlot,
  TranslateProgressEvent
} from '../shared/models'

const bridge: ReadArcBridge = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  patchSettings: (patch: Partial<PersistedSettings>) => ipcRenderer.send(IPC.settingsPatch, patch),
  platform: process.platform,
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  importPdfs: (paths: string[]) => ipcRenderer.invoke(IPC.libraryImport, paths),
  onImportProgress: (cb: (e: ImportProgressEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: ImportProgressEvent): void =>
      cb(payload)
    ipcRenderer.on(IPC.importProgress, listener)
    return () => ipcRenderer.removeListener(IPC.importProgress, listener)
  },
  onMenuAction: (cb: (action: 'settings' | 'import' | 'privacy') => void) => {
    const onSettings = (): void => cb('settings')
    const onImport = (): void => cb('import')
    const onPrivacy = (): void => cb('privacy')
    ipcRenderer.on(IPC.menuOpenSettings, onSettings)
    ipcRenderer.on(IPC.menuImport, onImport)
    ipcRenderer.on(IPC.menuOpenPrivacy, onPrivacy)
    return () => {
      ipcRenderer.removeListener(IPC.menuOpenSettings, onSettings)
      ipcRenderer.removeListener(IPC.menuImport, onImport)
      ipcRenderer.removeListener(IPC.menuOpenPrivacy, onPrivacy)
    }
  },
  pickPdfs: () => ipcRenderer.invoke(IPC.libraryPick),
  listPapers: () => ipcRenderer.invoke(IPC.libraryList),
  openPaper: (paperId: string) => ipcRenderer.invoke(IPC.paperOpen, paperId),
  deletePaper: (paperId: string) => ipcRenderer.invoke(IPC.paperDelete, paperId),
  showPaperMenu: (paperId: string) => ipcRenderer.send(IPC.paperMenu, paperId),
  onPaperMenuDelete: (cb: (paperId: string) => void) => {
    const listener = (_e: unknown, paperId: string): void => cb(paperId)
    ipcRenderer.on(IPC.paperMenuDelete, listener)
    return () => ipcRenderer.removeListener(IPC.paperMenuDelete, listener)
  },
  saveProgress: (paperId: string, update: ProgressUpdate) =>
    ipcRenderer.send(IPC.paperProgress, paperId, update),
  paperFile: (paperId: string) => ipcRenderer.invoke(IPC.paperFile, paperId),
  pdfAsset: (kind: string, filename: string) => ipcRenderer.invoke(IPC.pdfAsset, kind, filename),
  saveThumbnail: (paperId: string, dataUrl: string) =>
    ipcRenderer.invoke(IPC.thumbSave, paperId, dataUrl),
  getThumbnail: (paperId: string) => ipcRenderer.invoke(IPC.thumbGet, paperId),
  getFigure: (paperId: string, blockIdStr: string) =>
    ipcRenderer.invoke(IPC.figureGet, paperId, blockIdStr),
  modelState: () => ipcRenderer.invoke(IPC.modelsState),
  saveProvider: (input: ProviderSaveInput) => ipcRenderer.invoke(IPC.modelsSaveProvider, input),
  saveTaskRoute: (slot: TaskSlot, route: TaskRoute) =>
    ipcRenderer.invoke(IPC.modelsSaveRoute, slot, route),
  detectLocal: () => ipcRenderer.invoke(IPC.modelsDetectLocal),
  saveProxy: (cfg) => ipcRenderer.invoke(IPC.proxiesSave, cfg),
  deleteProxy: (name: string) => ipcRenderer.invoke(IPC.proxiesDelete, name),
  saveEndpointProxy: (slug: string, proxyName: string | null) =>
    ipcRenderer.invoke(IPC.endpointProxySave, slug, proxyName),
  saveMainModel: (provider: string, model: string) =>
    ipcRenderer.invoke(IPC.modelsSaveMain, provider, model),
  testNetwork: (cfg) => ipcRenderer.invoke(IPC.networkTest, cfg),
  deleteProvider: (slug: string) => ipcRenderer.invoke(IPC.modelsDeleteProvider, slug),
  listProviderModels: (slug: string) => ipcRenderer.invoke(IPC.modelsList, slug),
  translatePaper: (paperId: string, confirmed = false, force = false, override = null) =>
    ipcRenderer.invoke(IPC.translatePaper, paperId, confirmed, force, override),
  stopTranslation: (paperId: string) => ipcRenderer.invoke(IPC.translateStop, paperId),
  translateText: (text: string, dictOnly = false, reqId?: number) =>
    ipcRenderer.invoke(IPC.translateText, text, dictOnly, reqId ?? null),
  onTranslateTextDelta: (cb: (delta: string, reqId: number | null) => void) => {
    const listener = (_e: unknown, delta: string, reqId: number | null): void => cb(delta, reqId ?? null)
    ipcRenderer.on(IPC.translateTextDelta, listener)
    return () => ipcRenderer.removeListener(IPC.translateTextDelta, listener)
  },
  reportTranslateFocus: (paperId: string, blockOrder: number) =>
    ipcRenderer.send(IPC.translateFocus, paperId, blockOrder),
  translateOutline: (paperId: string) => ipcRenderer.invoke(IPC.translateOutline, paperId),
  retranslateBlock: (paperId: string, blockId: string) =>
    ipcRenderer.invoke(IPC.translateBlock, paperId, blockId),
  onTranslateProgress: (cb: (e: TranslateProgressEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: TranslateProgressEvent): void =>
      cb(payload)
    ipcRenderer.on(IPC.translateProgress, listener)
    return () => ipcRenderer.removeListener(IPC.translateProgress, listener)
  },
  monthUsage: () => ipcRenderer.invoke(IPC.usageMonth),
  getSummary: (paperId: string) => ipcRenderer.invoke(IPC.summaryGet, paperId),
  generateSummary: (paperId: string, force = false) =>
    ipcRenderer.invoke(IPC.summaryGenerate, paperId, force),
  askChat: (paperId: string, question: string, history: ChatHistoryItem[], options?: ChatAskOptions) =>
    ipcRenderer.invoke(IPC.chatAsk, paperId, question, history, options),
  listChatSessions: (paperId: string) => ipcRenderer.invoke(IPC.chatSessionsList, paperId),
  createChatSession: (paperId: string) => ipcRenderer.invoke(IPC.chatSessionCreate, paperId),
  listChatMessages: (paperId: string, sessionId: string) =>
    ipcRenderer.invoke(IPC.chatSessionMessages, paperId, sessionId),
  deleteChatSession: (paperId: string, sessionId: string) =>
    ipcRenderer.invoke(IPC.chatSessionDelete, paperId, sessionId),
  renameChatSession: (paperId: string, sessionId: string, title: string) =>
    ipcRenderer.invoke(IPC.chatSessionRename, paperId, sessionId, title),
  stopChat: (paperId: string) => ipcRenderer.send(IPC.chatStop, paperId),
  onGenDelta: (cb: (e: { kind: string; delta: string; paperId?: string; reset?: boolean }) => void) => {
    ipcRenderer.on(IPC.genDelta, (_e, payload) => cb(payload))
  },
  onChatDelta: (cb: (e: ChatDeltaEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: ChatDeltaEvent): void => cb(payload)
    ipcRenderer.on(IPC.chatDelta, listener)
    return () => ipcRenderer.removeListener(IPC.chatDelta, listener)
  },
  captureRegion: (rect: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke(IPC.captureRegion, rect),
  dataOverview: () => ipcRenderer.invoke(IPC.dataOverview),
  dataClear: (kind: string) => ipcRenderer.invoke(IPC.dataClear, kind),
  dataReveal: (id: string) => ipcRenderer.invoke(IPC.dataReveal, id),
  listNotes: (paperId: string) => ipcRenderer.invoke(IPC.notesList, paperId),
  addNote: (paperId: string, blockId: string, text: string, selection?: string) =>
    ipcRenderer.invoke(IPC.notesAdd, paperId, blockId, text, selection),
  removeNote: (paperId: string, anchorId: string) => ipcRenderer.invoke(IPC.notesRemove, paperId, anchorId),
  addHighlight: (
    paperId: string,
    blockId: string,
    selection: string,
    rects?: [number, number, number, number, number][],
    hintRange?: [number, number]
  ) => ipcRenderer.invoke(IPC.highlightAdd, paperId, blockId, selection, rects, hintRange),
  removeHighlight: (paperId: string, id: string) =>
    ipcRenderer.invoke(IPC.highlightRemove, paperId, id),
  onPaperBlocksUpdated: (cb: (paperId: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, paperId: string): void => cb(paperId)
    ipcRenderer.on(IPC.paperBlocksUpdated, listener)
    return () => ipcRenderer.removeListener(IPC.paperBlocksUpdated, listener)
  },
  onLayoutProgress: (cb: (e: LayoutProgressEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, e: LayoutProgressEvent): void => cb(e)
    ipcRenderer.on(IPC.layoutProgress, listener)
    return () => ipcRenderer.removeListener(IPC.layoutProgress, listener)
  },
  runSearch: (query: string) => ipcRenderer.invoke(IPC.searchRun, query),
  onSearchProgress: (cb: (e: SearchProgressEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: SearchProgressEvent): void => cb(payload)
    ipcRenderer.on(IPC.searchProgress, listener)
    return () => ipcRenderer.removeListener(IPC.searchProgress, listener)
  },
  addSearchResult: (result: SearchResultInput) => ipcRenderer.invoke(IPC.searchAdd, result),
  onSearchAddProgress: (
    cb: (e: { id: string; stage: 'download' | 'import'; received: number; total: number }) => void
  ) => {
    ipcRenderer.on(IPC.searchAddProgress, (_e, payload) => cb(payload))
  },
  findContradictions: () => ipcRenderer.invoke(IPC.notesContradictions),
  generateNotes: (paperId: string) => ipcRenderer.invoke(IPC.notesGenerate, paperId),
  stopGen: (kind: 'summary' | 'notes', paperId: string) => ipcRenderer.send(IPC.genStop, kind, paperId),
  summarizeSearch: (query: string, results: SearchResultInput[]) =>
    ipcRenderer.invoke(IPC.searchSummarize, query, results)
}

contextBridge.exposeInMainWorld('readarc', bridge)
