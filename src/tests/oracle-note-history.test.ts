import { previousOracleVersion, oracleDefinition, upgradeOraclePreferences } from '../presets/meowssiah/definition';
import { expect, it } from 'vitest';
import { SaveRepository } from '../services/storage/saveRepository';
import { game } from './fixtures/game';
import { observedToolString } from '../presets/spreset/toolObservation';

it('近六条去重、回填、草稿消费与清空历史分别受实例和版本约束', async () => {
  const repo = await SaveRepository.open(crypto.randomUUID());
  try {
    const state = await repo.create(game('paper'));
    let view = await repo.readOracleNote(state.saveId);
    for (const text of ['1','2','3','4','5','6','7','3']) view = await repo.writeOracleNote(state.saveId, view, text, true);
    expect(view.history).toEqual(['3','7','6','5','4','2']);
    const pending = view;
    view = await repo.clearOracleHistory(state.saveId, view);
    expect(view.note).toEqual(pending.note);
    expect(view.history).toEqual([]);
    await expect(repo.writeOracleNote(state.saveId, pending, '过期', true)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    view = await repo.writeOracleNote(state.saveId, view, '本机历史', false);
    view = await repo.writeOracleNote(state.saveId, view, '', true);
    expect(view).toMatchObject({ note: null, history: ['本机历史'] });
    const [backup] = await repo.exportBackup([state.saveId]);
    expect(JSON.stringify(backup)).not.toContain('本机历史');
    const comparison = await repo.compareBackup(backup);
    view = await repo.writeOracleNote(state.saveId, view, '期间修改', true);
    await expect(repo.importBackup(backup, comparison.confirmation, { overwrite: true })).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' });
    await repo.importBackup(backup, (await repo.compareBackup(backup)).confirmation, { overwrite: true });
    const replaced = await repo.readOracleNote(state.saveId);
    expect(replaced).toMatchObject({ note: null, history: [] });
    await expect(repo.writeOracleNote(state.saveId, view, '其他实例', true)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await repo.delete(state.saveId, state.revision, replaced.instance);
    await repo.create(state);
    await expect(repo.clearOracleHistory(state.saveId, replaced)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  } finally { repo.close(); }
});

it('只观察已到达的顶层字符串及完整转义', () => {
  const partial = '{"comment":"\\"game_content\\": fake","game_content":"雪\\n\\u98ce\\uD83D';
  expect(observedToolString(partial, 'game_content')).toBe('雪\n风');
  expect(observedToolString(partial + '\\uDC08', 'game_content')).toBe('雪\n风🐈');
  expect(observedToolString('{"x":{"game_content":"别处"}}', 'game_content')).toBe('');
  expect(observedToolString('{"game_content":"雪\\u98', 'game_content')).toBe('雪');
});

it('上一版方案保留玩家编辑，已显式保存的旧版默认格式跟随新版默认值', () => {
  const id = 'eb65ec28-14a7-401c-887a-e6e22c3295c9';
  const source = { scripts: {}, version: previousOracleVersion, entries: {
    [id]: { enabled: true, content: '在剧情中穿插角色的内心活动，格式如下\n<details><summary>内心-角色名</summary>\n内心话\n</details>' },
    'catgod-direction': { content: '玩家自己的要求' },
  } };
  const next = upgradeOraclePreferences(source);
  expect(next.version).toBe(oracleDefinition.version);
  expect(next.entries).toEqual({ [id]: { enabled: true }, 'catgod-direction': { content: '玩家自己的要求' } });
  expect(source.entries[id].content).toContain('<details>');
  source.entries[id].content = '在原处用我的格式';
  expect(upgradeOraclePreferences(source).entries[id].content).toBe(source.entries[id].content);
});
