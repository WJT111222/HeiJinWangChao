import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsSchema, defaultSettings, mergeSettingsChanges } from '../ui/settings/model';
import { chimeForFailure, chimeForTurn, chimeIfWanted, playChime, previewChime, primeChime, resetChimeForTests, shouldChime } from '../ui/game/completionChime';
import { AiError } from '../services/ai/errors';

/** 最小 Web Audio 替身：记录创建的节点、连线、断开与播放的频率。 */
class FakeNode {
  connected = 0; disconnected = 0;
  connect<T>(target: T) { this.connected++; return target; }
  disconnect() { this.disconnected++; }
}
class FakeParam { value = 0; setValueAtTime() { return this; } exponentialRampToValueAtTime() { return this; } }
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeFilter extends FakeNode { type = ''; frequency = new FakeParam(); }
class FakeOscillator extends FakeNode {
  type = ''; frequency = new FakeParam(); onended: (() => void) | null = null;
  start() { Fake.started.push(this.frequency.value); }
  stop() { Fake.oscillators.push(this); }
}
class Fake {
  static instances: Fake[] = []; static started: number[] = []; static oscillators: FakeOscillator[] = []; static nodes: FakeNode[] = [];
  static initialState: AudioContextState = 'running'; static resumeTo: AudioContextState = 'running';
  state: AudioContextState = Fake.initialState; currentTime = 0; destination = new FakeNode();
  constructor() { Fake.instances.push(this); }
  resume() { this.state = Fake.resumeTo; return Promise.resolve(); }
  createGain() { const n = new FakeGain(); Fake.nodes.push(n); return n; }
  createBiquadFilter() { const n = new FakeFilter(); Fake.nodes.push(n); return n; }
  createOscillator() { const n = new FakeOscillator(); Fake.nodes.push(n); return n; }
}
const page = (hidden: boolean, focused: boolean) => ({ hidden, hasFocus: () => focused });
const endAll = () => { for (const osc of Fake.oscillators) osc.onended?.(); };

beforeEach(() => {
  Fake.instances = []; Fake.started = []; Fake.oscillators = []; Fake.nodes = []; Fake.initialState = 'running'; Fake.resumeTo = 'running';
  resetChimeForTests();
  vi.stubGlobal('AudioContext', Fake);
  vi.stubGlobal('document', { hidden: true, hasFocus: () => false });
});
afterEach(() => { vi.unstubAllGlobals(); resetChimeForTests(); });

describe('提示音设置', () => {
  it('旧设置缺字段时默认「切到别处时」，其余设置不变；非法取值拒绝', () => {
    const old = structuredClone(defaultSettings()) as Record<string, unknown>;
    delete old.notifications;
    const parsed = SettingsSchema.parse(old);
    expect(parsed.notifications).toEqual({ completionChime: 'background' });
    expect(parsed.display).toEqual({ appearance: 'night' });
    expect(SettingsSchema.safeParse({ ...defaultSettings(), notifications: { completionChime: 'loud' } }).success).toBe(false);
  });
  it('默认只在页面不在前台时提醒；关闭时从不提醒；总是时都提醒', () => {
    expect(shouldChime('background', page(false, true))).toBe(false);
    expect(shouldChime('background', page(true, false))).toBe(true);
    expect(shouldChime('background', page(false, false))).toBe(true);
    expect(shouldChime('off', page(true, false))).toBe(false);
    expect(shouldChime('always', page(false, true))).toBe(true);
  });
  it('跨标签同步的提示音设置与其他分类的修改互不覆盖', () => {
    const base = defaultSettings(), latest = structuredClone(base), edited = structuredClone(base);
    latest.notifications.completionChime = 'off';
    edited.prompts.perspective = 'first';
    expect(mergeSettingsChanges(base, edited, latest).notifications.completionChime).toBe('off');
  });
});

describe('回合结果对应的提示', () => {
  it('正式结算成功才是完成提示；幂等回执不重复提醒', () => {
    expect(chimeForTurn({ outcome: { status: 'complete' }, committed: { replayed: false } })).toBe('done');
    expect(chimeForTurn({ outcome: { status: 'complete' }, committed: { replayed: true } })).toBeUndefined();
  });
  it('世界预览与未完成候选需要玩家处理，不播放完成提示', () => {
    expect(chimeForTurn({ outcome: { status: 'preview' } })).toBe('attention');
    expect(chimeForTurn({ outcome: { status: 'skipped' } })).toBe('attention');
  });
  it('生成失败提醒处理；主动取消不响', () => {
    expect(chimeForFailure(new AiError('cancelled'))).toBeUndefined();
    expect(chimeForFailure(new AiError('network'))).toBe('attention');
    expect(chimeForFailure(new Error('boom'))).toBe('attention');
  });
  it('自动重试后成功只按最终结果提醒一次', () => {
    // 重试中间的失败只走 onAttemptFailure，不经过提示判断；最终结果只调用一次。
    primeChime('always');
    chimeIfWanted('always', chimeForTurn({ outcome: { status: 'complete' }, committed: { replayed: false } }));
    expect(Fake.started).toEqual([523.25, 1046.5, 783.99, 1567.98]);
  });
});

describe('音频生命周期', () => {
  it('提示音关闭时不初始化音频，也不播放', () => {
    primeChime('off');
    chimeIfWanted('off', 'done');
    expect(Fake.instances).toHaveLength(0);
    expect(Fake.started).toEqual([]);
  });
  it('生成中改为关闭（播放时读取最新设置）则不响', () => {
    primeChime('always');
    chimeIfWanted('off', 'done');
    expect(Fake.started).toEqual([]);
  });
  it('音频挂起或中断时放弃本次提示，之后恢复也不补播', () => {
    Fake.initialState = 'suspended'; Fake.resumeTo = 'suspended';
    primeChime('always');
    playChime('done');
    expect(Fake.started).toEqual([]);
    Fake.instances[0].state = 'running';
    expect(Fake.started).toEqual([]);
    playChime('attention');
    expect(Fake.started).toEqual([392, 784, 329.63, 659.26]);
  });
  it('音频已关闭时下次启用会重新创建', () => {
    primeChime('always');
    Fake.instances[0].state = 'closed';
    playChime('done');
    expect(Fake.started).toEqual([]);
    primeChime('always');
    expect(Fake.instances).toHaveLength(2);
  });
  it('播放结束后断开本次创建的全部节点', () => {
    primeChime('always');
    playChime('done');
    expect(Fake.nodes.length).toBeGreaterThan(0);
    expect(Fake.nodes.every(node => node.disconnected === 0)).toBe(true);
    endAll();
    expect(Fake.nodes.every(node => node.disconnected === 1)).toBe(true);
  });
  it('试听会先等音频恢复运行再播放', async () => {
    Fake.initialState = 'suspended';
    await previewChime('done');
    expect(Fake.started[0]).toBe(523.25);
  });
  it('不支持 Web Audio 或构造失败时静默跳过，不抛错', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => { primeChime('always'); playChime('done'); }).not.toThrow();
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('denied'); } });
    expect(() => { primeChime('always'); playChime('attention'); }).not.toThrow();
  });
});
