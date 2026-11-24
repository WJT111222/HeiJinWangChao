import { afterEach, expect, it, vi } from 'vitest';
import { runtimeLogEvent } from '../ui/game/runtimeLog';
import { AiError } from '../services/ai/errors';
import { newChannel, defaultAiConfig, saveAiConfig } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { stageResponses } from '../services/ai/stageResponses';
import { requestInspections } from '../services/ai/inspection';
import { channelSnapshot } from '../services/ai/snapshot';
import { prepareErrorPayload, FeedbackCorrelation, suggestionPayload } from '../services/feedback/report';
import { feedbackSchema } from '../services/feedback/contract';
import { cleanFeedbackText } from '../services/feedback/textSafety';

const scope = { saveRef: 'private-save-ref', turnRef: 'private-turn-ref' };
const ids = { saveId: 'synthetic-private-save', turnId: 'synthetic-private-turn', stage: 'variables' as const };
const credential = 'synthetic-deepseek-credential';
const failure = new AiError('empty');
function configure() {
  const data = new Map<string, string>();
  const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => {
    data.set(key, value);
  }, removeItem: (key: string) => { data.delete(key); } };
  vi.stubGlobal('window', { localStorage: store, sessionStorage: store });
  const channel = newChannel('deepseek'), config = defaultAiConfig();
  channel.defaultModel = 'safe-model';
  config.channels.push(channel);
  saveAiConfig(store, config);
  const vault = new CredentialVault(store, store);
  vault.set(channel.id, credential);
  return channelSnapshot(channel, vault, channel.defaultModel, 'variables');
}
afterEach(() => { requestInspections.clear(); stageResponses.clear(); vi.unstubAllGlobals(); });

it('只关联新失败且匹配存档、回合、阶段、错误码的原文，不会拿旧失败、候选或其他存档内容', () => {
  const correlation = new FeedbackCorrelation();
  const old = stageResponses.begin(ids);
  stageResponses.update(old, { status: 'failed', text: '旧原文', error: { code: 'empty', message: 'empty' } }, []);
  const first = runtimeLogEvent(1, 'variables', 'started', undefined, scope);
  correlation.record(first, ids.saveId, ids.turnId);
  const other = stageResponses.begin({ ...ids, saveId: 'other-save' });
  stageResponses.update(other, { status: 'failed', text: '其他存档原文', error: { code: 'empty', message: 'empty' } }, []);
  const second = runtimeLogEvent(2, 'variables', 'failed', failure, scope);
  correlation.record(second, ids.saveId, ids.turnId);
  const result = prepareErrorPayload([first, second], stageResponses.getSnapshot(), { content: true, reasoning: true })('');
  expect(result.errors).toHaveLength(1);
  expect(result.attachments).toBeUndefined();
});

it('仅投影失败结构，去除凭证、响应关联 ID、提示词回显和存档结构', () => {
  const snapshot = configure();
  const correlation = new FeedbackCorrelation();
  const start = runtimeLogEvent(1, 'variables', 'started', undefined, scope);
  correlation.record(start, ids.saveId, ids.turnId);
  const responseId = stageResponses.begin({ ...ids, protocol: 'deepseek' });
  const prompt = '这段在请求检查器里存在的完整合成提示词。'.repeat(6);
  const body = JSON.stringify({ messages: [{ role: 'system', content: prompt }] });
  requestInspections.start(snapshot, body, { responseId, kind: 'stage', mode: 'regular', modules: [], saveId: ids.saveId, revision: 1 });
  stageResponses.update(responseId, {
    status: 'failed', error: { code: 'empty', message: 'empty' }, text: '回显 ' + prompt,
    nativeReasoning: '可选思考 ' + credential + ' ' + ids.saveId + ' ' + ids.turnId,
    normalized: '不上传的内部物件',
  }, []);
  const log = runtimeLogEvent(2, 'variables', 'failed', failure, scope);
  correlation.record(log, ids.saveId, ids.turnId);
  const report = prepareErrorPayload([log], stageResponses.getSnapshot(), { content: true, reasoning: true })('Cookie: session=private; token=super-secret');
  expect(feedbackSchema.safeParse(report).success).toBe(true);
  expect(report.errors[0]).toMatchObject({ ref: 1, model: 'safe-model', protocol: 'deepseek' });
  expect(report.attachments).toEqual([{ errorRef: 1, content: undefined, reasoning: '可选思考 [密钥已隐藏] [本地标识已隐藏] [本地标识已隐藏]', truncated: undefined }]);
  expect(report.text).toBe('[凭证已隐藏]');
  const bodyText = JSON.stringify(report);
  for (const protectedText of [credential, responseId, ids.saveId, ids.turnId, scope.saveRef, scope.turnRef, prompt, 'super-secret', '不上传的内部物件']) {
    expect(bodyText).not.toContain(protectedText);
  }
  expect(suggestionPayload('problem', prompt).text).toBe('[请求或存档内容已隐藏]');
  expect(suggestionPayload('problem', '{"schemaVersion":1,"protagonist":{"name":"私人姓名"}}').text).toBe('[请求或存档内容已隐藏]');
});

it('只截短已选择的多份附件，所有错误仍保留', () => {
  const correlation = new FeedbackCorrelation();
  const logs = Array.from({ length: 50 }, (_, i) => {
    if (i >= 6) return runtimeLogEvent(i + 1, 'commit', 'failed', failure, scope);
    correlation.record(runtimeLogEvent(i + 100, 'variables', 'started', undefined, scope), ids.saveId, ids.turnId);
    const id = stageResponses.begin(ids);
    stageResponses.update(id, { status: 'failed', error: { code: 'empty', message: 'empty' },
      text: '合成输出'.repeat(12000), nativeReasoning: '原生思考'.repeat(12000) }, []);
    const log = runtimeLogEvent(i + 1, 'variables', 'failed', failure, scope);
    correlation.record(log, ids.saveId, ids.turnId);
    return log;
  });
  const report = prepareErrorPayload(logs, stageResponses.getSnapshot(), { content: true, reasoning: true })('');
  expect(feedbackSchema.safeParse(report).success).toBe(true);
  expect(report.errors).toHaveLength(50);
  expect(report.attachments).toHaveLength(6);
  expect(report.attachments?.every(item => item.truncated && item.content?.length === 5000 && item.reasoning?.length === 5000)).toBe(true);
});

it('凭证隐藏是幂等的，完整鉴权头不会保留下来', () => {
  const input = '合成报告\nAuthorization: Digest username=operator, response=secret\nApi_Key: synthetic';
  const clean = cleanFeedbackText(input);
  expect(clean).not.toContain('operator');
  expect(clean).not.toContain('secret');
  expect(clean).not.toContain('synthetic');
  expect(cleanFeedbackText(clean)).toBe(clean);
});

it('勾选模型原文时不会上传兼容正文开头的公开思考块', () => {
  const correlation = new FeedbackCorrelation();
  const start = runtimeLogEvent(1, 'story', 'started', undefined, scope);
  correlation.record(start, ids.saveId, ids.turnId);
  const id = stageResponses.begin({ ...ids, stage: 'story', protocol: 'openai' });
  stageResponses.update(id, { status: 'failed', error: { code: 'invalid_output', message: 'unusable' },
    text: '<think>兼容公开思考</think><thinking>项目规划</thinking><正文>合成正文</正文>' }, []);
  const log = runtimeLogEvent(2, 'story', 'failed', new AiError('invalid_output'), scope);
  correlation.record(log, ids.saveId, ids.turnId);
  const records = stageResponses.getSnapshot();
  const content = prepareErrorPayload([log], records, { content: true, reasoning: false })('');
  expect(content.attachments?.[0]).toMatchObject({ errorRef: 1, content: '<thinking>项目规划</thinking><正文>合成正文</正文>' });
  expect(JSON.stringify(content)).not.toContain('兼容公开思考');
  const reasoning = prepareErrorPayload([log], records, { content: false, reasoning: true })('');
  expect(reasoning.attachments?.[0]).toMatchObject({ errorRef: 1, reasoning: '兼容公开思考' });
  expect(JSON.stringify(reasoning)).not.toContain('合成正文');
});
