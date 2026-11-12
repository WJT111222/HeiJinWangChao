import { openLibrary } from './home';
import type { Page } from '@playwright/test';

// Isolated visual-review save. Every displayed value is loaded through the real repository;
// the two history entries and waiting draft come from the real commit path, without AI calls.
export async function seedNightSeal(page: Page, longValues = false) {
  await page.goto('/');
  await page.evaluate(async (longValues) => {
    const repoPath = '/src/services/storage/saveRepository.ts', worldPath = '/src/tests/fixtures/world.ts',
      turnPath = '/src/tests/fixtures/turn.ts';
    const { SaveRepository } = await import(repoPath), { worldState } = await import(worldPath),
      { completeDraft } = await import(turnPath);
    const repo = await SaveRepository.open(), state = worldState();
    state.title = '沈砚 · 重庆'; state.openingCityId = 'chongqing';
    state.protagonist.name = longValues ? '沈砚与城市旧事档案的长期记录者'.repeat(5) : '沈砚';
    state.protagonist.profession = '记者';
    state.protagonist.healthText = longValues ? '身体状态保持稳定，需要适时休息。'.repeat(50) : '略感疲倦';
    state.protagonist.emotionText = '平静，心有所虑';
    state.protagonist.background = '他从熟悉的街巷开始记录这座城市。每一次采访都带来新的线索，也留下需要自己判断的问题。\n'.repeat(24);
    state.economy.cash = longValues ? Number.MAX_SAFE_INTEGER : 138600;
    state.weatherText = '小雨初歇'; state.environmentText = '路灯初亮，江边的晚风吹过街巷。';
    state.npc['npc-a'].name = longValues ? '来自很远地方并有许多故事的朋友'.repeat(10) : '许知遥';
    await repo.create(state);
    const narratives = [
      '【旁白】傍晚的雨刚停，轻轨从楼群中间穿过。沈砚收起伞，看着对面山坡上一层层亮起的窗。手机震了一下，是编辑约他明早见面的消息。',
      '【旁白】江边的风带着潮气，吹得人清醒。他数了数钱包里的现金。这座城市从不缺机会，只是每一个机会背后，都有需要自己作出的选择。',
    ];
    for (const [index, narrative] of narratives.entries()) {
      if (index) {
        const waiting = await repo.loadDraft(state.saveId);
        await repo.bindTurnAction(waiting, '沿江步道走一走', true, true);
      }
      const candidate = await completeDraft(repo, { narrative, actionOptions: ['回复编辑，确认明天的会面', '沿着江边步道走一走', '给熟悉的朋友打个电话'], summary: '沈砚站在江边收到编辑的消息，考虑接下来的安排。',
        variables: { commands: [{ type: 'SetWorldClock', commandId: `visual-clock-${index}`,
          worldClock: `2026-10-18T08:${index ? '20' : '10'}:00+08:00`, evidence: narrative.slice(4) }], rejectedSuggestions: [], unresolved: [] },
      });
      await repo.commitTurn({ draft: candidate, nextAction: '', useVariableStage: true, useWorldStage: true });
    }
    repo.close();
  }, longValues);
  await page.reload();
  await openLibrary(page);
}
export async function nightSealStored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.loadGame('save-a'); } finally { repo.close(); }
  });
}
