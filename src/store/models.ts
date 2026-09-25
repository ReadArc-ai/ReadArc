import { create } from 'zustand'
import type { DetectedLocal, ModelState, ProviderSaveInput, TaskRoute, TaskSlot } from '../../shared/models'

interface ModelsStore {
  state: ModelState | null
  loading: boolean
  detected: DetectedLocal[] | null

  load(): Promise<void>
  saveProvider(input: ProviderSaveInput): Promise<void>
  saveRoute(slot: TaskSlot, route: TaskRoute): Promise<void>
  /** 默认模型（config 的 main:）：对话框底部切换器与设置页共用这一个入口 */
  saveMainModel(provider: string, model: string): Promise<void>
  detectLocal(): Promise<void>
}

export const useModels = create<ModelsStore>((set, get) => ({
  state: null,
  loading: false,
  detected: null,

  load: async () => {
    set({ loading: true })
    try {
      set({ state: await window.readarc.modelState() })
    } finally {
      set({ loading: false })
    }
  },

  saveProvider: async (input) => {
    await window.readarc.saveProvider(input)
    await get().load()
  },

  saveRoute: async (slot, route) => {
    await window.readarc.saveTaskRoute(slot, route)
    await get().load()
  },

  saveMainModel: async (provider, model) => {
    await window.readarc.saveMainModel(provider, model)
    await get().load()
  },

  detectLocal: async () => {
    const detected = await window.readarc.detectLocal()
    set({ detected })
    await get().load()
  }
}))
