import type { WorkMeter } from './keyMatch';

/**
 * 普通文本关键词的一次扫描索引（Aho–Corasick 自动机）。
 *
 * 把同一大小写模式下的全部普通关键词建成一个自动机；每段扫描文本只走一遍，
 * 同时得到每个关键词“是否出现”和“是否有满足完整词边界的出现”。
 * 代价约为 文本长度 + 关键词总长 + 命中次数，与条目数量、关键词个数无关。
 * 判断结果与逐个 includes / 完整词边界检查完全相同（测试中做差分对照）。
 */
export const PLAIN_INDEX_WEIGHTS = {
  /** 建索引：每个关键词字符。 */
  buildChar: 8,
  /** 扫描：每个文本字符。 */
  scanChar: 6,
  /** 每处命中（含完整词边界检查，实测约 16 纳秒）。 */
  hit: 20,
} as const;

const isWordCode = (c: number) => c >= 48 && c <= 57 || c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 95;

export interface PlainHits { any: boolean; whole: boolean }

export class PlainIndex {
  private readonly ids = new Map<string, number>();
  private readonly needles: string[] = [];
  private built = false;
  private children: Array<Map<number, number>> = [];
  private fail: number[] = [];
  /** 结点上结束的关键词编号（-1 表示无）。 */
  private output: number[] = [];
  /** 沿失败链最近的“有输出”结点（0 表示无）。 */
  private dict: number[] = [];
  private lastText: string | null = null;
  private any = new Uint8Array(0);
  private whole = new Uint8Array(0);

  add(needle: string) {
    if (this.built) throw new Error('PlainIndex: 建好后不能再加关键词');
    if (needle === '' || this.ids.has(needle)) return;
    this.ids.set(needle, this.needles.length);
    this.needles.push(needle);
  }
  has(needle: string) { return needle === '' || this.ids.has(needle); }

  private build(meter: WorkMeter) {
    let total = 0;
    for (const needle of this.needles) total += needle.length;
    meter.charge(total * PLAIN_INDEX_WEIGHTS.buildChar);
    const children: Array<Map<number, number>> = [new Map()];
    const output = [-1];
    this.needles.forEach((needle, id) => {
      let node = 0;
      for (let i = 0; i < needle.length; i++) {
        const c = needle.charCodeAt(i);
        let next = children[node].get(c);
        if (next === undefined) { next = children.length; children.push(new Map()); output.push(-1); children[node].set(c, next); }
        node = next;
      }
      output[node] = id;
    });
    const fail = new Array<number>(children.length).fill(0);
    const dict = new Array<number>(children.length).fill(0);
    const queue: number[] = [];
    for (const child of children[0].values()) queue.push(child);
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head];
      for (const [c, child] of children[node]) {
        let f = fail[node];
        while (f !== 0 && !children[f].has(c)) f = fail[f];
        const target = children[f].get(c);
        fail[child] = target !== undefined && target !== child ? target : 0;
        dict[child] = output[fail[child]] >= 0 ? fail[child] : dict[fail[child]];
        queue.push(child);
      }
    }
    Object.assign(this, { children, fail, output, dict, built: true });
  }

  private scan(text: string, meter: WorkMeter) {
    if (this.lastText === text) return;
    if (!this.built) this.build(meter);
    meter.charge(text.length * PLAIN_INDEX_WEIGHTS.scanChar);
    const any = new Uint8Array(this.needles.length), whole = new Uint8Array(this.needles.length);
    const { children, fail, output, dict, needles } = this;
    let node = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      while (node !== 0 && !children[node].has(c)) node = fail[node];
      node = children[node].get(c) ?? 0;
      for (let o = output[node] >= 0 ? node : dict[node]; o !== 0; o = dict[o]) {
        meter.charge(PLAIN_INDEX_WEIGHTS.hit);
        const id = output[o];
        any[id] = 1;
        if (!whole[id]) {
          const start = i - needles[id].length + 1, end = i + 1;
          if ((start === 0 || !isWordCode(text.charCodeAt(start - 1))) && (end === text.length || !isWordCode(text.charCodeAt(end)))) whole[id] = 1;
        }
      }
    }
    this.any = any; this.whole = whole; this.lastText = text;
  }

  /** 查询某个已登记关键词在 text 中的出现情况。 */
  lookup(text: string, needle: string, meter: WorkMeter): PlainHits {
    if (needle === '') {
      // 空关键词：包含判断恒为真；完整词判断看是否存在两侧都是边界的位置。
      meter.charge(text.length);
      for (let i = 0; i <= text.length; i++) {
        if ((i === 0 || !isWordCode(text.charCodeAt(i - 1))) && (i === text.length || !isWordCode(text.charCodeAt(i)))) return { any: true, whole: true };
      }
      return { any: true, whole: false };
    }
    this.scan(text, meter);
    const id = this.ids.get(needle)!;
    return { any: this.any[id] === 1, whole: this.whole[id] === 1 };
  }
}
