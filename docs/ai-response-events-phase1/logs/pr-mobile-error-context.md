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
    1) <button data-kind="continue" aria-label="完成本回合结算" title="候选已完成，保存本回合结果" class="composer-workflow-action">…</button> aka getByRole('button', { name: '完成本回合结算', description: '候选已完成，保存本回合结果' })
    2) <button class="primary">完成本回合结算</button> aka getByText('完成本回合结算', { exact: true })

Call log:
  - waiting for getByRole('button', { name: '完成本回合结算', exact: true })

```

# Page snapshot

```yaml
- generic [active]:
  - generic [ref=f1e1]:
    - banner:
      - button "打开游戏菜单" [ref=f1e2] [cursor=pointer]: ☰
    - main [ref=f1e3]:
      - generic "城市与当前场景" [ref=f1e4]:
        - button "此时此地与主角状态" [ref=f1e5] [cursor=pointer]:
          - generic [aria-hidden] [ref=f1e6]: 城
          - generic [ref=f1e7]:
            - generic [ref=f1e8]: 当前地点
            - generic [ref=f1e9]: 重庆
          - time [ref=f1e10]: 08:10
          - generic "天气：天气待确认" [ref=f1e11]: —
        - generic [ref=f1e12]: 重庆，2026/10/18 星期日 08:10，天气：天气待确认
      - region "剧情与行动" [ref=f1e13]:
        - generic "正文阅读区域" [ref=f1e14]:
          - generic [ref=f1e15]:
            - generic [ref=f1e16]: THE STORY
            - generic [ref=f1e17]: 已保存草稿
          - article [ref=f1e18]:
            - generic [ref=f1e19]:
              - heading "第 1 回合" [level=2] [ref=f1e20]
              - generic [aria-hidden] [ref=f1e21]: 第一回
              - generic [ref=f1e22]:
                - text: 2026/10/18 · 星期日 · 08:00
                - generic [ref=f1e23]: 重庆
            - paragraph [ref=f1e25]: 经过十分钟，主角完成用餐。主角已经用现金支付30元吃饭。
          - article [ref=f1e26]:
            - generic [ref=f1e27]:
              - heading "第 2 回合" [level=2] [ref=f1e28]
              - generic [aria-hidden] [ref=f1e29]: 第二回
              - generic [ref=f1e30]:
                - text: 2026/10/18 · 星期日 · 08:10
                - generic [ref=f1e31]: 重庆
                - text: · 草稿
            - text: 正文草稿 · 世界状态尚未确认
            - paragraph [ref=f1e33]: 经过十分钟，主角完成用餐。主角已经用现金支付30元吃饭。
        - generic [ref=f1e34]:
          - region "三阶段工作流" [ref=f1e36]:
            - button "三阶段工作流详情" [expanded] [ref=f1e39] [cursor=pointer]:
              - status [ref=f1e44]:
                - generic [ref=f1e45]: 三阶段 ·
                - text: 候选已完成 · 等待结算
              - generic [ref=f1e46]: 详情 ›
          - generic [ref=f1e47]:
            - generic [ref=f1e49]:
              - button "撤回" [disabled] [ref=f1e50]:
                - generic [aria-hidden] [ref=f1e51]: 撤
              - button "完成本回合结算" [ref=f1e52] [cursor=pointer]:
                - generic [aria-hidden] [ref=f1e53]: 结
            - generic [ref=f1e54]: 你的行动
            - textbox "你的行动" [ref=f1e55]:
              - /placeholder: 填写你的行动
              - text: 查看原文时仍可编辑行动
            - button "发送" [ref=f1e57] [cursor=pointer]
          - status [ref=f1e58]: 候选已完成，可点击左侧按钮完成本回合结算；发送新行动将先结算，再绑定下一回合。
      - navigation "底部导航" [ref=f1e59]:
        - button "故事" [ref=f1e60] [cursor=pointer]:
          - generic [aria-hidden] [ref=f1e61]: 文
          - text: 故事
        - button "人物" [ref=f1e62] [cursor=pointer]:
          - generic [aria-hidden] [ref=f1e63]: 我
          - text: 人物
        - button "世界资料" [ref=f1e64] [cursor=pointer]:
          - generic [aria-hidden] [ref=f1e65]: 世
          - text: 世界资料
        - button "设置" [ref=f1e66] [cursor=pointer]:
          - generic [aria-hidden] [ref=f1e67]: 设
          - text: 设置
  - generic [ref=f1e68]:
    - button "收起工作流暗区" [ref=f1e69] [cursor=pointer]
    - dialog "三阶段工作流" [ref=f1e70]:
      - generic [ref=f1e71]:
        - button "收起三阶段工作流" [ref=f1e72] [cursor=pointer]
        - button "行动输入" [ref=f1e74] [cursor=pointer]
      - region "三阶段详情" [ref=f1e75]:
        - generic [ref=f1e76]:
          - button "返回三阶段列表" [ref=f1e77] [cursor=pointer]: 三阶段
          - generic [ref=f1e78]:
            - text: STAGE 03 · WORLD
            - heading "动态世界" [level=3] [ref=f1e79]
          - button "收起三阶段详情" [ref=f1e80] [cursor=pointer]: ×
        - region "动态世界详情" [ref=f1e83]:
          - generic [ref=f1e84]:
            - generic [ref=f1e86]:
              - generic [ref=f1e87]: 已完成
              - generic [ref=f1e88]: 程序校验通过 · 仍未正式结算
            - button "重新生成世界候选" [ref=f1e90] [cursor=pointer]
          - tablist "动态世界内容" [ref=f1e91]:
            - tab "概览" [selected] [ref=f1e92] [cursor=pointer]
            - tab [ref=f1e93] [cursor=pointer]:
              - text: 候选
              - superscript [ref=f1e94]: "1"
            - tab "模型原文" [ref=f1e95] [cursor=pointer]
            - tab "校验结果" [ref=f1e96] [cursor=pointer]
          - tabpanel "概览" [ref=f1e97]:
            - generic [ref=f1e98]:
              - paragraph [ref=f1e99]: 0场外命令
              - paragraph [ref=f1e100]: 0任务
              - paragraph [ref=f1e101]: 0事件
              - paragraph [ref=f1e102]: 1未解决事项
            - generic [ref=f1e103]:
              - generic [ref=f1e104]:
                - term [ref=f1e105]: 未来计划
                - definition [ref=f1e106]: "0"
              - generic [ref=f1e107]:
                - term [ref=f1e108]: 线索候选
                - definition [ref=f1e109]: "0"
              - generic [ref=f1e110]:
                - term [ref=f1e111]: 时间轴候选
                - definition [ref=f1e112]: "0"
              - generic [ref=f1e113]:
                - term [ref=f1e114]: 正文版本
                - definition [ref=f1e115]: "1"
              - generic [ref=f1e116]:
                - term [ref=f1e117]: 变量候选版本
                - definition [ref=f1e118]: "1"
              - generic [ref=f1e119]:
                - term [ref=f1e120]: 世界候选版本
                - definition [ref=f1e121]: "2"
            - paragraph [ref=f1e122]:
              - button "查看候选明细 →" [ref=f1e123] [cursor=pointer]
            - region "本阶段请求 Token 用量" [ref=f1e124]:
              - generic [ref=f1e125]:
                - paragraph [ref=f1e126]: 动态世界 · world · 响应已接收本次请求输入：≈ 58,462 Token（估算输入 Token）最大输出设置：8,192
                - generic [ref=f1e127]:
                  - generic [ref=f1e128]:
                    - text: 实际输入：
                    - generic [ref=f1e129]: 未提供
                  - generic [ref=f1e130]:
                    - text: 实际输出：
                    - generic [ref=f1e131]: 未提供
                  - generic [ref=f1e132]:
                    - text: 实际总量：
                    - generic [ref=f1e133]: 未提供
                  - generic [ref=f1e134]:
                    - text: 思考 Token：
                    - generic [ref=f1e135]: 未提供
              - text: 各次请求独立统计；Unicode启发式不含消息包装等协议开销，不是精确计费，不据此阻止请求。完整记录可在AI请求检查中查看。
            - paragraph [ref=f1e136]: 此处为只读候选。未改变正式人物、经济、任务、时间或历史；线索尚未发布。查看内部结果不会更新任何人物认知。
        - generic [ref=f1e137]:
          - button "完成本回合结算" [ref=f1e139] [cursor=pointer]
          - generic [ref=f1e140]: 生成可能产生费用。
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