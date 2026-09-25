import { friendlyImportError } from './service'
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMinimalPdf } from '../docengine/pdf-fixture'
import { importPdf, pruneStaleFigures, refineLayout } from './import'
import { getBlocks, getPaper, openDb, searchBlocks } from '../db'

// 手写迷你 PDF 不是真实版面，固定走启发式路径（ML 路径由 regions-to-blocks 单测覆盖）
process.env['READARC_DISABLE_ML'] = '1'

/** 真 PDF → pdf.js 提取 → 版面解析 → 入库 的端到端冒烟。 */
describe('importPdf（端到端）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readarc-'))
  const pdfPath = join(dir, 'fixture.pdf')
  writeFileSync(
    pdfPath,
    buildMinimalPdf([
      { text: 'Retrieval-Augmented Speech Recognition', x: 106, y: 700, size: 18 },
      { text: '1 Introduction', x: 72, y: 650, size: 12 },
      { text: 'We propose a retrieval aug-', x: 72, y: 630, size: 10 },
      { text: 'mented model for speech tasks.', x: 72, y: 618, size: 10 },
      { text: 'Our index stores exemplars.', x: 320, y: 630, size: 10 }
    ])
  )

  it('解析出块、目录与标题并落库；内容哈希做主键', async () => {
    const db = openDb(':memory:')
    const outcome = await importPdf(db, pdfPath)

    expect(outcome.blockCount).toBeGreaterThanOrEqual(3)
    expect(outcome.outline.map((o) => o.title)).toContain('1 Introduction')

    const paper = getPaper(db, outcome.paperId)!
    expect(paper.title).toBe('Retrieval-Augmented Speech Recognition')

    const blocks = getBlocks(db, outcome.paperId)
    const joined = blocks.map((b) => b.text).join('\n')
    expect(joined).toContain('retrieval augmented model') // 断词已合并
    expect(searchBlocks(db, outcome.paperId, 'exemplars').length).toBe(1)

    // 同一文件重新导入（如移动后再拖入）：同一篇，不产生重复
    const again = await importPdf(db, pdfPath)
    expect(again.paperId).toBe(outcome.paperId)
    expect(db.prepare('SELECT COUNT(*) AS n FROM papers').get()).toEqual({ n: 1 })
    db.close()
  })
})

describe('friendlyImportError：导入失败必须是人能看懂的一句话', () => {
  it('pdf.js 的空文件英文原句翻成中文', () => {
    // 真实报错原文：0 字节的文件走到这一句
    expect(friendlyImportError(new Error('The PDF file is empty, i.e. its size is zero bytes.'))).toBe(
      '文件为空（0 字节）'
    )
  })

  it('常见文件系统错误各有对应说法', () => {
    expect(friendlyImportError(new Error('InvalidPDFException: Invalid PDF structure'))).toBe(
      '文件不是有效的 PDF'
    )
    expect(friendlyImportError(new Error('PasswordException: No password given'))).toBe(
      '暂不支持受密码保护的 PDF'
    )
    expect(friendlyImportError(new Error("ENOENT: no such file or directory, open '/x.pdf'"))).toBe(
      '找不到文件，可能已被移动或删除。'
    )
    expect(friendlyImportError(new Error('EACCES: permission denied'))).toBe(
      '没有读取此文件的权限'
    )
  })


  it('零页 PDF 报「一页都没有」而不是默默入库一篇空论文', () => {
    expect(friendlyImportError(new Error('PDF_NO_PAGES'))).toBe('此 PDF 不包含任何页面')
  })

  it('认不出的报错也包成中文，但保留原文供反馈', () => {
    const out = friendlyImportError(new Error('Weird low-level failure 0x8004'))
    expect(out).toContain('无法解析 PDF')
    expect(out).toContain('Weird low-level failure 0x8004')
  })
})

describe('pruneStaleFigures：重新解析后清掉旧截图', () => {
  const mk = (): string => mkdtempSync(join(tmpdir(), 'readarc-figs-'))

  it('只留下本次解析产出的截图', () => {
    const d = mk()
    for (const n of ['a_1_0.png', 'a_1_5.png', 'a_2_9.png']) writeFileSync(join(d, n), 'png')
    const removed = pruneStaleFigures(d, new Set(['a_1_0.png']))
    expect(removed).toBe(2)
    expect(readdirSync(d)).toEqual(['a_1_0.png'])
  })

  it('全部都要保留时一个都不删', () => {
    const d = mk()
    const keep = ['a_1_0.png', 'a_1_1.png']
    for (const n of keep) writeFileSync(join(d, n), 'png')
    expect(pruneStaleFigures(d, new Set(keep))).toBe(0)
    expect(readdirSync(d).sort()).toEqual(keep)
  })

  it('目录不存在时返回 0，不抛异常', () => {
    expect(pruneStaleFigures(join(tmpdir(), 'readarc-no-figs-xyz'), new Set())).toBe(0)
  })

  it('本次没有任何截图时，把旧的全清掉', () => {
    const d = mk()
    writeFileSync(join(d, 'old_1_0.png'), 'png')
    expect(pruneStaleFigures(d, new Set())).toBe(1)
    expect(readdirSync(d)).toEqual([])
  })
})

describe('写入类失败也要说人话', () => {
  it('拷进库目录失败说「写不进」而不是「读不了」', () => {
    expect(friendlyImportError(new Error("EACCES: permission denied, copyfile '/a' -> '/b'"))).toBe(
      '无法写入论文库目录，请检查目录权限和磁盘状态。'
    )
    expect(friendlyImportError(new Error('EROFS: read-only file system'))).toBe(
      '无法写入论文库目录，请检查目录权限和磁盘状态。'
    )
  })

  it('读源文件的权限问题仍报「读不了」', () => {
    expect(friendlyImportError(new Error("EACCES: permission denied, open '/x.pdf'"))).toBe(
      '没有读取此文件的权限'
    )
  })
})

/** quick 导入与后台识别：模型不在场时 quick 等同普通导入，refineLayout 也能安全重跑 */
describe('quick 导入 + refineLayout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readarc-quick-'))
  const pdfPath = join(dir, 'fixture.pdf')
  writeFileSync(
    pdfPath,
    buildMinimalPdf([
      { text: 'A Paper Title', x: 106, y: 700, size: 18 },
      { text: '1 Introduction', x: 72, y: 650, size: 12 },
      { text: 'Body text of the paper.', x: 72, y: 630, size: 10 }
    ])
  )

  it('模型不在场：quick 导入直接是 done，块照常入库', async () => {
    const db = openDb(':memory:')
    const outcome = await importPdf(db, pdfPath, undefined, undefined, { quick: true })
    expect(getPaper(db, outcome.paperId)?.layout_state).toBe('done')
    expect(getBlocks(db, outcome.paperId).length).toBeGreaterThan(0)
  })

  it('refineLayout 重跑后块数不变、状态 done；不存在的论文返回 false', async () => {
    const db = openDb(':memory:')
    const outcome = await importPdf(db, pdfPath, undefined, undefined, { quick: true })
    const before = getBlocks(db, outcome.paperId).length
    expect(await refineLayout(db, outcome.paperId)).toBe(true)
    expect(getBlocks(db, outcome.paperId).length).toBe(before)
    expect(getPaper(db, outcome.paperId)?.layout_state).toBe('done')
    expect(await refineLayout(db, 'nope')).toBe(false)
  })
})
