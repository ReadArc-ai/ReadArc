/**
 * 全文翻译的启停状态机。
 *
 * 停止是**协作式**的：请求停止后，正在跑的那一段要等模型返回才会被观察到
 * （可能 5–20 秒）。这个窗口里用户很可能再点一次「翻译全文」想续译——
 * 那时任务还在 running 里，若直接当作「已在跑」返回，停止请求没人撤回，
 * 当前段跑完后循环照常停下：用户看到的是「点了翻译，没反应」。
 * 所以任务已在跑时必须撤回待处理的停止请求（resumeIfRunning）。
 */
export class TranslationRunState {
  private readonly running = new Set<string>()
  private readonly stopRequested = new Set<string>()

  /**
   * 已在跑就撤回待处理的停止请求并返回 true（调用方直接返回，不再起一轮）。
   * 必须在任何早退判断**之前**调用，它不会把任务标记为运行中。
   */
  resumeIfRunning(paperId: string): boolean {
    if (!this.running.has(paperId)) return false
    this.stopRequested.delete(paperId) // 用户是要继续，撤回停止
    return true
  }

  /**
   * 真正起一轮循环时才调用——必须在所有早退分支（无可用路由、已全译完、
   * 预估待确认）之后，否则那些路径会把论文永久留在 running 里，
   * 之后的「翻译全文」全部被当成「已在跑」而静默失效（预估确认流程首当其冲）。
   */
  begin(paperId: string): void {
    this.running.add(paperId)
    this.stopRequested.delete(paperId)
  }

  /** 只对正在跑的任务有意义；没在跑就没什么可停的。 */
  requestStop(paperId: string): void {
    if (this.running.has(paperId)) this.stopRequested.add(paperId)
  }

  shouldStop(paperId: string): boolean {
    return this.stopRequested.has(paperId)
  }

  isRunning(paperId: string): boolean {
    return this.running.has(paperId)
  }

  /** 一轮循环结束（正常跑完、被停、或抛错）。 */
  end(paperId: string): void {
    this.running.delete(paperId)
    this.stopRequested.delete(paperId)
  }
}
