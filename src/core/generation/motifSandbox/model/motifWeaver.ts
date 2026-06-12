// ============================================================
// motifSandbox · model · Motif Weaver(旋律续写,clean-room ThemeWeaver.myGenerateSolo)
// ------------------------------------------------------------
// 16 bars lead-only:verse1(8)+verse2(8)。每 verse 首拍 motif【原样 quote(identity)】,
//   随后 answer(motif 序进发展)+ continuation(级进导向终止主音)。第一期轻量:
//   quote + sequence/answer + cadence target + boundary smoothing,先跑通能听,再耳朵迭代。
// 非 jazz 全 diatonic(chromaticRatio=0)。确定性(seeded rng,无 Math.random)。
// ============================================================

import type { MotifNote, MotifOccurrence, MotifWeaverInput, MotifWeaverResult, SandboxStyle, ScaleMode, UserMotif } from './types';
import { analyzeAndNormalize } from './motifAnalysis';
import { identity, transposeDiatonicMotif, fitRange } from './motifTransform';
import { transposeDiatonic, degreeOctaveToMidi, snapMidiToScale } from './scale';
import { auditMotifWeave } from './jazzinessAudit';
import { makeRng, type SeededRng } from './rng';

const TOTAL_BEATS = 64;
const VERSE2_START = 32;
const LEAD_LOW = 60, LEAD_HIGH = 84;

const STYLE_RHYTHM: Record<SandboxStyle, number[]> = {
  pop: [0, 1, 2, 3],
  lofi: [0, 2],
  rnb: [0, 1, 1.5, 2.5, 3],
  jazz: [0, 0.5, 1, 1.5, 2, 3],
};
const STYLE_SEQ_STEPS: Record<SandboxStyle, number[]> = {
  pop: [1, -1, 2, -2],
  lofi: [2, -2, 1],
  rnb: [1, -2, 1, 3],
  jazz: [2, -1, 3, -2],
};

const nearestDegreeMidi = (degree: number, refMidi: number, keyPc: number, mode: ScaleMode): number => {
  let best = degreeOctaveToMidi(degree, 4, keyPc, mode), bestD = 99;
  for (let oct = 3; oct <= 6; oct++) {
    const m = degreeOctaveToMidi(degree, oct, keyPc, mode);
    const d = Math.abs(m - refMidi);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
};
const stepToward = (fromMidi: number, targetMidi: number, keyPc: number, mode: ScaleMode): number => {
  if (Math.abs(fromMidi - targetMidi) < 1) return targetMidi;
  return transposeDiatonic(fromMidi, fromMidi < targetMidi ? 1 : -1, keyPc, mode);
};

function pasteQuote(motif: UserMotif, atBeat: number, section: 'verse1' | 'verse2'): MotifNote[] {
  return fitRange(identity(motif.notes), LEAD_LOW, LEAD_HIGH).map((n) => ({
    ...n, onsetBeat: atBeat + n.onsetBeat, occurrenceKind: 'quote', sectionId: section,
  }));
}

/** answer:motif 序进发展,填 [start,end);seed 影响序进步选择;LOFI 留白多。 */
function fillAnswer(motif: UserMotif, start: number, end: number, style: SandboxStyle, rng: SeededRng, section: 'verse1' | 'verse2'): MotifNote[] {
  const out: MotifNote[] = [];
  const steps = STYLE_SEQ_STEPS[style];
  const stride = motif.lengthBeats + (style === 'lofi' ? 1 : 0);
  let cursor = start;
  while (cursor < end - 0.25) {
    const step = rng.pick(steps); // ★ seed 影响发展
    const frag = transposeDiatonicMotif(motif.notes, step, motif.keyPc, motif.mode);
    for (const n of frag) {
      const at = cursor + n.onsetBeat;
      if (at >= end - 1e-6) break;
      out.push({ ...n, onsetBeat: at, durationBeat: Math.min(n.durationBeat, end - at), accent: n.accent * 0.85, occurrenceKind: 'answer', sectionId: section });
    }
    cursor += stride;
    if (style === 'lofi' && rng.chance(0.5)) cursor += 1;
  }
  return out;
}

/** continuation:级进导向终止主音(末小节落 tonic 长音);cadenceRef 决定落在哪个八度的主音(平滑进下一段)。 */
function fillContinuation(start: number, end: number, fromMidi: number, cadenceRefMidi: number, motif: UserMotif, style: SandboxStyle, rng: SeededRng, strongerEnding: boolean): MotifNote[] {
  const { keyPc, mode } = motif;
  const out: MotifNote[] = [];
  const bars = Math.max(1, Math.round((end - start) / 4));
  const rhythm = STYLE_RHYTHM[style];
  const tonic = nearestDegreeMidi(1, cadenceRefMidi, keyPc, mode);
  let prev = fromMidi;
  for (let b = 0; b < bars; b++) {
    const barStart = start + b * 4;
    const isLast = b === bars - 1;
    const onsets = isLast ? [0, 2] : rhythm;
    // 中途目标:逐渐逼近 tonic;非末 bar 在 5/3 间游走(rng 选,seed 影响)
    const barTarget = isLast ? tonic : nearestDegreeMidi(rng.pick([5, 3, 2, 6]), prev, keyPc, mode);
    for (let j = 0; j < onsets.length; j++) {
      const at = barStart + onsets[j];
      if (at >= end - 1e-6) break;
      const nextOnset = j < onsets.length - 1 ? barStart + onsets[j + 1] : barStart + 4;
      let dur = nextOnset - at;
      let midi: number;
      if (isLast && j === onsets.length - 1) { midi = tonic; dur = Math.max(dur, strongerEnding ? 2 : 1.5); }
      else {
        midi = stepToward(prev, barTarget, keyPc, mode);
        if (rng.chance(0.25)) midi = transposeDiatonic(midi, rng.pick([1, -1]), keyPc, mode); // 邻接装饰(seed 影响)
      }
      midi = snapMidiToScale(midi, keyPc, mode);
      out.push({ midi, onsetBeat: at, durationBeat: Math.min(dur, end - at), velocity: 0.7, scaleDegree: 0, octave: 0, accent: at % 4 === 0 ? 0.8 : 0.5, occurrenceKind: 'continuation' });
      prev = midi;
    }
  }
  return out;
}

/** 寄存器引导:非 quote 音逐个挪到离上一音最近的八度(消大跳;quote 内部不动)。 */
function voiceLeadNonQuote(lead: MotifNote[]): MotifNote[] {
  const sorted = [...lead].sort((a, b) => a.onsetBeat - b.onsetBeat);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].midi;
    if (sorted[i].occurrenceKind === 'quote') continue; // quote 不动
    let m = sorted[i].midi;
    while (m - prev > 6 && m - 12 >= LEAD_LOW) m -= 12;
    while (prev - m > 6 && m + 12 <= LEAD_HIGH) m += 12;
    sorted[i].midi = m;
  }
  return sorted;
}

export function generateMotifWeave(input: MotifWeaverInput): MotifWeaverResult {
  const { motif } = analyzeAndNormalize(input.capturedNotes, input.keyPc, input.mode, input.bpm, input.seed);
  const rng = makeRng((input.seed ^ 0x9e3779b9) >>> 0);
  const L = motif.lengthBeats;
  const lead: MotifNote[] = [];
  const occurrences: MotifOccurrence[] = [];
  const quoteFirst = fitRange(identity(motif.notes), LEAD_LOW, LEAD_HIGH)[0]?.midi ?? LEAD_LOW + 7;

  // verse1:quote → answer → continuation(导向 verse2 quote 首音的八度)
  lead.push(...pasteQuote(motif, 0, 'verse1'));
  occurrences.push({ motifId: motif.id, sectionId: 'verse1', startBeat: 0, kind: 'quote', transform: 'identity' });
  const a1 = fillAnswer(motif, L, 16, input.style, rng, 'verse1');
  lead.push(...a1);
  lead.push(...fillContinuation(16, VERSE2_START, a1.length ? a1[a1.length - 1].midi : quoteFirst, quoteFirst, motif, input.style, rng, false));

  // verse2:同 quote → answer → continuation(最终终止,落主音)
  lead.push(...pasteQuote(motif, VERSE2_START, 'verse2'));
  occurrences.push({ motifId: motif.id, sectionId: 'verse2', startBeat: VERSE2_START, kind: 'quote', transform: 'identity' });
  const a2 = fillAnswer(motif, VERSE2_START + L, 48, input.style, rng, 'verse2');
  lead.push(...a2);
  lead.push(...fillContinuation(48, TOTAL_BEATS, a2.length ? a2[a2.length - 1].midi : quoteFirst, quoteFirst, motif, input.style, rng, true));

  const connected = voiceLeadNonQuote(lead).filter((n) => n.onsetBeat < TOTAL_BEATS && n.durationBeat > 0);
  const audit = auditMotifWeave(connected, motif, occurrences, input.keyPc, input.mode);
  return { motif, occurrences, lead: connected, audit };
}
