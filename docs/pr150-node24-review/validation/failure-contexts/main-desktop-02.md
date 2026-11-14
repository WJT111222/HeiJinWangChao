# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: story-runtime.spec.ts >> P6：截断请求不保存正文，明确预算诊断；失败重试无原生输出依然成功
- Location: e2e/story-runtime.spec.ts:341:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('.stage-responses').getByText('供应商公开返回的原生内容', { exact: true })

```

# Page snapshot

```yaml
- main [ref=f1e2]:
  - generic "城市与当前场景" [ref=f1e3]:
    - generic [ref=f1e4]:
      - generic [aria-hidden] [ref=f1e5]: 黑
      - generic [ref=f1e6]:
        - heading "重庆" [level=1] [ref=f1e7]
        - generic "CHONGQING · 山城" [ref=f1e8]
    - generic [ref=f1e9]:
      - generic "重庆" [ref=f1e10]: 当前地点
      - generic "2026/10/18 星期日 08:00" [ref=f1e13]:
        - time [ref=f1e14]: 08:00
        - generic [ref=f1e15]:
          - generic [ref=f1e16]: 2026/10/18 星期日
          - generic [ref=f1e17]: 早晨
      - generic [ref=f1e18]:
        - button "查看天气详情" [ref=f1e19] [cursor=pointer]:
          - generic [aria-hidden] [ref=f1e20]: 晴
          - generic [ref=f1e21]: 天气
          - generic [ref=f1e22]: 天气待确认
        - button "查看环境详情" [ref=f1e23] [cursor=pointer]:
          - generic [aria-hidden] [ref=f1e24]: 境
          - generic [ref=f1e25]: 环境
          - generic [ref=f1e26]: 环境待确认
  - complementary "主角信息" [ref=f1e27]:
    - generic [ref=f1e28]:
      - generic [aria-hidden] [ref=f1e29]: 正
      - generic [ref=f1e30]:
        - heading "正文测试角色" [level=2] [ref=f1e31]
        - paragraph [ref=f1e32]: 30 岁 · 女性 · 教师
    - paragraph [ref=f1e33]: 资金
    - generic [ref=f1e34]:
      - generic [ref=f1e35]:
        - generic [ref=f1e36]: 现金
        - strong [ref=f1e37]: 未确认
      - generic [ref=f1e38]:
        - generic [ref=f1e39]: 线上资金
        - strong [ref=f1e40]: 未确认
    - paragraph [ref=f1e41]: 状态
    - generic [ref=f1e42]:
      - generic "待开局确认" [ref=f1e43]:
        - generic [ref=f1e44]: 身体
        - text: 待开局确认
      - generic "待开局确认" [ref=f1e45]:
        - generic [ref=f1e46]: 情绪
        - text: 待开局确认
    - region "当前穿戴与装备" [ref=f1e47]:
      - paragraph [ref=f1e48]: 当前穿戴与装备
      - generic [ref=f1e49]:
        - generic [ref=f1e50]:
          - term [ref=f1e51]: 上衣
          - definition [ref=f1e52]: 无
        - generic [ref=f1e53]:
          - term [ref=f1e54]: 下装
          - definition [ref=f1e55]: 无
        - generic [ref=f1e56]:
          - term [ref=f1e57]: 鞋子
          - definition [ref=f1e58]: 无
        - generic [ref=f1e59]:
          - term [ref=f1e60]: 饰品
          - definition [ref=f1e61]: 无
        - generic [ref=f1e62]:
          - term [ref=f1e63]: 主武器
          - definition [ref=f1e64]: 无
        - generic [ref=f1e65]:
          - term [ref=f1e66]: 副武器
          - definition [ref=f1e67]: 无
        - generic [ref=f1e68]:
          - term [ref=f1e69]: 载具
          - definition [ref=f1e70]: 无
    - generic [ref=f1e71]:
      - button "人物档案" [ref=f1e72] [cursor=pointer]
      - button "经济与资产" [ref=f1e73] [cursor=pointer]
  - region "剧情与行动" [ref=f1e74]:
    - generic "正文阅读区域" [ref=f1e75]:
      - generic [ref=f1e76]:
        - generic [ref=f1e77]: THE STORY
        - generic [ref=f1e78]: 已保存草稿
      - article [ref=f1e79]:
        - generic [ref=f1e80]:
          - generic [aria-hidden] [ref=f1e81]:
            - generic [ref=f1e82]: "1"
            - generic [ref=f1e83]:
              - generic [ref=f1e84]: 第一回
              - generic [ref=f1e85]: TURN 001
          - heading "第 1 回合" [level=2] [ref=f1e92]
          - generic [aria-hidden] [ref=f1e93]: 十月十八日 · 星期日 · 八时整 · 重庆 · 草稿
        - generic [ref=f1e94]: 正文草稿 · 世界状态尚未确认
        - paragraph [ref=f1e96]: 公交车在街边缓缓停下。 行人沿着站台散开，你仍站在原地。
      - generic "行动建议" [ref=f1e97]:
        - paragraph [ref=f1e98]: 接下来你想做什么
        - button "看看站台" [ref=f1e99] [cursor=pointer]:
          - generic [aria-hidden] [ref=f1e100]: "01"
          - generic [aria-hidden] [ref=f1e102]: →
        - button "留在原地" [ref=f1e103] [cursor=pointer]:
          - generic [aria-hidden] [ref=f1e104]: "02"
          - generic [aria-hidden] [ref=f1e106]: →
        - button "询问路线" [ref=f1e107] [cursor=pointer]:
          - generic [aria-hidden] [ref=f1e108]: "03"
          - generic [aria-hidden] [ref=f1e110]: →
    - generic [ref=f1e111]:
      - region "三阶段工作流" [ref=f1e113]:
        - generic [ref=f1e114]:
          - generic [ref=f1e115]:
            - status [ref=f1e116]: 三阶段 · 等待继续 · 部分已完成
            - generic [ref=f1e117]:
              - button "01 正文 · 已完成" [ref=f1e118] [cursor=pointer]:
                - generic [ref=f1e120]:
                  - generic [ref=f1e121]: "01"
                  - text: 正文
                  - emphasis [ref=f1e122]: · 已完成
              - button "02 变量 · 待生成" [ref=f1e123] [cursor=pointer]:
                - generic [ref=f1e125]:
                  - generic [ref=f1e126]: "02"
                  - text: 变量
                  - emphasis [ref=f1e127]: · 待生成
              - button "03 动态世界 · 待生成" [ref=f1e128] [cursor=pointer]:
                - generic [ref=f1e130]:
                  - generic [ref=f1e131]: "03"
                  - text: 动态世界
                  - emphasis [ref=f1e132]: · 待生成
            - button "详情" [expanded] [ref=f1e133] [cursor=pointer]
          - region "三阶段详情" [ref=f1e134]:
            - generic [ref=f1e135]:
              - generic [ref=f1e137]:
                - generic [ref=f1e138]: THREE STAGES · 三阶段
                - heading "等待继续 · 部分已完成" [level=3] [ref=f1e139]
              - button "收起三阶段详情" [ref=f1e140] [cursor=pointer]: ×
            - generic [ref=f1e141]:
              - navigation "三阶段导航" [ref=f1e142]:
                - paragraph [ref=f1e143]: STAGES
                - list [ref=f1e144]:
                  - listitem [ref=f1e145]:
                    - button "01正文生成 已完成" [ref=f1e146] [cursor=pointer]:
                      - generic [aria-hidden] [ref=f1e147]: ✓
                      - strong [ref=f1e148]:
                        - generic [ref=f1e149]: "01"
                        - text: 正文生成
                      - generic [ref=f1e150]: 已完成
                  - listitem [ref=f1e151]:
                    - button "02变量管理 待生成" [ref=f1e152] [cursor=pointer]:
                      - strong [ref=f1e154]:
                        - generic [ref=f1e155]: "02"
                        - text: 变量管理
                      - generic [ref=f1e156]: 待生成
                    - generic "变量管理阶段开关" [ref=f1e157]:
                      - checkbox "变量管理" [checked] [ref=f1e158] [cursor=pointer]
                  - listitem [ref=f1e159]:
                    - button "03动态世界 待生成" [ref=f1e160] [cursor=pointer]:
                      - strong [ref=f1e162]:
                        - generic [ref=f1e163]: "03"
                        - text: 动态世界
                      - generic [ref=f1e164]: 待生成
                    - generic "动态世界阶段开关" [ref=f1e165]:
                      - checkbox "动态世界" [checked] [ref=f1e166] [cursor=pointer]
                - paragraph [ref=f1e167]: 本回合
                - list [ref=f1e168]:
                  - listitem [ref=f1e169]:
                    - button "运行诊断 错误与用量 错误 1 条" [ref=f1e170] [cursor=pointer]:
                      - generic [aria-hidden] [ref=f1e171]: 诊
                      - strong [ref=f1e172]: 运行诊断
                      - generic [ref=f1e173]: 错误与用量
                      - generic "错误 1 条" [ref=f1e174]: "1"
                  - listitem [ref=f1e175]:
                    - button "已绑定输入 只读" [ref=f1e176] [cursor=pointer]:
                      - generic [aria-hidden] [ref=f1e177]: 述
                      - strong [ref=f1e178]: 已绑定输入
                      - generic [ref=f1e179]: 只读
              - region "正文生成详情" [ref=f1e181]:
                - generic [ref=f1e182]:
                  - generic [ref=f1e183]:
                    - text: STAGE 01 · STORY
                    - heading "正文生成 已完成" [level=4] [ref=f1e184]:
                      - text: 正文生成
                      - generic [ref=f1e185]: 已完成
                  - generic [ref=f1e186]: 正文生成位于行动输入旁。
                - tablist "正文生成内容" [ref=f1e188]:
                  - tab "概览" [ref=f1e189] [cursor=pointer]
                  - tab "模型原文" [active] [selected] [ref=f1e190] [cursor=pointer]
                  - tab "校验结果" [ref=f1e191] [cursor=pointer]
                - tabpanel "模型原文" [ref=f1e192]:
                  - region "模型原文" [ref=f1e193]:
                    - heading "正文模型原文（临时响应）" [level=5] [ref=f1e194]
                    - textbox "正文模型完整原文" [ref=f1e195]: "<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>【旁白】公交车在街边缓缓停下。 行人沿着站台散开，你仍站在原地。</正文><短期记忆>等车</短期记忆><变量规划>[{\"group\":\"time\",\"observedFact\":\"内部指导绝不进入阅读区\"}]</变量规划><行动选项>看看站台 留在原地 询问路线</行动选项>"
                    - paragraph [ref=f1e196]: 仅本页面临时保存，刷新或淘汰后无法恢复；模型原文不等于已执行结果。不会写入正式世界或剧情历史，不会发起请求。系统凭证会隐藏。
            - generic [ref=f1e197]:
              - generic [ref=f1e198]:
                - button "继续未完成阶段" [ref=f1e199] [cursor=pointer]
                - generic [ref=f1e200]: 从第一个未完成的阶段继续
              - generic [ref=f1e201]: 生成可能产生费用。
      - generic [ref=f1e202]:
        - button "撤回" [disabled] [ref=f1e205]
        - generic [ref=f1e206]: 你的行动
        - textbox "你的行动" [ref=f1e207]:
          - /placeholder: 填写你的行动；发送后生成三阶段并自动结算
        - generic [ref=f1e208]:
          - button "发送" [disabled] [ref=f1e209]
          - generic [ref=f1e210]: Ctrl + Enter
  - complementary "世界资料" [ref=f1e211]:
    - heading "世界资料" [level=2] [ref=f1e212]
    - navigation "世界资料分类" [ref=f1e213]:
      - button "NPC" [ref=f1e214] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e215]: 人
      - button "势力组织" [ref=f1e217] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e218]: 势
      - button "地图" [ref=f1e220] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e221]: 图
      - button "物品栏" [ref=f1e223] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e224]: 物
      - button "世界事件" [ref=f1e226] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e227]: 事
      - button "历史时间轴" [ref=f1e229] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e230]: 史
      - button "记忆" [ref=f1e232] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e233]: 忆
    - navigation "系统操作" [ref=f1e235]:
      - button "设置" [ref=f1e236] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e237]: 设
      - button "返回首页" [ref=f1e239] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e240]: 归
```

# Test source

```ts
  249 | test('快速重复点击、取消重试、迟到请求与切档隔离、刷新保留空草稿', async ({ page }) => {
  250 |   const before = await seed(page); plans.push({ delay: 1500 });
  251 |   await page.getByRole('button', { name: '生成开局正文', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  252 |   await expect.poll(() => requests.length).toBe(1);
  253 |   await page.getByRole('button', { name: '取消生成', exact: true }).click();
  254 |   expect((await stored(page)).draft.story).toBeUndefined();
  255 |   plans.push({ delay: 1500 }); await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  256 |   await expect.poll(() => requests.length).toBe(2); await goHome(page);
  257 |   await page.locator('.save-card').filter({ hasText: '另一个存档角色' }).getByRole('button', { name: /读取存档/ }).click(); await openGameTools(page, true);
  258 |   await page.getByRole('button', { name: '生成开局正文', exact: true }).click(); await generated(page);
  259 |   expect((await stored(page)).draft.story).toBeUndefined(); expect((await stored(page, 'story-e2e-b')).draft.storyRevision).toBe(1); expect((await stored(page)).state).toBe(before);
  260 |   await page.goto('/#game/story-e2e-a'); await openGameTools(page);
  261 |   plans.push({ delay: 1200 }); await page.getByRole('button', { name: '生成开局正文', exact: true }).click(); await expect.poll(() => requests.length).toBe(4);
  262 |   await page.reload(); await openGameTools(page); expect((await stored(page)).draft.story).toBeUndefined();
  263 |   await page.getByRole('button', { name: '生成开局正文', exact: true }).click(); await generated(page);
  264 | });
  265 | test('已有 regular 草稿生成正确模式，没有草稿时不自动创建下一回合', async ({ page }) => {
  266 |   const before = await seed(page, 'regular');
  267 |   await page.getByLabel('你的行动').fill('编辑文本不会替换绑定输入');
  268 |   await page.getByRole('button', { name: '生成本回合正文', exact: true }).click();
  269 |   await generated(page);
  270 |   expect(JSON.stringify(requests[0])).toContain('绑定的本回合行动');
  271 |   expect(JSON.stringify(requests[0])).not.toContain('编辑文本不会替换绑定输入');
  272 |   expect((await stored(page)).draft.story.turnKind).toBe('regular');
  273 |   expect((await stored(page)).state).toBe(before);
  274 |   await page.evaluate(async () => {
  275 |     const path = '/src/services/storage/saveRepository.ts';
  276 |     const { SaveRepository } = await import(path);
  277 |     const repo = await SaveRepository.open();
  278 |     const draft = await repo.loadDraft('story-e2e-a');
  279 |     await repo.deleteDraft('story-e2e-a', draft.draftRevision);
  280 |     repo.close();
  281 |   });
  282 |   await page.reload(); await openGameTools(page);
  283 |   await expect(page.getByText(/没有可执行的回合草稿/)).toBeVisible();
  284 |   await expect(page.getByRole('button', { name: '生成开局正文', exact: true })).toBeDisabled();
  285 |   expect((await stored(page)).draft).toBeUndefined();
  286 |   expect(requests).toHaveLength(1);
  287 | });
  288 | test('长篇流式阅读自动跟随、手动上滚暂停、恢复跟随，移动端无横向溢出', async ({ page }) => {
  289 |   await seed(page);
  290 |   const long = '【旁白】雨落在站台上，行人安静等候。\n\n'.repeat(140);
  291 |   plans.push({
  292 |     chunks: [
  293 |       '<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>' + long,
  294 |       '新到的车辆停在站台旁。',
  295 |       '</正文><短期记忆>等候</短期记忆><变量规划>[]</变量规划><行动选项>看看站台\n留在原地\n询问路线</行动选项>',
  296 |     ],
  297 |     gap: 900,
  298 |   });
  299 |   await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  300 |   const reader = page.getByTestId('story-reader');
  301 |   await expect(reader).toContainText('雨落在站台');
  302 |   await expect.poll(() => reader.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  303 |   await reader.evaluate((el) => {
  304 |     el.scrollTop = 0;
  305 |     el.dispatchEvent(new Event('scroll'));
  306 |   });
  307 |   await expect(page.getByRole('button', { name: '跟随最新正文 ↓', exact: true })).toBeVisible();
  308 |   await expect(reader).toContainText('新到的车辆');
  309 |   expect(await reader.evaluate((el) => el.scrollTop)).toBe(0);
  310 |   await page.getByRole('button', { name: '跟随最新正文 ↓', exact: true }).click();
  311 |   await expect.poll(() => reader.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  312 |   await generated(page);
  313 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  314 |   await expect(reader).not.toContainText('变量规划');
  315 | });
  316 | 
  317 | 
  318 | test('P6：完整文本与原生思考在统一原文查看，正文/存档隔离，刷新清除临时资料', async ({ page }) => {
  319 |   const before = await seed(page);
  320 |   plans.push({ reasoning: '公开原生标记 mock-browser-key', chunks: [result().replace('本轮创作提纲：保持人物与场景连续，按行动呈现事实。', '私人规划标记，不是正文事实。')] });
  321 |   await page.getByRole('button', { name: '生成开局正文', exact: true }).click(); await generated(page);
  322 |   const reader = page.getByTestId('story-reader'); await expect(reader).toContainText(displayedStory);
  323 |   await expect(reader).not.toContainText('私人规划标记'); await expect(reader).not.toContainText('公开原生标记');
  324 |   const inspection = page.locator('.wf-raw'); await expect(inspection.locator('pre')).toHaveCount(0);
  325 |   const saved = await stored(page); expect(saved.state).toBe(before); expect(JSON.stringify(saved.draft)).not.toContain('私人规划标记');
  326 |   await openStoryInspection(page);
  327 |   await expect(inspection.getByRole('textbox', { name: '正文模型完整原文', exact: true })).toHaveValue(/<thinking>私人规划标记/);
  328 |   await expect(inspection.getByRole('textbox', { name: '正文模型完整原文', exact: true })).toHaveValue(/公开原生标记/);
  329 |   await expect(inspection.locator('textarea')).toHaveCount(1);
  330 |   await expect(inspection.getByLabel('供应商公开原生思考全文', { exact: true })).toHaveCount(0);
  331 |   await expect(inspection).not.toContainText('mock-browser-key'); expect(await stored(page)).toEqual(saved); expect(requests).toHaveLength(1);
  332 |   const messages = requests[0].messages as { role: string; content: string }[];
  333 |   expect(messages.slice(-3).map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
  334 |   expect(messages.filter((message) => message.content.includes('### Step 0｜'))).toHaveLength(1);
  335 |   await page.reload(); await openGameTools(page); await openStoryInspection(page);
  336 |   await expect(inspection).toContainText('没有可恢复的模型原文'); await expect(reader).toContainText(displayedStory);
  337 |   expect(await stored(page)).toEqual(saved); expect(requests).toHaveLength(1);
  338 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  339 | });
  340 | 
  341 | test('P6：截断请求不保存正文，明确预算诊断；失败重试无原生输出依然成功', async ({ page }) => {
  342 |   await seed(page); const saved = await stored(page);
  343 |   plans.push({ reasoning: '只有临时原生内容', finishReason: 'length', chunks: ['<thinking>长规划尚未结束'] });
  344 |   await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  345 |   await expect(page.getByRole('alert')).toContainText('达到输出上限'); expect(await stored(page)).toEqual(saved); expect(requests).toHaveLength(1);
  346 |   plans.push({}); await page.getByRole('button', { name: '生成开局正文', exact: true }).click(); await generated(page);
  347 |   expect((await stored(page)).draft.storyRevision).toBe(1); expect(requests).toHaveLength(2);
  348 |   const inspection = await openStoryInspection(page);
> 349 |   await inspection.getByText('供应商公开返回的原生内容', { exact: true }).click(); await expect(inspection).toContainText('供应商未提供');
      |                                                               ^ Error: locator.click: Test timeout of 30000ms exceeded.
  350 | });
  351 | 
  352 | test('Story精确诊断：1268/1500字符直接可见，可复制单条，原文仍可查看且不自动重试', async ({ page }) => {
  353 |   await seed(page);
  354 |   await page.evaluate(async () => {
  355 |     const path = '/src/ui/settings/model.ts', { settingsKey } = await import(path);
  356 |     const value = JSON.parse(localStorage.getItem(settingsKey)!); value.prompts.minNarrativeChars = 1500;
  357 |     localStorage.setItem(settingsKey, JSON.stringify(value));
  358 |   });
  359 |   // Reload settings; clipboard is installed after reload so it remains a deterministic browser Mock.
  360 |   await page.reload(); await openGameTools(page);
  361 |   await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { Reflect.set(window, 'copiedStoryDiagnostic', value); } } }); });
  362 |   const before = await stored(page), raw = result('字'.repeat(1268)); plans.push({ chunks: [raw] });
  363 |   await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  364 |   const alert = page.getByRole('alert'); await expect(alert).toContainText('正文长度不足');
  365 |   await expect(alert).toContainText('1268 字符'); await expect(alert).toContainText('1500 字符'); await expect(alert).toContainText('本次正文未保存');
  366 |   const log = page.getByTestId('runtime-log'); await expect(log).toContainText('narrative_short');
  367 |   await openWorkflowDiagnostics(page); await log.getByRole('button', { name: '复制此条' }).click(); await expect(log).toContainText('已复制此条错误日志');
  368 |   const copied = JSON.parse(await page.evaluate(() => Reflect.get(window, 'copiedStoryDiagnostic')));
  369 |   expect(copied).toMatchObject({ stage: 'story', code: 'invalid_output', storyRule: 'narrative_short', actualCount: 1268, minimumCount: 1500 });
  370 |   expect(JSON.stringify(copied)).not.toContain('字'.repeat(20)); expect(JSON.stringify(copied)).not.toContain('mock-browser-key');
  371 |   await expect(await openStageRaw(page, 'story')).toContainText('未通过验收');
  372 |   await expect(page.locator('.stage-responses')).toContainText('正文长度不足');
  373 |   expect(await page.getByLabel('正文模型完整原文').textContent()).toBe(raw);
  374 |   expect(await stored(page)).toEqual(before); expect(requests).toHaveLength(1);
  375 |   await page.reload(); await openGameTools(page); expect(await stored(page)).toEqual(before); expect(requests).toHaveLength(1);
  376 | });
  377 | 
  378 | test('Story标签与变量规划诊断分别定位；只有玩家明确重试才再次请求，合法原协议仍成功', async ({ page }) => {
  379 |   await seed(page); const before = await stored(page);
  380 |   const cases = [
  381 |     [result().replace(/<正文>.*?<\/正文>/s, ''), 'tag_missing', '标签：<正文>'],
  382 |     [result().replace('</正文>', ''), 'tag_unclosed', '未闭合'],
  383 |     [result().replace('本轮创作提纲：保持人物与场景连续，按行动呈现事实。', ' '), 'planning_empty', '正文规划区块为空'],
  384 |     [result().replace('等车</短期记忆>', ' </短期记忆>'), 'summary_empty', '<短期记忆> 内容为空'],
  385 |     [result().replace(/<变量规划>.*?<\/变量规划>/s, '<变量规划>[private-game-detail</变量规划>'), 'guide_json', '不是合法 JSON'],
  386 |     [result().replace(/<变量规划>.*?<\/变量规划>/s, '<变量规划>[{"group":"npc","observedFact":42}]</变量规划>'), 'story_schema', 'variableGuide.0.observedFact'],
  387 |     [result().replace('看看站台\n留在原地\n询问路线', '等候\n离开'), 'actions_count', '实际：2 条'],
  388 |   ];
  389 |   for (const [index, [raw, rule, message]] of cases.entries()) {
  390 |     plans.push({ chunks: [raw] }); await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  391 |     await expect(page.getByRole('alert')).toContainText(message);
  392 |     const latest = page.getByTestId('runtime-log').locator('li').first(); await expect(latest).toContainText(rule);
  393 |     await expect(latest).not.toContainText('private-game-detail'); await expect(latest).not.toContainText('mock-browser-key');
  394 |     expect(await stored(page)).toEqual(before); expect(requests).toHaveLength(index + 1);
  395 |   }
  396 |   plans.push({}); await page.getByRole('button', { name: '生成开局正文', exact: true }).click(); await generated(page);
  397 |   expect((await stored(page)).draft.story.narrative).toBe(story); expect((await stored(page)).state).toBe(before.state); expect(requests).toHaveLength(cases.length + 1);
  398 | });
  399 | 
  400 | test('Story后置凭证拒绝同步到原文面板，诊断与原文均不泄露密钥', async ({ page }) => {
  401 |   await seed(page); const before = await stored(page);
  402 |   plans.push({ chunks: [result(story + 'mock-browser-key')] }); await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  403 |   await expect(page.getByRole('alert')).toContainText('模型输出包含凭证内容');
  404 |   const log = page.getByTestId('runtime-log'); await expect(log).toContainText('credential_output'); await expect(log).not.toContainText('mock-browser-key');
  405 |   const panel = await openStageRaw(page, 'story'); await expect(panel).toContainText('未通过验收'); await expect(panel).toContainText('credential_output'); await expect(panel).not.toContainText('mock-browser-key');
  406 |   await expect(panel.getByText('正文程序校验后的结果', { exact: true })).toHaveCount(0);
  407 |   expect(await stored(page)).toEqual(before); expect(requests).toHaveLength(1);
  408 | });
  409 | 
  410 | test('Story保存版本冲突保留原DataError处理，原文面板显示具体失败而非校验成功', async ({ page }) => {
  411 |   await seed(page); const before = await stored(page);
  412 |   await page.evaluate(async () => {
  413 |     const repoPath = '/src/services/storage/saveRepository.ts', errorPath = '/src/domain/common.ts';
  414 |     const [{ SaveRepository }, { DataError }] = await Promise.all([import(repoPath), import(errorPath)]);
  415 |     SaveRepository.prototype.saveDraft = async () => { throw new DataError('DRAFT_CONFLICT', 'private-storage-detail'); };
  416 |   });
  417 |   await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  418 |   await expect(page.getByRole('alert')).toContainText('存档或草稿版本已变化');
  419 |   await expect(page.getByTestId('runtime-log')).toContainText('draft_conflict');
  420 |   await expect(page.getByTestId('runtime-log')).not.toContainText('private-storage-detail');
  421 |   await expect(await openStageRaw(page, 'story')).toContainText('未通过验收');
  422 |   await expect(page.locator('.stage-responses')).toContainText('draft_conflict');
  423 |   expect(await stored(page)).toEqual(before); expect(requests).toHaveLength(1);
  424 | });
  425 | 
```