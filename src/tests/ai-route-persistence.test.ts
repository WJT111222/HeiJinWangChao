import { describe, expect, it } from 'vitest';
import { AiConfigSchema, defaultAiConfig, newChannel, readAiConfig, removeChannel, saveAiConfig, setModelRouteFollow } from '../services/ai/configuration';
import { requestSnapshot, resolveModelRoute } from '../services/ai/snapshot';
import { CredentialVault } from '../services/ai/credentials';

const tasks = ['variables', 'world', 'memory'] as const;
function store() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function fixture() {
  const config = defaultAiConfig(), storage = store(), credentials = store();
  config.channels = ['story', ...tasks].map(id => ({ ...newChannel(), id, name: id, defaultModel: `${id}-default` }));
  config.routes.story = { channelId: 'story', modelId: 'story-override' };
  for (const stage of tasks) config.routes[stage] = { mode: 'independent', channelId: stage, modelId: `${stage}-override` };
  const vault = new CredentialVault(credentials, credentials);
  for (const channel of config.channels) vault.set(channel.id, 'test-only-secret');
  return { config, storage, vault };
}
describe('per-stage independent selection while following Story', () => {
  it.each(tasks)('%s restores exact channel/model after saving follow mode and reloading', stage => {
    const a = fixture(), original = structuredClone(a.config), other = tasks.filter(task => task !== stage);
    const following = setModelRouteFollow(a.config, stage, true);
    expect(a.config).toEqual(original);
    expect(resolveModelRoute(following, stage).model).toBe('story-override');
    saveAiConfig(a.storage, following);
    expect(a.storage.getItem('heijin.ai.v1')).not.toContain('test-only-secret');
    const loaded = readAiConfig(a.storage), restored = setModelRouteFollow(loaded, stage, false);
    expect(restored.routes[stage]).toEqual(original.routes[stage]);
    expect(requestSnapshot(restored, stage, a.vault).model).toBe(`${stage}-override`);
    for (const task of other) expect(restored.routes[task]).toEqual(original.routes[task]);
    expect(setModelRouteFollow(following, stage, true)).toEqual(following);
    expect(setModelRouteFollow(restored, stage, false)).toEqual(restored);
  });
  it.each(tasks)('%s with no saved independent selection stays unconfigured rather than silently inheriting', stage => {
    const a = fixture(); a.config.routes[stage] = {mode:'follow-story'};
    const independent = setModelRouteFollow(a.config, stage, false);
    expect(independent.routes[stage]).toEqual({mode:'independent',channelId:'',modelId:''});
    expect(() => resolveModelRoute(independent,stage)).toThrow(expect.objectContaining({code:'configuration'}));
    saveAiConfig(a.storage,independent); expect(readAiConfig(a.storage).routes[stage]).toEqual(independent.routes[stage]);
  });
  it('changes to Story do not replace any remembered independent selection or an in-flight snapshot', () => {
    const a=fixture();const snapshot=requestSnapshot(a.config,'variables',a.vault);
    let config=a.config;for(const task of tasks)config=setModelRouteFollow(config,task,true);
    config.routes.story={channelId:'memory',modelId:'new-story'};
    for(const task of tasks){
      expect(resolveModelRoute(config,task).model).toBe('new-story');
      const restored=setModelRouteFollow(config,task,false);
      expect(restored.routes[task]).toEqual(a.config.routes[task]);
    }
    expect(snapshot.model).toBe('variables-override');expect(snapshot.channel.id).toBe('variables');
  });
  it('retains default-model selection as empty modelId without converting it to an override', () => {
    const a=fixture();a.config.routes.variables={mode:'independent',channelId:'variables',modelId:''};
    saveAiConfig(a.storage,setModelRouteFollow(a.config,'variables',true));
    const restored=setModelRouteFollow(readAiConfig(a.storage),'variables',false);
    expect(restored.routes.variables).toEqual(a.config.routes.variables);
    expect(resolveModelRoute(restored,'variables').model).toBe('variables-default');
  });
  it.each(tasks)('deleting an active %s channel leaves explicit independent mode and clears dangling IDs', stage => {
    const a=fixture(), removed=removeChannel(a.config,stage);
    expect(removed.routes[stage]).toEqual({mode:'independent',channelId:'',modelId:''});
    expect(() => resolveModelRoute(removed,stage)).toThrow(expect.objectContaining({code:'configuration'}));
    expect(AiConfigSchema.safeParse(removed).success).toBe(true);
  });
  it.each(tasks)('deleting a remembered %s channel preserves intentional follow mode without a stale backup', stage => {
    const a=fixture(),removed=removeChannel(setModelRouteFollow(a.config,stage,true),stage);
    expect(removed.routes[stage]).toEqual({mode:'follow-story'});
    expect(resolveModelRoute(removed,stage).model).toBe('story-override');
    expect(setModelRouteFollow(removed,stage,false).routes[stage]).toEqual({mode:'independent',channelId:'',modelId:''});
  });
  it('deleting the Story channel keeps independent and remembered selections intact', () => {
    const a=fixture(),follow=setModelRouteFollow(a.config,'variables',true),removed=removeChannel(follow,'story');
    expect(() => resolveModelRoute(removed,'variables')).toThrow();
    expect(setModelRouteFollow(removed,'variables',false).routes.variables).toEqual(a.config.routes.variables);
    expect(resolveModelRoute(removed,'world').model).toBe('world-override');
  });
  it('reads old V1 configurations without migration, only defaulting the originally optional memory route', () => {
    const a=fixture(),raw={...a.config,routes:{story:a.config.routes.story,variables:{mode:'follow-story'},world:a.config.routes.world}};
    const json=JSON.stringify(raw);a.storage.setItem('heijin.ai.v1',json);
    const read=readAiConfig(a.storage);
    expect(read.routes.variables).toEqual({mode:'follow-story'});expect(read.routes.world).toEqual(raw.routes.world);
    expect(read.routes.memory).toEqual({mode:'follow-story'});expect(a.storage.getItem('heijin.ai.v1')).toBe(json);
  });
  it.each([
    {channelId:'missing',modelId:'model'},
    {channelId:'world',modelId:'bad\nmodel'},
    {channelId:'world',modelId:'model',apiKey:'must-not-be-stored'},
    {channelId:'world'},
  ])('strictly rejects malformed remembered selections: %j', independent => {
    const a=fixture();
    expect(AiConfigSchema.safeParse({...a.config,routes:{...a.config.routes,world:{mode:'follow-story',independent}}}).success).toBe(false);
  });
});
