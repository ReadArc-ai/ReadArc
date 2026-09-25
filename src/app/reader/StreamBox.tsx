import { useEffect, useRef, type JSX } from 'react'
import { Markdown } from '../../lib/md'

/**
 * 流式生成中的草稿：灰字、固定高度、内部滚动并跟住末尾。
 * 生成过程里模型先吐出的多半是从原文摘的片段，不该像成品一样撑开面板；
 * 生成完成后由各自的成品组件（笔记条目 / 摘要卡）正常渲染。
 */
export function StreamBox({ text, className }: { text: string; className?: string }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])
  return (
    <div className="stream-box" ref={ref}>
      <Markdown className={className ? `${className} stream-text` : 'stream-text'} text={text} />
    </div>
  )
}
