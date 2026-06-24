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
const CHORD_EPS = 0.04; // 真和音判定:raw onset 差 < 此 = 同时按下(比 16/32 分旋律间隔严;两路径共用)
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
// ★ 贴 16 分网格(2026-06-22 用户重写):取代旧"两阶段对拍/整体变速+骨干锚强拍"——后者把均匀节奏挤成"每拍贴俩"
//   还偶尔掉音。新法:轻微整体缩放贴合 bar(s≈1)+ 逐音吸最近 16 分(不锚强拍)+ 保所有音(撞位前推/扩 grid)。
//   旧"用改速度对拍"思路【作废】(均匀输入下几乎每个音被判骨干 → 抢拍位 → 级联挤压,实测均匀八分→0/0.25 堆叠)。
// ============================================================
const SCALE_MIN = 0.85, SCALE_MAX = 1.0; // ★ 轻微贴合 bar = 【只压不拉】(2026-06-22):span 稍超一个 bar → 轻压收进整 bar;
//   span 不足一个 bar 一律 s=1(不拉伸)—— 拉伸会把用户【弹在拍上】的音推离拍(末音落 beat3 时尤甚)。s≈1 → 节奏保真。
const snap16 = (x: number): number => Math.round(x / GRID) * GRID;
/** 逐音就近吸附 → 16 分网格。
 *  ⚠️ 三连音吸附【暂缓】:weaver 输出层 line 476 把 lead onset 硬吸 1/16(伴奏击点也 1/16)→ motif 三连位会被
 *  下游重吸成 1/16、毁掉 verbatim quote。接三连需 weaver/伴奏/IR 全链三连感知(单独工程)。当前 16 分网格。 */
const snapPassing = (x: number): number => snap16(x);

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
  // ★ 时长主导(非力度):结构音=长音 + 首尾 + 轮廓拐点;响亮短音=经过重音,不算骨干(对齐 §12 结构音原则,
  //   否则 loud 弱拍短音会被当骨干拉到强拍 → 毁掉用户切分)。力度仅次权重。
  const score = notes.map((x, i) =>
    0.45 * (x.dur / maxDur) + 0.20 * Math.min(1, x.vel) + 0.25 * (i === 0 || i === n - 1 ? 1 : 0) + 0.10 * (turns[i] ? 1 : 0));
  const peak = Math.max(...score);
  const flags = score.map((s, i) => i === 0 || s >= peak * 0.7);
  if (flags.filter(Boolean).length < 2) { // 兜底:补最高的非 head 音
    let bi = -1, bv = -1;
    for (let i = 1; i < n; i++) if (!flags[i] && score[i] > bv) { bv = score[i]; bi = i; }
    if (bi >= 0) flags[bi] = true;
  }
  return flags;
}

/** ★ 贴 16 分网格(用户 2026-06-22 重写 · Option B「轻微贴合 bar + 逐音贴 16 分」):
 *  ① 真和音单音化(CHORD_EPS);② bar 数 = 自然长度(span 取整 bar,1..4),【轻微整体缩放】令 span 正好填满
 *     N bar(s≈1,不挤压均匀节奏,只把稍长/稍短收进整 bar);③ 逐音吸最近 16 分 —— ★【不再骨干锚强拍】
 *     (旧版把均匀节奏挤成"每拍贴俩"的根因:均匀输入下几乎每个音都被判骨干 → 全抢四分拍位 → 撞位级联);
 *     撞位前推不丢音,超末则扩 grid(≤4 bar)绝不丢音。时值贴 16 分(钳在 grid 末,内部不钳 barline)。
 *  输入须【首音已对齐到 onset 0】(free=t0 对齐 / hidden-grid=切头)。 */
export function fitMotifToBricks(raw: readonly FitInputNote[], beatsPerBar = 4): MotifFit {
  const sorted = [...raw].sort((a, b) => a.onset - b.onset);
  if (sorted.length === 0) return { notes: [], lengthBeats: beatsPerBar, scale: 1, barCount: 1 };
  // ① 真和音单音化:仅【真同时按下】(raw onset 差 < CHORD_EPS)取最高音;不同 onset 一律保留(撞位前推不丢音)
  const mono: FitInputNote[] = [];
  for (const x of sorted) {
    const prev = mono[mono.length - 1];
    if (prev && Math.abs(x.onset - prev.onset) < CHORD_EPS) { if (x.midi > prev.midi) mono[mono.length - 1] = x; }
    else mono.push(x);
  }
  const struct = preFitStructural(mono);
  const span = Math.max(...mono.map((x) => x.onset + x.dur), GRID);
  // ② bar 数 = 自然长度;轻微整体缩放让 span 正好填满 N bar(s≈1 → 不挤压均匀节奏)
  let N = Math.max(1, Math.min(4, Math.round(span / beatsPerBar)));
  let lengthBeats = beatsPerBar * N;
  const s = Math.min(SCALE_MAX, Math.max(SCALE_MIN, lengthBeats / span));
  // ③ 逐音吸最近 16 分(无骨干锚强拍 → 均匀节奏保真);撞位前推不丢音;超末扩 grid;时值贴 16 分钳 grid 末
  const out: MotifFitNote[] = [];
  let last = -1;
  mono.forEach((x, i) => {
    let onset = Math.max(0, snapPassing(s * x.onset));
    if (onset <= last + 1e-9) onset = +(last + GRID).toFixed(6);                       // 撞位 → 下一个空 16 分位
    while (onset >= lengthBeats - 1e-9 && N < 4) { N++; lengthBeats = beatsPerBar * N; } // 超末 → 扩 grid 不丢音
    if (onset >= lengthBeats - 1e-9) return;                                            // 4 bar 仍放不下(>64 个 16 分)→ 丢(极端)
    const dur = Math.min(regularDur(s * x.dur), Math.max(GRID, lengthBeats - onset));
    out.push({ onset, dur, vel: x.vel, midi: x.midi, structural: struct[i] });
    last = onset;
  });
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
    inputTonality, // ★ 保留输入音阶(blues contract Phase 1)
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
  leadingRestBeats: number;  // 【signed entry offset】(诊断):>0 晚进 / =0 正好 / <0 抢进被 grace 接住(motif 已切头,首音 onset=0)
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
  // 1) 取捕获窗内 + 抢拍宽容窗(directive 2026-06-19):接受 captureStart 前 preCaptureGraceBeats 拍内的早进音
  //    (负 quantizedOnsetBeat);更早的 count-in 仍滤。★ quantizedOnsetBeat 仅做窗口过滤,不做旋律合并 key。
  const grace = ctx.preCaptureGraceBeats ?? 0;
  let g = gridNotes.filter((n) => n.quantizedOnsetBeat >= -grace - 1e-6 && n.quantizedOnsetBeat < windowBeats - 1e-6);
  if (g.length === 0) throw new MotifAnalysisError('数拍后没有录到音符,请在数拍结束后开始弹。');
  // 2) 按 raw onsetBeat 排序(★ directive Phase 2:【不再】按 quantizedOnsetBeat 合并旋律音 —— 那会把落同一
  //    16 分格的真实旋律音吞掉。真同时按下的单旋律化交给 fitMotifToBricks 的 raw-onset CHORD_EPS + 撞位前推不丢音)。
  g = [...g].sort((a, b) => a.onsetBeat - b.onsetBeat);
  if (g.length > 96) g = g.slice(0, 96);

  const allowPickup = opts.allowPickup ?? false;
  // ★ signed entry offset(directive 2026-06-19):>0 用户晚进 / =0 正好 / <0 用户抢进(被 grace 接住)。不止"晚进量"。
  const firstBeat = g[0].quantizedOnsetBeat;

  // ★ 两阶段对拍(2026-06-18 用户):默认路径(切头)用 RAW onset 喂 fitMotifToBricks —— 等比变速锚骨干音
  //   落强拍 + 经过音吸 16 分 + 选 brick(1..captureBars)。allowPickup(保留前导休止)走旧 quantize 路径不变速。
  type Placed = { onset: number; dur: number; vel: number; midi: number };
  let placed: Placed[];
  let lengthBeats: number;
  if (!allowPickup) {
    const raw0 = g[0].onsetBeat;                     // 首音 raw onset(切头基准)
    const fit = fitMotifToBricks(
      g.map((n) => ({ onset: Math.max(0, n.onsetBeat - raw0), dur: Math.max(MIN_DUR_BEAT, n.durationBeat), vel: clamp01(n.velocity / 127), midi: n.midi })),
      ctx.beatsPerBar,
    );
    placed = fit.notes.map((x) => ({ onset: x.onset, dur: x.dur, vel: x.vel, midi: x.midi }));
    lengthBeats = Math.min(windowBeats, fit.lengthBeats); // 不超捕获窗
  } else {
    // pickup(保留前导休止,不变速、不走 fit)→ ★ 同样【不按 quantizedOnsetBeat 合并吞音】(directive 2026-06-19
    //   边界补全,UI pickup toggle 可达):真同时按下(raw onset 差 < CHORD_EPS)单旋律化取最高;其余各自落
    //   quantized 16 分位(保前导休止,不切头),撞位前推到下一个空格【不丢音】。
    const mono: GridCapturedNote[] = [];
    for (const nn of g) {
      const prev = mono[mono.length - 1];
      if (prev && Math.abs(nn.onsetBeat - prev.onsetBeat) < CHORD_EPS) { if (nn.midi > prev.midi) mono[mono.length - 1] = nn; }
      else mono.push(nn);
    }
    placed = [];
    let last = -1;
    for (const nn of mono) {
      let onset = Math.max(0, nn.quantizedOnsetBeat);
      if (onset <= last + 1e-9) onset = +(last + GRID).toFixed(6); // 撞位 → 下一个空 16 分位(保音、保序)
      if (onset >= windowBeats - 1e-9) break;                       // 超捕获窗才丢(极端密度,罕见)
      const dur = Math.min(regularDur(nn.quantizedDurationBeat), Math.max(GRID, windowBeats - onset));
      placed.push({ onset, dur, vel: clamp01(nn.velocity / 127), midi: nn.midi });
      last = onset;
    }
    const localLastEnd = Math.max(...placed.map((x) => x.onset + x.dur), GRID);
    lengthBeats = Math.max(ctx.beatsPerBar, Math.min(windowBeats, Math.ceil(localLastEnd / ctx.beatsPerBar - 1e-6) * ctx.beatsPerBar));
  }

  // 3) 音高:存 raw → 吸 tonality(记改动);accent/structuralTone 用【对拍后 local 相位】的节拍权重
  const turns = contourTurns(placed.map((x) => x.midi));
  const lastIdx = placed.length - 1;
  let snapChanges = 0;
  const motifNotes: MotifNote[] = placed.map((x, i) => {
    const snapped = snapMidiToTonality(x.midi, ctx.keyPc, ctx.tonality);
    if (snapped !== x.midi) snapChanges++;
    const edge = i === 0 || i === lastIdx;
    const localBeatInBar = ((x.onset % ctx.beatsPerBar) + ctx.beatsPerBar) % ctx.beatsPerBar; // 对拍后相位
    const { accent, structuralToneScore } = scoreNote(x.vel, metricalWeight(localBeatInBar), Math.min(1, x.dur), edge, turns[i]);
    return {
      midi: snapped,
      onsetBeat: x.onset,                     // 切头 + 对拍 → 首音 = 0(禁止空拍开始)
      durationBeat: x.dur,
      velocity: x.vel,
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
    leadingRestBeats: firstBeat,          // signed entry offset(诊断;>0 晚进/<0 抢进;切头后 motif 首音已=0)
    aligned: !allowPickup,
  };
  const motif: UserMotif = {
    id: `motif-hg-${ctx.seed}-${motifNotes.length}`,
    keyPc: ctx.keyPc, mode: ctx.scaleMode, bpm: ctx.bpm,
    notes: motifNotes, lengthBeats, contour, rhythmCell, createdAt: ctx.seed,
    inputTonality: ctx.tonality, // ★ 隐形网格路径也保留输入音阶(blues contract Phase 1)
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
