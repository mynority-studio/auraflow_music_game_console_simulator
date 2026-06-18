// ============================================================
// motifSandbox · model · 分析与清洗(raw MIDI → normalized UserMotif)
// ------------------------------------------------------------
// 参考 Impro-Visor MemorizeMotifsTRM 的 relative representation 思路,clean-room。
// 流程:ms→beat → 量化 1/16 → 单旋律化(取最高/去重) → scale snap → 度/八度/accent/contour/rhythmCell。
// ★ raw 与 normalized 都保留:raw 仅 UI/debug,normalized 进生成。
// ============================================================

import type { CapturedMidiNote, MotifNote, ScaleMode, UserMotif } from './types';
import { midiToScaleDegree, midiToOctave, snapMidiToScale, degreeOctaveToMidi } from './scale';
import { snapMidiToTonality, type SandboxTonality } from './sandboxScales';
import { metricalWeight, type HiddenGridCaptureContext, type GridCapturedNote, type CaptureMode } from '../capture/hiddenGridClock';

/** 力度/能量重音(comp/bass 击点)+ 结构音分(配和声/乐句身份)。directive §12。 */
function scoreNote(velNorm: number, metWeight: number, durNorm: number, isEdge: boolean, isTurn: boolean): { accent: number; structuralToneScore: number } {
  const e = isEdge ? 1 : 0, t = isTurn ? 1 : 0;
  return {
    accent: Math.max(0, Math.min(1, 0.40 * velNorm + 0.30 * metWeight + 0.15 * durNorm + 0.15 * e)),
    structuralToneScore: Math.max(0, Math.min(1, 0.35 * metWeight + 0.25 * durNorm + 0.20 * velNorm + 0.15 * e + 0.05 * t)),
  };
}
/** 轮廓转折(峰/谷):相邻方向反转 = true(首尾 false)。 */
function contourTurns(midis: number[]): boolean[] {
  return midis.map((_, i) => {
    if (i === 0 || i === midis.length - 1) return false;
    const d1 = Math.sign(midis[i] - midis[i - 1]), d2 = Math.sign(midis[i + 1] - midis[i]);
    return d1 !== 0 && d2 !== 0 && d1 !== d2;
  });
}

const GRID = 0.25; // 1/16 = 0.25 beat(量化网格)
const MIN_DUR_BEAT = 0.05; // ms→beat 时的防 0 兜底
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** ★ 时值规整成整分音值(2026-06-18 用户修订):时值吸 1/16(= 2/4/8/16 分整分音符),【仅此一步】。
 *  —— 只把不规则时值吸到最近的整分音值(2/4/8/16 分),displacement ≤ 1/32 拍,**保留 motif 形状**。
 *  ⚠️ 不再【钳在 bar 内】:整分音值即便跨 barline(如 onset 3.5 + 1.0 拍 = 干净的 8 分位 4.5),也是合法的连音/
 *     tie,落点已在整分网格上,downbeat 不糊;旧版钳到 bar 末会把跨 bar 的整音砍半(1.0→0.5)= 过大改变音符
 *     距离、听感丢形状(用户 2026-06-18 报告)。单旋律叠音安全在播放层 leadOnlyIr 做【仅同音高】裁剪。 */
function regularDur(durBeat: number): number {
  return Math.max(GRID, Math.round(durBeat / GRID) * GRID);        // 吸 1/16 → 整分音值(不钳 bar)
}

// ============================================================
// ★ 两阶段对拍(2026-06-18 用户):固定 song BPM 下,把 motif【整体等比缩放】令骨干音落强拍,
//   再把经过音就近吸到 16 分 / 三连音位。缩放限 ×0.5–×2(8分↔16分↔4分),自动选 1/2/.. bar。
//   —— "用改速度对拍,不用挪音符对拍":相对位置由缩放保持,只有骨干音锚强拍 + 经过音轻吸附。
// ============================================================
const SCALE_MIN = 0.5, SCALE_MAX = 2.0; // 等比缩放上下限(8分↔16分↔4分)
const snap16 = (x: number): number => Math.round(x / GRID) * GRID;
/** 经过音就近吸附 → 16 分网格。
 *  ⚠️ 三连音吸附(用户 2026-06-18 "三连音形状")【暂缓】:weaver 输出层 line 476 把 lead onset 硬吸 1/16
 *  (ONSET_GRID,与伴奏稳稳对拍),伴奏击点也按 1/16 → motif 出现三连位会被下游重吸成 1/16、毁掉 verbatim quote。
 *  接三连需让 weaver/伴奏/IR 全链三连感知(单独工程)。当前先做核心 16 分对拍。 */
const snapPassing = (x: number): number => snap16(x);
/** 四分拍的节拍强度:下拍 1.0 > 半小节 0.7 > 弱四分 0.4;非四分位 = 0(不是落拍点)。 */
function quarterStrength(pos: number, beatsPerBar: number): number {
  const b = ((pos % beatsPerBar) + beatsPerBar) % beatsPerBar;
  const q = Math.round(b);
  if (Math.abs(b - q) > 0.12) return 0;
  if (q === 0) return 1.0;
  if (q * 2 === beatsPerBar) return 0.7;
  return 0.4;
}

export interface FitInputNote { onset: number; dur: number; vel: number; midi: number; }
export interface MotifFitNote extends FitInputNote { structural: boolean; }
export interface MotifFit { notes: MotifFitNote[]; lengthBeats: number; scale: number; barCount: number; }

/** 结构音【先验估计】(与节拍无关 → 打破"骨干音定 onset / onset 定骨干音"的循环):
 *  力度 / 时长 / 首尾 / 轮廓拐点。head 永远结构音;相对阈值(≥ 峰值 0.7),保证 ≥ 2。 */
function preFitStructural(notes: readonly FitInputNote[]): boolean[] {
  const n = notes.length;
  if (n === 0) return [];
  const turns = contourTurns(notes.map((x) => x.midi));
  const maxDur = Math.max(...notes.map((x) => x.dur), 1e-6);
  const score = notes.map((x, i) =>
    0.40 * Math.min(1, x.vel) + 0.30 * (x.dur / maxDur) + 0.20 * (i === 0 || i === n - 1 ? 1 : 0) + 0.10 * (turns[i] ? 1 : 0));
  const peak = Math.max(...score);
  const flags = score.map((s, i) => i === 0 || s >= peak * 0.7);
  if (flags.filter(Boolean).length < 2) { // 兜底:补最高的非 head 音
    let bi = -1, bv = -1;
    for (let i = 1; i < n; i++) if (!flags[i] && score[i] > bv) { bv = score[i]; bi = i; }
    if (bi >= 0) flags[bi] = true;
  }
  return flags;
}

/** ★ 两阶段对拍主函数。输入须【首音已对齐到 onset 0】(free=t0 对齐 / hidden-grid=切头)。
 *  阶段一:等比缩放 s(∈[0.5,2]) + 选 brick 小节数 N → 骨干音落强拍(下拍/半小节优先);
 *  阶段二:骨干音吸最近四分拍,经过音就近吸 16分/三连;时值规整;同拍位取最高音;钳在 brick 末。 */
export function fitMotifToBricks(raw: readonly FitInputNote[], beatsPerBar = 4): MotifFit {
  const notes = [...raw].sort((a, b) => a.onset - b.onset);
  const n = notes.length;
  if (n === 0) return { notes: [], lengthBeats: beatsPerBar, scale: 1, barCount: 1 };
  const span = Math.max(...notes.map((x) => x.onset + x.dur), GRID);
  const struct = preFitStructural(notes);
  const structOnsets = notes.filter((_, i) => struct[i]).map((x) => x.onset);

  // 候选 brick 小节数 N:基准缩放 baseS=beatsPerBar*N/span 落在 [0.5,2] 内才算(否则缩放离谱)
  const cand: number[] = [];
  for (let N = 1; N <= 4; N++) { const bs = (beatsPerBar * N) / span; if (bs >= SCALE_MIN - 1e-9 && bs <= SCALE_MAX + 1e-9) cand.push(N); }
  if (cand.length === 0) cand.push(Math.max(1, Math.min(4, Math.round(span / beatsPerBar)))); // span 极端 → 就近取整 bar

  // 骨干音落点 = 【brick 内】最近四分拍(0..lengthBeats-1);lengthBeats 本身=下个 brick 下拍,不是合法落点
  const placeStrong = (pos: number, lenN: number): number => Math.max(0, Math.min(lenN - 1, Math.round(pos)));
  const clampS = (x: number): number => Math.min(SCALE_MAX, Math.max(SCALE_MIN, x));
  const naturalN = Math.max(1, Math.min(4, Math.round(span / beatsPerBar))); // motif 自然小节数(只在对拍强烈更优时才偏离)
  let best: { N: number; s: number; cost: number } | null = null;
  for (const N of cand) {
    const lenN = beatsPerBar * N;
    const baseS = clampS(lenN / span); // span 极端 → 基准已钳进 [0.5,2]
    for (let k = -40; k <= 40; k++) {
      const s = clampS(baseS * (1 + k * 0.01)); // 钳进幅度限内(不丢候选 → best 必有解)
      let sc = 0;
      for (const on of structOnsets) {
        const target = placeStrong(s * on, lenN); // 只瞄 brick 内四分拍(不奖励落到 brick 外下拍)
        sc += Math.abs(s * on - target) + 0.25 * (1 - quarterStrength(target, beatsPerBar));
      }
      const cost = sc / Math.max(1, structOnsets.length)
        + 0.30 * Math.abs(Math.log(s))         // 抗过度缩放(s=1→0)
        + 0.12 * Math.abs(N - naturalN);        // 偏好自然小节数(防为追下拍硬摊成更长 brick)
      if (!best || cost < best.cost - 1e-12) best = { N, s, cost };
    }
  }
  const { N, s } = best!;
  const lengthBeats = beatsPerBar * N;

  // 应用:骨干→brick 内最近四分拍;经过→就近 16分/三连(钳进 brick 末);时值规整;钳进 brick 末
  const placed = notes.map((x, i) => {
    const pos = s * x.onset;
    const onset = struct[i] ? placeStrong(pos, lengthBeats) : Math.max(0, Math.min(lengthBeats - GRID, snapPassing(pos)));
    const dur = Math.min(regularDur(s * x.dur), Math.max(GRID, lengthBeats - onset)); // 钳在 brick 末(非内部 barline)
    return { onset, dur, vel: x.vel, midi: x.midi, structural: struct[i] };
  }).filter((x) => x.onset < lengthBeats - 1e-9);

  // 同 onset 取最高音(单旋律化);结构音优先保留
  const byOnset = new Map<number, MotifFitNote>();
  for (const x of placed) {
    const key = +x.onset.toFixed(6);
    const ex = byOnset.get(key);
    if (!ex) byOnset.set(key, x);
    else if ((x.structural && !ex.structural) || (x.structural === ex.structural && x.midi > ex.midi)) byOnset.set(key, x);
  }
  const out = [...byOnset.values()].sort((a, b) => a.onset - b.onset);
  return { notes: out, lengthBeats, scale: s, barCount: N };
}

export interface AnalyzeResult {
  motif: UserMotif;
  rawCount: number;
  normalizedCount: number;
}
export class MotifAnalysisError extends Error {}

/** 把 raw CapturedMidiNote[] 分析 + 归一化成 UserMotif(走完整链,不绕过)。 */
export function analyzeAndNormalize(
  captured: readonly CapturedMidiNote[],
  keyPc: number,
  mode: ScaleMode,
  bpm: number,
  createdAt = 0,
  inputTonality?: SandboxTonality, // 给定则吸到该音阶(布鲁斯 b5/五声等特征保留);否则吸大/小调母调
): AnalyzeResult {
  const rawCount = captured.length;
  if (rawCount === 0) throw new MotifAnalysisError('没有录到音符。');

  const msPerBeat = 60000 / bpm;
  // 1) ms → beat(首音对齐到 0)→ ★【两阶段对拍】(2026-06-18 用户):固定 song BPM 下,把 motif 整体等比缩放
  //    令骨干音落强拍,经过音就近吸 16分/三连,自动选 1/2/.. bar。取代旧"逐音吸 1/16 + round 到整 bar"。
  const sorted = [...captured].sort((a, b) => a.onsetMs - b.onsetMs);
  const t0 = sorted[0].onsetMs;
  type Tmp = { midi: number; onset: number; dur: number; vel: number };
  const fit = fitMotifToBricks(
    sorted.map((c) => ({ onset: (c.onsetMs - t0) / msPerBeat, dur: Math.max(MIN_DUR_BEAT, c.durationMs / msPerBeat), vel: clamp01(c.velocity / 127), midi: c.midi })),
  );
  let notes: Tmp[] = fit.notes.map((x) => ({ midi: x.midi, onset: x.onset, dur: x.dur, vel: x.vel }));

  // 2) scale snap — 有 inputTonality 走【该音阶】(保留 blues b5/五声特征),否则吸大/小调母调
  for (const n of notes) n.midi = inputTonality ? snapMidiToTonality(n.midi, keyPc, inputTonality) : snapMidiToScale(n.midi, keyPc, mode);

  // 3) 质量门
  if (notes.length < 2) throw new MotifAnalysisError('音符太少(<2),请重录一段更完整的 motif。');
  if (notes.length > 96) notes = notes.slice(0, 96); // 极端密度兜底

  // 4) motif 长度 = fit 选定的 brick(1/2/.. bar);(单旋律化 + 时值规整已在 fit 内做)
  const lengthBeats = fit.lengthBeats;

  // 7) 转 MotifNote(度/八度/accent + structuralToneScore;directive §12 节拍权重模型)
  const lastIdx = notes.length - 1;
  const turns = contourTurns(notes.map((n) => n.midi));
  const motifNotes: MotifNote[] = notes.map((n, i) => {
    const beatInBar = ((n.onset % 4) + 4) % 4;
    const edge = i === 0 || i === lastIdx;
    const { accent, structuralToneScore } = scoreNote(n.vel, metricalWeight(beatInBar), Math.min(1, n.dur), edge, turns[i]);
    return {
      midi: n.midi,
      onsetBeat: n.onset,
      durationBeat: n.dur,
      velocity: n.vel,
      scaleDegree: midiToScaleDegree(n.midi, keyPc, mode),
      octave: midiToOctave(n.midi),
      accent,
      structuralToneScore,
    };
  });

  // 8) contour(相邻 scaleDegree delta 符号)+ rhythmCell(onset 差 + 时值)
  const contour: number[] = [];
  for (let i = 1; i < motifNotes.length; i++) {
    const d = (motifNotes[i].octave * 7 + motifNotes[i].scaleDegree) - (motifNotes[i - 1].octave * 7 + motifNotes[i - 1].scaleDegree);
    contour.push(Math.sign(d));
  }
  const rhythmCell: number[] = motifNotes.map((n) => n.durationBeat);

  const motif: UserMotif = {
    id: `motif-${createdAt}-${notes.length}`,
    keyPc, mode, bpm,
    notes: motifNotes,
    lengthBeats,
    contour,
    rhythmCell,
    createdAt,
  };
  return { motif, rawCount, normalizedCount: motifNotes.length };
}

// ============================================================
// 隐形时钟分析(directive Phase C + grid_alignment_structural_tone)—— GridCapturedNote[] → UserMotif
//   关键差异(对比 free 路径):用网格量化位、长度由实际演奏小节数派生、先存 raw 再吸 tonality。
//   ★ 默认【切头重对齐】(2026-06-16 directive Phase 1):首颗有效音 = motif-local beat 0,
//     整段前移(localOnsetBeat = quantizedOnsetBeat − firstBeat),禁止空拍开始。raw 晚进量
//     存进 leadingRestBeats(诊断,不进生成)。allowPickup=true 才保留前导休止(未来高级选项)。
// ============================================================
export interface MotifTimingAnalysis {
  captureMode: CaptureMode;
  bpm: number;
  captureBars: number;
  lengthBeats: number;
  phaseConfidence: number;   // 隐形时钟 = 1(相位已知)
  quantizeErrorMean: number;
  quantizeErrorMax: number;
  hasPickup: boolean;
  leadingRestBeats: number;  // 用户首音相对 captureStart 的【晚进量】(诊断;motif 已切头,首音 onset=0)
  aligned: boolean;          // 是否已切头对齐(allowPickup=false → true)
}

export interface HiddenGridAnalyzeOptions {
  allowPickup?: boolean;     // true=保留前导休止(故意空起的 pickup);默认 false=切头对齐
}

export interface HiddenGridAnalysis {
  motif: UserMotif;
  timing: MotifTimingAnalysis;
  snapChanges: number;       // 被 tonality 吸附改动的音数(审计;调内输入应=0)
}

export function analyzeHiddenGridMotif(gridNotes: readonly GridCapturedNote[], ctx: HiddenGridCaptureContext, opts: HiddenGridAnalyzeOptions = {}): HiddenGridAnalysis {
  const windowBeats = ctx.captureBars * ctx.beatsPerBar; // 捕获窗(最多 4 小节)
  // 1) 只取捕获窗内(数拍 pre-roll 已被 recorder 滤;这里防御)
  let g = gridNotes.filter((n) => n.quantizedOnsetBeat >= -1e-6 && n.quantizedOnsetBeat < windowBeats - 1e-6);
  if (g.length === 0) throw new MotifAnalysisError('数拍后没有录到音符,请在数拍结束后开始弹。');
  // 2) 单旋律化:同量化位取最高音
  const byOnset = new Map<number, GridCapturedNote>();
  for (const n of g) { const ex = byOnset.get(n.quantizedOnsetBeat); if (!ex || n.midi > ex.midi) byOnset.set(n.quantizedOnsetBeat, n); }
  g = [...byOnset.values()].sort((a, b) => a.quantizedOnsetBeat - b.quantizedOnsetBeat);
  if (g.length > 96) g = g.slice(0, 96);

  // ★ Phase 1:切头重对齐 —— 首颗有效音 → motif-local beat 0(禁止空拍开始;allowPickup 才保留)。
  const allowPickup = opts.allowPickup ?? false;
  const firstBeat = g[0].quantizedOnsetBeat;        // 用户首音相对 captureStart 的晚进量(诊断)
  const shift = allowPickup ? 0 : firstBeat;        // 切头量(pickup 时不切)
  const localOnset = (n: GridCapturedNote): number => Math.max(0, n.quantizedOnsetBeat - shift);

  // ★ 真 motif 长度 = 实际演奏到的小节数(切头后的 local 末音 → 取整 bar),1..captureBars。
  const localLastEnd = Math.max(...g.map((n) => localOnset(n) + n.quantizedDurationBeat));
  const lengthBeats = Math.max(ctx.beatsPerBar, Math.min(windowBeats, Math.ceil(localLastEnd / ctx.beatsPerBar - 1e-6) * ctx.beatsPerBar));

  // 3) 音高:存 raw → 吸 tonality(记改动);accent/structuralTone 用【切头后 local 相位】的节拍权重
  //    (Phase 3:不能用 GridCapturedNote.metricalWeight = 旧相位权重,否则结构音整体错相)。
  const turns = contourTurns(g.map((n) => n.midi));
  const lastIdx = g.length - 1;
  let snapChanges = 0;
  const motifNotes: MotifNote[] = g.map((n, i) => {
    const snapped = snapMidiToTonality(n.midi, ctx.keyPc, ctx.tonality);
    if (snapped !== n.midi) snapChanges++;
    const velNorm = clamp01(n.velocity / 127);
    const edge = i === 0 || i === lastIdx;
    const onset = localOnset(n);
    const localBeatInBar = ((onset % ctx.beatsPerBar) + ctx.beatsPerBar) % ctx.beatsPerBar; // 切头后相位
    const { accent, structuralToneScore } = scoreNote(velNorm, metricalWeight(localBeatInBar), Math.min(1, n.quantizedDurationBeat), edge, turns[i]);
    return {
      midi: snapped,
      onsetBeat: onset,                       // 切头后 → 首音 = 0(禁止空拍开始)
      durationBeat: regularDur(n.quantizedDurationBeat), // 规整成整分音值(不钳 bar,保形状)
      velocity: velNorm,
      scaleDegree: midiToScaleDegree(snapped, ctx.keyPc, ctx.scaleMode),
      octave: midiToOctave(snapped),
      accent, structuralToneScore,
    };
  });

  // 4) contour + rhythmCell
  const contour: number[] = [];
  for (let i = 1; i < motifNotes.length; i++) {
    const d = (motifNotes[i].octave * 7 + motifNotes[i].scaleDegree) - (motifNotes[i - 1].octave * 7 + motifNotes[i - 1].scaleDegree);
    contour.push(Math.sign(d));
  }
  const rhythmCell = motifNotes.map((n) => n.durationBeat);

  const errs = g.map((n) => Math.abs(n.timingErrorBeat));
  const timing: MotifTimingAnalysis = {
    captureMode: 'hiddenGrid', bpm: ctx.bpm, captureBars: ctx.captureBars, lengthBeats,
    phaseConfidence: 1.0,
    quantizeErrorMean: errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length),
    quantizeErrorMax: errs.length ? Math.max(...errs) : 0,
    hasPickup: allowPickup && firstBeat > 1e-6,
    leadingRestBeats: firstBeat,          // 用户晚进量(诊断;切头后 motif 首音已=0)
    aligned: !allowPickup,
  };
  const motif: UserMotif = {
    id: `motif-hg-${ctx.seed}-${motifNotes.length}`,
    keyPc: ctx.keyPc, mode: ctx.scaleMode, bpm: ctx.bpm,
    notes: motifNotes, lengthBeats, contour, rhythmCell, createdAt: ctx.seed,
  };
  return { motif, timing, snapChanges };
}

// ============================================================
// 录制长度 → 整 bar 自动识别 + BPM 调整(2026-06-15,用户)
//   手动起止录制 → 据当前 bpm 算这段是几 bar → 四舍五入到 1..4 bar →
//   反算 bpm,让这段【正好 = 整数 bar】(不整拍就靠调 bpm 缩/拉到整 bar)。
// ============================================================
export interface BarFit {
  adjustedBpm: number; // 调整后 bpm(让 span 正好 = targetBars 个整 bar)
  targetBars: number;  // 识别出的整 bar 数(1..maxBars)
  rawBars: number;     // 调整前的非整数 bar 数
  spanMs: number;      // 首音到末音结束的时长
}

/** 据录制时长 + 当前 bpm 识别整 bar 数,并反算让它正好整 bar 的 bpm。 */
export function fitRecordingToBars(
  captured: readonly CapturedMidiNote[],
  bpm: number,
  beatsPerBar = 4,
  maxBars = 4,
): BarFit {
  if (captured.length === 0) return { adjustedBpm: bpm, targetBars: 1, rawBars: 0, spanMs: 0 };
  const sorted = [...captured].sort((a, b) => a.onsetMs - b.onsetMs);
  const first = sorted[0].onsetMs;
  const lastEnd = Math.max(...sorted.map((c) => c.onsetMs + c.durationMs));
  const spanMs = Math.max(1, lastEnd - first);
  const msPerBar = (beatsPerBar * 60000) / bpm;
  const rawBars = spanMs / msPerBar;
  const targetBars = Math.max(1, Math.min(maxBars, Math.round(rawBars)));
  // span = targetBars 个 bar → msPerBeat = spanMs/(targetBars*beatsPerBar) → bpm = 60000/msPerBeat
  const exactBpm = (beatsPerBar * targetBars * 60000) / spanMs;
  const adjustedBpm = Math.round(Math.max(40, Math.min(240, exactBpm)) * 10) / 10;
  return { adjustedBpm, targetBars, rawBars, spanMs };
}

// ============================================================
// 示例 motif 注入(用户决策:必做)—— 生成 raw CapturedMidiNote[],
//   带【真实瑕疵】(off-grid 时序 + 一个离调经过音 + 力度重音 + 一处和音重叠),
//   再走完整 analyze→normalize 验证清洗链。不绕过 analyzer。
// ============================================================
import { makeRng } from './rng';
import { SCALE_INTERVALS } from './scale';

const SAMPLE_DEGREE_PATTERNS: number[][] = [
  [1, 2, 3, 5],          // do re mi sol
  [5, 3, 1, 2, 1],       // sol mi do re do
  [1, 3, 5, 6, 5, 3],    // 上行琶音 + 回
  [3, 2, 1, 6, 5],       // 下行级进
];
const SAMPLE_RHYTHMS: number[][] = [
  [0, 1, 2, 3],
  [0, 1, 2, 3, 3.5],
  [0, 0.5, 1, 1.5, 2, 2.5],
  [0, 1, 1.5, 2.5, 3],
];

/** 生成一段示例 raw 输入(在选定 key 内 + 一处离调 + 时序抖动 + 重音 + 一处重叠和音)。 */
export function generateSampleCaptured(bpm: number, keyPc: number, mode: ScaleMode, variant = 0): CapturedMidiNote[] {
  const rng = makeRng(0x5a + variant * 101 + keyPc);
  const degrees = SAMPLE_DEGREE_PATTERNS[variant % SAMPLE_DEGREE_PATTERNS.length];
  const onsets = SAMPLE_RHYTHMS[variant % SAMPLE_RHYTHMS.length];
  const n = Math.min(degrees.length, onsets.length);
  const msPerBeat = 60000 / bpm;
  const out: CapturedMidiNote[] = [];
  for (let i = 0; i < n; i++) {
    const baseMidi = degreeOctaveToMidi(degrees[i], 5, keyPc, mode); // 八度 5 ≈ midi 60-72
    const jitterMs = Math.round((rng.next() * 2 - 1) * 18);          // ±18ms 人手抖动(被量化吸回)
    const onsetMs = onsets[i] * msPerBeat + jitterMs;
    const durBeat = (i < n - 1 ? onsets[i + 1] - onsets[i] : 1) * (0.7 + rng.next() * 0.3);
    const accent = i === 0 ? 112 : 78 + rng.int(24);
    out.push({ midi: baseMidi, velocity: accent, onsetMs: Math.max(0, onsetMs), durationMs: Math.max(80, durBeat * msPerBeat) });
  }
  // 注入一个离调经过音(在 scale 两音之间,证明 snap 起效)
  if (n >= 2) {
    const between = degreeOctaveToMidi(degrees[1], 5, keyPc, mode) + 1; // +1 半音 = 大概率离调
    if (!SCALE_INTERVALS[mode].includes(((between - keyPc) % 12 + 12) % 12)) {
      out.push({ midi: between, velocity: 70, onsetMs: onsets[1] * msPerBeat + msPerBeat * 0.5, durationMs: msPerBeat * 0.4 });
    }
  }
  // 注入一处重叠和音(证明单旋律化取最高音)
  out.push({ midi: degreeOctaveToMidi(degrees[0], 4, keyPc, mode), velocity: 60, onsetMs: out[0].onsetMs + 4, durationMs: out[0].durationMs });
  return out;
}
