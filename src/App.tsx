import { useRef, useState, type JSX } from 'react'
import { useApp } from './store/app'
import { usePaper } from './store/paper'
import { useResolvedTheme } from './lib/use-theme'
import { useTier } from './lib/use-tier'
import { useShortcuts } from './lib/use-shortcuts'
import { classifyDrop, hasFiles } from './lib/drop'
import { tNow, useT } from './i18n'
import { Titlebar } from './app/shell/Titlebar'
import { Rail } from './app/shell/Rail'
import { ImportToast } from './app/shell/ImportToast'
import { ReaderScreen } from './app/reader'
import { LibraryScreen } from './app/library'
import { DiscoverScreen } from './app/search'
import { SettingsModal } from './app/settings'
import { OnboardingScreen } from './app/onboarding'
import { CommandPalette } from './app/shell/CommandPalette'
import { ConfirmDialog } from './app/shell/ConfirmDialog'

export function App(): JSX.Element {
  const screen = useApp((s) => s.screen)
  const resolved = useResolvedTheme()
  const t = useT()
  useTier()
  useShortcuts(resolved === 'dark')

  // 文件悬停在窗口上时铺一层「松开导入」：让用户在松手前就知道这里接收拖放。
  // dragover 在悬停期间持续触发，靠它续命；一段时间没再触发（拖出窗口或松手）就撤掉，
  // 不依赖 dragenter/dragleave 的配对——跨子元素时它们并不可靠。
  const [dragOver, setDragOver] = useState(false)
  const overTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    if (!hasFiles(e.dataTransfer.types)) return
    setDragOver(true)
    if (overTimer.current) clearTimeout(overTimer.current)
    overTimer.current = setTimeout(() => setDragOver(false), 250)
  }

  // 拖入 PDF：落到应用任意位置都接收；不是 PDF 或读不到路径也要说一声，不能没反应
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    if (overTimer.current) clearTimeout(overTimer.current)
    setDragOver(false)
    const { paths, problem } = classifyDrop(Array.from(e.dataTransfer.files), (f) => window.readarc.pathForFile(f))
    if (problem) {
      usePaper.setState({ importError: tNow(problem === 'no-path' ? 'import.drop-no-path' : 'import.drop-not-pdf') })
      return
    }
    void usePaper.getState().importFiles(paths)
  }

  return (
    <div className="app" onDragOver={onDragOver} onDrop={onDrop}>
      <Titlebar />
      <div className="app-body">
        <Rail />
        {screen === 'reader' && <ReaderScreen />}
        {screen === 'library' && <LibraryScreen />}
        {screen === 'discover' && <DiscoverScreen />}
        {screen === 'onboard' && <OnboardingScreen />}
      </div>
      {dragOver && (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-overlay-box">{t('import.drop-here')}</div>
        </div>
      )}
      <ImportToast />
      <CommandPalette />
      <ConfirmDialog />
      <SettingsModal />
    </div>
  )
}
