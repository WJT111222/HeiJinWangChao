import { expect, it, vi } from 'vitest';
import {
  defaultAiConfig, newChannel, readAiConfig, removeChannel, routeDefaults, setModelRouteFollow,
} from '../services/ai/configuration';
import { requestSnapshot, resolveModelRoute, selectedModelRoute } from '../services/ai/snapshot';
import { CredentialVault } from '../services/ai/credentials';
import { AiClient } from '../services/ai/client';
import { loanReminderDays } from '../ui/phone/phoneView';
import { defaultSettings, mergeSettingsChanges } from '../ui/settings/model';

const keys = ['phoneGroup', 'blackbook', 'theater', 'imagePrompt'] as const;
function setup() {
  const config = defaultAiConfig(), main = newChannel(), extra = newChannel();
  config.channels = [main, extra];
  config.routes.story = { channelId: main.id, modelId: 'original' };
  const independent = { mode: 'independent' as const, channelId: extra.id, modelId: 'specialized' };
  return { config, independent, extra };
}
it('读取旧配置自动补四条路由，保留原有独立选择，且读取不写盘', () => {
  const { config, independent } = setup();
  config.routes.memory = independent;
  const routes = Object.fromEntries(Object.entries(config.routes).filter(([key]) => !keys.some(k => k === key)));
  const legacy = JSON.stringify({ ...config, routes });
  const storage = { getItem: () => legacy, setItem: vi.fn() };
  const restored = readAiConfig(storage);
  expect(restored.routes).toMatchObject(routes);
  for (const key of keys) {
    expect(restored.routes[key]).toEqual({ mode: routeDefaults[key] });
    expect(resolveModelRoute(restored,key).model).toBe('original');
  }
  expect(storage.setItem).not.toHaveBeenCalled();
});
it.each(keys)('%s 恢复默认保存独立选择，删除渠道清除引用', key => {
  const { config, independent, extra } = setup();
  config.routes[key] = independent;
  const follow = setModelRouteFollow(config, key, true);
  expect(follow.routes[key]).toEqual({ mode: routeDefaults[key], independent: { channelId: extra.id, modelId: 'specialized' } });
  expect(setModelRouteFollow(follow, key, false).routes[key]).toEqual(independent);
  for (const candidate of [follow, config]) expect(removeChannel(candidate, extra.id).routes[key]).toEqual({ mode: routeDefaults[key] });
});
it('群聊和小黑书沿私聊、变量到正文逐级解析，异常循环终止', () => {
  const { config, independent } = setup();
  for (const key of ['phoneGroup','blackbook'] as const) {
    expect(resolveModelRoute(config,key).model).toBe('original');
    config.routes.variables = independent;
    expect(resolveModelRoute(config,key).model).toBe('specialized');
    config.routes.phone = { ...independent, modelId:'private' };
    expect(resolveModelRoute(config,key).model).toBe('private');
    config.routes.phone = {mode:'follow-variables'};
    config.routes.variables = {mode:'follow-story'};
  }
  Object.assign(config.routes.variables,{mode:'follow-variables'});
  expect(() => resolveModelRoute(config,'phoneGroup')).toThrow();
  expect(() => selectedModelRoute(config,'phoneGroup')).toThrow();
});
it.each(['phoneGroup','blackbook'] as const)('%s 使用独立模型，保持手机结构化协议且直连失败只发一次', async route => {
  const {config,independent,extra} = setup();
  config.routes[route] = independent;
  extra.baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
  extra.compatibility.jsonMode = true;
  const store = {getItem: () => 'mock-credential', setItem() {}, removeItem() {}};
  const snapshot = requestSnapshot(config,'phone',new CredentialVault(store,store),{route});
  expect(snapshot).toMatchObject({stage:'phone',model:'specialized'});
  const send = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('window',{location:new URL('https://game.example')});
  vi.stubGlobal('localStorage',{getItem:()=>null});
  try {
    await expect(new AiClient(send).generate(snapshot,[{role:'user',content:'sample'}],{stream:false})).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    const [url,init] = send.mock.calls[0];
    expect(String(url)).toBe(extra.baseUrl+'/chat/completions');
    expect(JSON.parse(String(init?.body))).toMatchObject({response_format:{type:'json_object'},model:'specialized'});
  } finally { vi.unstubAllGlobals(); }
});
it('旧偏好保留默认提醒，不同标签的剧场和手机编辑逐项合并', () => {
  const base = defaultSettings();
  expect(loanReminderDays(base.phone)).toBe(3);
  expect(loanReminderDays({loanReminderDays:0})).toBe(0);
  const edited = {...base, phone:{groupReplyLimit:2 as const,loanReminderDays:3},theater:{length:'short' as const,perspective:'follow' as const}};
  const latest = {...base,phone:{loanReminderDays:7},theater:{length:'medium' as const,perspective:'first' as const}};
  expect(mergeSettingsChanges(base,edited,latest)).toMatchObject({phone:{groupReplyLimit:2,loanReminderDays:7},theater:{length:'short',perspective:'first'}});
});
