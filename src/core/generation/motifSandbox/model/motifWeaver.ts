// ============================================================
// motifSandbox · model · Motif Weaver(和弦进行 × motif 复现,2026-06-15 重写)
// ------------------------------------------------------------
// 用户方案:给 motif 配和弦 → 一轮进行内 motif 出现 1 次(轮首原样)或 2 次
//   (前半段原样 + 后半段【和声适配变体】:间距/时值/轮廓不变,落新和弦,尾音解决,+ 一点邻音/节奏微变)。
//   进行重复 → 复制第一轮的结果(确定性)。非 jazz 全 diatonic。
// ============================================================

import type { MotifNote, MotifOccurrence, MotifWeaverInput, MotifWeaverResult, SandboxStyle, ScaleMode, UserMotif } from './types';
import { analyzeAndNormalize } from './motifAnalysis';
import { identity, transposeDiatonicMotif, fitRange } from './motifTransform';
import { transposeDiatonic, snapMidiToScale } from './scale';
import { buildMotifCycle } from './motifHarmony';
import { chordAtBeat, nearestChordTone, type SandboxChord } from './chords';
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

/** 后半段【和声适配变体】:整体 diatonic 平移到续接和弦区(保间距/轮廓/时值),
 *  长音落和弦音(避持续撞和弦),尾音解决,短音小概率邻音微变(Q2)。 */
function placeAdapted(motif: UserMotif, atBeat: number, motifFirstDeg: number, contChords: readonly SandboxChord[], cycleIndex: number, rng: SeededRng, keyPc: number, mode: ScaleMode): MotifNote[] {
  const offset = contChords[0].degree - motifFirstDeg; // 首和弦根的 diatonic 距离 → 序进位移(保间距)
  const base = fitRange(transposeDiatonicMotif(motif.notes, offset, keyPc, mode), LEAD_LOW, LEAD_HIGH);
  const out: MotifNote[] = base.map((n) => {
    const absBeat = atBeat + n.onsetBeat;
    const ch = chordAtBeat(contChords, absBeat - atBeat) ?? contChords[0];
    let midi = n.midi;
    if (n.durationBeat >= 1 && !ch.tonePcs.includes(((midi % 12) + 12) % 12)) midi = nearestChordTone(midi, ch); // 长音落和弦音
    else if (rng.chance(0.18)) midi = transposeDiatonic(midi, rng.pick([1, -1]), keyPc, mode);                  // 短音邻音微变
    return { ...n, midi, onsetBeat: absBeat, occurrenceKind: 'adapted' as const, cycleIndex };
  });
  if (out.length) { // 尾音解决:落末和弦的和弦音
    const last = out[out.length - 1];
    const lastCh = chordAtBeat(contChords, last.onsetBeat - atBeat) ?? contChords[contChords.length - 1];
    last.midi = nearestChordTone(last.midi, lastCh);
  }
  return out;
}

/** once 情形:后半段用续接和弦做级进填充(落和弦音,末解决)。 */
function fillTowardChords(start: number, end: number, contChords: readonly SandboxChord[], style: SandboxStyle, rng: SeededRng, keyPc: number, mode: ScaleMode): MotifNote[] {
  const out: MotifNote[] = [];
  const rhythm = STYLE_RHYTHM[style];
  let prev = nearestChordTone(70, contChords[0]);
  const bars = Math.max(1, Math.round((end - start) / 4));
  for (let b = 0; b < bars; b++) {
    const barStart = start + b * 4;
    const ch = chordAtBeat(contChords, barStart - start) ?? contChords[Math.min(b, contChords.length - 1)];
    const isLast = b === bars - 1;
    const onsets = isLast ? [0, 2] : rhythm;
    for (let j = 0; j < onsets.length; j++) {
      const at = barStart + onsets[j];
      if (at >= end - 1e-6) break;
      const dur = (j < onsets.length - 1 ? onsets[j + 1] : 4) - onsets[j];
      let midi: number;
      if (isLast && j === onsets.length - 1) midi = nearestChordTone(prev, ch); // 末解决到和弦音(长)
      else if (j % 2 === 0) midi = nearestChordTone(prev, ch);                   // 强拍落和弦音
      else { midi = transposeDiatonic(prev, rng.pick([1, -1, 2]), keyPc, mode); midi = snapMidiToScale(midi, keyPc, mode); }
      out.push({ midi, onsetBeat: at, durationBeat: isLast && j === onsets.length - 1 ? Math.max(dur, 1.5) : dur, velocity: 0.68, scaleDegree: 0, octave: 0, accent: j === 0 ? 0.8 : 0.5, occurrenceKind: 'fill' });
      prev = midi;
    }
  }
  return out;
}

/** 寄存器引导:非 quote 音逐个挪到离上一音最近的八度(消大跳;quote 不动)。 */
function voiceLead(lead: MotifNote[]): MotifNote[] {
  const s = [...lead].sort((a, b) => a.onsetBeat - b.onsetBeat);
  for (let i = 1; i < s.length; i++) {
    if (s[i].occurrenceKind === 'quote') continue;
    let m = s[i].midi; const prev = s[i - 1].midi;
    while (m - prev > 7 && m - 12 >= LEAD_LOW) m -= 12;
    while (prev - m > 7 && m + 12 <= LEAD_HIGH) m += 12;
    s[i].midi = m;
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
  const motifFirstDeg = cycle.motifChords[0].degree;

  // —— 生成【第一轮】(beat 0..cycleBeats):前半段 exact + (twice ? 后半段 adapted : 填充)——
  const cycle0: MotifNote[] = [];
  cycle0.push(...placeExact(motif, 0, 0));
  if (placeTwice) cycle0.push(...placeAdapted(motif, motifBeats, motifFirstDeg, cycle.contChords, 0, rng, keyPc, mode));
  else cycle0.push(...fillTowardChords(motifBeats, cycleBeats, cycle.contChords, style, rng, keyPc, mode));

  // —— 复制第一轮到所有轮(进行重复 → 复制第一遍)——
  const lead: MotifNote[] = [];
  const progression: SandboxChord[] = [];
  const occurrences: MotifOccurrence[] = [];
  for (let c = 0; c < numCycles; c++) {
    const shift = c * cycleBeats;
    for (const n of cycle0) lead.push({ ...n, onsetBeat: n.onsetBeat + shift, cycleIndex: c });
    for (const ch of cycle.all) progression.push({ ...ch, startBeat: ch.startBeat + shift });
    occurrences.push({ motifId: motif.id, startBeat: shift, kind: 'quote', cycleIndex: c, chordRoman: cycle.motifChords[0].roman });
    if (placeTwice) occurrences.push({ motifId: motif.id, startBeat: shift + motifBeats, kind: 'adapted', cycleIndex: c, chordRoman: cycle.contChords[0].roman });
  }

  const finalLead = voiceLead(lead).filter((n) => n.durationBeat > 0);
  const audit = auditMotifWeave(finalLead, motif, occurrences, keyPc, mode, { numCycles, cycleBeats, placeTwice });
  return { motif, progression, occurrences, lead: finalLead, cycleBeats, numCycles, placeTwice, audit };
}
