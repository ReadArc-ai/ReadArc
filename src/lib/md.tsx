/**
 * AI 输出的 Markdown 渲染：marked 解析 + DOMPurify 消毒（模型输出不可信）。
 * 引用 chip 以内联 `<a data-cite>` 形式混排在文本里，点击经事件委托回跳原文；
 * 外链一律交给系统浏览器（window.open 被主进程路由到 shell.openExternal）。
 */
import { useMemo, type JSX } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: true })

export function mdToHtml(text: string): string {
  const raw = marked.parse(text, { async: false }) as string
  return DOMPurify.sanitize(raw, {
    ALLOWED_ATTR: ['href', 'title', 'class', 'data-cite', 'start']
  })
}

export function Markdown({
  text,
  className,
  onCite
}: {
  text: string
  className?: string
  /** 有引用 chip 时的回跳回调（data-cite 的数值） */
  onCite?: (order: number) => void
}): JSX.Element {
  const html = useMemo(() => mdToHtml(text), [text])
  return (
    <div
      className={`md-body${className ? ` ${className}` : ''}`}
      onClick={(e) => {
        const t = e.target as Element
        const cite = t.closest('[data-cite]')
        if (cite && onCite) {
          e.preventDefault()
          onCite(Number(cite.getAttribute('data-cite')))
          return
        }
        const link = t.closest('a[href]') as HTMLAnchorElement | null
        if (link?.href.startsWith('http')) {
          e.preventDefault()
          window.open(link.href)
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
