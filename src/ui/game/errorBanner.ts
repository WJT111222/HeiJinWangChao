// 三阶段错误横幅的关闭作用域：只记录安全的标识（存档、回合、正文版本、失败事件序号）和已显示给玩家的错误文案摘要，
// 不包含模型原文、请求内容或密钥。任何一项变化都视为「新的错误」，横幅重新出现；普通重渲染得到同一个键。
export interface ErrorBannerScope {
  saveId: string;
  turnId?: string;
  storyRevision?: number;
  /** 本页面会话内已记录的失败事件序号；清空运行日志不会让它回退。 */
  failureSeq: number;
}
export interface ErrorBannerFailure { stage: string; errorCode: string; attempt: number }

export function errorBannerKey(scope: ErrorBannerScope, messages: readonly string[], failures: readonly ErrorBannerFailure[]) {
  return JSON.stringify([scope.saveId, scope.turnId ?? null, scope.storyRevision ?? null, scope.failureSeq,
    messages, failures.map((failure) => [failure.stage, failure.errorCode, failure.attempt])]);
}
