import { vi } from 'vitest'

// 这些测试在 Node 中验证服务层，并显式传入数据库与路径。
// Electron 44 的 Node 入口会按需下载桌面运行时；不能让各 worker 并发下载。
// 保留 app 不可用的边界：意外调用桌面 API 时仍会失败，真实 API 由 MAS 冒烟验证。
vi.mock('electron', () => ({ app: undefined }))
