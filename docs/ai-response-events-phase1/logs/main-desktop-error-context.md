# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: candidate-streaming.spec.ts >> world 实时只读、主动公开思考、跟随与复制、完整校验后结算
- Location: e2e/candidate-streaming.spec.ts:94:3

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('button', { name: '完成本回合结算', exact: true }) resolved to 2 elements:
    1) <button class="primary">完成本回合结算</button> aka getByRole('region', { name: '三阶段详情' }).getByRole('button', { name: '完成本回合结算' })
    2) <button data-kind="continue" title="候选已完成，保存本回合结果" class="composer-workflow-action">完成本回合结算</button> aka getByRole('button', { name: '完成本回合结算', description: '候选已完成，保存本回合结果' })

Call log:
  - waiting for getByRole('button', { name: '完成本回合结算', exact: true })

```

# Page snapshot

```yaml
- main [ref=f1e2]:
  - generic "城市与当前场景" [ref=f1e3]:
    - generic [ref=f1e4]:
      - generic [aria-hidden] [ref=f1e5]: 黑
      - generic [ref=f1e6]:
        - heading "城市长夜" [level=1] [ref=f1e7]
        - generic "A CITY. A TURNING POINT." [ref=f1e8]
    - generic [ref=f1e9]:
      - generic "重庆" [ref=f1e10]: 当前地点
      - generic "2026/10/18 星期日 08:10" [ref=f1e13]:
        - time [ref=f1e14]: 08:10
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
      - generic [aria-hidden] [ref=f1e29]: 林
      - generic [ref=f1e30]:
        - heading "林舟" [level=2] [ref=f1e31]
        - paragraph [ref=f1e32]: 30 岁 · 男 · 教师
    - paragraph [ref=f1e33]: 资金
    - generic [ref=f1e34]:
      - generic [ref=f1e35]:
        - generic [ref=f1e36]: 现金
        - strong [ref=f1e37]: 70.00 元
      - generic [ref=f1e38]:
        - generic [ref=f1e39]: 线上资金
        - strong [ref=f1e40]: 200.00 元
    - paragraph [ref=f1e41]: 状态
    - generic [ref=f1e42]:
      - generic "健康" [ref=f1e43]:
        - generic [ref=f1e44]: 身体
        - text: 健康
      - generic "平静" [ref=f1e45]:
        - generic [ref=f1e46]: 情绪
        - text: 平静
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
          - heading "第 1 回合" [level=2] [ref=f1e81]
          - generic [aria-hidden] [ref=f1e82]: 第一回
          - generic [aria-hidden] [ref=f1e83]: 十月十八日 · 星期日 · 八时整 · 重庆
        - paragraph [ref=f1e85]: 经过十分钟，主角完成用餐。主角已经用现金支付30元吃饭。
      - article [ref=f1e86]:
        - generic [ref=f1e87]:
          - heading "第 2 回合" [level=2] [ref=f1e88]
          - generic [aria-hidden] [ref=f1e89]: 第二回
          - generic [aria-hidden] [ref=f1e90]: 十月十八日 · 星期日 · 八时十分 · 重庆 · 草稿
        - generic [ref=f1e91]: 正文草稿 · 世界状态尚未确认
        - paragraph [ref=f1e93]: 经过十分钟，主角完成用餐。主角已经用现金支付30元吃饭。
    - generic [ref=f1e94]:
      - region "三阶段工作流" [ref=f1e96]:
        - generic [ref=f1e97]:
          - generic [ref=f1e98]:
            - status [ref=f1e99]: 三阶段 · 候选已完成 · 等待结算
            - generic [ref=f1e100]:
              - button "01 正文 · 已完成" [ref=f1e101] [cursor=pointer]:
                - generic [ref=f1e103]:
                  - generic [ref=f1e104]: "01"
                  - text: 正文
                  - emphasis [ref=f1e105]: · 已完成
              - button "02 变量 · 已完成" [ref=f1e106] [cursor=pointer]:
                - generic [ref=f1e108]:
                  - generic [ref=f1e109]: "02"
                  - text: 变量
                  - emphasis [ref=f1e110]: · 已完成
              - button "03 动态世界 · 已完成" [ref=f1e111] [cursor=pointer]:
                - generic [ref=f1e113]:
                  - generic [ref=f1e114]: "03"
                  - text: 动态世界
                  - emphasis [ref=f1e115]: · 已完成
            - button "详情" [expanded] [ref=f1e116] [cursor=pointer]
          - region "三阶段详情" [ref=f1e117]:
            - generic [ref=f1e118]:
              - generic [ref=f1e120]:
                - generic [ref=f1e121]: THREE STAGES · 三阶段
                - heading "候选已完成 · 等待结算" [level=3] [ref=f1e122]
              - button "收起三阶段详情" [ref=f1e123] [cursor=pointer]: ×
            - generic [ref=f1e124]:
              - navigation "三阶段导航" [ref=f1e125]:
                - paragraph [ref=f1e126]: STAGES
                - list [ref=f1e127]:
                  - listitem [ref=f1e128]:
                    - button "01正文生成 已完成" [ref=f1e129] [cursor=pointer]:
                      - generic [aria-hidden] [ref=f1e130]: ✓
                      - strong [ref=f1e131]:
                        - generic [ref=f1e132]: "01"
                        - text: 正文生成
                      - generic [ref=f1e133]: 已完成
                  - listitem [ref=f1e134]:
                    - button "02变量管理 已完成" [ref=f1e135] [cursor=pointer]:
                      - generic [aria-hidden] [ref=f1e136]: ✓
                      - strong [ref=f1e137]:
                        - generic [ref=f1e138]: "02"
                        - text: 变量管理
                      - generic [ref=f1e139]: 已完成
                    - generic "变量管理阶段开关" [ref=f1e140]:
                      - checkbox "变量管理" [checked] [ref=f1e141] [cursor=pointer]
                  - listitem [ref=f1e142]:
                    - button "03动态世界 已完成" [active] [ref=f1e143] [cursor=pointer]:
                      - generic [aria-hidden] [ref=f1e144]: ✓
                      - strong [ref=f1e145]:
                        - generic [ref=f1e146]: "03"
                        - text: 动态世界
                      - generic [ref=f1e147]: 已完成
                    - generic "动态世界阶段开关" [ref=f1e148]:
                      - checkbox "动态世界" [checked] [ref=f1e149] [cursor=pointer]
                - paragraph [ref=f1e150]: 本回合
                - list [ref=f1e151]:
                  - listitem [ref=f1e152]:
                    - button "运行诊断 错误与用量" [ref=f1e153] [cursor=pointer]:
                      - generic [aria-hidden] [ref=f1e154]: 诊
                      - strong [ref=f1e155]: 运行诊断
                      - generic [ref=f1e156]: 错误与用量
                  - listitem [ref=f1e157]:
                    - button "已绑定输入 只读" [ref=f1e158] [cursor=pointer]:
                      - generic [aria-hidden] [ref=f1e159]: 述
                      - strong [ref=f1e160]: 已绑定输入
                      - generic [ref=f1e161]: 只读
              - region "动态世界详情" [ref=f1e163]:
                - generic [ref=f1e164]:
                  - generic [ref=f1e165]:
                    - text: STAGE 03 · WORLD
                    - heading "动态世界 已完成 程序校验通过 · 仍未正式结算" [level=4] [ref=f1e166]:
                      - text: 动态世界
                      - generic [ref=f1e167]: 已完成
                      - generic [ref=f1e168]: 程序校验通过 · 仍未正式结算
                  - button "重新生成世界候选" [ref=f1e170] [cursor=pointer]
                - tablist "动态世界内容" [ref=f1e171]:
                  - tab "概览" [selected] [ref=f1e172] [cursor=pointer]
                  - tab [ref=f1e173] [cursor=pointer]:
                    - text: 候选
                    - superscript [ref=f1e174]: "1"
                  - tab "模型原文" [ref=f1e175] [cursor=pointer]
                  - tab "校验结果" [ref=f1e176] [cursor=pointer]
                - tabpanel "概览" [ref=f1e177]:
                  - generic [ref=f1e178]:
                    - paragraph [ref=f1e179]:
                      - generic [ref=f1e180]: "0"
                      - text: 场外命令
                    - paragraph [ref=f1e181]:
                      - generic [ref=f1e182]: "0"
                      - text: 任务
                    - paragraph [ref=f1e183]:
                      - generic [ref=f1e184]: "0"
                      - text: 事件
                    - paragraph [ref=f1e185]:
                      - generic [ref=f1e186]: "1"
                      - text: 未解决事项
                  - generic [ref=f1e187]:
                    - generic [ref=f1e188]:
                      - term [ref=f1e189]: 未来计划
                      - definition [ref=f1e190]: "0"
                    - generic [ref=f1e191]:
                      - term [ref=f1e192]: 线索候选
                      - definition [ref=f1e193]: "0"
                    - generic [ref=f1e194]:
                      - term [ref=f1e195]: 时间轴候选
                      - definition [ref=f1e196]: "0"
                    - generic [ref=f1e197]:
                      - term [ref=f1e198]: 正文版本
                      - definition [ref=f1e199]: "1"
                    - generic [ref=f1e200]:
                      - term [ref=f1e201]: 变量候选版本
                      - definition [ref=f1e202]: "1"
                    - generic [ref=f1e203]:
                      - term [ref=f1e204]: 世界候选版本
                      - definition [ref=f1e205]: "2"
                  - paragraph [ref=f1e206]:
                    - button "查看候选明细 →" [ref=f1e207] [cursor=pointer]
                  - region "本阶段请求 Token 用量" [ref=f1e208]:
                    - generic [ref=f1e209]:
                      - paragraph [ref=f1e210]: 动态世界 · world · 响应已接收本次请求输入：≈ 58,462 Token（估算输入 Token）最大输出设置：8,192
                      - generic [ref=f1e211]: 实际输入：未提供；实际输出：未提供； 实际总量：未提供；思考 Token：未提供
                    - text: 各次请求独立统计；Unicode启发式不含消息包装等协议开销，不是精确计费，不据此阻止请求。完整记录可在AI请求检查中查看。
                  - paragraph [ref=f1e212]: 此处为只读候选。未改变正式人物、经济、任务、时间或历史；线索尚未发布。查看内部结果不会更新任何人物认知。
            - generic [ref=f1e213]:
              - generic [ref=f1e214]:
                - button "完成本回合结算" [ref=f1e215] [cursor=pointer]
                - generic [ref=f1e216]: 正文及已启用阶段的候选均已通过校验
              - generic [ref=f1e217]: 生成可能产生费用。
      - generic [ref=f1e218]:
        - generic [ref=f1e220]:
          - button "撤回" [disabled] [ref=f1e221]
          - button "完成本回合结算" [ref=f1e222] [cursor=pointer]
        - generic [ref=f1e223]: 你的行动
        - textbox "你的行动" [ref=f1e224]:
          - /placeholder: 填写你的行动；发送后生成三阶段并自动结算
          - text: 查看原文时仍可编辑行动
        - generic [ref=f1e225]:
          - button "发送" [ref=f1e226] [cursor=pointer]
          - generic [ref=f1e227]: Ctrl + Enter
      - status [ref=f1e228]: 候选已完成，可点击左侧按钮完成本回合结算；发送新行动将先结算，再绑定下一回合。
  - complementary "世界资料" [ref=f1e229]:
    - heading "世界资料" [level=2] [ref=f1e230]
    - navigation "世界资料分类" [ref=f1e231]:
      - button "NPC" [ref=f1e232] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e233]: 人
      - button "势力组织" [ref=f1e235] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e236]: 势
      - button "地图" [ref=f1e238] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e239]: 图
      - button "物品栏" [ref=f1e241] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e242]: 物
      - button "世界事件" [ref=f1e244] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e245]: 事
      - button "历史时间轴" [ref=f1e247] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e248]: 史
      - button "记忆" [ref=f1e250] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e251]: 忆
    - navigation "系统操作" [ref=f1e253]:
      - button "设置" [ref=f1e254] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e255]: 设
      - button "返回首页" [ref=f1e257] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e258]: 归
```

# Test source

```ts
  39  | }
  40  | async function seed(page: Page, stage: 'variables' | 'world', old = false) {
  41  |   target = stage;
  42  |   await page.goto('/');
  43  |   await page.evaluate(async ({ baseUrl, stage, old }) => {
  44  |     const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts', '/src/ui/settings/model.ts',
  45  |       '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/domain/drafts.ts'];
  46  |     const [{ SaveRepository }, { worldState }, { completeDraft }, { defaultSettings, settingsKey }, { newChannel, defaultAiConfig, saveAiConfig }, { CredentialVault }, { startStageAttempt }] = await Promise.all(paths.map(p => import(p)));
  47  |     const repo = await SaveRepository.open(); await repo.create(worldState());
  48  |     await repo.commitTurn({ draft: await completeDraft(repo), nextAction: '', useVariableStage: true, useWorldStage: true });
  49  |     const full = await completeDraft(repo, { variables: { commands: [{ type: 'SetWorldClock', commandId: 'clock-stream', evidence: '经过十分钟', worldClock: '2026-10-18T08:20:00+08:00' }], rejectedSuggestions: [], unresolved: [] } });
  50  |     await repo.saveDraft(startStageAttempt(full, [stage]), full.draftRevision, undefined, full); repo.close();
  51  |     const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
  52  |     for (const summary of Object.values(settings.memory.summaries) as { automatic: boolean }[]) summary.automatic = false;
  53  |     settings.runtime.streamVariables = true; settings.runtime.streamWorld = true;
  54  |     if (old) { delete (settings.runtime as Partial<typeof settings.runtime>).streamVariables; delete (settings.runtime as Partial<typeof settings.runtime>).streamWorld; settings.runtime.timeoutSeconds = 73; settings.prompts.perspective = 'first'; }
  55  |     localStorage.setItem(settingsKey, JSON.stringify(settings));
  56  |     const channel = newChannel('deepseek'), config = defaultAiConfig(); channel.baseUrl = baseUrl;
  57  |     config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
  58  |     config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
  59  |     config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' }; saveAiConfig(localStorage, config);
  60  |     new CredentialVault(sessionStorage, localStorage).set(channel.id, 'fictional-stream-browser-key', true);
  61  |   }, { baseUrl, stage, old });
  62  |   await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
  63  |   return stored(page);
  64  | }
  65  | async function closeDiagnostics(page: Page) { if (await page.locator('dialog.mobile-diagnostics-sheet[open]').isVisible()) await page.keyboard.press('Escape'); }
  66  | async function closeWorkflow(page: Page) {
  67  |   const close = page.getByRole('button', { name: '收起三阶段详情', exact: true });
  68  |   if (await close.isVisible()) await close.click(); else await workflowTrigger(page).click();
  69  | }
  70  | async function begin(page: Page, stage: 'variables' | 'world', label: string) {
  71  |   active = undefined; await openWorkflowStage(page, stage); await page.getByRole('button', { name: `生成${label}候选`, exact: true }).click();
  72  |   await expect.poll(() => Boolean(active)).toBe(true); expect(calls.at(-1)).toEqual({ model: stage, stream: true });
  73  | }
  74  | 
  75  | test('旧运行设置不重置：两个独立开关默认关闭，显式保存、刷新和未保存取消', async ({ page }, info) => {
  76  |   await seed(page, 'variables', true);
  77  |   const original = await page.evaluate(() => localStorage.getItem('heijin.settings.v1'));
  78  |   await openSettings(page); await page.getByRole('button', { name: '运行', exact: true }).click();
  79  |   const variables = page.getByRole('checkbox', { name: '变量管理 · 流式传输', exact: true }), world = page.getByRole('checkbox', { name: '动态世界 · 流式传输', exact: true });
  80  |   await expect(variables).not.toBeChecked(); await expect(world).not.toBeChecked(); await expect(page.getByLabel('请求超时（秒）')).toHaveValue('73');
  81  |   expect(await page.evaluate(() => localStorage.getItem('heijin.settings.v1'))).toBe(original);
  82  |   await variables.check(); await expect(world).not.toBeChecked(); await page.getByRole('button', { name: '保存本地设置', exact: true }).click();
  83  |   await page.reload(); await openSettings(page); await page.getByRole('button', { name: '运行', exact: true }).click();
  84  |   await expect(variables).toBeChecked(); await expect(world).not.toBeChecked(); await world.check();
  85  |   await page.getByRole('button', { name: '保存本地设置', exact: true }).click(); await page.screenshot({ path: info.outputPath('stream-settings.png') });
  86  |   await page.reload(); await openSettings(page); await page.getByRole('button', { name: '运行', exact: true }).click();
  87  |   await expect(variables).toBeChecked(); await expect(world).toBeChecked(); await variables.uncheck(); await page.reload();
  88  |   const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.settings.v1')!));
  89  |   expect(saved.runtime).toMatchObject({ streamVariables: true, streamWorld: true, timeoutSeconds: 73 }); expect(saved.prompts.perspective).toBe('first'); expect(saved.version).toBe(1); expect(calls).toEqual([]);
  90  | });
  91  | 
  92  | for (const stage of ['variables', 'world'] as const) {
  93  |   const label = stage === 'variables' ? '变量' : '世界', rawLabel = stage === 'variables' ? '变量' : '动态世界';
  94  |   test(`${stage} 实时只读、主动公开思考、跟随与复制、完整校验后结算`, async ({ page }, info) => {
  95  |     const before = await seed(page, stage); await begin(page, stage, label);
  96  |     await page.evaluate(async () => {
  97  |       const p = '/src/services/ai/stageResponses.ts', { stageResponses } = await import(p);
  98  |       const metrics = { publishes: 0, frames: 0, active: true };
  99  |       const unsubscribe = stageResponses.subscribe(() => { metrics.publishes++; });
  100 |       const tick = () => { if (metrics.active) { metrics.frames++; requestAnimationFrame(tick); } }; requestAnimationFrame(tick);
  101 |       (window as unknown as { __streamMetrics: typeof metrics; __stopMetrics: () => void }).__streamMetrics = metrics;
  102 |       (window as unknown as { __stopMetrics: () => void }).__stopMetrics = () => { metrics.active = false; unsubscribe(); };
  103 |     });
  104 |     write({ reasoning_content: '仅主动查看的独立公开思考' });
  105 |     const prefix = stage === 'variables' ? '<thinking>变量规划</thinking><说明>私密变量说明。\n' : '{"unresolved":["私密世界说明。';
  106 |     write({ content: prefix });
  107 |     await expect.poll(() => page.evaluate(async () => { const p = '/src/services/ai/stageResponses.ts'; return (await import(p)).stageResponses.getSnapshot()[0]?.text; })).toBe(prefix);
  108 |     expect(await page.locator('body').textContent()).not.toContain('私密');
  109 |     const pending = await stored(page); expect(pending.state).toEqual(before.state); expect(pending.draft?.[stage]).toBeUndefined();
  110 |     const panel = await openStageRaw(page, stage), box = panel.getByRole('textbox', { name: `${rawLabel}模型完整原文`, exact: true });
  111 |     await expect(panel).toContainText('未完成'); await expect(box).toHaveValue(prefix); await expect(box).toHaveAttribute('readonly', '');
  112 |     expect(await panel.textContent()).not.toContain('仅主动查看的独立');
  113 |     const passage = '长段落中文，供阅读与复制。\n'.repeat(1400);
  114 |     const long = stage === 'world' ? passage.replace(/\n/g, '\\n') : passage;
  115 |     for (let n = 0; n < long.length; n += 200) write({ content: long.slice(n, n + 200) });
  116 |     await expect(box).toHaveValue(prefix + long);
  117 |     expect(await box.evaluate(el => el.scrollTop > 0)).toBe(true);
  118 |     // User reading the beginning must not be dragged down by the next fragment.
  119 |     await box.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  120 |     write({ content: '继续返回。' }); await expect(box).toHaveValue(prefix + long + '继续返回。'); expect(await box.evaluate(el => el.scrollTop)).toBe(0);
  121 |     await box.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('ControlOrMeta+C');
  122 |     expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prefix + long + '继续返回。');
  123 |     await panel.getByLabel(`${rawLabel}原文内容`).selectOption('reasoning'); await expect(panel.getByRole('textbox')).toHaveValue('仅主动查看的独立公开思考');
  124 |     expect(await stored(page)).toEqual(pending); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  125 |     const inputStarted = Date.now(); await page.locator('#player-input').fill('查看原文时仍可编辑行动');
  126 |     await expect(page.locator('#player-input')).toHaveValue('查看原文时仍可编辑行动');
  127 |     const inputLatencyMs = Date.now() - inputStarted;
  128 |     const metrics = await page.evaluate(() => { const w = window as unknown as { __streamMetrics: { publishes: number; frames: number }; __stopMetrics: () => void }; w.__stopMetrics(); return w.__streamMetrics; });
  129 |     expect(metrics.frames).toBeGreaterThan(0); expect(metrics.publishes).toBeLessThan(40); expect(calls).toHaveLength(1);
  130 |     await writeFile(info.outputPath('live-performance.json'), JSON.stringify({ ...metrics, inputLatencyMs, textChars: long.length, fragments: Math.ceil(long.length / 200) }, null, 2));
  131 |     await info.attach('live-performance', { body: JSON.stringify({ ...metrics, inputLatencyMs, textChars: long.length, fragments: Math.ceil(long.length / 200) }, null, 2), contentType: 'application/json' });
  132 |     await panel.getByLabel(`${rawLabel}原文内容`).selectOption('content'); await page.screenshot({ path: info.outputPath('stream-live.png') });
  133 |     if (stage === 'variables') write({ content: '</说明><命令>\nset worldClock = "2026-10-18T08:20:00+08:00"\n</命令>' });
  134 |     else write({ content: '"],"worldCommands":[],"taskCommands":[],"eventCommands":[],"visibleHooks":[]}' });
  135 |     end();
  136 |     await expect.poll(async () => (await stored(page)).draft?.stageStatus[stage]).toBe('ready');
  137 |     expect((await stored(page)).state).toEqual(before.state);
  138 |     await closeWorkflow(page); await openWorkflowStage(page, stage);
> 139 |     await page.getByRole('button', { name: stage === 'variables' ? '继续未完成阶段' : '完成本回合结算', exact: true }).click();
      |                                                                                                          ^ Error: locator.click: Error: strict mode violation: getByRole('button', { name: '完成本回合结算', exact: true }) resolved to 2 elements:
  140 |     await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(2);
  141 |     expect(calls.map(c => c.model)).toEqual(stage === 'variables' ? ['variables', 'world'] : ['world']);
  142 |     await page.screenshot({ path: info.outputPath('stream-committed.png') });
  143 |   });
  144 |   test(`${stage} 取消后显式重试不串台，中断保留片段且不保存失败候选`, async ({ page }, info) => {
  145 |     const before = await seed(page, stage); await begin(page, stage, label);
  146 |     write({ content: '旧请求的合法公开片段' }); await openWorkflowStage(page, stage);
  147 |     await page.getByRole('button', { name: `取消${label}生成`, exact: true }).click();
  148 |     await expect(page.getByRole('button', { name: `生成${label}候选`, exact: true })).toBeEnabled();
  149 |     const stopped = await stored(page); expect(stopped.state).toEqual(before.state); expect(stopped.draft?.[stage]).toBeUndefined();
  150 |     const old = active; await begin(page, stage, label); write({ content: stage === 'variables' ? variableText : worldText }); end();
  151 |     await expect.poll(async () => (await stored(page)).draft?.stageStatus[stage]).toBe('ready');
  152 |     old?.write(frame({ content: '取消后的迟到错误内容' })); old?.end();
  153 |     await openWorkflowStage(page, stage); active = undefined;
  154 |     await page.getByRole('button', { name: `重新生成${label}候选`, exact: true }).click(); await expect.poll(() => Boolean(active)).toBe(true);
  155 |     write({ content: '新请求中断前的实际片段' });
  156 |     await expect.poll(() => page.evaluate(async () => { const p = '/src/services/ai/stageResponses.ts'; return (await import(p)).stageResponses.getSnapshot()[0]?.text; })).toBe('新请求中断前的实际片段');
  157 |     active!.destroy(); await expect.poll(async () => (await stored(page)).draft?.stageStatus[stage]).toBe('failed');
  158 |     await closeDiagnostics(page); const panel = await openStageRaw(page, stage);
  159 |     await expect(panel.getByRole('textbox')).toHaveValue('新请求中断前的实际片段'); await expect(panel).not.toContainText('取消后的迟到错误内容');
  160 |     const after = await stored(page); expect(after.state).toEqual(before.state); expect(after.draft?.[stage]).toBeUndefined(); expect(calls).toHaveLength(3);
  161 |     await page.screenshot({ path: info.outputPath('stream-interrupted.png') }); expect(await stored(page)).toEqual(after);
  162 |   });
  163 | }
  164 | 
```