import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { migrateSave } from '../services/storage/migrations';
import { SaveRepository } from '../services/storage/saveRepository';
import { serializeBackup, parseBackup } from '../services/storage/backup';
import { playerView } from '../ui/panels/playerView';
import { contactGroups, loanReminderDays, phoneMoney, upcomingLoans } from '../ui/phone/phoneView';
import { createGameState } from '../domain/state';
import { worldState } from './fixtures/world';
import { composePrompt } from '../prompts/composer';
import { talentPromptInput } from './fixtures/talentPrompt';
import { phoneGame } from './fixtures/phone';

describe('只读手机', () => {
  it('新档开局同伴默认有号码，人物阶段提供旧识建档和陌生人交换号码的规则', async () => {
    const state = worldState(),
      companion = state.npc['npc-a'];
    if (companion.kind !== 'special') throw Error('开局同伴须为特殊人物');
    const created = createGameState({ ...state, companion });
    expect(created.npc[companion.id].phoneContact).toEqual({ status: 'known' });
    const request = await composePrompt(talentPromptInput('entities', 'regular'));
    const content = request.messages.map((message) => message.content).join('\n');
    expect(content).toContain('同学、同事、亲戚或旧识');
    expect(content).toContain('新认识的陌生人须在正文实际交换可用电话');
  });
  it('公开亲子、现役家庭与公开势力分组；号码缺失、未知、失效和暗中成员分别处理', () => {
    const state = phoneGame();
    state.npc.unknown = { ...state.npc.old, id: 'unknown', phoneContact: { status: 'unknown' } };
    state.npc.missing = { ...state.npc.old, id: 'missing', phoneContact: undefined };
    const ids = () =>
      Object.fromEntries(
        Object.entries(contactGroups(playerView(state))).map(([group, people]) => [
          group,
          people.map((p) => p.id),
        ]),
      );
    expect(ids()).toEqual({
      家人: ['daughter'],
      后宫: ['partner'],
      我的势力: ['colleague'],
      其他: ['old', 'hidden'],
    });
    state.harem!.children[0].visibility = 'internal';
    expect(ids().家人).toEqual([]);
    expect(ids().其他).toContain('daughter');
  });
  it('人民币按分显示；三天阈值按游戏日历跨午夜，无结束时钟、无期限及已清偿贷款不提醒', () => {
    const state = phoneGame(),
      debt = state.economy.debts.mortgage;
    expect(phoneMoney(8642035)).toBe('¥86,420.35');
    expect(phoneMoney(null)).toBe('未确认');
    expect(upcomingLoans(state)[0].days).toBe(loanReminderDays);
    state.worldClock = '2026-10-17T15:59:59Z';
    expect(upcomingLoans(state)[0].days).toBe(4);
    state.worldClock = '2026-10-17T16:00:00Z';
    expect(upcomingLoans(state)[0].days).toBe(3);
    state.worldClock = '2026-10-22T00:00:00+08:00';
    expect(upcomingLoans(state)[0].days).toBe(-1);
    state.openingTimePending = true;
    expect(upcomingLoans(state)).toEqual([]);
    delete state.openingTimePending;
    debt.status = 'repaid';
    expect(upcomingLoans(state)).toEqual([]);
    debt.status = 'active';
    delete debt.dueAt;
    expect(upcomingLoans(state)).toEqual([]);
  });
  it('V10 原档与 v1/v2/v3 旧包迁移不补号码；V11 正式数据和历史节点均可恢复', async () => {
    const { phone, ...fields } = phoneGame();
    delete fields.npc.partner.phoneContact;
    const old = { ...fields, schemaVersion: 10 };
    const before = structuredClone(old),
      state = migrateSave(old);
    expect(old).toEqual(before);
    expect(state.phone).toEqual(phone);
    expect(Object.values(state.npc).every((p) => p.appearedInStory)).toBe(true);
    expect(state.npc.partner.phoneContact).toBeUndefined();
    expect(state.npc.old.phoneContact).toEqual({ status: 'invalid' });
    expect(migrateSave(state)).toEqual(state);
    for (const version of [1, 2, 3]) {
      const backup = await parseBackup(
        JSON.stringify({
          format: 'heijin-backup',
          version,
          saves: [{ state: old, ...(version > 1 ? { theaters: [] } : {}) }],
        }),
      );
      expect(backup.entries[0]).toMatchObject({ ok: true, state: JSON.parse(JSON.stringify(state)) });
    }
    const repo = await SaveRepository.open('phone', new IDBFactory());
    try {
      await repo.importBackup({ state }, (await repo.compareBackup({ state })).confirmation);
      const file = await serializeBackup(await repo.exportBackup([state.saveId]), 'test');
      expect(JSON.parse(file).version).toBe(5);
      expect((await parseBackup(file)).entries[0]).toMatchObject({
        ok: true,
        state: JSON.parse(JSON.stringify(state)),
      });
      const node = await repo.history.create(state.saveId, '江边');
      expect((await repo.history.preview(state.saveId, { kind: 'manual', id: node.id })).state).toEqual(
        state,
      );
      expect((await repo.load(state.saveId)).phone).toEqual(phone);
    } finally {
      repo.close();
    }
  });
});
