import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { IDBFactory } from 'fake-indexeddb';
import { npcAcceptanceState } from './fixtures/npcAcceptance';
import { legacyNpcMemories } from './fixtures/npcUnified';
import { playerView } from '../ui/panels/playerView';
import { NpcPanel } from '../ui/panels/NpcPanel';
import { npcContext } from '../prompts/npcContext';
import { composePrompt } from '../prompts/composer';
import { contextStatistics } from '../prompts/statistics';
import { defaultSettings } from '../ui/settings/model';
import { createTurnDraft, rerollStory, TurnDraftSchema } from '../domain/drafts';
import { SaveRepository } from '../services/storage/saveRepository';
import { migrateSave } from '../services/storage/migrations';

const summary = (values: number[]) => ({ samples: values.map(n => +n.toFixed(3)), medianMs: +[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(3), maxMs: +Math.max(...values).toFixed(3) });
function measure<T>(run: () => T) {
  const values = []; let result!: T;
  for (let i = 0; i < 3; i++) { const start = performance.now(); result = run(); values.push(performance.now() - start); }
  return { result, timing: summary(values) };
}
it('30/100/300/1000人、100/300回合：正式投影、名录、实际请求及读档可重复测量，不裁剪或发AI', async () => {
  const rows = [];
  for (const count of [30, 100, 300, 1000]) {
    const turns = count < 300 ? 100 : 300, state = npcAcceptanceState(count, turns), before = JSON.stringify(state);
    const memoryBefore = process.memoryUsage().heapUsed;
    const view = measure(() => playerView(state));
    const roster = measure(() => renderToStaticMarkup(createElement(NpcPanel, { view: view.result })));
    expect(roster.result).toContain('人物名录'); expect((roster.result.match(/class="npc-directory-row"/g) ?? []).length).toBe(20);
    const projected = measure(() => npcContext(state, { stage: 'story', playerInput: '继续当前日常' }, new Set()));
    const migrated = measure(() => migrateSave({ ...state, schemaVersion: 8 }));
    expect(migrated.result).toEqual(state);
    expect(Object.keys(projected.result.npc)).toHaveLength(count);
    expect(Object.values(projected.result.index.groups).flat()).toHaveLength(count);
    const initial = rerollStory(createTurnDraft(state.saveId, state.revision, 'volume-next', 'regular', '继续当前日常'), { turnKind: 'regular', narrative: '【旁白】主角继续当前的日常安排。', summary: '继续日常', variableGuide: [] });
    const draft = TurnDraftSchema.parse({ ...initial, variables: { result: { commands: [], rejectedSuggestions: [], unresolved: [] }, validation: 'validated', candidateRevision: 1, requestRevision: 0, storyRevision: initial.storyRevision }, stageStatus: { ...initial.stageStatus, variables: 'ready' } });
    const requests = [];
    for (const stage of ['story', 'variables', 'world'] as const) {
      const times = []; let prompt!: Awaited<ReturnType<typeof composePrompt>>;
      for (let i = 0; i < 3; i++) { const start = performance.now(); prompt = await composePrompt({ state, draft, settings: defaultSettings(), stage, mode: 'regular', userInput: draft.userInput }); times.push(performance.now() - start); }
      const stats = contextStatistics(prompt.messages);
      expect(stats.actual.inputTokens).toBeUndefined(); expect(stats.characters).toBe(prompt.messages.reduce((n, m) => n + Array.from(m.content).length, 0));
      expect(prompt.context.NPC_KNOWLEDGE).toBeUndefined(); expect(prompt.context.SCENE_NPCS).toBeUndefined();
      const save = prompt.context.SAVE_STATE as { npc: Record<string, unknown> };
      expect(Object.keys(save.npc)).toHaveLength(count);
      requests.push({ stage, ...stats, compose: summary(times) });
    }
    const factory = new IDBFactory(), name = `npc-volume-${count}`, repo = await SaveRepository.open(name, factory);
    try {
      await new Promise<void>((resolve, reject) => { const req = factory.open(name); req.onerror = () => reject(req.error); req.onsuccess = () => { const db = req.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; }; });
      const times = [];
      for (let i = 0; i < 3; i++) { const start = performance.now(); const loaded = await repo.load(state.saveId); times.push(performance.now() - start); expect(loaded).toEqual(state); }
      rows.push({ count, turns, rawMemories: Object.values(state.npc).reduce((n, p) => n + p.memories.length, 0),
        tasks: Object.keys(state.tasks).length, events: Object.keys(state.events).length, organizations: Object.keys(state.organizations).length,
        encodedSnapshotBytes: new TextEncoder().encode(JSON.stringify({ version: 1, saveId: state.saveId, turnId: 'volume-next', beforeTurnId: state.journal.at(-1)!.turnId, input: '继续当前日常', stateJSON: before })).length,
        stateBytes: new TextEncoder().encode(before).length, heapDeltaBytes: process.memoryUsage().heapUsed - memoryBefore,
        playerView: view.timing, initialRosterSsr: roster.timing, npcProjection: projected.timing, v8Migration: migrated.timing, repositoryLoad: summary(times), requests });
    } finally { repo.close(); }
    expect(JSON.stringify(state)).toBe(before);
  }
  const legacy = [6, 7].map(version => {
    const raw = legacyNpcMemories(version as 6 | 7), measured = measure(() => migrateSave(raw));
    expect(measured.result.npc['npc-a'].memories).toHaveLength(21);
    return { version, memories: 21, migrate: measured.timing };
  });
  if (process.env.NPC_FINAL_METRICS) writeFileSync(process.env.NPC_FINAL_METRICS, JSON.stringify({ environment: { node: process.version, cpu: cpus()[0].model, logicalCpus: cpus().length, totalMemoryBytes: totalmem() }, sampleCount: 3,
    note: 'Synthetic, warm cache after first sample; elapsed times include GC and shared-host load. SSR is not browser rendering. Heap delta is not peak RAM. No network or usage.', rows, legacy }, null, 2));
}, 120000);
