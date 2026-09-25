import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/ipc'
import { loadSettings } from './settings-store'
import { uiText } from './i18n'
import { friendlyModelError } from './model/router'
import { friendlySourceError } from './search/service'

vi.mock('./settings-store', () => ({ loadSettings: vi.fn() }))

beforeEach(() => {
  vi.mocked(loadSettings).mockReturnValue({ ...DEFAULT_SETTINGS, lang: 'en', targetLang: 'zh' })
})

describe('main-process interface language', () => {
  it('uses interface language for model/search errors and native menus, independently of translation language', () => {
    expect(friendlyModelError('HTTP 401')).toContain('Settings → Connect')
    expect(friendlySourceError(new Error('HTTP 429'))).toContain('request rate')
    expect(uiText('menu.finder')).toBe('Show in Finder')

    vi.mocked(loadSettings).mockReturnValue({ ...DEFAULT_SETTINGS, lang: 'zh', targetLang: 'en' })
    expect(friendlyModelError('HTTP 401')).toContain('设置 → 接入')
    expect(friendlySourceError(new Error('HTTP 429'))).toContain('请求频率')
    expect(uiText('menu.finder')).toBe('在 Finder 中显示')
  })

  it('preserves diagnostic values while formatting localized errors', () => {
    expect(friendlySourceError(new Error('HTTP 503'))).toContain('HTTP 503')
    expect(uiText('notes.failed', { detail: 'disk {detail} unavailable' })).toBe(
      'Could not save notes: disk {detail} unavailable'
    )
    expect(uiText('search.cooldown', { seconds: 12 })).toContain('12 seconds')
  })
})
