/** 模型接入：供应商、路由、代理、连通性测试、用量 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { ProviderSaveInput, ProxySaveInput, TaskRoute, TaskSlot } from '../../shared/models'
import { saveMainModel } from '../config/main-model'
import { upsertEnvVar } from '../config/env-writer'
import { deleteProvider } from '../config/provider-writer'
import { composeProxyUrl, deleteProxy, proxyPasswordEnv, saveEndpointProxy, saveProxy } from '../config/proxies'
import { appDb } from '../library/service'
import { detectLocal, modelState, modelsForProvider, saveProviderAndKey, saveRoute, usageOverview } from '../model/service'
import { fetchErrorText, testProxyConnectivity } from '../model/transport'

export function registerModelsIpc(): void {
  ipcMain.handle(IPC.modelsState, () => modelState())
  ipcMain.handle(IPC.modelsSaveProvider, (_e, input: ProviderSaveInput) =>
    saveProviderAndKey({ ...input, keyEnv: input.keyEnv ?? undefined })
  )
  ipcMain.handle(IPC.modelsSaveRoute, (_e, slot: TaskSlot, route: TaskRoute) => saveRoute(slot, route))
  ipcMain.handle(IPC.modelsDetectLocal, () => detectLocal())
  ipcMain.handle(IPC.modelsDeleteProvider, (_e, slug: string) => deleteProvider(slug))
  ipcMain.handle(IPC.proxiesSave, (_e, input: ProxySaveInput) => {
    const { password, ...def } = input
    saveProxy(def)
    if (password) upsertEnvVar(proxyPasswordEnv(def.name), password)
  })
  ipcMain.handle(IPC.proxiesDelete, (_e, name: string) => deleteProxy(name))
  ipcMain.handle(IPC.endpointProxySave, (_e, slug: string, proxyName: string | null) =>
    saveEndpointProxy(slug, proxyName)
  )
  ipcMain.handle(IPC.modelsSaveMain, (_e, provider: string, model: string) => saveMainModel({ provider, model }))
  // 测试代理连通性：经该档案代理请求 204 端点，5s 超时
  ipcMain.handle(IPC.networkTest, async (_e, input: ProxySaveInput) => {
    const { password, ...def } = input
    if (password) upsertEnvVar(proxyPasswordEnv(def.name), password)
    try {
      const ok = await testProxyConnectivity(composeProxyUrl(def))
      return { ok }
    } catch (err) {
      return { ok: false, error: fetchErrorText(err) }
    }
  })
  ipcMain.handle(IPC.modelsList, (_e, slug: string) => modelsForProvider(slug))
  ipcMain.handle(IPC.usageMonth, () => usageOverview(appDb()))
}
