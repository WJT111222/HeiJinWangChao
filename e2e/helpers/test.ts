import { expect, test as base } from '@playwright/test';

export { expect };

// 既有游戏/设置测试从已阅读公告的状态开始。真正的首次访问流程由
// startup-notices.spec.ts 使用原生 test 独立覆盖；生产代码没有测试旁路。
export const test = base.extend<{ fixedTime: string | undefined }>({
  fixedTime: [undefined, { option: true }],
  context: async ({ context, fixedTime }, use) => {
    if (fixedTime !== undefined) await context.clock.setFixedTime(fixedTime);
    // Init scripts may run before Playwright installs the fake clock.
    await context.addInitScript((fixedTime) => {
      try {
        const now = new Date(fixedTime ?? Date.now());
        const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
          String(now.getDate()).padStart(2, '0')].join('-');
        localStorage.setItem('heijin.notices.hidden-on.v1', date);
      } catch { /* 存储异常测试仍由原场景断言。 */ }
    }, fixedTime);
    await use(context);
  },
});
