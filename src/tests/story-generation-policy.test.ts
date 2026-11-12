import { expect, test } from 'vitest';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { mayStartStory } from '../ui/game/storyGenerationPolicy';

const empty = createTurnDraft('save', 0, 'turn', 'opening', '');
const ready = rerollStory(empty, {turnKind:'opening',narrative:'已保存的正文',summary:'有效摘要',variableGuide:[]});
test('有效草稿即使下游失败、关闭或存在旧错误也不能主动替换正文',()=>{
  expect(mayStartStory(ready)).toBe(false);
  expect(mayStartStory({...ready,stageStatus:{...ready.stageStatus,variables:'failed',world:'failed'}})).toBe(false);
  expect(mayStartStory({...ready,useVariableStage:false,useWorldStage:false})).toBe(false);
});
test('空草稿与失败正文保持正常生成和重试，缺失草稿不能请求',()=>{
  expect(mayStartStory(empty)).toBe(true);
  expect(mayStartStory({...ready,stageStatus:{...ready.stageStatus,story:'failed'}})).toBe(true);
  expect(mayStartStory(undefined)).toBe(false);
});
test('升级前缺少有效摘要的无效草稿仍能通过原手动机制修复',()=>{
  expect(mayStartStory({...ready,story:{...ready.story!,summary:' \n '}})).toBe(true);
  expect(mayStartStory({...ready,story:{...ready.story!,summary:'short English summary'}})).toBe(false);
});
