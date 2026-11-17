import { describe, expect, it } from 'vitest';
import { composePrompt } from '../prompts/composer';
import { readPromptResource } from '../prompts/loader';
import { createTurnDraft } from '../domain/drafts';
import { defaultSettings } from '../ui/settings/model';
import { worldState } from './fixtures/world';

/** 防八股：自然文风模块点名分类套话与替代写法；两个正文规划在动笔前做文风预检。只影响正文阶段。 */
describe('自然文风（反模板表达）', () => {
  it('套话按类别点名并给出替代写法，补充结构模板、跨回合不重复、下笔前预想与风格关系', async () => {
    const text = await readPromptResource('writing.natural_prose');
    for (const heading of ['固定微表情与身体特写', '万能氛围句', '套路比喻与宏大象征', '对白修饰', '句式模板', '情绪宣布与旁白解读', '段落与结构模板'])
      expect(text).toContain(`- ${heading}：`);
    expect(text).toContain('不是绝对禁用“像、仿佛、似乎、一丝”等正常汉语词汇');
    expect(text).toContain('同一句式在一回合正文里最多出现一次');
    expect(text).toContain('不跨回合重复：前文已经用过的比喻、标志性动作和描写句式，近几回合不再重复使用');
    expect(text).toContain('人物固定的口头禅和习惯动作属于人物特点，可以保持');
    expect(text).toContain('下笔前预想：');
    expect(text).toContain('启用剧情风格时，句子长短、语气与氛围以风格的笔法要求为准；本模块的套话与重复限制在任何风格下都适用');
    expect(text).toContain('本模块只管理 <正文> 的中文叙事质量；<短期记忆>、<变量规划> 按原有的客观记录规则书写');
    // 正文边生成边输出，无法写完后回改：不再要求“写完自查”。
    expect(text).not.toContain('写完自查');
  });
});

describe('正文规划的文风预检', () => {
  it('普通回合 Step 14 第 4 条：具体细节、回避前几回合已用表达、说话方式与节奏；不抄写套话清单', async () => {
    const text = await readPromptResource('planning.regular');
    const step = text.slice(text.indexOf('### Step 14'), text.indexOf('### Step 15'));
    expect(step).toContain('4. 文风预检：');
    expect(step).toContain('最近几回合正文已经用过的比喻、标志性动作和句式，本回合换一种写法');
    expect(step).toContain('规划里只写准备怎么写，不要抄写套话清单');
  });
  it('开局 Step 7 第 4 条：同样预检，但开局没有前文，不含跨回合回看', async () => {
    const text = await readPromptResource('planning.opening');
    const step = text.slice(text.indexOf('### Step 7'), text.indexOf('### Step 8'));
    expect(step).toContain('4. 文风预检：');
    expect(step).toContain('规划里只写准备怎么写，不要抄写套话清单');
    expect(step).not.toContain('最近几回合');
  });
});

describe('组装：只进入正文阶段', () => {
  const state = worldState();
  it.each(['opening', 'regular'] as const)('%s 正文：自然文风与对应规划都在，开关关闭时只剩规划里的预检', async (mode) => {
    const draft = createTurnDraft(state.saveId, state.revision, 'turn-prose', mode, mode === 'opening' ? '' : '去码头');
    const compose = (naturalProse: boolean) => { const settings = defaultSettings(); settings.prompts.naturalProse = naturalProse;
      return composePrompt({ stage: 'story', mode, state, draft, userInput: draft.userInput, settings }); };
    const on = await compose(true), off = await compose(false);
    expect(on.modules.map((m) => m.id)).toEqual(expect.arrayContaining(['writing.natural_prose', `planning.${mode}`]));
    expect(JSON.stringify(on.messages)).toContain('不跨回合重复');
    expect(off.modules.some((m) => m.id === 'writing.natural_prose')).toBe(false);
    expect(JSON.stringify(off.messages)).toContain('文风预检');
  });
});
