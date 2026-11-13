import { expect, test } from './helpers/test';
import { seedNightSeal, nightSealStored } from './helpers/nightSeal';

// One navigation smoke only: no send, stage execution or settlement is requested.
test('#125 兼容：车票主按钮进入存档，#120 双层非模态工作流与行动输入共存', async ({ page }) => {
  let postCalls = 0;
  await page.route('**/*', route => {
    if (route.request().method() === 'POST') { postCalls++; return route.abort('blockedbyclient'); }
    return route.continue();
  });
  await seedNightSeal(page);
  await expect(page.locator('.mobile-home')).toBeVisible();
  await page.evaluate(async () => {
    const configPath='/src/services/ai/configuration.ts', vaultPath='/src/services/ai/credentials.ts';
    const { defaultAiConfig, newChannel, saveAiConfig }=await import(configPath), { CredentialVault }=await import(vaultPath);
    const config=defaultAiConfig(), channel=newChannel();
    channel.baseUrl='https://pr125-compatibility.mock.invalid/v1'; config.channels=[channel];
    config.routes.story={channelId:channel.id,modelId:'story'};
    for(const stage of ['variables','world','memory']) config.routes[stage]={mode:'independent',channelId:channel.id,modelId:stage};
    saveAiConfig(localStorage,config);
    new CredentialVault(sessionStorage,localStorage).set(channel.id,'test-only-placeholder');
  });
  await page.locator('.mh-primary').click();
  await expect(page).toHaveURL(/#game\/save-a$/);
  await expect(page.getByTestId('story-reader')).toBeVisible();
  const before=await nightSealStored(page);
  const trigger=page.locator('.workflow-toggle'); await trigger.click();
  const drawer=page.getByRole('dialog',{name:'三阶段工作流',exact:true});
  const panel=drawer.getByRole('region',{name:'三阶段详情',exact:true});
  await expect(drawer).toBeVisible(); await expect(drawer).toHaveAttribute('aria-modal','false');
  expect(await drawer.evaluate(element=>element.tagName==='DIALOG'||element.matches(':modal'))).toBe(false);
  await expect(panel).toHaveAttribute('data-level','home');
  await expect(panel.getByRole('navigation',{name:'三阶段导航'}).locator('.workflow-stages').getByRole('button')).toHaveCount(3);
  await panel.getByRole('navigation',{name:'三阶段导航'}).getByRole('button',{name:/正文生成/}).click();
  await expect(panel).toHaveAttribute('data-level','detail');
  await panel.getByRole('button',{name:'返回三阶段列表',exact:true}).click();
  await expect(panel).toHaveAttribute('data-level','home');
  const input=page.getByLabel('你的行动',{exact:true}), send=page.getByRole('button',{name:'发送',exact:true});
  await input.click(); await page.keyboard.type('观察江边，不提交行动');
  await expect(input).toBeFocused(); await expect(input).toHaveValue('观察江边，不提交行动');
  await expect(send).toBeEnabled(); await expect(drawer).toBeVisible();
  await drawer.getByRole('button',{name:'收起三阶段详情',exact:true}).click();
  await expect(drawer).toHaveCount(0); await expect(trigger).toBeFocused();
  await input.click(); await expect(input).toBeEditable(); await expect(send).toBeEnabled();
  await page.keyboard.press('Tab'); await expect(send).toBeFocused();
  expect((await nightSealStored(page)).state).toEqual(before.state);
  expect(postCalls).toBe(0);
});
