import { previousOracleVersion, oracleDefinition, upgradeOraclePreferences } from '../presets/meowssiah/definition';
import { expect, it } from 'vitest';
import { SaveRepository } from '../services/storage/saveRepository';
import { request, transaction } from '../services/storage/idb';
import { createOracleStore, oracleStore, readSheet } from '../services/storage/oracleNotes';
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

it('从旧存储迁入的历史按 trim 去重，当前纸条逐字保留', async () => {
  const name = crypto.randomUUID();
  const note = { id: crypto.randomUUID(), text: '　开头留白\n第二行  ', once: true };
  const old = indexedDB.open(name, 11);
  old.onupgradeneeded = () => old.result.createObjectStore('saveControls', { keyPath: 'saveId' });
  const db = await request(old);
  await transaction(db, ['saveControls'], 'readwrite', tx =>
    request(tx.objectStore('saveControls').put({ saveId: 'paper', oracleNote: note })));
  db.close();
  const upgrade = indexedDB.open(name, 12);
  upgrade.onupgradeneeded = () => createOracleStore(upgrade.result, upgrade.transaction!);
  const migrated = await request(upgrade);
  try {
    const raw = await transaction(migrated, [oracleStore], 'readonly', tx => request(tx.objectStore(oracleStore).get('paper')));
    expect(raw).toMatchObject({ note, history: [note.text.trim()] });
    expect(await transaction(migrated, [oracleStore], 'readonly', tx => readSheet(tx, 'paper'))).toEqual(raw);
  } finally { migrated.close(); }
});

it('已有 V12 重复历史首次读取即去重，重新保存与清除保留最近六条且逐档隔离', async () => {
  const name = crypto.randomUUID(), repo = await SaveRepository.open(name);
  try {
    await repo.create(game('paper'));
    await repo.create(game('other'));
    const other = await repo.writeOracleNote('other', await repo.readOracleNote('other'), '　另一档原文  ', false);
    const note = { id: crypto.randomUUID(), text: '  当前纸条\n末行　', once: true };
    const version = crypto.randomUUID();
    const db = await request(indexedDB.open(name));
    try {
      const original = {
        saveId: 'paper', version, note, history: ['　乙', '  甲\n乙 ', '乙 ', '甲\n乙', '甲  乙', '　'],
      };
      await transaction(db, [oracleStore], 'readwrite', tx => request(tx.objectStore(oracleStore).put(original)));
      const readStored = () => transaction(db, [oracleStore], 'readonly', tx => request(tx.objectStore(oracleStore).get('paper')));
      let view = await repo.readOracleNote('paper');
      expect(view).toMatchObject({ version, note, history: ['乙','甲\n乙','甲  乙'] });
      expect(await readStored()).toEqual(original);
      view = await repo.writeOracleNote('paper', view, '  甲\n乙　', true);
      expect(view.note?.text).toBe('  甲\n乙　');
      expect(view.history).toEqual(['甲\n乙','乙','甲  乙']);
      expect(await readStored()).toMatchObject({ history: view.history, note: view.note });
      for (const text of ['三','四','五','六']) view = await repo.writeOracleNote('paper', view, text, true);
      view = await repo.clearOracleNote('paper', view, '  四　');
      expect(view).toMatchObject({ note: null, history: ['四','六','五','三','甲\n乙','乙'] });
      expect(await repo.readOracleNote('other')).toEqual(other);
    } finally { db.close(); }
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
