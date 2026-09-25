/** 渲染崩溃时显示错误与重载按钮，而不是留给用户一个黑窗口。 */
import { Component, type ReactNode } from 'react'
import { tNow } from '../i18n'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash-screen">
        <h1>{tNow('crash.title')}</h1>
        <p>{tNow('crash.body')}</p>
        <pre>{this.state.error.stack ?? this.state.error.message}</pre>
        <button className="btn-accent" onClick={() => location.reload()}>
          {tNow('crash.reload')}
        </button>
      </div>
    )
  }
}
