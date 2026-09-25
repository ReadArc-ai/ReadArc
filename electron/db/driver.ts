/**
 * 延迟加载 better-sqlite3 的 JS 入口，减少窗口前的依赖加载。
 * 13.0.3 本身直到构造 Database 才加载原生绑定；此包装不能据此认定或修复
 * 原生启动崩溃，也不能捕获 SIGABRT / SIGKILL。可捕获的加载错误由调用方处理。
 */
import type Database from 'better-sqlite3'

type SqliteCtor = typeof Database
let ctor: SqliteCtor | null = null

export function sqliteDriver(): SqliteCtor {
  if (!ctor) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- 原生模块延迟加载，失败由调用方处理
    ctor = require('better-sqlite3') as SqliteCtor
  }
  return ctor
}
