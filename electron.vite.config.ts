import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

// 界面上显示的版本号取自 package.json，构建期注入——不再手写，写死了必然过期
const appVersion = (JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }).version

export default defineConfig({
  main: {
    // better-sqlite3 等原生依赖不打包，运行时从 node_modules 加载
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: {
        index: resolve(__dirname, 'electron/bootstrap.ts'),
        app: resolve(__dirname, 'electron/main.ts')
      } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'electron/preload.ts') } }
    }
  },
  renderer: {
    root: 'src',
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/index.html') }
    },
    resolve: {
      alias: { '@': resolve(__dirname, 'src') }
    },
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
    plugins: [react(), tailwindcss()]
  }
})
