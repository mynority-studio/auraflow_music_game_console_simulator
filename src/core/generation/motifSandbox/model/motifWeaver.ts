// ============================================================
// motifSandbox · model · Motif Weaver(和弦进行 × motif 复现,2026-06-15 重写)
// ------------------------------------------------------------
// 用户方案:给 motif 配和弦 → 一轮进行内 motif 出现 1 次(轮首原样)或 2 次
//   (前半段原样 + 后半段【和声适配变体】:间距/时值/轮廓不变,落新和弦,尾音解决,+ 一点邻音/节奏微变)。
//   进行重复 → 复制第一轮的结果(确定性)。非 jazz 全 diatonic。
// ============================================================

import type { MotifNote, MotifOccurrence, MotifWeaverInput, MotifWeaverResult, SandboxStyle, ScaleMode, UserMotif } from './types';
import { analyzeAndNormalize } from './motifAnalysis';
import { identity, fitRange } from './motifTransform';
import { transposeDiatonic, snapMidiToScale } from './scale';
import { buildMotifCycle } from './motifHarmony';
import { chordAtBeat, nearestChordTone, chordToneInDirection, type SandboxChord } from './chords';
import { auditMotifWeave } from './jazzinessAudit';
import { makeRng, type SeededRng } from './rng';

const TARGET_BEATS = 64;
const LEAD_LOW = 60, LEAD_HIGH = 84;

const STYLE_RHYTHM: Record<SandboxStyle, number[]> = {
  pop: [0, 1, 2, 3], lofi: [0, 2], rnb: [0, 1, 1.5, 2.5, 3], jazz: [0, 0.5, 1, 1.5, 2, 3],
};

/** 轮首原样 motif(identity,fitRange 到 lead 音区)。 */
function placeExact(motif: UserMotif, atBeat: number, cycleIndex: number): MotifNote[] {
  return fitRange(identity(motif.notes), LEAD_LOW, LEAD_HIGH).map((n) => ({ ...n, onsetBeat: atBeat + n.onsetBeat, occurrenceKind: 'quote' as const, cycleIndex }));
}

const MAX_LEAP = 7; // 旋律线最大跳进 = 纯五度(>5th 算大跳,尽量避免);超则八度收拢
/** 朝 target 走【一个 diatonic 度】,但若已在 ≤2 度内则直接到 target(避免来回)。 */
function stepTo(fromMidi: number, targetMidi: number, keyPc: number, mode: ScaleMode): number {
  const d = targetMidi - fromMidi;
  if (Math.abs(d) <= 2) return targetMidi;
  return transposeDiatonic(fromMidi, d > 0 ? 1 : -1, keyPc, mode);
}

/** 后半段【和声适配变体】:沿 motif 的【轮廓方向 + 时值】重落到续接和弦的【和弦音】上 ——
 *  保轮廓/节奏(可辨),音程随就近和弦音(小跳=平滑),首音接 quote 末音,尾音朝下一轮 quote 首音解决,
 *  短音小概率邻音微变(Q2)。不再 rigid 平移(避免整块上飘 + 大跳)。 */
function placeAdapted(motif: UserMotif, atBeat: number, contChords: readonly SandboxChord[], cycleIndex: number, rng: SeededRng, keyPc: number, mode: ScaleMode, peakMidi: number, resolveToMidi: number, refLow: number, refHigh: number): MotifNote[] {
  const out: MotifNote[] = [];
  const lastBarStart = (contChords.length - 1) * 4; // 末 bar 起点(相对) → 此后【渐降】lead-in 进入复述
  let prev = peakMidi;
  for (let i = 0; i < motif.notes.length; i++) {
    const n = motif.notes[i];
    const ch = chordAtBeat(contChords, n.onsetBeat) ?? contChords[0];
    let midi: number;
    if (i === 0) midi = chordToneInDirection(prev, ch, -1); // 从 quote 峰音【下行】recovery(跳后反向)
    else if (n.onsetBeat >= lastBarStart - 1e-6) midi = chordToneInDirection(prev, ch, Math.sign(resolveToMidi - prev) || -1); // 末 bar:朝下一轮 quote 首音【渐降】(voice-leading 进复述)
    else {
      let dir = Math.sign(motif.notes[i].midi - motif.notes[i - 1].midi); // motif 轮廓方向
      if (prev >= refHigh) dir = -1; else if (prev <= refLow) dir = 1;    // 触顶/底 → 反向(arch,不上飘)
      midi = chordToneInDirection(prev, ch, dir);
    }
    while (midi > refHigh && midi - 12 >= refLow - 2) midi -= 12;          // 音域带约束
    while (midi < refLow && midi + 12 <= refHigh + 2) midi += 12;
    if (n.durationBeat < 1 && rng.chance(0.15)) midi = transposeDiatonic(midi, rng.pick([1, -1]), keyPc, mode); // 短音邻音微变(Q2)
    out.push({ ...n, midi, onsetBeat: atBeat + n.onsetBeat, occurrenceKind: 'adapted' as const, cycleIndex });
    prev = midi;
  }
  if (out.length) { // 尾音解决:落【离下一轮 quote 首音最近】的末和弦和弦音
    out[out.length - 1].midi = nearestChordTone(resolveToMidi, contChords[contChords.length - 1]);
  }
  return out;
}

/** once 情形:后半段级进填充 —— 起于 quote 末音,逐 bar【渐降】朝下一轮 quote 首音,强拍落和弦音,末音回授。 */
function fillTowardChords(start: number, end: number, contChords: readonly SandboxChord[], style: SandboxStyle, rng: SeededRng, keyPc: number, mode: ScaleMode, startMidi: number, resolveToMidi: number): MotifNote[] {
  const out: MotifNote[] = [];
  const rhythm = STYLE_RHYTHM[style];
  let prev = startMidi;
  const bars = Math.max(1, Math.round((end - start) / 4));
  for (let b = 0; b < bars; b++) {
    const barStart = start + b * 4;
    const ch = contChords[Math.min(b, contChords.length - 1)];
    const isLast = b === bars - 1;
    const onsets = isLast ? [0, 2] : rhythm;
    const barTarget = Math.round(startMidi + (resolveToMidi - startMidi) * ((b + 1) / bars)); // 起→止【渐变】落点 → 平滑回授
    for (let j = 0; j < onsets.length; j++) {
      const at = barStart + onsets[j];
      if (at >= end - 1e-6) break;
      const dur = (j < onsets.length - 1 ? onsets[j + 1] : 4) - onsets[j];
      const dir = Math.sign(barTarget - prev);
      let midi: number;
      if (isLast && j === onsets.length - 1) midi = nearestChordTone(resolveToMidi, ch); // 末:落离 quote 首音最近的和弦音(回授)
      else if (j % 2 === 0) midi = chordToneInDirection(prev, ch, dir);                  // 强拍:朝目标方向的最近和弦音
      else { midi = stepTo(prev, barTarget, keyPc, mode); midi = snapMidiToScale(midi, keyPc, mode); } // 反拍:级进经过音
      out.push({ midi, onsetBeat: at, durationBeat: isLast && j === onsets.length - 1 ? Math.max(dur, 1.5) : dur, velocity: 0.68, scaleDegree: 0, octave: 0, accent: j === 0 ? 0.8 : 0.5, occurrenceKind: 'fill' });
      prev = midi;
    }
  }
  return out;
}

/** 旋律线平滑(作曲原则:级进为主、跳进≤纯五度、音域带约束、末段级进回授到下一轮 quote 首音、不碰 quote)。 */
function smoothMelodicLine(lead: MotifNote[], bandLo: number, bandHi: number, keyPc: number, mode: ScaleMode, loopTargetMidi: number, lastChord: SandboxChord): MotifNote[] {
  const s = [...lead].sort((a, b) => a.onsetBeat - b.onsetBeat);
  // 前向:把跳进 > 纯五度的续写音八度收拢到 prev 附近(消大跳);音域带约束。
  for (let i = 1; i < s.length; i++) {
    if (s[i].occurrenceKind === 'quote') continue;
    let m = s[i].midi; const prev = s[i - 1].midi;
    while (m - prev > MAX_LEAP && m - 12 >= bandLo) m -= 12;
    while (prev - m > MAX_LEAP && m + 12 <= bandHi) m += 12;
    while (m > bandHi && m - 12 >= bandLo) m -= 12;
    while (m < bandLo && m + 12 <= bandHi) m += 12;
    s[i].midi = m;
  }
  // 后向【级进回授】:末续写音落 loopTarget(下一轮 quote 首音)附近;向前逐个保证 ≤ 纯五度(用 scale 音,不八度跳)。
  let li = s.length - 1;
  while (li >= 0 && s[li].occurrenceKind === 'quote') li--;
  if (li >= 1) {
    s[li].midi = nearestChordTone(loopTargetMidi, lastChord); // 末音回授(级进进入复述)
    for (let i = li - 1; i >= 1 && s[i].occurrenceKind !== 'quote'; i--) {
      const next = s[i + 1].midi;
      if (Math.abs(s[i].midi - next) > MAX_LEAP) {
        const dir = s[i].midi > next ? 1 : -1; // 保持原本在 next 的上/下方,但拉到 ≤ 三度
        s[i].midi = snapMidiToScale(next + dir * 4, keyPc, mode);
      }
    }
  }
  return s;
}

export function generateMotifWeave(input: MotifWeaverInput): MotifWeaverResult {
  const { keyPc, mode, style } = input;
  const { motif } = analyzeAndNormalize(input.capturedNotes, keyPc, mode, input.bpm, input.seed);
  const rng = makeRng((input.seed ^ 0x9e3779b9) >>> 0);
  const cycle = buildMotifCycle(motif, keyPc, mode);
  const cycleBeats = cycle.cycleBeats;
  const motifBeats = cycle.motifBeats;
  const numCycles = Math.max(2, Math.min(8, Math.round(TARGET_BEATS / cycleBeats)));
  const placeTwice = rng.chance(0.55); // 概率 once / twice(整曲一致)

  // —— motif 寄存器(决定续写音域带 + 回授目标)——
  const exact0 = placeExact(motif, 0, 0);
  const refLow = Math.min(...exact0.map((n) => n.midi));
  const refHigh = Math.max(...exact0.map((n) => n.midi));
  const firstMidi = exact0[0].midi;                    // 下一轮 quote 首音 → 续写末音回授到它(平滑复述)
  const lastMidi = exact0[exact0.length - 1].midi;     // quote 末音 → 续写起点(平滑接续)
  const bandLo = refLow - 2, bandHi = refHigh + 5;     // 音域带(≈十度内)

  // —— 生成【第一轮】(beat 0..cycleBeats):前半段 exact + (twice ? 后半段 adapted : 填充)——
  const cycle0: MotifNote[] = [];
  cycle0.push(...exact0);
  if (placeTwice) cycle0.push(...placeAdapted(motif, motifBeats, cycle.contChords, 0, rng, keyPc, mode, lastMidi, firstMidi, refLow, refHigh));
  else cycle0.push(...fillTowardChords(motifBeats, cycleBeats, cycle.contChords, style, rng, keyPc, mode, lastMidi, firstMidi));
  // 旋律线平滑(级进为主/跳进≤五度/跳后反向/音域带);只在第一轮做 → 复制后各轮一致 + 轮间复述平滑(末音≈首音)
  const cycle0Smooth = smoothMelodicLine(cycle0, bandLo, bandHi, keyPc, mode, firstMidi, cycle.contChords[cycle.contChords.length - 1]);

  // —— 复制第一轮到所有轮(进行重复 → 复制第一遍)——
  const lead: MotifNote[] = [];
  const progression: SandboxChord[] = [];
  const occurrences: MotifOccurrence[] = [];
  for (let c = 0; c < numCycles; c++) {
    const shift = c * cycleBeats;
    for (const n of cycle0Smooth) lead.push({ ...n, onsetBeat: n.onsetBeat + shift, cycleIndex: c });
    for (const ch of cycle.all) progression.push({ ...ch, startBeat: ch.startBeat + shift });
    occurrences.push({ motifId: motif.id, startBeat: shift, kind: 'quote', cycleIndex: c, chordRoman: cycle.motifChords[0].roman });
    if (placeTwice) occurrences.push({ motifId: motif.id, startBeat: shift + motifBeats, kind: 'adapted', cycleIndex: c, chordRoman: cycle.contChords[0].roman });
  }

  const finalLead = [...lead].sort((a, b) => a.onsetBeat - b.onsetBeat).filter((n) => n.durationBeat > 0);
  const audit = auditMotifWeave(finalLead, motif, occurrences, keyPc, mode, { numCycles, cycleBeats, placeTwice });
  return { motif, progression, occurrences, lead: finalLead, cycleBeats, numCycles, placeTwice, audit };
}
