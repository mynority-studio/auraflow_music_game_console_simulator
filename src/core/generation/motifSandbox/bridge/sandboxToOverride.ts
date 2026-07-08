// ============================================================
// motifSandbox · bridge · Q+R 产物 → Q+N MotifSongOverride(走 A · PR3 高层入口)
// ------------------------------------------------------------
// 把一次 Q+R motif weave 结果(progression + lead)整体转成 generateSongFromMotif 的注入合同:
//   harmony = 权威和声(sandboxProgressionToHarmonicPlan),lead = 权威 lead(MotifNote→MotifLeadNote,beats)。
// 这是 UI / 调用方拿到的【单一转换入口】。
// ============================================================

import type { MotifSongOverride, MotifLeadNote } from '../../newEngine/generation/generateSongFromMotif';
import { chordTypeIntervals, normalizeChordType } from '../../newEngine/knowledge/chords';
import { sandboxProgressionToHarmonicPlan } from './sandboxToHarmonicPlan';
import { analyzeUserMelodicBrick } from '../model/melodicBrickAnalyzer';
import { inferHarmonyIntent } from '../model/melodicBrickHarmonyIntent';
import { findUnsupportedFirstPhraseTones, selectProgressionForMotif } from '../model/motifProgressionSelector';
import { realizeToSandboxChords } from '../model/motifRoadmap';
import { degreeToPc, makeChord, romanOf } from '../model/chords';
import type { SandboxChord } from '../model/chords';
import type { SandboxTonality } from '../model/sandboxScales';
import type { MotifNote, MotifWeaverResult, SandboxStyle, ScaleMode, UserMotif } from '../model/types';

const MOTIF_LEAD_PRESENCE_FLOOR = 82;
const MOTIF_LEAD_TARGET_AVG = 92;
const MOTIF_LEAD_GAIN_THRESHOLD = 88;
const MOTIF_LEAD_MAX_GAIN = 2.5;
const MOTIF_LEAD_BOOSTED_CEILING = 118;
const DEFAULT_TARGET_BARS = 16;
const EPS = 1e-6;

export interface UserMotifBrickSongOverrideOptions {
  quoteBeats?: number;
  style?: SandboxStyle;
  seed?: number;
  keyPc?: number;
  mode?: ScaleMode;
  targetBars?: number;
  inputTonality?: SandboxTonality;
}

function clampVelocity(v: number, hi = 127): number {
  return Math.max(1, Math.min(hi, Math.round(v)));
}

/** Q+R lead 音(velocity 0..1)→ 权威 lead 音(beats,velocity 1..127)。 */
export function motifNoteToLeadNote(n: MotifNote): MotifLeadNote {
  return {
    pitch: Math.round(n.midi),
    onsetBeat: n.onsetBeat,
    durationBeat: n.durationBeat,
    velocity: clampVelocity((n.velocity || 0.7) * 127),
    accent: n.accent,
    structuralToneScore: n.structuralToneScore,
  };
}

/** Q+R 整编用 lead presence:用户轻弹的 motif 进完整 pop/乐队伴奏时不能被 comp 盖住。 */
export function motifNotesToLeadNotes(notes: readonly MotifNote[]): MotifLeadNote[] {
  const raw = notes.map(motifNoteToLeadNote);
  if (!raw.length) return raw;

  const avg = raw.reduce((sum, n) => sum + n.velocity, 0) / raw.length;
  const gain = avg < MOTIF_LEAD_GAIN_THRESHOLD
    ? Math.min(MOTIF_LEAD_MAX_GAIN, MOTIF_LEAD_TARGET_AVG / Math.max(1, avg))
    : 1;

  return raw.map((n) => ({
    ...n,
    velocity: clampVelocity(
      Math.max(MOTIF_LEAD_PRESENCE_FLOOR, n.velocity * gain),
      gain > 1 ? MOTIF_LEAD_BOOSTED_CEILING : 127,
    ),
  }));
}

/** 一次 Q+R weave 结果 → Q+N 注入合同(harmony + lead 都做权威)。 */
export function buildMotifSongOverride(result: MotifWeaverResult, keyPc: number, mode: ScaleMode): MotifSongOverride {
  return {
    harmony: sandboxProgressionToHarmonicPlan(result.progression, keyPc, mode),
    lead: motifNotesToLeadNotes(result.lead),
    key: { keyPc: ((keyPc % 12) + 12) % 12, mode }, // 供 generateSongFromMotif 把 16-bar 和声 tile 满 arrangement 时重装配
  };
}

function quoteBeatsForMotif(motif: UserMotif): number {
  const motifBars = Math.max(1, Math.min(4, Math.round(motif.lengthBeats / 4)));
  const quoteBars = motifBars >= 4 ? 2 : motifBars;
  return Math.min(motif.lengthBeats, quoteBars * 4);
}

const m12 = (n: number): number => ((n % 12) + 12) % 12;

function chordPcs(rootPc: number, type: string): number[] {
  return [...new Set(chordTypeIntervals(normalizeChordType(type) ?? 'maj').map((iv) => m12(rootPc + iv)))];
}

function chordSupports(chord: SandboxChord, requiredPcs: readonly number[]): boolean {
  const pcs = chordPcs(chord.realRootPc ?? chord.rootPc, chord.realType ?? 'maj');
  return requiredPcs.every((pc) => pcs.includes(m12(pc)));
}

function funcOfDegree(degree: number): 'T' | 'S' | 'D' {
  const d = ((degree - 1) % 7 + 7) % 7 + 1;
  return d === 5 || d === 7 ? 'D' : d === 2 || d === 4 ? 'S' : 'T';
}

function candidateTypesForDegree(degree: number, keyPc: number, mode: ScaleMode): string[] {
  const root = degreeToPc(degree, keyPc, mode);
  const base = makeChord(degree, keyPc, mode, 0, 4);
  const ivs = new Set(base.tonePcs.map((pc) => m12(pc - root)));
  if (ivs.has(6)) return ['m7b5', 'dim7', 'm9b5'];
  if (ivs.has(3)) return ['min', 'm7', 'madd9', 'm9', 'm11', 'm13', 'm6/9'];
  return ['maj', 'add9', 'maj7', 'maj9', '6', '6/9', 'maj13', 'maj7#11', 'sus2', 'sus4', '7sus4', '9sus4', '13sus4', '7', '9', '11', '13', '13#11', '7#11'];
}

function chooseSupportChord(original: SandboxChord, requiredPcs: readonly number[], keyPc: number, mode: ScaleMode): SandboxChord {
  if (chordSupports(original, requiredPcs)) return original;
  let best: { degree: number; type: string; score: number } | null = null;
  for (let degree = 1; degree <= 7; degree++) {
    const rootPc = degreeToPc(degree, keyPc, mode);
    const types = candidateTypesForDegree(degree, keyPc, mode);
    for (let rank = 0; rank < types.length; rank++) {
      const type = types[rank];
      const pcs = chordPcs(rootPc, type);
      if (!requiredPcs.every((pc) => pcs.includes(m12(pc)))) continue;
      let score = rank;
      if (degree !== original.degree) score += 3;
      if (funcOfDegree(degree) !== (original.effectiveFunc ?? funcOfDegree(original.degree))) score += 1.5;
      score += Math.abs(degree - original.degree) * 0.15;
      if (!best || score < best.score) best = { degree, type, score };
    }
  }
  if (!best) return original;

  const rootPc = degreeToPc(best.degree, keyPc, mode);
  const repaired = makeChord(best.degree, keyPc, mode, original.startBeat, original.durationBeats);
  return {
    ...repaired,
    realRoman: romanOf(best.degree, mode),
    realType: best.type,
    realRootPc: rootPc,
    realTonePcs: chordPcs(rootPc, best.type),
    borrowedSource: undefined,
    effectiveFunc: original.effectiveFunc ?? funcOfDegree(best.degree),
  };
}

function repairFirstPhraseHarmony(progression: readonly SandboxChord[], brick: ReturnType<typeof analyzeUserMelodicBrick>, keyPc: number, mode: ScaleMode): SandboxChord[] {
  return progression.map((chord) => {
    if (chord.startBeat >= brick.quoteBeats - EPS) return chord;
    const requiredPcs = brick.structuralTones
      .filter((t) => t.onsetBeat >= chord.startBeat - EPS && t.onsetBeat < chord.startBeat + chord.durationBeats - EPS && t.onsetBeat < brick.quoteBeats - EPS)
      .map((t) => m12(t.midi));
    return requiredPcs.length ? chooseSupportChord(chord, requiredPcs, keyPc, mode) : chord;
  });
}

function buildMotifOwnedHarmony(motif: UserMotif, opts: UserMotifBrickSongOverrideOptions, quoteBeats: number): MotifSongOverride['harmony'] {
  if (!opts.style) return undefined;
  const keyPc = m12(opts.keyPc ?? motif.keyPc);
  const mode = opts.mode ?? motif.mode;
  const inputTonality = opts.inputTonality ?? motif.inputTonality;
  const seed = opts.seed ?? 0;
  const targetBars = opts.targetBars ?? DEFAULT_TARGET_BARS;
  const brick = analyzeUserMelodicBrick({ ...motif, keyPc, mode }, quoteBeats);
  const selected = selectProgressionForMotif({
    brick,
    intent: inferHarmonyIntent(brick),
    style: opts.style,
    mode,
    keyPc,
    seed,
    targetBars,
    inputTonality,
    requireFirstPhraseSupport: true,
  });
  const realized = realizeToSandboxChords(selected.slots, keyPc, mode, { inputTonality, userBrick: brick, seed });
  let progression = repairFirstPhraseHarmony(realized, brick, keyPc, mode);
  const unsupported = findUnsupportedFirstPhraseTones({ brick, slots: selected.slots, keyPc });
  if (unsupported.length > 0) progression = repairFirstPhraseHarmony(progression, brick, keyPc, mode);
  return sandboxProgressionToHarmonicPlan(progression, keyPc, mode);
}

function normalizeOverrideOptions(motif: UserMotif, optionsOrQuoteBeats?: number | UserMotifBrickSongOverrideOptions): { quoteBeats: number; opts: UserMotifBrickSongOverrideOptions } {
  if (typeof optionsOrQuoteBeats === 'number') return { quoteBeats: optionsOrQuoteBeats, opts: { quoteBeats: optionsOrQuoteBeats } };
  const opts = optionsOrQuoteBeats ?? {};
  return { quoteBeats: opts.quoteBeats ?? quoteBeatsForMotif(motif), opts };
}

/** Q+R 产品播放链路:只把用户输入 motif 当作 Q+N lead 内的 brick quote。
 *  不把 sandbox weaver 续写出的整条 lead 注入成品;若给出 style/seed,和声由用户 motif 首句硬约束。 */
export function buildUserMotifBrickSongOverride(motif: UserMotif, optionsOrQuoteBeats?: number | UserMotifBrickSongOverrideOptions): MotifSongOverride {
  const { quoteBeats, opts } = normalizeOverrideOptions(motif, optionsOrQuoteBeats);
  const harmony = buildMotifOwnedHarmony(motif, opts, quoteBeats);
  const keyPc = m12(opts.keyPc ?? motif.keyPc);
  const mode = opts.mode ?? motif.mode;
  return {
    ...(harmony ? { harmony, key: { keyPc, mode } } : {}),
    userBrick: {
      notes: motifNotesToLeadNotes(motif.notes),
      quoteBeats,
    },
  };
}

/** 兼容调试 result 的便捷入口;产品 UI 优先用 buildUserMotifBrickSongOverride(motif)。 */
export function buildMotifBrickSongOverride(result: MotifWeaverResult): MotifSongOverride {
  return buildUserMotifBrickSongOverride(result.motif, Math.min(result.motif.lengthBeats, result.quoteBars * 4));
}
