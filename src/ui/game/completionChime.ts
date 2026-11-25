/**
 * 生成完成提示音：用 Web Audio 现场合成两声柔和的正弦“叮”，不加载音频文件。
 * 浏览器要求在用户操作中启用声音，因此在玩家点击开始生成时先 prime。
 */
export type ChimeMode = 'off' | 'background' | 'always';
export type ChimeKind = 'done' | 'attention';

type AudioContextClass = typeof AudioContext;
let context: AudioContext | undefined;

function audioContext(): AudioContext | undefined {
  try {
    const Ctor = (globalThis as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass }).AudioContext
      ?? (globalThis as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
    if (!Ctor) return undefined;
    context ??= new Ctor();
    return context;
  } catch { return undefined; }
}

/** 在用户手势里调用，让后续异步完成时可以出声；不支持或被拒绝时静默跳过。 */
export function primeChime() {
  const ctx = audioContext();
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
}

/** 默认只在玩家切到别的标签页或窗口时提醒，正在看着游戏时不打扰。 */
export function shouldChime(mode: ChimeMode, page: Pick<Document, 'hidden' | 'hasFocus'> = document) {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return page.hidden || !page.hasFocus();
}

// 完成：C5→G5 上行纯五度；需要处理：G4→E4 轻轻下行。音量很低，带缓慢衰减与低通，避免刺耳。
const tones: Record<ChimeKind, { notes: readonly [number, number][]; peak: number }> = {
  done: { notes: [[523.25, 0], [783.99, 0.16]], peak: 0.07 },
  attention: { notes: [[392, 0], [329.63, 0.2]], peak: 0.06 },
};

export function playChime(kind: ChimeKind) {
  const ctx = audioContext();
  if (!ctx || ctx.state === 'closed') return;
  try {
    const start = ctx.currentTime + 0.02;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    filter.connect(ctx.destination);
    const { notes, peak } = tones[kind];
    for (const [frequency, offset] of notes) {
      const at = start + offset, end = at + 1.6;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      gain.connect(filter);
      // 基音加一个很轻的高八度泛音，听起来像小铃而不是电子蜂鸣。
      for (const [multiple, level] of [[1, 1], [2, 0.12]] as const) {
        const voice = ctx.createGain();
        voice.gain.value = level;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = frequency * multiple;
        osc.connect(voice).connect(gain);
        osc.start(at);
        osc.stop(end + 0.05);
      }
    }
  } catch { /* 提示音失败不影响任何游戏流程 */ }
}

export function chimeIfWanted(mode: ChimeMode, kind: ChimeKind) {
  if (shouldChime(mode)) playChime(kind);
}
