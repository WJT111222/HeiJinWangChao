import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { GameStateSchema } from '../domain/state';
import { normalizeOpeningCity } from '../domain/openingCity';
import { deriveAtmosphere, locationText, sceneTime, cn, dx } from '../ui/game/atmosphere';
import { SaveRepository } from '../services/storage/saveRepository';
import { buildCreationState, newCreation } from '../ui/creation/model';
import { defaultSettings } from '../ui/settings/model';
import { completeDraft, submission, elapsedVariables } from './fixtures/turn';
import { worldState } from './fixtures/world';
import { game } from './fixtures/game';
import { request, transaction } from '../services/storage/idb';
import { skyline } from '../ui/home/skyline';

let repo: SaveRepository, db: IDBDatabase;
beforeEach(async () => {
  const factory = new IDBFactory(); repo = await SaveRepository.open('city-night', factory);
  db = await new Promise<IDBDatabase>((resolve, reject) => {
    const op = factory.open('city-night'); op.onsuccess = () => resolve(op.result); op.onerror = () => reject(op.error);
  });
});
afterEach(() => { vi.restoreAllMocks(); db.close(); repo.close(); });
const put = (state: unknown) => transaction(db, ['saves'], 'readwrite', async tx => { await request(tx.objectStore('saves').put(state)); });
const raw = () => transaction(db, ['saves'], 'readonly', tx => request(tx.objectStore('saves').get('save-a')));

describe('固定城市身份：创建、兼容、原子补齐、并发和撤回', () => {
  it.each(['chongqing', 'shanghai', 'harbin', 'guangzhou'] as const)('创角正式写入 %s，而非依赖生成后的地点', async city => {
    const form = newCreation(); form.city = city; form.person = { name: '林舟', age: '30', gender: '男性', appearance: '', personality: '' }; form.customProfession = '记者';
    const state = buildCreationState(form, defaultSettings());
    expect(state.openingCityId).toBe(city);
    expect((await repo.create(state)).openingCityId).toBe(city);
  });
  it.each([6, 7, 8, 9])('V%s 旧档按标题恢复一次，移动、标题和重载不再影响身份', async schemaVersion => {
    const state = game(); delete state.openingCityId; state.title = '人物 · 上海';
    await put({ ...state, schemaVersion });
    const loaded = await repo.load('save-a');
    expect(loaded.openingCityId).toBe('shanghai'); expect(loaded.schemaVersion).toBe(9);
    expect(await raw()).toEqual(loaded); expect(loaded.revision).toBe(0);
    await put({ ...loaded, title: '改名 · 广州' });
    expect((await repo.loadGame('save-a')).state.openingCityId).toBe('shanghai');
  });
  it('无法恢复时持久化 null，不从当前地点猜测，也不在下次读档重试标题', async () => {
    const state = game(); delete state.openingCityId;
    await put(state);
    const loaded = (await repo.loadGame('save-a')).state;
    expect(loaded.openingCityId).toBeNull(); expect(await raw()).toEqual(loaded);
    await put({ ...loaded, title: '改名 · 重庆' });
    expect((await repo.load('save-a')).openingCityId).toBeNull();
  });
  it('并发读取串行补齐，不增加游戏版本，其他写入保留身份', async () => {
    const state = game(); delete state.openingCityId; state.title = '人物 · 哈尔滨'; await put(state);
    const [a, b] = await Promise.all([repo.load('save-a'), repo.loadGame('save-a')]);
    expect(a).toEqual(b.state); expect(a.openingCityId).toBe('harbin');
    const next = await repo.save('save-a', 0, 'weather-change', [{ type: 'SetWorldClock', commandId: 'clock', worldClock: '2026-10-18T08:01:00+08:00', evidence: '过了一分钟' }]);
    expect(next.openingCityId).toBe('harbin'); expect(next.revision).toBe(1);
    expect(await raw()).toEqual(next);
  });
  it('旧档补齐与业务写入竞争时不丢失更新，过期 CAS 仍拒绝', async () => {
    const state = game(); delete state.openingCityId; state.title = '人物 · 广州'; await put(state);
    const [, saved] = await Promise.all([repo.loadGame('save-a'), repo.save('save-a', 0, 'concurrent', [
      { type: 'SetWorldClock', commandId: 'elapsed', worldClock: '2026-10-18T08:01:00+08:00', evidence: '过了一分钟' },
    ])]);
    expect(saved.openingCityId).toBe('guangzhou'); expect(saved.revision).toBe(1); expect(await raw()).toEqual(saved);
    await expect(repo.save('save-a', 0, 'stale', [{ type: 'SetWorldClock', commandId: 'stale', worldClock: '2026-10-18T08:02:00+08:00', evidence: '过期写入' }])).rejects.toThrow();
    expect(await raw()).toEqual(saved);
  });
  it('补齐 put 失败时原始数据不被部分改写', async () => {
    const state = game(); delete state.openingCityId; state.title = '人物 · 重庆'; await put(state);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('mock quota', 'QuotaExceededError'); });
    await expect(repo.load('save-a')).rejects.toThrow(); expect(await raw()).toEqual(state);
  });
  it('草稿损坏导致 loadGame 事务回滚，补齐不能提前落盘', async () => {
    const state = game(); delete state.openingCityId; await put(state);
    await transaction(db, ['drafts'], 'readwrite', async tx => { await request(tx.objectStore('drafts').put({ saveId: 'save-a', broken: true })); });
    await expect(repo.loadGame('save-a')).rejects.toThrow(); expect(await raw()).toEqual(state);
  });
  it('损坏存档不因缺开局城市而被修复覆盖', async () => {
    const state = { ...game(), protagonist: { locationId: 'missing' } }; delete state.openingCityId;
    await put(state); await expect(repo.load('save-a')).rejects.toThrow(); expect(await raw()).toEqual(state);
  });
  it('已有未知身份、无美术 id 和 null 都原样保留', () => {
    for (const id of ['hangzhou', 'unknown-city', null]) {
      const state = { ...game(), title: '人物 · 重庆', openingCityId: id };
      expect(normalizeOpeningCity(state)).toBe(state);
      expect(deriveAtmosphere(state).city).toBe('other');
    }
  });
  it('普通场景取开始值；历史、重复回执和旧快照撤回保留既定身份', async () => {
    const state = worldState(); state.openingCityId = 'chongqing'; await repo.create(state);
    const first = await repo.commitTurn(submission(await completeDraft(repo), ''));
    const waiting = first.draft; await repo.bindTurnAction(waiting, '去新地点', true, true);
    const secondDraft = await completeDraft(repo, { narrative: '主角用餐后去了街口。', variables: { ...await elapsedVariables(repo, '去新地点', 60), commands: [
      ...(await elapsedVariables(repo, '去新地点', 60)).commands,
      { type: 'CreateLocation', commandId: 'new-place', evidence: '去了街口', location: { id: 'new-place', name: '街口', parentId: 'chongqing' } },
      { type: 'UpdateProtagonist', commandId: 'move', evidence: '去了街口', protagonistId: first.state.protagonist.id, expectedRevision: first.state.revision, changes: { locationId: 'new-place' } },
    ] } });
    const second = await repo.commitTurn(submission(secondDraft, ''));
    expect(second.state.journal[1].scene).toEqual({ worldClock: first.state.worldClock, locationId: first.state.protagonist.locationId });
    expect(second.state.journal[0]).toEqual(first.state.journal[0]);
    expect(second.state.protagonist.locationId).toBe('new-place');
    expect((await repo.commitTurn(submission(secondDraft, ''))).state).toEqual(second.state);
    // Emulate a snapshot written by the older program, with misleading title and no city field.
    await transaction(db, ['turnUndo'], 'readwrite', async tx => {
      const records = await request(tx.objectStore('turnUndo').getAll());
      const record = records.at(-1), snapshot = JSON.parse(record.stateJSON); delete snapshot.openingCityId; snapshot.title = '旧名 · 上海';
      await request(tx.objectStore('turnUndo').put({ ...record, stateJSON: JSON.stringify(snapshot) }));
    });
    const undone = await repo.undoTurn({ saveId: 'save-a', expectedRevision: second.state.revision, expectedDraft: second.draft, operationId: 'undo-city' });
    expect(undone.state.openingCityId).toBe('chongqing');
    expect(undone.state.journal).toEqual(first.state.journal); expect(undone.state.journal).toHaveLength(1);
    expect((await repo.load('save-a')).openingCityId).toBe('chongqing');
  });
});

describe('氛围与中文场景：只读正式身份和游戏时间', () => {
  it.each([['chongqing','cq'],['shanghai','sh'],['harbin','hrb'],['guangzhou','gz']])('%s 对应 %s', (id, key) => {
    const state = game(); state.openingCityId = id; state.protagonist.locationId = 'shanghai';
    expect(deriveAtmosphere(state).city).toBe(key);
  });
  it.each([[0,'late'],[4,'late'],[5,'dawn'],[6,'dawn'],[7,'day'],[16,'day'],[17,'dusk'],[18,'dusk'],[19,'night'],[22,'night'],[23,'late']] as const)('%s 点为 %s', (hour,time) => {
    const state = game(); state.worldClock = `2026-11-10T${String(hour).padStart(2,'0')}:00:00+08:00`; expect(deriveAtmosphere(state).time).toBe(time);
  });
  it('开局待定使用入夜；不把占位日历当成真实日期', () => {
    expect(deriveAtmosphere({ ...game(), openingTimePending: true }).time).toBe('night');
  });
  it.each([['雨夹雪','rain'],['雪和雾','snow'],['雾霾阴天','fog'],['多云','cloud'],['晴朗','clear']])('%s 天气优先级为 %s', (weatherText, weather) => {
    expect(deriveAtmosphere({ ...game(), weatherText }).weather).toBe(weather);
  });
  it('按 GMT+8 跨日算星期，中文数字、整点、大写支持 999', () => {
    expect(sceneTime('2026-11-10T16:00:00Z')).toBe('十一月十一日 · 星期三 · 零时整');
    expect(sceneTime('2026-11-15T12:05:00+08:00')).toBe('十一月十五日 · 星期日 · 十二时五分');
    expect(cn(110)).toBe('一百一十'); expect(cn(999)).toBe('九百九十九'); expect(dx(12)).toBe('拾贰');
  });
  it('国家根、未知城市、缺失地点、环只影响场景文字', () => {
    const locations = { china:{id:'china',name:'中国'}, shanghai:{id:'shanghai',name:'上海',parentId:'china'}, shop:{id:'shop',name:'书店',parentId:'shanghai'} };
    expect(locationText(locations,'shop')).toEqual({ name:'书店',path:'上海',city:'上海' });
    expect(locationText(locations,'missing').name).toBe('地点未确认');
    expect(locationText(locations,'china').city).toBeUndefined();
    expect(locationText({ a:{id:'a',name:'a',parentId:'b'},b:{id:'b',name:'b',parentId:'a'} },'a').path).toBe('b');
  });
  it('scene 可选且严格，不要求历史地点仍在当前地点表中', () => {
    const state=game(); state.turnNumber=1; state.revision=1;
    state.journal=[{turnId:'old',revision:1,story:{turnKind:'opening',narrative:'原文',summary:'摘要',variableGuide:[]},relatedActorRefs:[]}];
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    state.journal[0].scene={worldClock:state.worldClock,locationId:'deleted-place'};
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    expect(GameStateSchema.safeParse({...state,journal:[{...state.journal[0],scene:{...state.journal[0].scene,extra:true}}]}).success).toBe(false);
  });
  it('游戏复用天际线时不夹带首页哈尔滨雪景，默认首页输出不变', () => {
    expect(skyline('hrb')).toContain('home-snow'); expect(skyline('hrb','',false)).not.toContain('home-snow');
    expect(skyline('cq','',false)).toBe(skyline('cq'));
  });
});
