import { DataError, requireData } from '../domain/common';
import { maxTheaterBody, TheaterRecordSchema, TheaterTarget, TheaterTheme, TheaterTitle, TheaterPerspective } from '../domain/theater/record';
import type { TheaterRecord, TheaterRoute } from '../domain/theater/record';
import { theaterBackground, theaterInputTokens } from '../domain/theater/background';
import type { GameState } from '../domain/state';
import { contextMessage } from '../prompts/contextMessage';
import { readPromptResource } from '../prompts/loader';
import { contextStatistics } from '../prompts/statistics';
import { AiClient } from '../services/ai/client';
import { readAiConfig, modelIdSchema } from '../services/ai/configuration';
import type { AiConfig } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { AiError, safeAiError } from '../services/ai/errors';
import type { AiMessage } from '../services/ai/protocols';
import { channelSnapshot, resolveModelRoute } from '../services/ai/snapshot';
import { safeResponseText, safeStreamResponseText } from '../services/ai/stageResponses';
import type { OpenTheater, TheaterRepository } from '../services/storage/theaters';
import type { Settings } from '../ui/settings/model';

export type TheaterAction = 'initial' | 'continue' | 'reroll';
export type TheaterLock = <T>(key: string, run: () => Promise<T>) => Promise<T>;
export const theaterPerspectives = { first: '第一人称', second: '第二人称', third: '第三人称' };
const routeMessage = '原渠道或模型已不可用。请选择可用渠道和模型，再主动发起生成。';
const privateOutput = () => new DataError('THEATER_PRIVATE', '检测到凭证或不适合保存的响应内容，本次未保存。');

export function theaterCredentials() {
  return { config: readAiConfig(localStorage), vault: new CredentialVault(sessionStorage, localStorage) };
}

function keysFor(config: AiConfig, vault: CredentialVault) {
  return config.channels.map(channel => vault.get(channel.id)).filter(Boolean);
}
function assertPrivate(value: string, secrets: readonly string[]) {
  if (safeResponseText(value, secrets) !== value) throw privateOutput();
}
export function checkTheaterTitle(title: string, config: AiConfig, vault: CredentialVault) {
  const checked = TheaterTitle.parse(title);
  assertPrivate(checked, keysFor(config, vault));
  return checked;
}

async function addressHash(baseUrl: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(baseUrl));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function theaterRoute(config: AiConfig, vault: CredentialVault, choice?: { channelId: string; model: string }): Promise<TheaterRoute> {
  const selection = choice ? { channel: config.channels.find(channel => channel.id === choice.channelId), model: choice.model.trim() }
    : resolveModelRoute(config, 'theater');
  const { channel, model } = selection;
  requireData(channel && modelIdSchema.safeParse(model).success, 'THEATER_ROUTE', routeMessage);
  channelSnapshot(channel, vault, model, 'theater');
  assertPrivate(JSON.stringify({ channelId: channel.id, model }), keysFor(config, vault));
  return { channelId: channel.id, model, protocol: channel.protocol, endpointHash: await addressHash(channel.baseUrl),
    sendTemperature: channel.compatibility.temperature, sendMaxOutputTokens: channel.compatibility.maxOutputTokens,
    ...channel.parameters };
}

export async function prepareTheater(input: { title: string; theme: string; target: number; perspective: 'follow' | TheaterRecord['config']['perspective'];
  stream: boolean; choice?: { channelId: string; model: string } }, settings: Settings, config: AiConfig, vault: CredentialVault) {
  const theme = TheaterTheme.parse(input.theme);
  const target = TheaterTarget.parse(input.target);
  const perspective = TheaterPerspective.parse(input.perspective === 'follow' ? settings.prompts.perspective : input.perspective);
  const title = TheaterTitle.parse(input.title.trim() || Array.from(theme.replace(/\s+/g, ' ')).slice(0, 24).join(''));
  const prompt = settings.theaterPrompt ?? await readPromptResource('theater.novel');
  const secrets = keysFor(config, vault);
  assertPrivate(JSON.stringify({ title, theme, prompt }), secrets);
  const route = await theaterRoute(config, vault, input.choice);
  // Resolve once, then freeze this episode's exact creation context.
  return (state: GameState): TheaterRecord => {
    const background = theaterBackground(state, theme, settings.memory.immediateWindowSize);
    assertPrivate(background.context, secrets);
    const now = new Date().toISOString();
    return TheaterRecordSchema.parse({
      version: 1, id: crypto.randomUUID(), saveId: state.saveId, revision: 0,
      title, theme, background,
      config: { target, perspective, followsPerspective: input.perspective === 'follow',
        route, routeMode: input.choice ? 'independent' : 'story', prompt, stream: input.stream, timeoutSeconds: settings.runtime.timeoutSeconds },
      body: '', status: 'empty', createdAt: now, updatedAt: now,
    });
  };
}

export function theaterMessages(record: TheaterRecord, action: TheaterAction): AiMessage[] {
  const { prompt, target, perspective } = record.config;
  const base = {
    theme: record.theme, perspective: theaterPerspectives[perspective], targetCharacters: target, action,
    ...(action === 'continue' ? { existingCharacters: Array.from(record.body).length } : {}),
  };
  const messages = (continuation?: { full: string } | { opening: string; recent: string; omitted: boolean }): AiMessage[] => [
    { role: 'system', content: prompt },
    { role: 'user', content: record.background.context + '\n\n' +
      contextMessage({ ...base, ...(continuation ? { continuation } : {}) }, 'THEATER_TASK') },
  ];
  const within = (items: AiMessage[]) => contextStatistics(items).estimatedTokens <= theaterInputTokens;
  if (action !== 'continue') {
    const result = messages();
    requireData(within(result), 'THEATER_CONTEXT', '创作要求与背景超出输入预算，请缩短主题或提示词后新建。');
    return result;
  }
  // Encode before estimating since escaping player data also consumes budget.
  let limit = Math.min(record.body.length, 8200);
  for (;;) {
    const head = Math.min(1400, Math.floor(limit / 4)), tail = limit - head;
    const prior = record.body.length <= limit ? { full: record.body } :
      { opening: record.body.slice(0, head), recent: record.body.slice(-tail), omitted: true };
    const result = messages(prior);
    if (within(result)) return result;
    if (limit <= 256) throw new DataError('THEATER_CONTEXT', '背景与创作要求超出续写预算。');
    limit = Math.floor(limit / 2);
  }
}

export function appendTheaterText(prior: string, addition: string) {
  let overlap = Math.min(prior.length, addition.length, 2048);
  while (overlap >= 16 && !prior.endsWith(addition.slice(0, overlap))) overlap--;
  const unique = overlap >= 16 ? addition.slice(overlap) : addition;
  requireData(unique.trim(), 'THEATER_EMPTY', '续写只重复了已保存的末尾。');
  return prior + (/[。！？.!?」”]$/u.test(prior) && !/^\s/u.test(unique) ? '\n\n' : '') + unique;
}

export const browserTheaterLock: TheaterLock = async (key, run) => {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new AiError('concurrency_unavailable');
  return navigator.locks.request('heijin.theater:' + key, { ifAvailable: true }, lock => {
    requireData(lock, 'THEATER_BUSY', '这篇小剧场正在其他标签生成。');
    return run();
  });
};
export type TheaterRunResult =
  | { kind: 'saved'; value: OpenTheater }
  | { kind: 'incomplete'; status: 'partial' | 'stopped'; body: string; message: string }
  | { kind: 'failed'; message: string; value?: OpenTheater };

export function theaterError(error: unknown) {
  if (error instanceof DataError) return error.message;
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return '浏览器存储空间不足，原有正文已保留。';
  if (error instanceof AiError && ['not_found', 'authorization', 'credentials'].includes(error.code))
    return routeMessage + ' ' + safeAiError(error).message;
  return error instanceof AiError ? safeAiError(error).message : '操作失败，请检查本地存储及配置。原有正文已保留。';
}

function cleanText(text: string) {
  // This is transport cleanup. A leading planning block is not part of the novel.
  const stripped = text.replace(/^\s*<\s*(think|thinking)\s*>[\s\S]*?(?:<\/\s*\1\s*>|$)\s*/i, '');
  if (/^\s*(?:<\s*(?:think(?:ing)?)?\s*$|\{\s*"(?:error|choices|candidates)"\s*:|data:\s*[{[])/i.test(stripped)) return '';
  return stripped;
}

export async function runTheater(repository: TheaterRepository, opened: OpenTheater, action: TheaterAction, input: {
  config: AiConfig; vault: CredentialVault; signal: AbortSignal; lifetime: AbortSignal;
  onText?: (text: string) => void; onReasoning?: (text: string) => void; onSaving?: () => void;
}, client = new AiClient(), withLock = browserTheaterLock): Promise<TheaterRunResult> {
  return withLock(JSON.stringify([opened.owner.saveId, opened.record.id]), async () => {
    const record = await repository.verify(opened);
    requireData(action !== 'initial' || !record.body, 'THEATER_CONFLICT', '此篇已有正文，请使用续写或重新 Roll。');
    requireData(action !== 'continue' || record.body, 'THEATER_EMPTY', '请先生成可续写的正文。');
    const { route, stream, timeoutSeconds } = record.config;
    const { signal, lifetime } = input;
    const channel = input.config.channels.find(item => item.id === route.channelId);
    requireData(channel && channel.protocol === route.protocol && await addressHash(channel.baseUrl) === route.endpointHash,
      'THEATER_ROUTE', routeMessage);
    const snapshot = channelSnapshot({ ...channel, parameters: { temperature: route.temperature, maxOutputTokens: route.maxOutputTokens },
      compatibility: { ...channel.compatibility, temperature: route.sendTemperature, maxOutputTokens: route.sendMaxOutputTokens },
    }, input.vault, route.model, 'theater');
    const messages = theaterMessages(record, action);
    const secrets = keysFor(input.config, input.vault);
    assertPrivate(JSON.stringify(messages), secrets);
    const combined = AbortSignal.any([signal, lifetime]);
    if (combined.aborted) return { kind: 'failed', message: '生成已取消。' };

    let received = '', reasoning = '';
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    const publish = () => {
      publishTimer = undefined;
      if (!combined.aborted) input.onText?.(safeStreamResponseText(cleanText(received), secrets));
    };
    let limitedLocally = false;
    const localCapacity = new AbortController();
    const responseCapacity = maxTheaterBody - (action === 'continue' ? record.body.length : 0);
    requireData(responseCapacity > 0, 'THEATER_CAPACITY', '这篇正文已达到单篇存储上限。');
    const checkedBody = (value: string, truncated = false) => {
      assertPrivate(value, secrets);
      const clean = cleanText(value);
      if (!clean.trim()) return '';
      const body = action === 'continue' ? appendTheaterText(record.body, clean) : clean;
      assertPrivate(body, secrets);
      if (truncated && (safeStreamResponseText(value, secrets) !== value || safeStreamResponseText(body, secrets) !== body))
        throw privateOutput();
      requireData(body.length <= maxTheaterBody, 'THEATER_CAPACITY', '新增正文超过单篇存储上限。');
      return body;
    };
    const incomplete = (value: string, status: 'partial' | 'stopped', message: string): TheaterRunResult => {
      try {
        const body = checkedBody(value, true);
        if (body) return { kind: 'incomplete', body, status, message };
      } catch (error) { return { kind: 'failed', message: theaterError(error) }; }
      return { kind: 'failed', message };
    };
    await repository.verify(opened);
    let response;
    try {
      response = await client.generate(snapshot, messages, { timeoutSeconds, stream, recordInspection: false,
        signal: AbortSignal.any([combined, localCapacity.signal]),
        onDelta: delta => {
          if (combined.aborted || limitedLocally) return;
          received += delta.slice(0, responseCapacity + 2048 - received.length);
          if (received.length >= responseCapacity + 2048) { limitedLocally = true; localCapacity.abort(); }
          if (input.onText && publishTimer === undefined) publishTimer = setTimeout(publish, 25);
        },
        onReasoningDelta: delta => {
          if (combined.aborted || reasoning.length >= 24_000) return;
          reasoning += delta.slice(0, 24_000 - reasoning.length);
          input.onReasoning?.(safeStreamResponseText(reasoning, secrets));
        },
      });
    } catch (error) {
      if (lifetime.aborted) return { kind: 'failed', message: '已离开小剧场。' };
      const code = safeAiError(error).code;
      if (signal.aborted || code === 'cancelled' && !limitedLocally)
        return incomplete(received, 'stopped', '生成已停止。');
      if (limitedLocally) return incomplete(received.slice(0, Math.max(0, responseCapacity - 2)), 'partial', '已达到单篇存储上限。');
      if (['stream_interrupted', 'timeout', 'output_limit'].includes(code) && received.trim())
        return incomplete(received, 'partial', theaterError(error));
      const value = !record.body && !lifetime.aborted ? await repository.saveText(opened, '', 'failed', lifetime) : undefined;
      return { kind: 'failed', message: theaterError(error), value };
    } finally {
      if (publishTimer !== undefined) clearTimeout(publishTimer);
    }
    if (lifetime.aborted) return { kind: 'failed', message: '已离开小剧场。' };
    if (signal.aborted) return incomplete(response.text, 'stopped', '生成已停止。');
    if (response.outputLimited) return incomplete(response.text, 'partial', '本次已达模型输出上限，可保留后手动续写。');
    const body = checkedBody(response.text);
    if (!body) {
      const value = !record.body ? await repository.saveText(opened, '', 'failed', lifetime) : undefined;
      return { kind: 'failed', message: '模型没有返回可保存的小说正文。', value };
    }
    input.onSaving?.();
    const value = await repository.saveText(opened, body, 'complete', lifetime);
    return { kind: 'saved', value };
  });
}
