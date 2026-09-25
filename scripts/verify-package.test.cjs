const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, dirname } = require('node:path')
const { createPackage } = require('@electron/asar')
const verify = require('./verify-package.cjs')

async function packaged(extra, omit, run) {
  const dir = mkdtempSync(join(tmpdir(), 'readarc-package-check-'))
  try {
    const source = join(dir, 'source')
    const resources = join(dir, 'ReadArc.app', 'Contents', 'Resources')
    mkdirSync(resources, { recursive: true })
    const files = ['out/main/index.js', 'out/main/app.js', 'out/preload/index.js', 'out/renderer/index.html',
      'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'PRIVACY.en.md',
      'package.json', 'resources/dict/LICENSE.ECDICT', ...extra]
    for (const name of files.filter((f) => f !== omit)) {
      const path = join(source, name)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'test fixture')
    }
    await createPackage(source, join(resources, 'app.asar'))
    await run({ appOutDir: dir, electronPlatformName: 'mas',
      packager: { appInfo: { productFilename: 'ReadArc' } } })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('accept a runtime-only MAS archive', async () => {
  await packaged([], null, (context) => assert.doesNotReject(verify(context)))
})
test('reject local files, old packages and credentials before signing', async () => {
  for (const file of ['release/old.pkg', 'local/notes.md', 'design/prototype.html',
    'resources/models/experiment.onnx', 'node_modules/example/.env', 'node_modules/example/key.p8']) {
    await packaged([file], null, (context) => assert.rejects(verify(context), /非运行时或敏感文件/))
  }
})
test('reject a package missing its privacy policy', async () => {
  await packaged([], 'PRIVACY.md', (context) => assert.rejects(verify(context), /缺少 PRIVACY.md/))
})
test('reject a package missing the deferred main module', async () => {
  await packaged([], 'out/main/app.js', (context) => assert.rejects(verify(context), /缺少 out\/main\/app.js/))
})
