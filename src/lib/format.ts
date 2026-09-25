/** 数字格式化：token 计数（1.2k / 3.4M）。 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

/** 美元金额：非零小额展示 4 位小数，避免几厘钱被四舍五入成 $0.00 像是没统计。 */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

/** 字节数 → 人读单位（1 位小数，KB 以下取整） */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

/** 粗略估 token 数：一个汉字约 1 个，一个英文词约 1.3 个；只用于「思考了多少」这种进度提示 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u3000-\u9fff\uf900-\ufaff]/g) ?? []).length
  const words = (text.replace(/[\u3000-\u9fff\uf900-\ufaff]/g, ' ').match(/\S+/g) ?? []).length
  return Math.round(cjk + words * 1.3)
}
