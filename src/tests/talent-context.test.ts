import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { talentDefinitions } from '../domain/protagonist/talents';
import { composePrompt, STABLE_CONTEXT_KEYS } from '../prompts/composer';
import { talentContext } from '../prompts/talentContext';
import { estimateTokens } from '../prompts/statistics';
import { sentContext } from './fixtures/contextAssertions';
import { talentPromptInput as currentTalentPromptInput, talentMemoryInput as currentTalentMemoryInput } from './fixtures/talentPrompt';
import baseline from './fixtures/talent-no-selection-baseline.json';
import issue194PromptBaseline from './fixtures/talent-issue-194-prompt-baseline.json';

// 仅本文件的历史字节对照固定为原七字段设置；其他请求测试继续使用新默认设置。
function talentPromptInput(...args: Parameters<typeof currentTalentPromptInput>) {
  const input = currentTalentPromptInput(...args);
  delete input.settings.prompts.maxNarrativeChars;
  return input;
}
function talentMemoryInput(...args: Parameters<typeof currentTalentMemoryInput>) {
  const input = currentTalentMemoryInput(...args);
  delete input.settings.prompts.maxNarrativeChars;
  return input;
}

const stages = ['story', 'variables', 'world'] as const;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
afterEach(() => vi.unstubAllGlobals());

describe('PR-B 条件式单项天赋上下文', () => {
  it.each(talentDefinitions)('$name 的开局与普通 Story 均注入自然叙事约束，不宣读系统标签或削弱能力', async definition => {
    for (const mode of ['opening', 'regular'] as const) {
      const prompt = await composePrompt(talentPromptInput('story', mode, definition.id));
      const selected = sentContext(prompt.messages).PROTAGONIST_TALENT as NonNullable<ReturnType<typeof talentContext>>;
      const rules = selected.stageRules.join('\n');
      for (const requirement of [
        '天赋名称和专属机制名称只是系统识别标签',
        '核心领域、能力介绍、专属机制、长期影响和能力边界',
        '不得按名称字面扩展或误解能力',
        '小说正文不得宣读系统标签',
        '作为千机谋主', '他拥有赛博暴君天赋', '黄金律令的能力发动了', '凭借天工奇才的加持',
        '仅当玩家明确设定为世界内真实外号、头衔或称呼时',
        '成长经历、职业经验、专业能力、分析方法、具体行动与临场表现',
        'NPC 亲历评价和有因果依据的成果',
        '优先具体场景、对话与行动，而非旁白夸赞',
        '开局介绍人生背景时', '不得推翻玩家背景或凭空添加不合理重大成就',
        '普通回合按玩家行动和世界情势自然体现，不强制每回合出现天赋情节',
        '叙事写实不等于能力普通化', '各自领域的顶级优势与独特机会',
        'NPC 不因模型收到天赋资料就自动知道主角能力或秘密',
      ]) expect(rules).toContain(requirement);
      expect(selected.definition).toEqual(definition);
      expect(selected.commonRules.join('')).toContain('显著强于普通角色');
      expect(selected.commonRules.join('')).toContain('NPC 独立意志');
      expect(rules).toContain('不能全知、预知未来或凭空取得访问权限和资源');
      expect(rules).toContain('不能写成已经获利、任职、归附或完成制造');
    }
  });

  it('有天赋 Variables/World 完整请求保留通用与专属规则及已核对的入场提示', async () => {
    // Compared with main using the production composer: only the shared and regular World handoff modules differ.
    const requests = [];
    for (const definition of talentDefinitions) {
      for (const stage of ['variables', 'world'] as const) for (const mode of ['opening', 'regular'] as const) {
        const prompt = await composePrompt(talentPromptInput(stage, mode, definition.id));
        requests.push({ messages: prompt.messages, context: prompt.context, modules: prompt.modules });
      }
      const { commonRules, additionalRules } = talentContext(definition.id, 'story')!;
      requests.push({ definition, commonRules, additionalRules });
    }
    expect(hash(requests)).toBe(issue194PromptBaseline.withTalentVariablesAndWorld);
  });

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

  it.each(baseline.results.filter(r => r.stage !== 'memory'))('无天赋 $stage/$mode 保留 PR-A 上下文与经核对的正式请求', async expected => {
    const input = talentPromptInput(expected.stage as typeof stages[number], expected.mode as 'opening' | 'regular');
    const prompt = await composePrompt(input);
    expect(prompt.context).not.toHaveProperty('PROTAGONIST_TALENT');
    expect(sentContext(prompt.messages)).not.toHaveProperty('PROTAGONIST_TALENT');
    // 已逐消息对照 main：只更新受影响的 Story/World 消息及模块字节，不重录 Variables 或上下文。
    const expectedText = issue194PromptBaseline.results.find(result => result.stage === expected.stage && result.mode === expected.mode) ?? expected;
    expect(hash(prompt.messages)).toBe(expectedText.messages);
    expect(hash(prompt.context)).toBe(expected.context);
    expect(hash(prompt.modules)).toBe(expectedText.modules);
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
