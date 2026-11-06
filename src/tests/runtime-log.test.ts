import { variableTextEnvelope } from './fixtures/variableReply';
import { describe, expect, it } from 'vitest';
import { DataError } from '../domain/common';
import { AiError } from '../services/ai/errors';
import { domainRuleNames, isDomainRule } from '../executors/variableText/aggregateDiagnostics';
import { runtimeLogEvent } from '../ui/game/runtimeLog';
import { parseTextVariables } from '../services/validation/aiOutputs';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { game, npc, story } from './fixtures/game';

describe('safe runtime log diagnostics', () => {
  it('shows only allowlisted AI status and field metadata', () => {
    const event = runtimeLogEvent(1, 'variables', 'failed', new AiError('data_integrity', 422, {
      fieldPath: 'text.domain_validation_failed', commandIndex: 2,
    }));
    expect(event).toMatchObject({
      id: 1, stage: 'variables', kind: 'failed',
      code: 'data_integrity', httpStatus: 422,
      fieldPath: 'text.domain_validation_failed', commandIndex: 3,
    });
    expect(event.timestamp).toEqual(expect.any(String));
  });

  it('marks related commands without pretending to identify the single failing command', () => {
    const event = runtimeLogEvent(7, 'variables', 'failed', new AiError('data_integrity', undefined, {
      fieldPath: 'text.domain_validation_failed',
      relatedCommandIndices: [1, 2, 2, 0, 3],
    }));
    expect(event.commandIndex).toBeUndefined();
    expect(event.relatedCommandIndices).toEqual([1, 2, 3]);
  });

  it('does not echo unknown error messages or secret-like paths', () => {
    const secret = 'sk-very-private-key';
    const unknown = runtimeLogEvent(2, 'world', 'failed', new Error(`request ${secret} failed`));
    expect(JSON.stringify(unknown)).not.toContain(secret);
    expect(unknown.code).toBe('unknown');
    const unsafe = runtimeLogEvent(3, 'variables', 'failed', new AiError('schema_fields', undefined, {
      fieldPath: `token.${secret}`,
    }));
    expect(unsafe.fieldPath).toBeUndefined();
  });

  it('carries actual compiler mismatch into the safe UI log', async () => {
    const state = game();
    state.npc.npc_001 = npc('npc_001');
    const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'turn-a', 'opening', ''), {
      ...story, turnKind: 'opening',
    });
    let caught: unknown;
    try {
      await parseTextVariables(variableTextEnvelope('<命令>\nset npc[npc_001].onScene = "secret-input"\n</命令>'), state, draft);
    } catch (failure) { caught = failure; }
    expect(caught).toBeInstanceOf(AiError);
    const logged = runtimeLogEvent(10, 'variables', 'failed', caught);
    expect(logged).toMatchObject({
      code: 'schema_fields', fieldPath: 'text.type_mismatch', commandIndex: 1,
      valuePath: 'npc[id].onScene', expectedType: 'boolean',
      actualType: 'string', validationRule: 'invalid_type',
    });
    expect(JSON.stringify(logged)).not.toContain('npc_001');
    expect(JSON.stringify(logged)).not.toContain('secret-input');
  });

  it('shows sanitized field path, expected/actual type and rule', () => {
    const event = runtimeLogEvent(8, 'variables', 'failed', new AiError('schema_fields', undefined, {
      fieldPath: 'text.type_mismatch', commandIndex: 19,
      valuePath: 'npc[id].onScene', expectedType: 'boolean',
      actualType: 'string', validationRule: 'invalid_type',
    }));
    expect(event).toMatchObject({
      commandIndex: 20, fieldPath: 'text.type_mismatch',
      valuePath: 'npc[id].onScene', expectedType: 'boolean',
      actualType: 'string', validationRule: 'invalid_type',
    });
  });

  it('never echoes unknown path segments, raw entity IDs, or forged type metadata', () => {
    const event = runtimeLogEvent(9, 'variables', 'failed', new AiError('schema_fields', undefined, {
      valuePath: 'npc[secret-real-id].onScene',
      expectedType: 'secret' as 'boolean',
      actualType: 'private-text' as 'string',
      validationRule: 'leak' as 'invalid_type',
    }));
    const json = JSON.stringify(event);
    expect(json).not.toContain('secret-real-id');
    expect(json).not.toContain('private-text');
    expect(event).not.toHaveProperty('valuePath');
    expect(event).not.toHaveProperty('expectedType');
    expect(event).not.toHaveProperty('actualType');
    expect(event).not.toHaveProperty('validationRule');
  });

  it('carries real aggregate scene failure through parser, workflow error and safe UI event', async () => {
    const state = game();
    state.npc.npc_001 = npc('npc_001');
    state.locations.remote = { id: 'remote', name: '远处' };
    const before = structuredClone(state);
    const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'turn-a', 'opening', ''), {
      ...story, turnKind: 'opening',
    });
    let caught: unknown;
    try {
      await parseTextVariables(variableTextEnvelope('<命令>\nset protagonist.locationId = "remote"\n</命令>'), state, draft);
    } catch (failure) { caught = failure; }
    expect(caught).toBeInstanceOf(AiError);
    const event = runtimeLogEvent(13, 'variables', 'failed', caught);
    expect(event).toMatchObject({
      code: 'data_integrity', fieldPath: 'text.domain_validation_failed',
      domainRule: 'scene_transition', relatedCommandIndices: [1], relatedNpcId: 'npc_001',
    });
    expect(JSON.stringify(event)).toContain('npc_001');
    expect(`${domainRuleNames.scene_transition}（NPC：${event.relatedNpcId}）`)
      .toBe('主角移动时缺少原在场 NPC 的状态更新（NPC：npc_001）');
    expect(state).toEqual(before);
  });

  it('real multi-NPC scene failure names only the NPC that was not updated', async () => {
    const state = game();
    state.npc.npc_001 = npc('npc_001');
    state.npc.npc_002 = npc('npc_002');
    state.locations.remote = { id: 'remote', name: '远处' };
    const before = structuredClone(state);
    const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'turn-a', 'opening', ''), {
      ...story, turnKind: 'opening',
    });
    let caught: unknown;
    try {
      await parseTextVariables(variableTextEnvelope('<命令>\nset protagonist.locationId = "remote"\nset npc[npc_001].locationId = "remote"\n</命令>'), state, draft);
    } catch (failure) { caught = failure; }
    const event = runtimeLogEvent(14, 'variables', 'failed', caught);
    expect(event.relatedNpcId).toBe('npc_002');
    expect(event.domainRule).toBe('scene_transition');
    expect(`${domainRuleNames[event.domainRule!]}（NPC：${event.relatedNpcId}）`)
      .toBe('主角移动时缺少原在场 NPC 的状态更新（NPC：npc_002）');
    expect(state).toEqual(before);
  });

  it('real SCENE_LOCATION failure reaches the player log with that NPC id', async () => {
    const { commitCommands } = await import('../domain/commands');
    const { variableValidationError } = await import('../services/validation/variableDiagnostics');
    const state = game();
    state.npc.npc_gap = npc('npc_gap');
    const before = structuredClone(state);
    let caught: unknown;
    try {
      commitCommands(state, 'scene-gap', 0, [{
        type: 'UpdateNpc', commandId: 'clear-place', evidence: '地点被清空', npcId: 'npc_gap',
        expectedRevision: 0, changes: { locationId: null },
      }], state.updatedAt);
    } catch (failure) { caught = failure; }
    expect(caught).toBeInstanceOf(DataError);
    const event = runtimeLogEvent(15, 'variables', 'failed', variableValidationError(caught));
    expect(event).toMatchObject({
      code: 'data_integrity', domainRule: 'scene_location', relatedNpcId: 'npc_gap',
    });
    expect(`${domainRuleNames.scene_location}（NPC：${event.relatedNpcId}）`)
      .toBe('在场 NPC 缺少明确地点（NPC：npc_gap）');
    expect(state).toEqual(before);
  });

  it('variableValidationError carries safe NPC ID for SCENE errors', async () => {
    const { variableValidationError } = await import('../services/validation/variableDiagnostics');
    const { DataError } = await import('../domain/common');
    const error = variableValidationError(new DataError('SCENE_TRANSITION', '主角移动时须显式更新原在场 NPC（npc_abc）的地点或在场状态，不自动跟随'));
    expect(error).toBeInstanceOf(AiError);
    expect(error.details?.relatedNpcId).toBe('npc_abc');
    expect(error.details?.domainRule).toBe('scene_transition');
    const bad = variableValidationError(new DataError('SCENE_LOCATION', '在场 NPC（__proto__）必须有明确地点'));
    expect(bad.details?.relatedNpcId).toBeUndefined();
    expect(bad.details?.domainRule).toBe('scene_location');
  });

  it('rejects forged or invalid relatedNpcId in runtime log', () => {
    const forged = runtimeLogEvent(20, 'variables', 'failed', new AiError('data_integrity', undefined, {
      domainRule: 'scene_transition', relatedNpcId: '__proto__',
    }));
    expect(forged).not.toHaveProperty('relatedNpcId');
    const valid = runtimeLogEvent(21, 'variables', 'failed', new AiError('data_integrity', undefined, {
      domainRule: 'scene_transition', relatedNpcId: 'npc_safe_001',
    }));
    expect(valid.relatedNpcId).toBe('npc_safe_001');
  });

  it.each(Object.keys(domainRuleNames).filter(isDomainRule).filter(rule =>
    rule !== 'scene_transition' && rule !== 'scene_location'))('does not expose NPC ID for non-scene rule %s', (domainRule) => {
    const entry = runtimeLogEvent(30, 'variables', 'failed', new AiError('data_integrity', undefined, {
      domainRule, relatedNpcId: 'npc_unrelated_secret',
    }));
    expect(entry.domainRule).toBe(domainRule);
    expect(entry).not.toHaveProperty('relatedNpcId');
    expect(JSON.stringify(entry)).not.toContain('npc_unrelated_secret');
  });

  it.each(['scene_transition', 'scene_location'] as const)('allows only a valid NPC ID for %s without dropping World diagnostics', (domainRule) => {
    const entry = runtimeLogEvent(31, 'world', 'failed', new AiError('data_integrity', undefined, {
      domainRule, relatedNpcId: 'npc_valid', worldRule: 'actor_permission',
    }));
    expect(entry).toMatchObject({ domainRule, relatedNpcId: 'npc_valid', worldRule: 'actor_permission' });
    for (const relatedNpcId of ['__proto__', 'prototype', 'constructor', 'npc/private', 'npc\nprivate', 'npc?key=private', 'x'.repeat(129)]) {
      const invalid = runtimeLogEvent(32, 'variables', 'failed', new AiError('data_integrity', undefined, { domainRule, relatedNpcId }));
      expect(invalid).not.toHaveProperty('relatedNpcId');
    }
  });

  it('drops NPC ID without a scene rule while retaining a World rule', () => {
    const entry = runtimeLogEvent(33, 'world', 'failed', new AiError('data_integrity', undefined, {
      relatedNpcId: 'npc_unrelated_secret', worldRule: 'domain_state',
    }));
    expect(entry.worldRule).toBe('domain_state');
    expect(entry).not.toHaveProperty('relatedNpcId');
  });

  it('retains safe aggregate domain rule while rejecting forged free text', () => {
    const event = runtimeLogEvent(11, 'variables', 'failed', new AiError('data_integrity', undefined, {
      fieldPath: 'text.domain_validation_failed',
      domainRule: 'npc_scene_location',
      relatedCommandIndices: [1, 2],
    }));
    expect(event).toMatchObject({
      code: 'data_integrity', domainRule: 'npc_scene_location',
      relatedCommandIndices: [1, 2],
    });
    const forged = runtimeLogEvent(12, 'variables', 'failed', new AiError('data_integrity', undefined, {
      domainRule: 'npc-id-secret' as 'npc_scene_location',
    }));
    expect(forged).not.toHaveProperty('domainRule');
    expect(JSON.stringify(forged)).not.toContain('npc-id-secret');
  });

  it('displays only safe known commit errors', () => {
    expect(runtimeLogEvent(4, 'commit', 'failed', new DataError('TURN_TIME_REQUIRED', 'unsafe input')))
      .toMatchObject({ code: 'TURN_TIME_REQUIRED', message: '时间条件未满足，当前回合未正式结算。' });
    const unknown = runtimeLogEvent(5, 'commit', 'failed', new DataError('UNLISTED_ERROR', 'secret'));
    expect(JSON.stringify(unknown)).not.toContain('secret');
  });

  it('uses predictable labels without storing game text on success', () => {
    const event = runtimeLogEvent(6, 'story', 'completed');
    expect(event).toMatchObject({ stage: 'story', kind: 'completed', message: '正文生成已完成' });
    expect(event).not.toHaveProperty('code');
  });
});
