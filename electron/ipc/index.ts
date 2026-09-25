/**
 * 主进程 IPC 注册总入口。按功能分文件，每个文件只认识自己的服务层；
 * main.ts 只管窗口、菜单和生命周期。
 */
import { registerChatIpc } from './chat'
import { registerDataIpc } from './data'
import { registerGenIpc } from './gen'
import { registerLibraryIpc } from './library'
import { registerModelsIpc } from './models'
import { registerNotesIpc } from './notes'
import { registerSearchIpc } from './search'
import { registerSettingsIpc } from './settings'
import { registerTranslateIpc } from './translate'

export function registerAllIpc(deps: { rebuildMenu: () => void }): void {
  registerSettingsIpc(deps)
  registerLibraryIpc()
  registerModelsIpc()
  registerTranslateIpc()
  registerChatIpc()
  registerSearchIpc()
  registerNotesIpc()
  registerDataIpc()
  registerGenIpc()
}
