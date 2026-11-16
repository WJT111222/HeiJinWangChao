import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { talentDefinitions } from '../domain/protagonist/talents';
import { composePrompt, STABLE_CONTEXT_KEYS } from '../prompts/composer';
import { talentContext } from '../prompts/talentContext';
import { estimateTokens } from '../prompts/statistics';
import { sentContext } from './fixtures/contextAssertions';
import { talentPromptInput, talentMemoryInput } from './fixtures/talentPrompt';
import baseline from './fixtures/talent-no-selection-baseline.json';

const stages = ['story', 'variables', 'world'] as const;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
afterEach(() => vi.unstubAllGlobals());

describe('PR-B 条件式单项天赋上下文', () => {
  it.each(talentDefinitions)('$name 在开局/普通三阶段读取同一正式全文，单份注入且不改输入', async definition => {
    for (const stage of stages) for (const mode of ['opening', 'regular'] as const) {
      const input = talentPromptInput(stage, mode, definition.id), before = structuredClone(input);
      const prompt = await composePrompt(input), context = sentContext(prompt.messages);
      const selected = context.PROTAGONIST_TALENT as NonNullable<ReturnType<typeof talentContext>>;
      expect(selected.definition).toEqual(definition); expect(selected.stage).toBe(stage);
      expect(selected.commonRules.join('')).toContain('同属顶级优势');
      expect(selected.commonRules.join('')).toContain('显著强于普通角色');
      expect(selected.stageRules).toEqual(talentContext(definition.id, stage)!.stageRules);
      expect(JSON.stringify(context).split(JSON.stringify(definition))).toHaveLength(2);
      for (const other of talentDefinitions.filter(t => t.id !== definition.id)) {
        expect(JSON.stringify(context)).not.toContain(JSON.stringify(other.introduction).slice(1, -1));
      }
      const payload = JSON.stringify(selected);
      expect(payload.length).toBeLessThan(2400);
      expect(payload).not.toMatch(/\d+(?:\.\d+)?\s*%/);
      expect(estimateTokens(payload).estimatedTokens).toBeGreaterThan(0);
      expect(input).toEqual(before);
      const keys = Object.keys(context), stable = STABLE_CONTEXT_KEYS.filter(k => k in context);
      expect(keys.slice(0, stable.length)).toEqual(stable);
      expect(keys[stable.length]).toBe('CURRENT_TIME');
    }
  });

  it.each(baseline.results.filter(r => r.stage !== 'memory'))('无天赋 $stage/$mode 与独立 PR-A 基线消息、模块、上下文字节相同', async expected => {
    const input = talentPromptInput(expected.stage as typeof stages[number], expected.mode as 'opening' | 'regular');
    const prompt = await composePrompt(input);
    expect(prompt.context).not.toHaveProperty('PROTAGONIST_TALENT');
    expect(sentContext(prompt.messages)).not.toHaveProperty('PROTAGONIST_TALENT');
    expect(hash(prompt.messages)).toBe(expected.messages); expect(hash(prompt.context)).toBe(expected.context); expect(hash(prompt.modules)).toBe(expected.modules);
    expect(input.state.protagonist).not.toHaveProperty('talentId');
  });

  it.each(baseline.results.filter(r => r.stage === 'memory'))('Memory $task 即使有天赋也保持 PR-A 字节与原字段顺序', async expected => {
    for (const id of [undefined, ...talentDefinitions.map(t => t.id)]) {
      const prompt = await composePrompt(talentMemoryInput(expected.task, id));
      expect(hash(prompt.messages)).toBe(expected.messages); expect(hash(prompt.context)).toBe(expected.context); expect(hash(prompt.modules)).toBe(expected.modules);
      expect(JSON.stringify(prompt.context)).not.toContain('PROTAGONIST_TALENT');
    }
  });

  it('玩家名字/职业/输入中的天赋名不构成选择；未知保存 ID 在出站前严格拒绝', async () => {
    const fetcher = vi.fn(() => { throw new Error('Must not send'); }); vi.stubGlobal('fetch', fetcher);
    const input = talentPromptInput('story', 'opening');
    input.state.protagonist.name = '黄金律令'; input.state.protagonist.profession = '枭雄光环'; input.userInput = '想使用赛博暴君';
    expect((await composePrompt(input)).context).not.toHaveProperty('PROTAGONIST_TALENT');
    Reflect.set(input.state.protagonist, 'talentId', 'forged');
    await expect(composePrompt(input)).rejects.toMatchObject({ code: 'configuration' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('三阶段职责和高风险机制保持权责、认知、自主性与四项豪赌条件', () => {
    const story = talentContext('cyber_tyrant', 'story')!, variables = talentContext('golden_edict', 'variables')!, world = talentContext('power_hunter', 'world')!;
    expect(story.stageRules.join('')).toContain('机会发现与能力兑现'); expect(story.stageRules.join('')).toContain('不得替玩家');
    expect(variables.stageRules.join('')).toContain('有充分证据'); expect(variables.stageRules.join('')).toContain('空命令块');
    expect(world.stageRules.join('')).toContain('独立世界的长期回响'); expect(world.stageRules.join('')).toContain('NPC 知道'); expect(world.stageRules.join('')).toContain('受保护现场');
    expect(talentContext('underworld_aura', 'story')!.additionalRules.join('')).toContain('玩家同意');
    expect(talentContext('public_sovereign', 'world')!.additionalRules.join('')).toContain('每个 NPC 好感');
    for (const stage of stages) {
      const risk = talentContext('desperate_gambler', stage)!.additionalRules.join('');
      for (const text of ['玩家主动选择押注', '筹码具有真实重大价值', '失败代价合理明确', '潜在收益明显', '四项同时', '条件不明', '不保证翻盘', '不虚构概率']) expect(risk).toContain(text);
    }
    const payload = talentContext('underworld_aura', 'story')!; payload.commonRules.length = 0;
    expect(talentContext('underworld_aura', 'story')!.commonRules.length).toBeGreaterThan(0);
  });

  it('同一已选天赋的相邻回合固定前缀保持至 CURRENT_TIME，正式目录不在每轮重复八份', async () => {
    for (const stage of stages) {
      const a = await composePrompt(talentPromptInput(stage, 'regular', 'engineering_genius', 1));
      const b = await composePrompt(talentPromptInput(stage, 'regular', 'engineering_genius', 2));
      const joined = (prompt: typeof a) => prompt.messages.map(m => `${m.role}\n${m.content}`).join('\n');
      const first = joined(a), second = joined(b); let prefix = 0;
      while (prefix < first.length && first[prefix] === second[prefix]) prefix++;
      expect(prefix).toBeGreaterThan(first.indexOf('"CURRENT_TIME":'));
    }
  });
});
