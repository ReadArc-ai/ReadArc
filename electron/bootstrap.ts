import { initializeStartup } from './startup'

// 独立构建入口：不能静态 import main，否则打包器会把 yaml/undici 等 require
// 提升到日志和异常处理器之前，再次留下「没有窗口也没有日志」的盲区。
initializeStartup(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 有意在日志就绪后同步加载独立产物
  require('./app.js')
})
