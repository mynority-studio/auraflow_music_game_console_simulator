// ============================================================
// motifSandbox · capture · 隐形时钟(hidden grid clock)
// ------------------------------------------------------------
// directive: motif_weaver_hidden_grid_capture_directive.md(Phase A)
// 核心思想(来自 Impro-Visor):不从自由演奏反推 BPM —— 录音前先建一个【隐形音乐时钟】
//   (预选 BPM/拍号/捕获窗 + 数拍),用户跟着它弹,MIDI 时间戳【映射回这个已知网格】。
//   第一个音不再被强制当 beat 0;迟到就是迟到、前面的休止保留为音乐时值。
// 本文件只做【时钟数学】(确定性、纯函数);数拍发声/录音在 Phase B。
// ============================================================

import type { CapturedMidiNote, ScaleMode, SandboxStyle } from '../model/types';
import type { SandboxTonality } from '../model/sandboxScales';
import { makeRng } from '../model/rng';

export type CaptureMode = 'hiddenGrid' | 'freeFallback';

export interface HiddenGridCaptureContext {
  mode: 'hiddenGrid';
  seed: number;
  keyPc: number;
  scaleMode: ScaleMode;
  tonality: SandboxTonality;
  style: SandboxStyle;
  bpm: number;
  meterNumerator: 4;
  meterDenominator: 4;
  beatsPerBar: 4;
  gridStepsPerBeat: 4;        // 1/16 网格
  captureBars: 1 | 2 | 3 | 4; // 捕获窗最多 4 小节(真 motif 长度由实际演奏小节数派生)
  countInBars: 1 | 2;
  pickupBeats: 0 | 0.5 | 1;   // Phase 1 = 0,类型预留
  captureStartMs: number;     // 数拍结束 = 隐形 beat 0
  captureEndMs: number;
  clockSource: 'audioContext' | 'performance';
}

export interface GridCapturedNote {
  midi: number;
  velocity: number;           // 0..127
  rawOnMs: number;
  rawOffMs: number;
  rawDurationMs: number;
  onsetBeat: number;          // 相对 captureStart 的拍(可负=数拍期内)
  durationBeat: number;
  quantizedOnsetBeat: number; // 吸 1/16 后
  quantizedDurationBeat: number;
  barIndex: number;
  beatInBar: number;
  timingErrorBeat: number;    // onsetBeat - quantizedOnsetBeat(留给审计/confidence)
  metricalWeight: number;     // 节拍权重(下拍重 → 16 分轻)
}

// 预选 BPM 区间(directive §8);非 jazz 默认 pop 偏好 96-108。
const BPM_RANGE: Record<SandboxStyle, [number, number]> = {
  pop: [96, 108], rnb: [76, 98], lofi: [70, 90], jazz: [120, 160],
};

export const msPerBeat = (ctx: { bpm: number }): number => 60000 / ctx.bpm;
export const msPerBar = (ctx: HiddenGridCaptureContext): number => (ctx.beatsPerBar * 60000) / ctx.bpm;

/** 4/4 节拍权重(directive §12):下拍 1.0 / beat3 0.75 / beat2,4 0.55 / 八分反拍 0.35 / 十六分 0.2。 */
export function metricalWeight(beatInBar: number): number {
  const frac = beatInBar - Math.floor(beatInBar);
  if (Math.abs(frac) < 1e-6) {
    const b = ((Math.round(beatInBar) % 4) + 4) % 4;
    return b === 0 ? 1.0 : b === 2 ? 0.75 : 0.55;
  }
  if (Math.abs(frac - 0.5) < 1e-6) return 0.35;
  return 0.2;
}

/** 吸到 1/gridStepsPerBeat 网格。 */
export function quantizeBeat(beat: number, gridStepsPerBeat: number): number {
  return Math.round(beat * gridStepsPerBeat) / gridStepsPerBeat;
}

/** 录音前建隐形捕获上下文:预选 BPM(确定性随机)、数拍小节、捕获窗(最多 4 小节,不按 4 秒钳制)。 */
export function createHiddenGridContext(opts: {
  seed: number;
  keyPc: number;
  scaleMode: ScaleMode;
  tonality: SandboxTonality;
  style: SandboxStyle;
  startMs: number;
  desiredBars?: 1 | 2 | 3 | 4;   // 捕获窗最多小节数(默认 1;用户:给到 4)
  countInBars?: 1 | 2;           // 数拍小节数(默认 1)
  clockSource?: 'audioContext' | 'performance';
}): HiddenGridCaptureContext {
  const { seed, keyPc, scaleMode, tonality, style, startMs, desiredBars = 1, countInBars: ci = 1, clockSource = 'performance' } = opts;
  const rng = makeRng((seed ^ 0x4d2b1a7f) >>> 0);
  const [lo, hi] = BPM_RANGE[style];
  const bpm = Math.round(lo + rng.next() * (hi - lo));
  const beatsPerBar = 4 as const;
  const mpb = 60000 / bpm;
  const captureBars: 1 | 2 | 3 | 4 = desiredBars;
  const countInBars: 1 | 2 = ci;
  const captureStartMs = startMs + countInBars * beatsPerBar * mpb;
  const captureEndMs = captureStartMs + captureBars * beatsPerBar * mpb;
  return {
    mode: 'hiddenGrid', seed, keyPc, scaleMode, tonality, style, bpm,
    meterNumerator: 4, meterDenominator: 4, beatsPerBar: 4, gridStepsPerBeat: 4,
    captureBars, countInBars, pickupBeats: 0, captureStartMs, captureEndMs, clockSource,
  };
}

/** 原始 note(on/off ms)→ 网格位置(相对隐形 beat 0,不减首音;量化 + 节拍权重 + 误差)。 */
export function mapRawNoteToGrid(
  raw: { midi: number; velocity: number; onMs: number; offMs: number },
  ctx: HiddenGridCaptureContext,
): GridCapturedNote {
  const mpb = msPerBeat(ctx);
  const onsetBeat = (raw.onMs - ctx.captureStartMs) / mpb;        // 隐形 beat 0 = captureStart;迟到为正,数拍内为负
  const durationBeat = Math.max(0.05, (raw.offMs - raw.onMs) / mpb);
  const quantizedOnsetBeat = quantizeBeat(onsetBeat, ctx.gridStepsPerBeat);
  const quantizedDurationBeat = Math.max(1 / ctx.gridStepsPerBeat, quantizeBeat(durationBeat, ctx.gridStepsPerBeat));
  const barIndex = Math.floor(quantizedOnsetBeat / ctx.beatsPerBar);
  const beatInBar = quantizedOnsetBeat - barIndex * ctx.beatsPerBar;
  return {
    midi: raw.midi, velocity: raw.velocity,
    rawOnMs: raw.onMs, rawOffMs: raw.offMs, rawDurationMs: raw.offMs - raw.onMs,
    onsetBeat, durationBeat, quantizedOnsetBeat, quantizedDurationBeat,
    barIndex, beatInBar, timingErrorBeat: onsetBeat - quantizedOnsetBeat,
    metricalWeight: metricalWeight(beatInBar),
  };
}

/** 某 ms 是否落在【捕获窗】内(数拍期/窗后 = 不收)。 */
export function isWithinCapture(ms: number, ctx: HiddenGridCaptureContext): boolean {
  return ms >= ctx.captureStartMs - 1e-6 && ms < ctx.captureEndMs - 1e-6;
}

/** recorder 录到的 CapturedMidiNote[](onsetMs 相对【数拍开始】= recorder.start)→ 网格音。
 *  ★ 数拍期(onsetMs < captureStart)与窗后的音被滤掉 = count-in 不进 motif。
 *  注:context 用 startMs=0(与 recorder 同相对帧)。不调 fitRecordingToBars。 */
export function capturedToGridNotes(captured: readonly CapturedMidiNote[], ctx: HiddenGridCaptureContext): GridCapturedNote[] {
  return captured
    .filter((c) => isWithinCapture(c.onsetMs, ctx))
    .map((c) => mapRawNoteToGrid({ midi: c.midi, velocity: c.velocity, onMs: c.onsetMs, offMs: c.onsetMs + c.durationMs }, ctx));
}
