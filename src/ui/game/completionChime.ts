/**
 * 生成完成提示音：用 Web Audio 现场合成两声柔和的正弦“叮”，不加载音频文件。
 * 浏览器要求在用户操作中启用声音，因此在玩家点击开始生成时先 prime。
 * 任何音频异常都只会让这次提示静音，不影响游戏流程。
 */
import { AiError } from '../../services/ai/errors';

export type ChimeMode = 'off' | 'background' | 'always';
export type ChimeKind = 'done' | 'attention';

type AudioContextClass = typeof AudioContext;
let context: AudioContext | undefined;
/** 正在播放的提示音各自的“立即中止”回调；音频一离开运行状态就全部中止。 */
const playing = new Set<() => void>();
let watched: AudioContext | undefined;

/** 播放中音频被挂起、中断（iOS 来电等）或关闭时，立即停止并断开已安排的音，恢复后不会继续响。 */
function watchState(ctx: AudioContext) {
  if (watched === ctx) return;
  watched = ctx;
  try {
    ctx.addEventListener('statechange', () => {
      if (ctx.state !== 'running') for (const abort of [...playing]) abort();
    });
  } catch { /* 不支持状态事件时，仍有播放前检查与 onended 清理 */ }
}

function audioContextClass(): AudioContextClass | undefined {
  const scope = globalThis as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

/** 在用户手势里调用；提示音关闭时不初始化音频。不支持、被拒绝或已关闭时静默跳过。 */
export function primeChime(mode: ChimeMode) {
  if (mode === 'off') return;
  try {
    if (!context || context.state === 'closed') {
      const Ctor = audioContextClass();
      if (!Ctor) return;
      context = new Ctor();
    }
    if (context.state !== 'running') void context.resume().catch(() => undefined);
  } catch { context = undefined; }
}

/** 默认只在玩家切到别的标签页或窗口时提醒，正在看着游戏时不打扰。 */
export function shouldChime(mode: ChimeMode, page: Pick<Document, 'hidden' | 'hasFocus'> = document) {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return page.hidden || !page.hasFocus();
}

/**
 * 回合结果对应的提示：正式结算成功才是“完成”；幂等回执（其他标签或恢复已提交）不重复提醒；
 * 预览、未完成候选需要玩家处理，用低一点的提示。
 */
export function chimeForTurn(result: { outcome: { status: 'complete' | 'skipped' | 'preview' }; committed?: { replayed: boolean } }): ChimeKind | undefined {
  if (result.committed) return result.committed.replayed ? undefined : 'done';
  return result.outcome.status === 'complete' ? undefined : 'attention';
}
/** 生成失败需要玩家回来处理；主动取消不响。自动重试的中间失败不经过这里。 */
export function chimeForFailure(failure: unknown): ChimeKind | undefined {
  return failure instanceof AiError && failure.code === 'cancelled' ? undefined : 'attention';
}

// 完成：C5→G5 上行纯五度；需要处理：G4→E4 轻轻下行。音量很低，带缓慢衰减与低通，避免刺耳。
const tones: Record<ChimeKind, { notes: readonly [number, number][]; peak: number }> = {
  done: { notes: [[523.25, 0], [783.99, 0.16]], peak: 0.07 },
  attention: { notes: [[392, 0], [329.63, 0.2]], peak: 0.06 },
};
const NOTE_SECONDS = 1.6;

/** 只在音频确实处于运行状态时播放；挂起、中断或已关闭时直接放弃，避免恢复后补播过期提示。 */
export function playChime(kind: ChimeKind) {
  const ctx = context;
  if (!ctx || ctx.state !== 'running') return;
  watchState(ctx);
  const nodes: AudioNode[] = [], oscillators: OscillatorNode[] = [];
  const cleanup = () => {
    playing.delete(abort);
    for (const node of nodes) { try { node.disconnect(); } catch { /* 已断开 */ } }
    nodes.length = 0; oscillators.length = 0;
  };
  const abort = () => {
    for (const osc of oscillators) { osc.onended = null; try { osc.stop(); } catch { /* 未开始或已停止 */ } }
    cleanup();
  };
  playing.add(abort);
  try {
    const start = ctx.currentTime + 0.02;
    const filter = ctx.createBiquadFilter();
    nodes.push(filter);
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    filter.connect(ctx.destination);
    const { notes, peak } = tones[kind];
    let last: OscillatorNode | undefined, lastEnd = -1;
    for (const [frequency, offset] of notes) {
      const at = start + offset, end = at + NOTE_SECONDS;
      const gain = ctx.createGain();
      nodes.push(gain);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      gain.connect(filter);
      // 基音加一个很轻的高八度泛音，听起来像小铃而不是电子蜂鸣。
      for (const [multiple, level] of [[1, 1], [2, 0.12]] as const) {
        const voice = ctx.createGain(), osc = ctx.createOscillator();
        nodes.push(voice, osc);
        oscillators.push(osc);
        voice.gain.value = level;
        osc.type = 'sine';
        osc.frequency.value = frequency * multiple;
        osc.connect(voice).connect(gain);
        osc.start(at);
        osc.stop(end + 0.05);
        if (end >= lastEnd) { last = osc; lastEnd = end; }
      }
    }
    // 最后一个音结束后断开本次创建的全部节点，长时间游玩不累积。
    if (last) last.onended = cleanup; else cleanup();
  } catch { abort(); }
}

export function chimeIfWanted(mode: ChimeMode, kind: ChimeKind | undefined) {
  if (kind && shouldChime(mode)) playChime(kind);
}

/** 设置页试听：点击即启用声音，等音频真正运行后再播放。 */
export async function previewChime(kind: ChimeKind) {
  primeChime('always');
  try { if (context && context.state !== 'running') await context.resume(); } catch { return; }
  playChime(kind);
}

/** 仅供测试：丢弃缓存的音频上下文。 */
export function resetChimeForTests() { context = undefined; watched = undefined; playing.clear(); }
