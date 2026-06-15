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

const GRID = 0.25; // 1/16 = 0.25 beat(onset 量化网格)
const MIN_DUR_BEAT = 0.05; // duration 不量化,仅兜底防 0(保留录入原本时值)
const quantize = (beat: number): number => Math.round(beat / GRID) * GRID;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

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
  // 1) ms → beat,首音对齐到 0
  const sorted = [...captured].sort((a, b) => a.onsetMs - b.onsetMs);
  const t0 = sorted[0].onsetMs;
  type Tmp = { midi: number; onset: number; dur: number; vel: number };
  // ★ 2026-06-12(用户:不要改录入原本时值)—— 只量化 onset(quote 要落网格),
  //   duration 【保留录入原值】(ms→beat,不量化),仅 min 兜底防 0。
  let notes: Tmp[] = sorted.map((c) => ({
    midi: c.midi,
    onset: quantize((c.onsetMs - t0) / msPerBeat),
    dur: Math.max(MIN_DUR_BEAT, c.durationMs / msPerBeat),
    vel: clamp01(c.velocity / 127),
  }));

  // 2) 单旋律化:同一 onset bucket 取最高音;再去重同 pitch(保留较早/较长已隐含 sort)
  const byBucket = new Map<number, Tmp>();
  for (const n of notes) {
    const ex = byBucket.get(n.onset);
    if (!ex || n.midi > ex.midi) byBucket.set(n.onset, ex && ex.midi > n.midi ? ex : n);
  }
  notes = [...byBucket.values()].sort((a, b) => a.onset - b.onset);

  // 3)(2026-06-12 用户:完全还原录入时值)—— 不再把时值截到下一音起点(那会把 legato 时值吸到网格)。
  //    单旋律性由【同 onset 取最高音】保证;legato 叠音的真实时值保留,播放时再做【仅同音高】安全裁剪(leadOnlyIr)。

  // 4) scale snap — 有 inputTonality 走【该音阶】(保留 blues b5/五声特征),否则吸大/小调母调
  for (const n of notes) n.midi = inputTonality ? snapMidiToTonality(n.midi, keyPc, inputTonality) : snapMidiToScale(n.midi, keyPc, mode);

  // 5) 质量门
  if (notes.length < 2) throw new MotifAnalysisError('音符太少(<2),请重录一段更完整的 motif。');
  if (notes.length > 96) notes = notes.slice(0, 96); // 极端密度兜底

  // 6) motif 长度:span 四舍五入到【整 bar】(4 拍倍数),1..4 bar = 4/8/12/16 拍。
  //    (录制路径已先用 fitRecordingToBars 调 bpm 把 span 拉到整 bar,这里只是落定。)
  const span = Math.max(...notes.map((n) => n.onset + n.dur));
  const lengthBeats = Math.max(4, Math.min(16, Math.round(span / 4) * 4));

  // 7) 转 MotifNote(度/八度/accent)
  const lastIdx = notes.length - 1;
  const motifNotes: MotifNote[] = notes.map((n, i) => {
    const onBeat = Math.abs(n.onset - Math.round(n.onset)) < 1e-6;
    const edge = i === 0 || i === lastIdx;
    const accent = clamp01(0.45 * n.vel + 0.3 * (onBeat ? 1 : 0) + 0.25 * (edge ? 1 : 0) + 0.15 * Math.min(1, n.dur));
    return {
      midi: n.midi,
      onsetBeat: n.onset,
      durationBeat: n.dur,
      velocity: n.vel,
      scaleDegree: midiToScaleDegree(n.midi, keyPc, mode),
      octave: midiToOctave(n.midi),
      accent,
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
