import type { ReadArcBridge } from '../shared/ipc'

declare global {
  interface Window {
    readarc: ReadArcBridge
  }
}

export {}
