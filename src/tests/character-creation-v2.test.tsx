import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { IDBFactory } from 'fake-indexeddb';
import { CreationSchema, newCreation, selectProfession, professionProfile, professions, professionCategories, buildCreationState, createProfileSave, validateStep } from '../ui/creation/model';
import { appearanceTemplates, personalityTemplates } from '../ui/creation/personTemplates';
import { CreationWizard } from '../ui/creation/CreationWizard';
import { ProfessionProfile } from '../ui/components/ProfessionProfile';
import { defaultSettings } from '../ui/settings/model';
import { SaveRepository } from '../services/storage/saveRepository';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { composePrompt } from '../prompts/composer';
import { parseVariableText } from '../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import { game, story } from './fixtures/game';
import { completeDraft, submission } from './fixtures/turn';
import { worldResult } from './fixtures/world';
import type { ExecutionResult } from '../executors/variableText';

function filled() {
  const form = newCreation();
  form.person = { name: '林舟', age: '30', gender: '女性', appearance: '自定义外貌', personality: '自定义性格' };
  return form;
}
function unwrap<T>(result: ExecutionResult<T>) { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; }
const noChange = () => {};
describe('创角 V2 正式人物资料', () => {
  it('默认自由选择且性别仅有两个单选项', () => {
    const form = newCreation();
    expect([form.profession, form.appearanceTemplate, form.personalityTemplate]).toEqual(['custom', 'custom', 'custom']);
    expect([form.skills, form.professionDescription, form.professionLongTermImpact, form.customProfession]).toEqual(['', '', '', '']);
    const html = renderToStaticMarkup(<CreationWizard form={form} onChange={noChange} onCreate={noChange} onExit={noChange} busy={false} />);
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toContain('value="男性"'); expect(html).toContain('value="女性"');
  });
  it.each(['', '-1', '1.5', 'abc', '9007199254740992'])('年龄 %s 延续原整数校验', (age) => {
    const form = filled(); form.person.age = age; expect(() => validateStep(form, 1)).toThrow();
  });
  it('姓名仍必填，不接受性别自由文本，NPC定义不受影响', () => {
    const form = filled(); form.person.name = ' '; expect(() => validateStep(form, 1)).toThrow();
    form.person.name = '林舟'; form.person.gender = '自由文本'; expect(() => validateStep(form, 1)).toThrow();
    for (const gender of ['男性', '女性']) { form.person.gender = gender; expect(() => validateStep(form, 1)).not.toThrow(); }
  });
  it.each([...appearanceTemplates, ...personalityTemplates])('$name 是可编辑的完整文字，无属性分值', (template) => {
    expect([...template.description].length).toBeGreaterThanOrEqual(100); expect([...template.description].length).toBeLessThanOrEqual(180);
    expect(Object.keys(template).sort()).toEqual(['description', 'name']);
    const form = filled(); form.person.appearance = template.description + ' 玩家修改。'; form.step = 3;
    expect(CreationSchema.parse(JSON.parse(JSON.stringify(form))).person.appearance).toBe(form.person.appearance);
  });
  it('五个方向各六套，顺序固定', () => {
    expect(professionCategories).toEqual(['学生与人生阶段', '企业与商业', '专业与公共服务', '技术与生产', '城市服务与自由职业']);
    expect(professions).toHaveLength(30);
    for (const category of professionCategories) expect(professions.filter(job => job.category === category)).toHaveLength(6);
    expect(appearanceTemplates.map(t => t.name)).toEqual(['自然耐看', '清爽干练', '温润斯文', '冷峻凌厉', '成熟硬朗', '惊艳出众']);
    expect(personalityTemplates.map(t => t.name)).toEqual(['沉稳谨慎', '开朗健谈', '冷静理性', '直率果敢', '圆滑世故', '野心勃勃']);
  });
  it.each(professions)('$name 四项资料进入正式状态且不生成资产或权限', (job) => {
    expect(job.description.length).toBeGreaterThanOrEqual(100); expect(job.description.length).toBeLessThanOrEqual(180);
    expect(job.longTermImpact.length).toBeGreaterThanOrEqual(100); expect(job.longTermImpact.length).toBeLessThanOrEqual(180);
    expect(job.skills.length).toBeGreaterThanOrEqual(3); expect(job.skills.length).toBeLessThanOrEqual(5);
    expect(new Set(job.skills).size).toBe(job.skills.length);
    const state = buildCreationState(selectProfession(filled(), job.name), defaultSettings());
    expect(state.protagonist).toMatchObject({ profession: job.name, professionDescription: job.description, professionLongTermImpact: job.longTermImpact, skills: job.skills });
    expect(state.economy.cash).toBeNull(); expect(state.economy.onlineBalance).toBeNull();
    expect(state.items).toEqual({}); expect(state.organizations).toEqual({});
    expect(state.protagonist.publicStatus).toBeUndefined(); expect(state.protagonist.legalStatus).toBeUndefined();
  });
  it('自由职业四项独立保存，跨预设与刷新后恢复且不携带预设技能', () => {
    const custom = { ...filled(), customProfession: '纸艺修复师', professionDescription: '在旧书工作室修复纸质藏品。', skills: '修补\n配色\n装帧\n辨纸\n记录\n沟通', professionLongTermImpact: '长期接触收藏者与图书馆。' };
    const preset = selectProfession(custom, '律师'); expect(preset.skills).not.toBe(custom.skills);
    const restored = selectProfession(CreationSchema.parse(JSON.parse(JSON.stringify(preset))), 'custom');
    expect(professionProfile(restored)).toEqual({ name: custom.customProfession, description: custom.professionDescription, skills: custom.skills.split('\n'), longTermImpact: custom.professionLongTermImpact });
    expect(professionProfile(selectProfession(selectProfession(filled(), '教师'), 'custom')).skills).toEqual([]);
  });
  it('确认页与档案完整展示长文本和独立技能，展示不修改资料', () => {
    const form = { ...selectProfession(filled(), '企业经营者'), step: 5 }, before = structuredClone(form);
    const hero = buildCreationState(form, defaultSettings()).protagonist;
    const confirmation = renderToStaticMarkup(<CreationWizard form={form} onChange={noChange} onCreate={noChange} onExit={noChange} busy={false} />);
    const profile = renderToStaticMarkup(<ProfessionProfile hero={hero} />);
    for (const html of [confirmation, profile]) {
      expect(html).toContain(hero.professionDescription); expect(html).toContain(hero.professionLongTermImpact);
      for (const skill of hero.skills) expect(html).toContain(`<li>${skill}</li>`);
    }
    expect(form).toEqual(before);
  });
  it('四项自定义资料创建、读取、关闭数据库后重载不丢失', async () => {
    const factory = new IDBFactory(), form = { ...filled(), customProfession: '调音师', professionDescription: '负责琴行与现场调音。', skills: '听音\n调弦', professionLongTermImpact: '认识本地演奏者。' };
    const repo = await SaveRepository.open('creation-v2', factory);
    await createProfileSave(repo, form, defaultSettings());
    const original = await repo.load(form.saveId); repo.close();
    const reopened = await SaveRepository.open('creation-v2', factory);
    try { expect(await reopened.load(form.saveId)).toEqual(original); expect(original.protagonist).toMatchObject({ profession: '调音师', professionDescription: form.professionDescription, professionLongTermImpact: form.professionLongTermImpact, skills: ['听音', '调弦'] }); }
    finally { reopened.close(); }
  });
  it.each(['opening', 'regular'] as const)('%s 三阶段实际 Composer 读取同一份正式职业，不加载全模板库', async (mode) => {
    const state = buildCreationState(selectProfession(filled(), '工程师'), defaultSettings());
    const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'profile-turn', mode, '继续'), { ...story, turnKind: mode,
      variableGuide: [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: '2015-07-08T08:00:00+08:00', endAt: '2015-07-08T08:05:00+08:00' }) }] });
    if (mode === 'regular') { delete state.openingTimePending; delete state.openingInitializationPending; }
    for (const stage of ['story', 'variables', 'world'] as const) {
      const result = await composePrompt({ state, draft, mode, stage, userInput: '继续', settings: defaultSettings() });
      const text = result.messages.map(m => m.content).join('\n');
      expect(text).toContain(state.protagonist.professionDescription); expect(text).toContain(state.protagonist.professionLongTermImpact);
      for (const skill of state.protagonist.skills) expect(text).toContain(skill);
      expect(text).not.toContain(professions.find(j => j.name === '网约车司机')!.longTermImpact);
      if (stage === 'variables') expect(text).toContain('protagonist.professionDescription');
    }
  });
});

describe('职业资料沿现有文本命令维护', () => {
  async function execute(body: string, mode: 'opening' | 'regular' = 'regular') {
    const state = game(); if (mode === 'regular') { state.turnNumber = 1; state.journal = [{ turnId: 'previous', revision: 0, story, relatedActorRefs: [] }]; } Object.assign(state.protagonist, { profession: '教师', professionDescription: '旧职业介绍', professionLongTermImpact: '旧职业影响', skills: ['教学', '急救'] });
    const before = structuredClone(state), draft = rerollStory(createTurnDraft(state.saveId, 0, 'profession-update', mode, ''), { ...story, turnKind: mode });
    const context = { draft, expectedRevision: 0 }, ast = parseVariableText(`<命令>\n${body}\n</命令>`);
    if (!ast.ok) throw new Error('Invalid fixture');
    const plan = unwrap(await compileVariableCommands(ast.value, state, context)), next = unwrap(await simulateVariablePlan(plan, state, context));
    expect(state).toEqual(before); return { state, next, plan, context, ast: ast.value };
  }
  it('名称单独变更清除旧职业说明但保留技能', async () => {
    const { next } = await execute('set protagonist.profession = "退休人士"');
    expect(next.protagonist).toMatchObject({ profession: '退休人士', professionDescription: '', professionLongTermImpact: '', skills: ['教学', '急救'] });
  });
  it('同名更新不清空档案', async () => {
    const { next } = await execute('set protagonist.profession = "教师"');
    expect(next.protagonist.professionDescription).toBe('旧职业介绍');
  });
  it.each([
    'set protagonist = {"profession":"社区讲师","professionDescription":"讲授社区课程","professionLongTermImpact":"继续联系学员"}',
    'set protagonist.profession = "社区讲师"\nset protagonist.professionDescription = "讲授社区课程"\nset protagonist.professionLongTermImpact = "继续联系学员"',
  ])('对象和字段映射经真实编译模拟，重放不重复应用', async body => {
    const { next, plan, context, ast } = await execute(body);
    expect(next.protagonist).toMatchObject({ profession: '社区讲师', professionDescription: '讲授社区课程', professionLongTermImpact: '继续联系学员', skills: ['教学', '急救'] });
    expect(await simulateVariablePlan(plan, next, context)).toMatchObject({ ok: false, error: { code: 'revision_conflict' } });
    const replay = unwrap(await compileVariableCommands(ast, next, context));
    expect(unwrap(await simulateVariablePlan(replay, next, context))).toEqual(next);
  });
  it('编译后的职业变更经候选保存、Commit重验、幂等回执及重载保留全部字段', async () => {
    const { state, plan, context } = await execute('set protagonist = {"profession":"调音师","professionDescription":"琴行调音","professionLongTermImpact":"长期联系演奏者"}', 'opening');
    const repo = await SaveRepository.open('profession-commit', new IDBFactory());
    try {
      await repo.create(state);
      await repo.saveDraft(createTurnDraft(state.saveId, state.revision, context.draft.turnId, 'opening', ''), null);
      const draft = await completeDraft(repo, { variables: { commands: [...plan.commands], rejectedSuggestions: [], unresolved: [] },
        world: worldResult(), narrative: story.narrative, summary: story.summary, variableGuide: [] });
      expect(await repo.load(state.saveId)).toEqual(state);
      const input = submission(draft, ''), committed = await repo.commitTurn(input);
      expect(committed.state.protagonist).toMatchObject({ profession: '调音师', professionDescription: '琴行调音', professionLongTermImpact: '长期联系演奏者', skills: ['教学', '急救'] });
      expect((await repo.commitTurn(input)).replayed).toBe(true);
      expect(await repo.load(state.saveId)).toEqual(committed.state);
    } finally { repo.close(); }
  });
  it('错误字段类型仍整批拒绝，不接受任意职业附加对象', async () => {
    await expect(execute('set protagonist.professionDescription = 3')).rejects.toThrow();
    await expect(execute('set protagonist = {"profession":"医生","licensed":true}')).rejects.toThrow();
  });
});
