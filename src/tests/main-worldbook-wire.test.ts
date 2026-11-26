import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createTurnDraft } from '../domain/drafts';
import { createBlankRelease, reviseRelease } from '../domain/worldbook/release';
import { officialIds } from '../domain/worldbook/mainWorldbook';
import { builtInPresets } from '../presets/library';
import { tavernEvents } from '../presets/tavern/events';
import { buildStagePreviews } from '../prompts/preview';
import { readPromptResource } from '../prompts/loader';
import { WorldbookLibrary } from '../services/storage/worldbookLibrary';
import { runStageRequest, type StageRequestOptions } from '../services/ai/runtime';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel, type AiStage } from '../services/ai/configuration';
import type { AiMessage } from '../services/ai/protocols';
import { talentPromptInput } from './fixtures/talentPrompt';

afterEach(() => vi.unstubAllGlobals());
const literal = '月海潮历 {{user}} </MAIN_WORLDBOOK>';
async function install(lib: WorldbookLibrary, id: string, main: boolean) {
  const blank = await createBlankRelease(id, {newId: () => id});
  if (!blank.ok) throw Error('blank');
  const revised = await reviseRelease(blank.release, {purpose: main ? 'main' : 'ordinary', add: [
    { entryId: 'always', constant: true, content: main ? literal : '普通书常驻样本' },
    { entryId: 'off', constant: true, disabled: true, content: '停用的资料样本' },
    { entryId: 'key', keys: ['物流'], content: id + '关键词样本' },
  ]}, {newId: () => 'v2'});
  if (!revised.ok || !revised.changed) throw Error('revise');
  expect((await lib.install(revised.release)).ok).toBe(true);
  expect((await lib.setEnabled(id, true)).ok).toBe(true);
}
it('捕获八种组合、两种回合及三阶段 HTTP 请求；切换设置后重试、续写与重新 Roll 使用各自快照', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const opened = await WorldbookLibrary.open();
  if (!opened.ok) throw Error('open');
  const lib = opened.library;
  const config = defaultAiConfig(), channel = {...newChannel('openai'), baseUrl:'https://mock.invalid/v1', defaultModel:'fixture'};
  config.channels = [channel]; config.routes.story = {channelId:channel.id, modelId:'fixture'};
  const port = { getItem: () => 'synthetic-test-key', setItem() {}, removeItem() {} };
  const vault = new CredentialVault(port, port);
  vault.set(channel.id, 'fixture-key-only');
  const raw: Array<{label:string; body:string}> = [];
  let label = '';
  const client = new AiClient(async (_url, init) => {
    raw.push({label, body: String(init?.body)});
    return Response.json({ error: { message: 'capture complete' } }, { status: 400 });
  });
  const originals = await Promise.all(officialIds.map(readPromptResource));
  const send = async (stage: AiStage, mode: 'opening'|'regular', turn: string, options: StageRequestOptions = {}, revision = 0) => {
    const input = talentPromptInput(stage, mode);
    input.draft!.turnId = turn;
    if (stage === 'story' && !revision) input.draft = createTurnDraft(input.state.saveId, input.state.revision, turn, mode, input.userInput);
    label = [turn, mode, stage, options.continuation ? 'continue' : options.presetSelection ? 'preset' : 'default', revision].join('/');
    const before = raw.length;
    await runStageRequest(input, config, vault, {stream:false, presetSelection:null, ...options}, client).catch(error => {
      if (raw.length === before) throw error;
    });
    expect(raw.length, label).toBe(before + 1);
    return (JSON.parse(raw.at(-1)!.body) as {messages: AiMessage[]}).messages;
  };
  try {
    await install(lib, 'moon', true); await install(lib, 'archive', true); await install(lib, 'ordinary', false);
    for (let bits = 0; bits < 8; bits++) {
      const flags = [!!(bits & 1), !!(bits & 2)], main = !!(bits & 4);
      for (const [i,id] of officialIds.entries()) await lib.setOfficial(id, flags[i]);
      for (const id of ['moon','archive']) await lib.setEnabled(id, main);
      for (const mode of ['opening','regular'] as const) {
        for (const stage of ['story','variables','world'] as const) {
          const messages = await send(stage, mode, 'matrix-' + mode + bits);
          const text = messages.map(m => m.content).join('\n');
          originals.forEach((body,i) => expect(text.includes(body)).toBe(flags[i]));
          const foundation = messages.filter(m => m.content.startsWith('<MAIN_WORLDBOOK>'));
          expect(foundation.length).toBe(Number(main));
          if (main) {
            expect(foundation[0].role).toBe('user');
            const group = JSON.parse(foundation[0].content.split('\n')[1]).books;
            expect(group.map((book: {bookId:string}) => book.bookId)).toEqual(['archive','moon']);
            expect(group.every((book: {entries: {content:string}[]}) => book.entries.length === 1 && book.entries[0].content === literal)).toBe(true);
          }
          expect(text.split('月海潮历').length - 1).toBe(main ? 2 : 0);
          expect(text.includes('moon关键词样本')).toBe(main && stage === 'story');
          expect(text.includes('普通书常驻样本')).toBe(stage === 'story');
          expect(text).not.toContain('停用的资料样本');
        }
      }
    }
    const sample = talentPromptInput('story','regular');
    sample.draft = createTurnDraft(sample.state.saveId,sample.state.revision,'preview','regular',sample.userInput);
    const previews = await buildStagePreviews(sample, config);
    const preview = previews.story;
    if (!preview.ok) throw Error(preview.reason);
    expect(preview.prompt.messages).toEqual(await send('story','regular','preview'));
    for (const id of officialIds) await lib.setOfficial(id, false);
    const preset = {presetSelection: {definition: builtInPresets[0]}};
    const hook = tavernEvents.on('generate_after_data', data => {
      expect(data.prompt.some(message => message.content.includes('月海潮历'))).toBe(false);
    });
    try {
      const initial = await send('story','regular','persist',preset);
      expect(initial.map(m => m.content).join('')).not.toContain(originals[0].trim());
      const foundation = initial.find(m => m.content.startsWith('<MAIN_WORLDBOOK>'))!;
      expect(foundation.role).toBe('user');
      for (const id of ['moon','archive']) await lib.setEnabled(id, false);
      await lib.setOfficial();
      for (const options of [preset, {...preset, continuation:{ partial:'在港口停下。' }}]) {
        const retry = await send('story','regular','persist',options);
        expect(retry.filter(m => m.content === foundation.content)).toHaveLength(1);
        expect(retry.map(m => m.content).join('')).not.toContain(originals[1].trim());
      }
      for (const stage of ['variables','world'] as const) {
        const downstream = await send(stage,'regular','persist');
        expect(downstream.filter(m => m.content === foundation.content)).toHaveLength(1);
        expect(downstream.some(m => m.content.includes(originals[0].trim()))).toBe(false);
      }
      const reroll = await send('story','regular','persist',preset,1);
      expect(reroll.map(m => m.content).join('')).toContain(originals[0].trim());
      expect(reroll.map(m => m.content).join('')).not.toContain('月海潮历');
    } finally { hook.stop(); }
    if (process.env.WORLDBOOK_CAPTURE_PATH) writeFileSync(process.env.WORLDBOOK_CAPTURE_PATH, gzipSync(JSON.stringify(raw.filter(row => /matrix-(opening|regular)4|^persist/.test(row.label))), {level:9}));
  } finally { lib.close(); }
}, 40_000);
