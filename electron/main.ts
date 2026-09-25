import { app, BrowserWindow, Menu, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { IPC, type PersistedSettings } from '../shared/ipc'
import { flushSettings, loadSettings, patchSettings } from './settings-store'
import { isSafeExternalUrl } from './safe-url'
import { resumePendingLayouts, setLayoutNotifier, sweepOrphanCopies, sweepStaleFigures } from './library/service'
import { absorbAskRouteIntoMain } from './config/main-model'
import { registerAllIpc } from './ipc'
import { describeError, logStartup, reportFatal, startupLogPath } from './startup'

const isMac = process.platform === 'darwin'

function backgroundColorFor(settings: PersistedSettings): string {
  const dark =
    settings.theme === 'dark' || (settings.theme === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? '#171717' : '#f8f8f8'
}


/**
 * 应用菜单。不设置的话 Electron 会挂上它自带的默认菜单——里面有指向 electronjs.org
 * 的 Help 项和「Toggle Developer Tools」，出现在正式产品里既不专业也不该有。
 *
 * 刻意**不放**缩放项：默认菜单的 zoomIn/zoomOut/resetZoom 占着 ⌘+/⌘−/⌘0，
 * 而这三个键在本应用里是 PDF 页面缩放（渲染进程处理）。菜单快捷键会先吃掉事件，
 * 于是工具栏提示写着「放大 ⌘+」实际却缩放整个界面。菜单不认领，键就归页面。
 * Edit 菜单的 role 必须保留——文本框的 ⌘C/⌘V/⌘A 全靠它。
 */
/**
 * 菜单里的产品名写常量，不用 app.name——开发期 app.name 是 package.json 的小写
 * "readarc"；而调 app.setName() 会连带改掉 userData 路径（区分大小写的卷上等于
 * 换了个数据目录）。为了菜单标签去动数据存放位置，不划算。
 */
const APP_NAME = 'ReadArc'

function buildAppMenu(): void {
  const zh = loadSettings().lang !== 'en'
  const L = (cn: string, en: string): string => (zh ? cn : en)
  const repo = 'https://github.com/ReadArc-ai/ReadArc'
  const site = 'https://readarc.ai'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: APP_NAME,
            submenu: [
              { role: 'about', label: L(`关于 ${APP_NAME}`, `About ${APP_NAME}`) },
              { type: 'separator' },
              {
                label: L('设置…', 'Settings…'),
                accelerator: 'CmdOrCtrl+,',
                click: () => BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.menuOpenSettings)
              },
              { type: 'separator' },
              { role: 'services', label: L('服务', 'Services') },
              { type: 'separator' },
              { role: 'hide', label: L(`隐藏 ${APP_NAME}`, `Hide ${APP_NAME}`) },
              { role: 'hideOthers', label: L('隐藏其他', 'Hide Others') },
              { role: 'unhide', label: L('全部显示', 'Show All') },
              { type: 'separator' },
              { role: 'quit', label: L(`退出 ${APP_NAME}`, `Quit ${APP_NAME}`) }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: L('文件', 'File'),
      submenu: [
        {
          label: L('导入 PDF…', 'Import PDF…'),
          accelerator: 'CmdOrCtrl+O',
          click: () => BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.menuImport)
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: L('关闭窗口', 'Close Window') } : { role: 'quit', label: L('退出', 'Quit') }
      ]
    },
    {
      label: L('编辑', 'Edit'),
      submenu: [
        { role: 'undo', label: L('撤销', 'Undo') },
        { role: 'redo', label: L('重做', 'Redo') },
        { type: 'separator' },
        { role: 'cut', label: L('剪切', 'Cut') },
        { role: 'copy', label: L('拷贝', 'Copy') },
        { role: 'paste', label: L('粘贴', 'Paste') },
        { role: 'selectAll', label: L('全选', 'Select All') }
      ]
    },
    {
      label: L('显示', 'View'),
      submenu: [
        { role: 'togglefullscreen', label: L('全屏', 'Toggle Full Screen') },
        // 开发期才给重载与开发者工具；打包产物里不出现
        ...(app.isPackaged
          ? []
          : ([
              { type: 'separator' },
              { role: 'reload' },
              { role: 'toggleDevTools' }
            ] as Electron.MenuItemConstructorOptions[]))
      ]
    },
    {
      label: L('窗口', 'Window'),
      submenu: [
        { role: 'minimize', label: L('最小化', 'Minimize') },
        { role: 'zoom', label: L('缩放', 'Zoom') },
        ...(isMac ? ([{ type: 'separator' }, { role: 'front', label: L('前置全部窗口', 'Bring All to Front') }] as Electron.MenuItemConstructorOptions[]) : [])
      ]
    },
    {
      role: 'help',
      label: L('帮助', 'Help'),
      submenu: [
        { label: L('隐私政策', 'Privacy policy'), click: () => {
          let win = BrowserWindow.getAllWindows()[0]
          if (!win) {
            createWindow()
            win = BrowserWindow.getAllWindows()[0]
            win?.webContents.once('did-finish-load', () => win.webContents.send(IPC.menuOpenPrivacy))
          } else {
            if (win.isMinimized()) win.restore()
            win.show()
            win.focus()
            win.webContents.send(IPC.menuOpenPrivacy)
          }
        } },
        { label: L('官网', 'Website'), click: () => void shell.openExternal(site) },
        { label: L('GitHub 项目主页', 'GitHub project'), click: () => void shell.openExternal(repo) },
        { label: L('报告问题', 'Report an issue'), click: () => void shell.openExternal(`${repo}/issues`) }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const settings = loadSettings()
  // 系统级弹出层（下拉列表、菜单）跟随应用主题，而不是跟随系统
  try {
    nativeTheme.themeSource = settings.theme
  } catch (err) {
    logStartup(`themeSource skipped: ${describeError(err)}`)
  }
  const bounds = settings.windowBounds

  const win = new BrowserWindow({
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: backgroundColorFor(settings),
    // 40px 自绘标题栏，macOS 交通灯内嵌
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 12, y: 13 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })

  // 窗口一定要出来：ready-to-show 依赖渲染进程首帧，渲染端加载失败或被系统杀掉时它永远不来。
  // 兜底定时显示，宁可先看到背景色再看到错误页，也不能「点了图标没反应」。
  let shown = false
  const showOnce = (why: string): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    logStartup(`window shown (${why})`)
    win.show()
  }
  win.once('ready-to-show', () => showOnce('ready-to-show'))
  const fallback = setTimeout(() => showOnce('fallback timer'), 2500)
  win.once('closed', () => clearTimeout(fallback))
  win.webContents.once('did-finish-load', () => logStartup('renderer did-finish-load'))
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return
    logStartup(`renderer did-fail-load ${code} ${desc} ${url}`)
    showOnce('did-fail-load')
    const path = startupLogPath() ?? ''
    const html = `<!doctype html><meta charset="utf-8"><body style="font:14px -apple-system,sans-serif;padding:32px;color:#222;background:#f8f8f8"><h2>ReadArc could not load its interface</h2><p>${desc} (${code})</p><p style="color:#666">${path}</p></body>`
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  })
  let renderRestarts = 0
  win.webContents.on('render-process-gone', (_e, details) => {
    logStartup(`render-process-gone: ${details.reason} (exit ${details.exitCode})`)
    showOnce('render-process-gone')
    // 渲染进程被系统杀掉一次就重载一次；反复挂就停手，留着错误现场
    if (renderRestarts++ === 0 && !win.isDestroyed()) win.webContents.reload()
  })

  // 外链一律走系统浏览器，窗口内不导航。
  //
  // 只放行 http/https/mailto：这些 URL 多数来自 PDF 的链接注释，属于**不可信内容**。
  // shell.openExternal 会把 file:// 与任意自定义 scheme 交给系统处理器，
  // 等于让一篇论文能唤起本机上任何已注册协议的应用。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 拖拽文件若未被页面拦截，Chromium 默认会把窗口导航到 file://（表现为黑屏）——一律禁止
  win.webContents.on('will-navigate', (e, url) => {
    const devServer = process.env['ELECTRON_RENDERER_URL']
    if (devServer && url.startsWith(devServer)) return
    if (url.startsWith('file://') && /\/index\.html(\?|$)/.test(url)) return // 自身重载
    e.preventDefault()
  })

  const saveBounds = (): void => {
    if (win.isDestroyed() || win.isMinimized() || win.isMaximized()) return
    patchSettings({ windowBounds: win.getBounds() })
  }
  win.on('resized', saveBounds)
  win.on('moved', saveBounds)

  // 诊断探针只在显式带远程调试端口启动时装配，正式运行的窗口不挂任何调试入口
  const diag = process.argv.some((a) => a.startsWith('--remote-debugging-port'))
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + (diag ? '?diag=1' : ''))
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), diag ? { query: { diag: '1' } } : {})
  }
}

/**
 * 单实例：两个进程共用同一个 SQLite 库与 settings.json——设置会互相覆盖，
 * 还可能对同一篇论文各翻译一遍（各花各的钱）。拿不到锁就退出，
 * 并把已有窗口带到前台，让用户以为「又打开了一次」。
 * MAS 沙盒不能可靠创建 Chromium 的单实例 socket（会把首次启动误判成锁失败）。
 * MAS 由 Launch Services 和 LSMultipleInstancesProhibited 管理重复启动；
 * 其他发行版仍使用 Electron 的锁。
 */
const isPrimaryInstance = process.mas === true || app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.quit()

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

app.whenReady().then(() => {
  if (!isPrimaryInstance) return // 退出的重复实例不能恢复后台任务或修改数据库
  logStartup(`app ready: v${app.getVersion()} electron ${process.versions.electron} mas=${String(process.mas)} ${process.platform}/${process.arch}`)
  // 窗口之前只做注册类工作；任何一步抛错都不能挡住窗口——
  // 先有窗口，用户才看得到后面的错误提示 [P4]
  try {
    setLayoutNotifier((e) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isDestroyed()) continue
        w.webContents.send(IPC.layoutProgress, e)
        if (e.done) w.webContents.send(IPC.paperBlocksUpdated, e.paperId)
      }
    })
    registerAllIpc({ rebuildMenu: buildAppMenu })
  } catch (err) {
    reportFatal('ipc registration failed', err)
  }
  try {
    buildAppMenu()
  } catch (err) {
    logStartup(`menu skipped: ${describeError(err)}`)
  }
  try {
    createWindow()
    logStartup('window created')
  } catch (err) {
    reportFatal('createWindow failed', err)
  }

  // 数据库相关的启动工作放在窗口之后：库打不开时窗口照常出来，由界面提示恢复步骤
  // 老配置里单独路由的「问答」模型并入默认模型（见 absorbAskRouteIntoMain）；
  // 配置文件坏了也不能挡启动——读原文照常 [P4]
  try {
    absorbAskRouteIntoMain()
  } catch (err) {
    logStartup(`ask-route migration skipped: ${describeError(err)}`)
  }
  try {
    resumePendingLayouts()
  } catch (err) {
    logStartup(`resumePendingLayouts skipped: ${describeError(err)}`)
  }
  // 清掉没人引用的 PDF 副本（历史重复导入的旧副本、强杀留下的半截拷贝）
  try {
    const n = sweepOrphanCopies()
    if (n > 0) console.warn(`swept ${n} orphan pdf copies`)
    const f = sweepStaleFigures()
    if (f > 0) console.warn(`swept ${f} stale figure files`)
  } catch {
    /* 清理失败不影响启动 */
  }

  app.on('activate', () => {
    const wins = BrowserWindow.getAllWindows()
    if (wins.length === 0) createWindow()
    else wins[0].show() // 已有窗口但还没显示出来（首帧没到）：点 Dock 图标就把它拉出来
  })
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})

app.on('before-quit', () => flushSettings())
