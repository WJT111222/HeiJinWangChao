import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { hasVisibleNarrative } from '../domain/storyContent';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { completeTurnDraft } from '../domain/turnCommit';
import { parseStoryEnvelope } from '../services/validation/aiOutputs';
import { SaveRepository } from '../services/storage/saveRepository';
import { builtInPresets, canResumeWriting, captureStoryWriting, legacyWritingDigest, resolveStoryPreset, writingWitness } from '../presets/library';
import { controls, editOutput, emptyOverride, toggleEntry } from '../presets/peintureSettings';
import { talentPromptInput } from './fixtures/talentPrompt';

const {settings,state,userInput} = talentPromptInput('story','regular');
settings.prompts.actionOptions = false;
const selected = {definition:builtInPresets[0]};

describe('可见正文与独立篇幅约束', () => {
  for (const text of [' ','\n\u0000\u009f','\u200b\u2060\ufeff','\u115f\u3164\u2800','\ufe0f\u{e0100}']) {
    it('仅不可见字符无法进入任何候选 ' + JSON.stringify([...text].map(c=>c.codePointAt(0))), () => {
      for (const min of [4000,null]) {
        expect(() => parseStoryEnvelope(`<正文>${text}</正文><短期记忆>候车。</短期记忆>`,'regular',settings,min))
          .toThrow(expect.objectContaining({details:expect.objectContaining({storyRule:'narrative_empty'})}));
      }
    });
  }
  it.each(['行','👨‍👩‍👧','e\u0301','می\u200cروم','क्‍ष'])('文学正文逐码点保留 %s', text => {
    expect(hasVisibleNarrative(text)).toBe(true);
    expect(parseStoryEnvelope(`<正文>${text}</正文><短期记忆>候车。</短期记忆>`,'regular',settings,null).story.narrative).toBe(text);
  });
  it('新候选写入及已存在的旧候选正式提交均受保护，旧存档仍可读取', async () => {
    const repo = await SaveRepository.open('visibility',new IDBFactory());
    try {
      const base = createTurnDraft(state.saveId,state.revision,'invisible-legacy','regular',userInput,false,false);
      const before = {state,draft:base};
      await repo.importBackup(before,(await repo.compareBackup(before)).confirmation);
      const current = (await repo.loadDraft(state.saveId))!;
      const invalid = rerollStory(current,{turnKind:'regular',narrative:'\u200b',summary:'等车。',variableGuide:[]});
      await expect(repo.saveDraft(invalid,current.draftRevision)).rejects.toMatchObject({code:'STORY_NOT_READY'});
      expect(await repo.loadDraft(state.saveId)).toEqual(current);
      const old = {state:await repo.load(state.saveId),draft:invalid};
      await repo.importBackup(old,(await repo.compareBackup(old)).confirmation,{overwrite:true});
      const stored = (await repo.loadDraft(state.saveId))!;
      const formal = await repo.load(state.saveId);
      expect(completeTurnDraft(stored)).toBe(false);
      await expect(repo.commitTurn({draft:stored,nextAction:'',useVariableStage:false,useWorldStage:false})).rejects.toMatchObject({code:'TURN_INCOMPLETE'});
      expect(await repo.load(state.saveId)).toEqual(formal);
      expect(await repo.loadDraft(state.saveId)).toEqual(stored);
    } finally { repo.close(); }
  });
});

it('有效文学指纹覆盖启用的有序内容及脚本配置；默认、显式默认、互斥往返一致', async () => {
  const pack = await resolveStoryPreset(selected);
  const defaults = emptyOverride(pack), initial = await captureStoryWriting(selected, settings.prompts);
  const capture = (overrides: typeof defaults) => captureStoryWriting({...selected,overrides},settings.prompts);
  const entry = pack.entries.find(row => row.enabled && !row.marker && row.content.trim())!;
  expect(await capture({...defaults,entries:{[entry.identifier]:{enabled:true,content:entry.content}}})).toEqual(initial);
  const on = toggleEntry(pack,defaults,'wave-length-dynamic-more',true);
  const restored = toggleEntry(pack,on,'wave-length-800-1000',true);
  expect(await capture(on)).not.toEqual(initial);
  expect(await capture(restored)).toEqual(initial);
  expect(await capture({...defaults,entries:{[entry.identifier]:{content:entry.content+'新文字'}}})).not.toEqual(initial);
  expect(await capture(editOutput(defaults,{mode:'auto',unescape:false}))).toEqual(initial);
  expect(await capture(editOutput(defaults,{mode:'text',unescape:false}))).not.toEqual(initial);
  expect(await capture({...defaults,scripts:{[controls.mainScript]:{enabled:false}}})).not.toEqual(initial);
  if (initial.source !== 'preset') throw new Error('expected preset');
  const legacy = {source:'preset' as const,id:initial.id,version:initial.version,configuration:await legacyWritingDigest(selected)};
  expect(await canResumeWriting(legacy,initial,{...selected,overrides:restored})).toBe(true);
  expect(await canResumeWriting(legacy,await capture(on),{...selected,overrides:on})).toBe(false);
  expect(await canResumeWriting({...legacy,configuration:'0'.repeat(64)},initial,selected)).toBe(false);
  expect(await canResumeWriting({...initial,version:'other'},initial,selected)).toBe(false);
  expect(await canResumeWriting({...initial,id:'other'},initial,selected)).toBe(false);
});

it('v2 摘要需要当前配置或发行默认值作为见证，重新保存使用 v4', async () => {
  const previous = {source:'preset' as const,id:selected.definition.id,version:selected.definition.version,
    configurationVersion:2 as const,configuration:'0c1b84c5f36d3e8fb04d6ac354b592322af7a203563fb6acd8b7a8f99dd6d618'};
  const loaded = await resolveStoryPreset(selected);
  const overrides = emptyOverride(loaded);
  overrides.entries.chatHistory = {content:'旧版本会计入的占位文本'};
  overrides.entries.worldInfoAfter = {content:'实际由长期记忆替换'};
  const edited = {...selected,overrides}, current = await captureStoryWriting(edited,settings.prompts);
  expect(current).toMatchObject({configurationVersion:4});
  expect(await canResumeWriting(previous,current,edited)).toBe(true);
  expect(await canResumeWriting({...previous,configuration:'0'.repeat(64)},current,edited)).toBe(false);
  const different = {...selected,overrides:toggleEntry(loaded,overrides,'wave-pace-fast',true)};
  expect(await canResumeWriting(previous,await captureStoryWriting(different,settings.prompts),different)).toBe(false);
});

it('有效字段投影保留角色和绝对插入语义，历史槽不读取位置、角色或文本', async () => {
  const { literaryEntry } = await import('../presets/messages');
  const loaded = await resolveStoryPreset(selected);
  const history = loaded.entries.find(row=>row.identifier==='chatHistory')!;
  const material = loaded.entries.find(row=>row.identifier==='worldInfoBefore')!;
  expect(literaryEntry({...history,role:'assistant',content:'任意占位',injection_position:1})).toEqual(literaryEntry(history));
  expect(literaryEntry({...material,content:'被替换'})).toEqual(literaryEntry(material));
  expect(literaryEntry({...material,role:'user'})).not.toEqual(literaryEntry({...material,role:'system'}));
  const absolute = {...material,injection_position:1 as const};
  expect(literaryEntry({...absolute,injection_depth:12})).not.toEqual(literaryEntry({...absolute,injection_depth:13}));
  expect(literaryEntry({...absolute,injection_order:7})).not.toEqual(literaryEntry({...absolute,injection_order:9}));
  expect(literaryEntry(absolute)).not.toEqual(literaryEntry({...material,injection_position:0}));
});


it('已确认的文学来源不能跨预设版本或预设标识发送', async () => {
  const witness = await writingWitness(selected,settings.prompts);
  for (const difference of [{version:'heijin.2'},{id:'another-preset'}]) {
    expect(witness.matches({definition:{...selected.definition,...difference}},settings.prompts)).toBe(false);
  }
});
