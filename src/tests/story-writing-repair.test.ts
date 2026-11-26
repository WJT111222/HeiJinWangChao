import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { hasVisibleNarrative } from '../domain/storyContent';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { completeTurnDraft } from '../domain/turnCommit';
import { parseStoryEnvelope } from '../services/validation/aiOutputs';
import { SaveRepository } from '../services/storage/saveRepository';
import { builtInPresets, canResumeWriting, captureStoryWriting, legacyWritingDigest, resolveStoryPreset } from '../presets/library';
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
