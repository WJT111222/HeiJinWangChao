import { expect, test } from './helpers/test';

const story = '<正文>林舟核对笔记，留在车站等车。</正文><短期记忆>核对笔记。</短期记忆><变量规划>[]</变量规划>';
const usualCases = ['完整短正文', '空正文', '截断', '拒答', '无效协议', '不可见正文'] as const;

for (const mode of ['原生', '独立防截断', '文学预设', '文学预设 1124'] as const) {
  const cases = mode.startsWith('文学预设') ? [...usualCases, '供应商结束错配'] : usualCases;
  test(mode + '：相同存档与 4000 字设置的实际请求和候选', async ({ page }, info) => {
    const wires: string[] = [];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'literature.mock.invalid') {
        return ['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol === 'blob:' ? route.continue() : route.abort();
      }
      const wire = route.request().postData()!;
      const kind = cases[wires.length];
      wires.push(wire);
      const tool = JSON.parse(wire).tools?.some((t: {function:{name:string}}) => t.function.name === 'actual_content');
      const content = kind === '空正文' ? story.replace('林舟核对笔记，留在车站等车。', ' ')
        : kind === '不可见正文' ? story.replace('林舟核对笔记，留在车站等车。', '\u200b')
        : kind === '无效协议' ? '无标签的响应' : kind === '截断' ? '<正文>林舟核对笔记' : story;
      const message = kind === '拒答' ? { content: '', refusal: 'synthetic refusal' }
        : tool ? { tool_calls: [{ type: 'function', id: 'delivery', function: { name: 'actual_content',
          arguments: kind === '截断' ? '{"content":"未结束' : JSON.stringify({ content }) } }] } : { content };
      const finish = kind === '供应商结束错配' ? 'tool_use' : kind === '截断' ? 'length' : kind === '拒答' ? 'content_filter' : tool ? 'tool_calls' : 'stop';
      return route.fulfill({json:{ choices:[{ message, finish_reason:finish }] }});
    });
    await page.goto('/');
    await page.evaluate(async mode => {
      const {enableNativeDelivery, savePresetSettings} = await import('/src/presets/settings.ts' as string);
      const settings = { enabled:mode.startsWith('文学预设'), selected:mode.startsWith('文学预设') ? (mode.endsWith('1124') ? 'peinture-1124' : 'peinture-1118') : null, packages:{} };
      if (mode === '独立防截断') enableNativeDelivery(settings);
      savePresetSettings(settings);
    }, mode);
    await page.reload();
    const result = await page.evaluate(async count => {
      const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/talentPrompt.ts', '/src/domain/drafts.ts',
        '/src/workflows/storyStage.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
      const [{SaveRepository},{talentPromptInput},{createTurnDraft},{StoryStage},{newChannel,defaultAiConfig},{CredentialVault}] =
        await Promise.all(paths.map(path => import(path)));
      const input = talentPromptInput('story','regular');
      Object.assign(input.settings.runtime, {streamStory:false, useEntityStage:false, useVariableStage:false, useWorldStage:false});
      Object.assign(input.settings.prompts, { minNarrativeChars:4000, maxNarrativeChars:5678, style:'noir', perspective:'first' });
      let draft = createTurnDraft(input.state.saveId,input.state.revision,'writing-compare','regular',input.userInput,false,false,false);
      const repo = await SaveRepository.open(), stage = new StoryStage(repo);
      try {
        const backup = {state:input.state,draft};
        await repo.importBackup(backup,(await repo.compareBackup(backup)).confirmation);
        draft = await repo.loadDraft(draft.saveId);
        const initialState = await repo.load(draft.saveId);
        const config = defaultAiConfig(), channel = newChannel('openai');
        channel.baseUrl='https://literature.mock.invalid/v1'; channel.defaultModel='mock-literature';
        config.channels=[channel]; config.routes.story={channelId:channel.id,modelId:''};
        const vault=new CredentialVault(sessionStorage,localStorage); vault.set(channel.id,'fixture-only');
        const rows = [];
        for (let index = 0; index < count; index++) {
          const previous = JSON.stringify(draft);
          try {
            draft = await stage.generate({draft,settings:input.settings,config,vault,
              ...(index >= 5 && draft.story && {onFailureSaved: () => {}})});
            rows.push({ saved:draft.story.narrative, source:draft.storyWriting?.source });
          } catch (err) {
            const error = err as {code?:string;details?:{storyRule?:string}};
            rows.push({code:error.code, rule:error.details?.storyRule,
              preserved:JSON.stringify(await repo.loadDraft(draft.saveId)) === previous});
          }
        }
        const revisionUnchanged = (await repo.load(draft.saveId)).revision === initialState.revision;
        if (!draft.story) return {rows, revisionUnchanged, committed:null};
        // Only the complete first candidate is still selected after the failed attempts.
        const submitted = await repo.commitTurn({draft:await repo.loadDraft(draft.saveId), nextAction:'', useEntityStage:false, useVariableStage:false, useWorldStage:false});
        const saved = await repo.load(draft.saveId);
        return {rows, revisionUnchanged, committed:{narrative:saved.journal.at(-1).story.narrative,
          advanced:saved.turnNumber - initialState.turnNumber, replayed:submitted.replayed}};
      } finally { stage.dispose(); repo.close(); }
    }, cases.length);
    expect(wires.length, JSON.stringify(result.rows)).toBe(cases.length);
    expect(result.revisionUnchanged).toBe(true);
    expect(result.rows[0]).toMatchObject(mode.startsWith('文学预设') ? {saved:'林舟核对笔记，留在车站等车。',source:'preset'}
      : {rule:'narrative_short',preserved:true});
    expect(result.committed).toEqual(mode.startsWith('文学预设')
      ? {narrative:'林舟核对笔记，留在车站等车。', advanced:1, replayed:false} : null);
    const outcomes = ['invalid_output','output_limit','content_filter','invalid_output','invalid_output'];
    expect(result.rows[5]).toMatchObject({rule:'narrative_empty',preserved:true});
    if (mode.startsWith('文学预设')) expect(result.rows[6]).toMatchObject({code:'stream_interrupted',preserved:true});
    for (const [index, expected] of outcomes.entries()) expect(result.rows[index + 1]).toMatchObject({code:expected,preserved:true});
    const requests = wires.map(text => {
      const body = JSON.parse(text);
      return { nativeRange:text.includes('4000～5678'), nativePerspective:text.includes('本文叙事始终以主角的“我”为第一人称镜头'),
        nativeStyle:text.includes('剧情风格：冷硬黑色'), presetRange:text.includes('800至1000字'), gameProtocol:text.includes('time:opening') && text.includes('eventNarration'),
        tools:body.tools?.map((t:{function:{name:string}}) => t.function.name) ?? [], model:body.model, maxOutput:body.max_completion_tokens ?? body.max_tokens,
        matchedExcerpts: ['4000～5678 字', '本文叙事始终以主角的“我”为第一人称镜头', '剧情风格：冷硬黑色', '800至1000字'].filter(excerpt => text.includes(excerpt)) };
    });
    for (const request of requests) {
      expect(request.nativeRange).toBe(!mode.startsWith('文学预设'));
      expect(request.nativePerspective).toBe(!mode.startsWith('文学预设'));
      expect(request.nativeStyle).toBe(!mode.startsWith('文学预设'));
      expect(request.presetRange).toBe(mode.startsWith('文学预设'));
      expect(request.gameProtocol).toBe(true);
      expect(request.tools).toEqual(mode === '原生' ? [] : ['wave_context_reference','actual_content']);
    }
    await info.attach('wire-comparison',{contentType:'application/json',body:JSON.stringify({mode,calls:wires.length,requests,result})});
  });
}
