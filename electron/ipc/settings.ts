import { ipcMain, nativeTheme } from 'electron'
import { IPC, type PersistedSettings } from '../../shared/ipc'
import { loadSettings, patchSettings } from '../settings-store'

export function registerSettingsIpc(deps: { rebuildMenu: () => void }): void {
  ipcMain.handle(IPC.settingsGet, () => loadSettings())
  ipcMain.on(IPC.settingsPatch, (_e, patch: Partial<PersistedSettings>) => {
    patchSettings(patch)
    if (patch.theme) nativeTheme.themeSource = patch.theme
    // 菜单文案在构建时按语言定死，切换语言后要重建，否则菜单还是旧语言
    if (patch.lang !== undefined) deps.rebuildMenu()
  })
}
