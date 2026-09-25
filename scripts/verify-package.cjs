// electron-builder afterPack：签名前检查归档边界，不能把维护者文件或旧包送去签名。
const { listPackage } = require('@electron/asar')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

module.exports = async function verifyPackage(context) {
  const resourceDir = context.electronPlatformName === 'darwin' || context.electronPlatformName === 'mas'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  const archive = join(resourceDir, 'app.asar')
  if (!existsSync(archive)) throw new Error('打包产物缺少 app.asar')
  const allowed = new Set(['out', 'node_modules', 'package.json', 'LICENSE', 'NOTICE',
    'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'PRIVACY.en.md', 'resources'])
  const files = listPackage(archive).map((file) => file.replace(/^\//, ''))
  for (const file of files) {
    if (!allowed.has(file.split('/')[0]) ||
        (file.startsWith('resources/') && !['resources/dict', 'resources/dict/LICENSE.ECDICT'].includes(file)) ||
        /(^|\/)\.env(?:\.|$)|\.(?:p8|p12|pfx|pem|key|provisionprofile|mobileprovision)$/.test(file)) {
      throw new Error(`发布包含非运行时或敏感文件：${file}`)
    }
  }
  for (const required of ['out/main/index.js', 'out/main/app.js', 'out/preload/index.js', 'out/renderer/index.html',
    'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'PRIVACY.en.md']) {
    if (!files.includes(required)) throw new Error(`发布包缺少 ${required}`)
  }
  console.log('发布包内容检查通过：只包含运行时代码、依赖及许可/隐私文件。')
}
