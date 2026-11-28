import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { DomainCommand } from '../domain/commands';
import { projectTurn } from '../domain/turnProjection';
import { contextFor } from '../prompts/context';
import { SaveRepository } from '../services/storage/saveRepository';
import { parseWorld } from '../services/validation/aiOutputs';
import { parsePartialWorld } from '../services/validation/partialOutputs';
import { defaultSettings } from '../ui/settings/model';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { worldResult, worldState } from './fixtures/world';

describe('场外来信使用现场阶段最终的在场状态', () => {
  let repo: SaveRepository;
  beforeEach(async () => {
    repo = await SaveRepository.open('phone-scene', new IDBFactory());
    const initial = worldState();
    initial.locations.dock = { id: 'dock', name: '码头' };
    initial.npc.scene.appearedInStory = true;
    await repo.create(initial);
    await repo.commitTurn(submission(await completeDraft(repo), ''));
  });
  afterEach(() => repo.close());

  async function arrange(mode: '自动离场' | '显式离场' | '同行' | '原地') {
    const state = await repo.load('save-a');
    const clock = await elapsedVariables(repo, '经过一分钟', 60);
    const end = clock.commands[0].worldClock;
    const later = new Date(Date.parse(end) + 60000).toISOString();
    const commands: DomainCommand[] = [...clock.commands];
    if (mode !== '原地') commands.push({
      type: 'UpdateProtagonist', commandId: 'move', protagonistId: state.protagonist.id,
      expectedRevision: state.revision, changes: { locationId: 'dock' }, evidence: '主角走到码头',
    });
    if (mode === '显式离场' || mode === '同行') commands.push({
      type: 'UpdateNpc', commandId: 'where', npcId: 'scene', expectedRevision: state.revision,
      changes: mode === '同行' ? { locationId: 'dock' } : { onScene: false }, evidence: mode,
    });
    function letter(npcId: string, messageId: string, dueAt: string): DomainCommand {
      return { type: 'SchedulePhoneMessage', commandId: 'queue-' + messageId, npcId, messageId,
        text: '资料已寄出。', dueAt, evidence: '场外跟进' };
    }
    const world = worldResult([letter('scene', 'immediate', end), letter('npc-a', 'independent', end),
      letter('scene', 'delayed', later)]);
    const draft = await completeDraft(repo, { variables: { ...clock, commands }, world });
    const prompt = contextFor({ stage: 'world', mode: 'regular', state, draft, userInput: draft.userInput,
      settings: defaultSettings() });
    return { state, draft, world, prompt, end, later };
  }

  it.each(['自动离场', '显式离场'] as const)('%s者可以立即来信和延迟来信，跨回合只投递一次', async mode => {
    const { state, draft, world, prompt, end, later } = await arrange(mode);
    expect(state.npc.scene.onScene).toBe(true);
    expect(projectTurn(state, draft).npc.scene.onScene).toBe(false);
    expect(prompt.PHONE_INBOX).toMatchObject({ appearedNpcIds: expect.arrayContaining(['scene']) });
    const raw = JSON.stringify(world);
    expect(parseWorld(raw, state, draft).worldCommands).toEqual(world.worldCommands);
    const partial = await parsePartialWorld(raw, state, draft);
    expect(partial.worldCommands).toEqual(world.worldCommands);
    expect(partial.settlement?.skipped ?? []).toEqual([]);
    const projection = projectTurn(state, draft, partial.worldCommands);
    expect(projection.phone.scheduled.map(m => m.messageId)).toEqual(['immediate', 'independent', 'delayed']);
    const first = await repo.commitTurn(submission(draft, ''));
    expect(first.state.npc.scene.onScene).toBe(false);
    expect(first.state.phone.threads.scene.messages).toMatchObject([{ id: 'immediate', at: end }]);
    expect(first.state.phone.threads['npc-a'].messages).toMatchObject([{ id: 'independent' }]);
    expect(first.state.phone.scheduled).toMatchObject([{ messageId: 'delayed', dueAt: later, sourceTurnId: draft.turnId }]);
    const next = await completeDraft(repo, { variables: await elapsedVariables(repo, '再等一分钟', 60) });
    const second = await repo.commitTurn(submission(next, ''));
    expect(second.state.phone.scheduled).toEqual([]);
    expect(second.state.phone.threads.scene.messages).toMatchObject([{ id: 'immediate' },
      { id: 'delayed', at: later, sourceTurnId: draft.turnId, deliveredTurnId: next.turnId }]);
    const replay = await repo.commitTurn(submission(next, ''));
    expect(replay.replayed).toBe(true);
    expect(replay.state.phone).toEqual(second.state.phone);
  });

  it.each(['同行', '原地'] as const)('%s者仍在场，隔离来信并保留同批独立命令', async mode => {
    const { state, draft, world, prompt } = await arrange(mode);
    expect(projectTurn(state, draft).npc.scene.onScene).toBe(true);
    expect(prompt.PHONE_INBOX).toMatchObject({ appearedNpcIds: expect.not.arrayContaining(['scene']) });
    const raw = JSON.stringify(world);
    expect(() => parseWorld(raw, state, draft)).toThrow();
    expect(() => projectTurn(state, draft, world.worldCommands)).toThrowError(expect.objectContaining({ code: 'PHONE_TARGET' }));
    const partial = await parsePartialWorld(raw, state, draft);
    expect(partial.worldCommands).toEqual([world.worldCommands[1]]);
    expect(partial.settlement?.skipped.map(s => s.groupIndex)).toEqual([0, 2]);
    await expect(repo.commitTurn(submission(draft, ''))).rejects.toThrow();
    expect(await repo.load('save-a')).toEqual(state);
    const saved = await repo.saveDraft({ ...draft, draftRevision: draft.draftRevision + 1,
      world: { ...draft.world!, candidateRevision: draft.world!.candidateRevision + 1, result: partial } }, draft.draftRevision);
    const { state: final } = await repo.commitTurn(submission(saved, ''));
    expect(final.phone.threads.scene).toBeUndefined();
    expect(final.phone.scheduled).toEqual([]);
    expect(final.phone.threads['npc-a'].messages).toMatchObject([{ id: 'independent' }]);
  });
});
