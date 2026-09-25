/** IPC 错误剥壳：用户不该看到 "Error invoking remote method '...'" 技术噪音。 */
export function errText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
