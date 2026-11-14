# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: story-runtime.spec.ts >> Story标签与变量规划诊断分别定位；只有玩家明确重试才再次请求，合法原协议仍成功
- Location: e2e/story-runtime.spec.ts:378:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: '正文测试角色' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('heading', { name: '正文测试角色' }) with timeout 5000ms
  - waiting for getByRole('heading', { name: '正文测试角色' })

```

```yaml
- banner:
  - button "打开游戏菜单": ☰
- main:
  - button "此时此地与主角状态":
    - text: 重庆 重庆
    - time: 08:00
    - text: —
  - text: 重庆，2026/10/18 星期日 08:00，天气：天气待确认
  - region "剧情与行动":
    - text: THE STORY 等待开局
    - paragraph: A CITY. A TURNING POINT.
    - heading "故事，尚未落笔。" [level=1]
    - paragraph: 你的资料已保存。 配置 AI 渠道后，即可生成这座城市中的第一幕。
    - paragraph: 行动建议将在正文生成后显示。
    - region "三阶段工作流":
      - button "三阶段工作流详情" [expanded]:
        - status: 三阶段 · 等待开始
        - text: 详情 ›
    - button "回合操作": ⋯
    - text: 你的行动
    - textbox "你的行动":
      - /placeholder: 填写你的行动
    - button "发送" [disabled]
  - navigation "底部导航":
    - button "故事"
    - button "人物"
    - button "世界资料"
    - button "设置"
- button "收起工作流暗区"
- dialog "三阶段工作流":
  - button "收起三阶段工作流"
  - button "行动输入"
  - region "三阶段详情":
    - text: THREE STAGES · 三阶段
    - heading "等待开始" [level=3]
    - button "收起三阶段详情": ×
    - navigation "三阶段导航":
      - paragraph: STAGES
      - list:
        - listitem:
          - button "01正文生成 待生成":
            - strong: 01正文生成
            - text: 待生成
        - listitem:
          - button "02变量管理 待生成":
            - strong: 02变量管理
            - text: 待生成
          - checkbox "变量管理" [checked]
        - listitem:
          - button "03动态世界 待生成":
            - strong: 03动态世界
            - text: 待生成
          - checkbox "动态世界" [checked]
      - paragraph: 本回合
      - list:
        - listitem:
          - button "运行诊断 错误与用量":
            - strong: 运行诊断
            - text: 错误与用量
        - listitem:
          - button "已绑定输入 只读":
            - strong: 已绑定输入
            - text: 只读
    - button "自动生成开局"
    - text: 生成可能产生费用。
```

# Test source

```ts
  48  |       const chunks = plan.chunks ?? [result()];
  49  |       if (plan.reasoning) response.write('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: plan.reasoning } }] }) + '\n\n');
  50  |       let index = 0;
  51  |       function send() {
  52  |         if (response.destroyed) return;
  53  |         if (index === chunks.length) {
  54  |           response.end(
  55  |             'data: ' +
  56  |               JSON.stringify({
  57  |                 choices: plan.finishReason ? [{ delta: {}, finish_reason: plan.finishReason }] : [],
  58  |                 usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
  59  |               }) +
  60  |               '\n\ndata: [DONE]\n\n',
  61  |           );
  62  |           return;
  63  |         }
  64  |         response.write(
  65  |           'data: ' +
  66  |             JSON.stringify({ choices: [{ delta: { content: chunks[index++] } }] }) +
  67  |             '\n\n',
  68  |         );
  69  |         later(send, plan.gap ?? 15);
  70  |       }
  71  |       send();
  72  |     }, plan.delay ?? 0);
  73  |   });
  74  |   await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  75  |   const address = server.address();
  76  |   if (!address || typeof address === 'string') throw new Error('缺少测试端口');
  77  |   baseUrl = `http://127.0.0.1:${address.port}/v1`;
  78  | });
  79  | test.afterEach(async () => {
  80  |   timers.forEach(clearTimeout);
  81  |   timers.clear();
  82  |   server.closeAllConnections();
  83  |   await new Promise<void>((resolve) => server.close(() => resolve()));
  84  | });
  85  | async function seed(page: Page, mode: 'opening' | 'regular' | 'none' = 'opening') {
  86  |   await page.goto('/');
  87  |   const before = await page.evaluate(
  88  |     async ({ baseUrl, mode }) => {
  89  |       const creationPath = '/src/ui/creation/model.ts';
  90  |       const repositoryPath = '/src/services/storage/saveRepository.ts';
  91  |       const settingsPath = '/src/ui/settings/model.ts';
  92  |       const configPath = '/src/services/ai/configuration.ts';
  93  |       const vaultPath = '/src/services/ai/credentials.ts';
  94  |       const draftsPath = '/src/domain/drafts.ts';
  95  |       const orderPath = '/src/prompts/order.ts';
  96  |       const { createProfileSave, newCreation } = await import(creationPath);
  97  |       const { SaveRepository } = await import(repositoryPath);
  98  |       const { defaultSettings, settingsKey } = await import(settingsPath);
  99  |       const { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath);
  100 |       const { CredentialVault } = await import(vaultPath);
  101 |       const { createTurnDraft } = await import(draftsPath);
  102 |       const { savePromptOrder } = await import(orderPath);
  103 |       const settings = defaultSettings();
  104 |       settings.prompts.minNarrativeChars = 10;
  105 |       localStorage.setItem(settingsKey, JSON.stringify(settings));
  106 |       const config = defaultAiConfig(),
  107 |         channel = newChannel();
  108 |       channel.baseUrl = baseUrl;
  109 |       channel.defaultModel = 'browser-story-mock';
  110 |       config.channels = [channel];
  111 |       config.routes.story = { channelId: channel.id, modelId: '' };
  112 |       saveAiConfig(localStorage, config);
  113 |       new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-browser-key');
  114 |       savePromptOrder(localStorage, { 'writing.conflict_pacing': 81, 'writing.emotion_guard': 80 });
  115 |       const form = newCreation();
  116 |       // 此套专门验证既有固定时钟草稿的流式/恢复；新待定开局另有真实创角回归。
  117 |       delete form.openingTimePending;
  118 |       form.worldClock = '2026-10-18T08:00:00+08:00';
  119 |       form.saveId = 'story-e2e-a';
  120 |       form.person = {
  121 |         name: '正文测试角色',
  122 |         age: '30',
  123 |         gender: '女性',
  124 |         appearance: '短发',
  125 |         personality: '冷静',
  126 |       };
  127 |       form.profession = '教师';
  128 |       const repo = await SaveRepository.open();
  129 |       const state = await createProfileSave(repo, form, settings, localStorage);
  130 |       if (mode !== 'opening') {
  131 |         await repo.deleteDraft(state.saveId, 0);
  132 |         if (mode === 'regular')
  133 |           await repo.saveDraft(
  134 |             createTurnDraft(state.saveId, 0, 'existing-regular', 'regular', '绑定的本回合行动'),
  135 |             null,
  136 |           );
  137 |       }
  138 |       form.saveId = 'story-e2e-b';
  139 |       form.person.name = '另一个存档角色';
  140 |       await createProfileSave(repo, form, settings, localStorage);
  141 |       repo.close();
  142 |       return JSON.stringify(state);
  143 |     },
  144 |     { baseUrl, mode },
  145 |   );
  146 |   await page.goto('/#game/story-e2e-a'); await openGameTools(page);
  147 |   await page.reload(); await openGameTools(page);
> 148 |   await expect(page.getByRole('heading', { name: '正文测试角色' })).toBeVisible();
      |                                                               ^ Error: expect(locator).toBeVisible() failed
  149 |   return before;
  150 | }
  151 | async function stored(page: Page, id = 'story-e2e-a') {
  152 |   return page.evaluate(async (id) => {
  153 |     const path = '/src/services/storage/saveRepository.ts';
  154 |     const { SaveRepository } = await import(path);
  155 |     const repo = await SaveRepository.open();
  156 |     try {
  157 |       return { state: JSON.stringify(await repo.load(id)), draft: await repo.loadDraft(id) };
  158 |     } finally {
  159 |       repo.close();
  160 |     }
  161 |   }, id);
  162 | }
  163 | async function generated(page: Page) {
  164 |   await expect(page.getByRole('region', { name: '三阶段工作流' }).locator('.workflow-stages > li').nth(0)).toContainText('已完成');
  165 | }
  166 | test('真实开局流式分片、资料面板不打断、只展示正文，草稿刷新与行动复制、快照统计', async ({
  167 |   page,
  168 | }, info) => {
  169 |   const before = await seed(page);
  170 |   plans.push({
  171 |     chunks: [
  172 |       '<thinking>按真实场景续写，不代替玩家决定。',
  173 |       '</thinking>',
  174 |       '<正',
  175 |       '文>【旁白】公交车',
  176 |       '在街边缓缓停下。\n\n',
  177 |       '行人沿着站台散开，你仍站在原地。<',
  178 |       '/正文><短期记忆>等车</短期记忆><变量',
  179 |       '规划>[{"group":"time","observedFact":"内部指导绝不进入阅读区"}]</变量规划><行动选项>看看站台\n留在原地\n询问路线</行动选项>',
  180 |     ],
  181 |     gap: 200,
  182 |   });
  183 |   await page.getByLabel('你的行动').fill('仅编辑输入，不能覆盖空开局偏好');
  184 |   await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  185 |   await expect(page.getByRole('article', { name: '流式正文预览' })).toContainText('公交车');
  186 |   expect((await stored(page)).draft.story).toBeUndefined();
  187 |   await openGameTools(page);
  188 |   await openWorldArchive(page); await page
  189 |     .getByRole('complementary', { name: '世界资料' })
  190 |     .getByRole('button', { name: /NPC/ })
  191 |     .click();
  192 |   await expect(page.getByRole('dialog', { name: 'NPC', exact: true })).toBeVisible();
  193 |   await page.keyboard.press('Escape');
  194 |   await openGameTools(page);
  195 |   await generated(page);
  196 |   const reader = page.getByTestId('story-reader');
  197 |   await expect(reader).toContainText(displayedStory);
  198 |   await expect(reader).not.toContainText('【旁白】');
  199 |   await expect(reader).not.toContainText('内部指导');
  200 |   await expect(reader).not.toContainText('<正文>');
  201 |   expect(requests).toHaveLength(1);
  202 |   const body = JSON.stringify(requests[0]);
  203 |   expect(body).toContain('PLAYER_ACTION');
  204 |   expect(body).not.toContain('仅编辑输入');
  205 |   expect(body).toContain('开局');
  206 |   const saved = await stored(page);
  207 |   expect(saved.state).toBe(before);
  208 |   expect(saved.draft.userInput).toBe('');
  209 |   expect(saved.draft.story.summary).toBe('等车');
  210 |   expect(saved.draft.story.narrative).toBe(story);
  211 |   expect(saved.draft.storyRevision).toBe(1);
  212 |   if (await page.locator('.workflow-summary').isVisible()) await workflowTrigger(page).click();
  213 |   await page.getByRole('button', { name: '看看站台', exact: true }).click();
  214 |   await expect(page.getByLabel('你的行动')).toHaveValue('看看站台');
  215 |   expect(requests).toHaveLength(1);
  216 |   await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  217 |   await openSettings(page);
  218 |   await page.getByRole('button', { name: '提示词管理', exact: true }).click();
  219 |   await page.getByRole('button', { name: '高级', exact: true }).click();
  220 |   await page.getByRole('combobox', { name: '数据来源', exact: true }).selectOption('actual');
  221 |   const internal = page.getByRole('region', { name: '上下文与统计' });
  222 |   await expect(internal).toContainText('browser-story-mock');
  223 |   await expect(internal).toContainText('stages.opening.story');
  224 |   await expect(internal).toContainText('42');
  225 |   await expect(internal).toContainText('49');
  226 |   await expect(internal).not.toContainText('mock-browser-key');
  227 |   await expect(internal.getByLabel('完整内部上下文')).toHaveCount(0);
  228 |   const order = await internal.locator('li').allTextContents();
  229 |   expect(order.join()).toContain('writing.conflict_pacing');
  230 |   expect(order.findIndex((value) => value.includes('writing.emotion_guard'))).toBeLessThan(
  231 |     order.findIndex((value) => value.includes('writing.conflict_pacing')),
  232 |   );
  233 |   await page.keyboard.press('Escape');
  234 |   await page.reload(); await openGameTools(page);
  235 |   await generated(page);
  236 |   await expect(page.getByTestId('story-reader')).toContainText(displayedStory);
  237 |   expect((await stored(page)).state).toBe(before);
  238 |   await page.screenshot({ path: info.outputPath('story-runtime.png'), fullPage: true });
  239 | });
  240 | test('有效正文草稿没有主动重生成入口，刷新后保持原稿且不请求模型', async ({ page }) => {
  241 |   const before = await seed(page);
  242 |   await page.getByRole('button', { name: '生成开局正文', exact: true }).click(); await generated(page);
  243 |   const saved = await stored(page);
  244 |   await expect(page.getByRole('button', { name: /重新 Roll|重新生成正文/ })).toHaveCount(0);
  245 |   await expect(page.getByRole('button', { name: '生成开局正文', exact: true })).toHaveCount(0);
  246 |   await page.reload(); await openGameTools(page); await generated(page);
  247 |   expect(await stored(page)).toEqual(saved); expect(saved.state).toBe(before); expect(requests).toHaveLength(1);
  248 | });
```