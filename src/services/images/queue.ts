import type { GameState } from '../../domain/state';
import { config, subscribeConfig } from './config';
import type { ImageConfig } from './config';
import { terminal } from './library';
import type { ImageLibrary, Job } from './library';
import { person, sameSubject, slots, targetFor, validTarget } from './model';
import type { Kind, Scope, Slot, Target } from './model';
import { convertText, delay, generateImage } from './protocol';
import { 合并并去重提示词单元, 归一化单段词组转化器输出 } from './promptTokens';

const prefix = 'heijin.image-job.',
  globalLock = 'heijin.image-generation.v1',
  rateKey = 'heijin.images.next-request';
const active = new Map<string, { saveId: string; controller: AbortController }>();
const cancelKey = 'heijin.images.cancel';
export function cancelJob(saveId: string, id: string) {
  active.get(lockName(saveId, id))?.controller.abort();
  localStorage.setItem(cancelKey, JSON.stringify([saveId, id, crypto.randomUUID()]));
}
const lockName = (saveId: string, id: string) => prefix + JSON.stringify([saveId, id]);
export function stopLocal(saveId: string) {
  for (const job of active.values()) if (job.saveId === saveId) job.controller.abort();
}
export async function recover(lib: ImageLibrary, scope: Scope) {
  if (!navigator.locks) return;
  const { jobs } = await lib.read(scope.saveId);
  for (const job of jobs.filter((j) => !terminal(j.phase))) {
    await navigator.locks.request(lockName(scope.saveId, job.id), { ifAvailable: true }, async (lock) => {
      if (lock) await lib.finish(job, '取消', '原页面已关闭或存档已替换；未重发请求').catch(() => {});
    });
  }
}
function template(t: Target) {
  return person(t.kind) ? 'person' : t.kind === 'vehicle' ? 'item' : (t.kind as 'item' | 'place' | 'story');
}
async function run(lib: ImageLibrary, job: Job, c: ImageConfig, controller: AbortController, extra: string) {
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]);
  const assertEnabled = () => {
    signal.throwIfAborted();
    if (!config().enabled) throw new DOMException('', 'AbortError');
  };
  // The global Web Lock serializes provider submissions and the persisted RPM reservation across tabs.
  async function reserve() {
    const remaining = Math.min(10000, Number(localStorage.getItem(rateKey)) - Date.now());
    if (remaining > 0) await delay(remaining, signal);
    assertEnabled();
    localStorage.setItem(rateKey, String(Date.now() + 10000));
  }
  assertEnabled();
  const { s, c: collection } = await lib.phase(job, c.convert ? '提示词转换' : '图片生成');
  const entry = job.target.kind === 'story' ? s.journal.find((j) => j.turnId === job.target.id) : undefined;
  const anchors = collection.anchors.filter(
    (a) =>
      validTarget(s, a.target) &&
      (sameSubject(a.target, job.target) ||
        entry?.relatedActorRefs.some(
          (ref) =>
            ref.id === a.target.id && (ref.kind === 'protagonist' ? 'player' : ref.kind) === a.target.kind,
        )),
  );
  const people = (entry?.relatedActorRefs ?? []).slice(0, 8).flatMap((ref) => {
    const kind = ref.kind === 'protagonist' ? 'player' : ref.kind === 'npc' ? 'npc' : undefined;
    const target = kind && targetFor(s, kind, ref.id);
    return target ? [target.summary] : [];
  });
  const source = [
    slots[job.slot],
    job.target.summary,
    ...people,
    ...anchors.map((a) => a.target.title + '：' + a.text),
    extra,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 12000);
  let prompt = source;
  if (c.convert) {
    await reserve();
    await lib.phase(job, '提示词转换');
    assertEnabled();
    prompt = await convertText(
      c,
      c.templates[template(job.target)] +
        '\n' +
        (c.backend === 'openai' ? '输出自然语言生图描述。' : '输出英文逗号分隔词组。') +
        '只输出最终提示词。已有年龄、身份和外貌优先于形象锚点。',
      source,
      signal,
    );
  }
  if (c.convert && c.backend !== 'openai')
    prompt = 归一化单段词组转化器输出(prompt, { isNovelAI: c.backend === 'novelai' });
  if (!prompt.trim()) throw new Error('转化器未返回有效词组');
  await reserve();
  await lib.phase(job, '图片生成');
  assertEnabled();
  const positive = 合并并去重提示词单元(prompt, c.positive, c.style).join(', ');
  const bytes = await generateImage(c, positive, c.negative, signal);
  assertEnabled();
  await lib.phase(job, '图片保存');
  await lib.save(job.scope, job.target, job.slot, bytes, signal, job);
}
export async function enqueue(
  lib: ImageLibrary,
  scope: Scope,
  t: Target,
  slot: Slot,
  automatic = false,
  extra = '',
) {
  const c = config();
  if (!c.enabled) throw new Error('文生图已关闭');
  if (!navigator.locks) throw new Error('当前环境不支持跨标签任务锁，请使用安全上下文');
  const id = automatic ? JSON.stringify([t.turnId, t.kind, t.id, slot]) : crypto.randomUUID();
  const name = lockName(scope.saveId, id);
  if (active.has(name)) return;
  const controller = new AbortController();
  active.set(name, { saveId: scope.saveId, controller });
  const unsubscribe = subscribeConfig(() => {
    if (!config().enabled) controller.abort();
  });
  const cancel = (e: StorageEvent) => {
    if (e.key === cancelKey && e.newValue) {
      try {
        const [s, j] = JSON.parse(e.newValue);
        if (s === scope.saveId && j === id) controller.abort();
      } catch {
        /* Other version. */
      }
    }
  };
  window.addEventListener('storage', cancel);
  const job: Job = {
    id,
    saveId: scope.saveId,
    scope: { saveId: scope.saveId, createdAt: scope.createdAt, instance: scope.instance },
    target: t,
    slot,
    automatic,
    phase: '等待',
    time: Date.now(),
    message: '',
  };
  try {
    await navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock || controller.signal.aborted || !(await lib.enqueue(job))) return;
      try {
        await navigator.locks.request(globalLock, { signal: controller.signal }, () =>
          run(lib, job, c, controller, extra),
        );
      } catch (error) {
        const aborted =
          controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
        const message = aborted
          ? '任务已取消，已发出的请求可能计费'
          : error instanceof TypeError
            ? '网络或跨域请求失败，请检查服务地址与 CORS'
            : error instanceof DOMException && error.name === 'TimeoutError'
              ? '任务超时，未自动重试'
              : error instanceof Error
                ? error.message
                : '图片生成失败';
        await lib.finish(job, aborted ? '取消' : '失败', message);
      }
    });
  } finally {
    active.delete(name);
    unsubscribe();
    window.removeEventListener('storage', cancel);
  }
}
export function afterSettlement(lib: ImageLibrary, before: GameState, s: GameState, instance?: string) {
  const c = config();
  const entry = s.journal.at(-1);
  if (
    !c.enabled ||
    !entry ||
    before.saveId !== s.saveId ||
    before.createdAt !== s.createdAt ||
    before.journal.at(-1)?.turnId === entry.turnId
  )
    return;
  const scope = { saveId: s.saveId, createdAt: s.createdAt, instance };
  function add(kind: Kind, id: string, slot: Slot) {
    const target = targetFor(s, kind, id);
    if (target)
      void enqueue(lib, scope, target, slot, true).catch(() => {
        /* Storage unavailable. Main turn is already durable. */
      });
  }
  if (c.auto.story) add('story', entry.turnId, 'illustration');
  if (c.auto.ordinary || c.auto.special)
    for (const p of Object.values(s.npc))
      if (!before.npc[p.id] && c.auto[p.kind === 'special' ? 'special' : 'ordinary'])
        add('npc', p.id, 'avatar');
  if (c.auto.item) {
    for (const p of Object.values(s.items))
      if (p.ownerRef?.kind === 'protagonist' && before.items[p.id]?.ownerRef?.kind !== 'protagonist')
        add('item', p.id, 'object');
    for (const v of Object.values(s.economy.vehicles))
      if (v.ownerRef.kind === 'protagonist' && before.economy.vehicles[v.id]?.ownerRef.kind !== 'protagonist')
        add('vehicle', v.id, 'object');
  }
}
