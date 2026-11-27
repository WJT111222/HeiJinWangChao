import { describe, expect, it } from 'vitest';
import { defaultAiConfig, newChannel, removeChannel } from '../services/ai/configuration';
import { AiConfigConflict, mergeAiDraft, storedDraft } from '../ui/settings/aiDraftMerge';

function fixture() {
  const config = defaultAiConfig();
  const channel = { ...newChannel(), id: 'one', name: '一', defaultModel: 'old' };
  config.channels = [channel];
  config.routes.story = { channelId: 'one', modelId: 'old' };
  const before = [{ id: 'one', session: null, persistent: 'fixture' }];
  const base = storedDraft(config, before);
  const mine = structuredClone(base), latest = structuredClone(base), now = structuredClone(before);
  return { base, mine, latest, before, now, merge: () => mergeAiDraft(base, mine, latest, before, now) };
}
describe('AI 设置三方合并', () => {
  it('合并同一渠道的独立字段，同时保留额外渠道和模型分配', () => {
    const { mine, latest, merge } = fixture();
    mine.config.channels[0].name = '改名';
    latest.config.channels[0].parameters.temperature = 0.4;
    latest.config.routes.story.modelId = 'new';
    latest.config.channels.push({ ...newChannel(), id: 'other' });
    const result = merge();
    expect(result.draft.config.channels).toHaveLength(2);
    expect(result.draft.config.channels[0]).toMatchObject({ name: '改名', parameters: { temperature: 0.4 } });
    expect(result.draft.config.routes.story.modelId).toBe('new');
    expect(result.write).toEqual([]);
  });
  it('保留来自两侧的不同新渠道', () => {
    const { mine, latest, merge } = fixture();
    mine.config.channels.push({ ...newChannel(), id: 'two' });
    latest.config.channels.push({ ...newChannel(), id: 'three' });
    expect(merge().draft.config.channels.map(c => c.id)).toEqual(['one', 'three', 'two']);
  });
  it('同一渠道字段或同一模型分配冲突时不签发写入', () => {
    for (const field of ['name', 'route']) {
      const { mine, latest, merge } = fixture();
      if (field === 'name') {
        mine.config.channels[0].name = 'mine'; latest.config.channels[0].name = 'other';
      } else {
        mine.config.routes.story.modelId = 'mine'; latest.config.routes.story.modelId = 'other';
      }
      expect(merge).toThrow(AiConfigConflict);
    }
  });
  it('记住状态、端点和删除渠道不得覆盖已轮换的持久密钥', () => {
    for (const edit of ['remember', 'endpoint', 'delete', 'key']) {
      const { mine, now, merge } = fixture();
      now[0].persistent = 'rotated';
      if (edit === 'remember') mine.remember.one = false;
      if (edit === 'endpoint') mine.config.channels[0].baseUrl = 'https://api.example.org/v1';
      if (edit === 'delete') mine.config = removeChannel(mine.config, 'one');
      if (edit === 'key') mine.keys.one = 'edited';
      expect(merge).toThrow(AiConfigConflict);
    }
  });
  it('各自有效的默认模型和路由修改合并后仍须有可用模型', () => {
    const { mine, latest, merge } = fixture();
    // One editor relies on the old channel default; the other relies on the old explicit model.
    mine.config.routes.story.modelId = '';
    latest.config.channels[0].defaultModel = '';
    expect(merge).toThrow(AiConfigConflict);
  });
  it('同一密钥和保存位置的相同修改可以合并', () => {
    const { mine, latest, now, merge } = fixture();
    mine.keys.one = latest.keys.one = 'same-new';
    now[0].persistent = 'same-new';
    expect(merge().draft.keys.one).toBe('same-new');
  });
  it('渠道删除遇到并发的新任务引用时拒绝提交', () => {
    const { mine, latest, merge } = fixture();
    mine.config = removeChannel(mine.config, 'one');
    latest.config.routes.phoneGroup = { mode: 'independent', channelId: 'one', modelId: 'm' };
    expect(merge).toThrow(AiConfigConflict);
  });
  it('远端删除渠道后，其他任务的跟随设置仍可保存', () => {
    const { base, mine, latest, merge } = fixture();
    for (const state of [base, mine, latest]) state.config.channels.push({ ...newChannel(), id: 'two' });
    latest.config = removeChannel(latest.config, 'one');
    latest.config.routes.story = { channelId: 'two', modelId: 'm' };
    mine.config.routes.phone = { mode: 'independent', channelId: 'two', modelId: 'm' };
    const result = merge();
    expect(result.draft.config.channels.map(channel => channel.id)).toEqual(['two']);
    expect(result.draft.config.routes.phone.mode).toBe('independent');
    expect(result.write).toEqual([]);
  });
});
