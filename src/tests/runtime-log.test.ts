import { describe, expect, it } from 'vitest';
import { DataError } from '../domain/common';
import { AiError } from '../services/ai/errors';
import { runtimeLogEvent } from '../ui/game/runtimeLog';

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
