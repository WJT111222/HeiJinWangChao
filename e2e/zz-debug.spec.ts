// 临时排查用，不合并。
import { test } from './helpers/test';
import { setup, plan, send, calls } from './helpers/actionRecovery';
test('debug action-recovery 500', async ({ page }) => {
  page.on('console', (m) => console.log('PAGE', m.type(), m.text().slice(0, 500)));
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 800)));
  await setup(page, true, 30);
  await page.evaluate(() => {
    const f = window.fetch;
    window.fetch = async (input, init) => {
      const w = window as unknown as Record<string, unknown>;
      if (String(input).includes('mock.invalid')) w.__body = String(init?.body).slice(0, 4000);
      try { return await f(input, init); } catch (e) { w.__err = String((e as Error)?.stack ?? e); throw e; }
    };
  });
  await plan(page, '500');
  await send(page);
  await page.waitForTimeout(5000);
  const w = (k: string) => page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], k);
  console.log('CALLS', JSON.stringify(await calls(page)));
  console.log('ERR', await w('__err'));
  console.log('BODY', await w('__body'));
  console.log('WORKFLOW', await page.locator('.workflow-summary').innerText().catch(() => '(none)'));
  await page.locator('.workflow-summary').click().catch(() => undefined);
  console.log('ALERTS', JSON.stringify(await page.getByRole('alert').allTextContents()));
});
