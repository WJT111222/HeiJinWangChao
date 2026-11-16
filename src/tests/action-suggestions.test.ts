import { expect, test } from 'vitest';
import { actionSuggestions } from '../ui/game/actionSuggestions';
import type { GameState } from '../domain/state';

const options = ['沿江走一走', '去书店看看', '留下观察街道'];
const story: GameState['journal'][number]['story'] = {
  turnKind: 'regular', narrative: '沿江观察。', summary: '沿江观察。', variableGuide: [], actionOptions: options,
};
const state = { turnNumber: 9, journal: [{ turnId: 'previous', revision: 9, relatedActorRefs: [], story }] };

test('绑定行动后正文尚无候选，也能只读投影最后已结算建议，不改变历史', () => {
  const before = structuredClone(state);
  expect(actionSuggestions(state)).toEqual({ options, previous: true, label: '上一已结算回合建议 · 第9回合' });
  expect(state).toEqual(before);
});

test('当前正文的有效建议优先，明确未结算，不把旧史建议冒充本轮建议', () => {
  const current = { ...story, actionOptions: ['去公园等候', '去码头问路', '去社区走走'] };
  expect(actionSuggestions(state, current)).toEqual({
    options: current.actionOptions, previous: false, label: '当前正文建议（本回合尚未结算）',
  });
});

test('当前正文缺少有效建议时仍可查看旧参考，但不会搜寻更早的日记或编造默认项', () => {
  expect(actionSuggestions(state, { ...story, actionOptions: undefined })?.previous).toBe(true);
  expect(actionSuggestions({ turnNumber: 0, journal: [] })).toBeUndefined();
  expect(actionSuggestions({ ...state, journal: [...state.journal, { ...state.journal[0], story: { ...story, actionOptions: undefined } }] })).toBeUndefined();
});

test('3～5条有效建议保持原文、顺序及完整长度，不截断、不补齐', () => {
  const long = '这是很长的玩家行动，'.repeat(300);
  const five = [...options, long, '留在原地'];
  expect(actionSuggestions(state, { ...story, actionOptions: five })?.options).toEqual(five);
  for (const invalid of [[], ['一', '二'], [...five, '六']]) {
    expect(actionSuggestions({ ...state, journal: [] }, { ...story, actionOptions: invalid })).toBeUndefined();
  }
});
