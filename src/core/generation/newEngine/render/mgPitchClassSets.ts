// ============================================================
// newEngine · render · MgPitchClassSets(MG strict 移植 Loop 4)
// Provenance: ../melodygenerative/src/lib/improvisor/PitchClassSets.ts 忠实港。
// 改动:import CHORD_TYPES/SCALE_TYPES←knowledge/mgMusicTheory·
//       lookupChordDef/ImprovisorChordDef←knowledge/improvisorChordVocab·ChordBlock←./mgChordPart。
// 每和弦 pc 调色板(chordTones/colorTones/scaleTones/approachTargets/outsideTones/priorityPcs)。
// ============================================================

// PitchClassSets.ts — Per-chord pc classification.
//
// For each chord we expose four NON-OVERLAPPING pc sets that LickGen
// consumes per-token:
//
//   chordTones    — root + 3 + 5 + 7 of the chord (basic identity).
//   colorTones    — declared extensions (9, 11, 13, alts) for the type.
//   scaleTones    — the chord's mode (e.g., Mixolydian for dom7) MINUS
//                   chordTones and colorTones.
//   approachTargets — pcs of NEXT chord's chord-tones (when known) —
//                   used by `A` tokens to choose half-step neighbors.
//   outsideTones  — everything else (chromatic).
//
// CLEAN-ROOM: classification is derived from music-theory rules
// (CHORD_TYPES literal intervals + family-aware scale picking), NOT
// from any external chord dictionary.

import { CHORD_TYPES, SCALE_TYPES } from '../knowledge/mgMusicTheory';
import { lookupChordDef, type ImprovisorChordDef } from '../knowledge/improvisorChordVocab';
import type { ChordBlock } from './mgChordPart';
import type { AcgStableRole } from '../knowledge/melodyGrammarTypes';
// ★ MG full-parity G2/G3:localScaleContext-aware orthogonal pitch sets(chord contract ∩ resolved local scale)。
import {
  resolveMelodyAdmissionContext, resolveLocalScale, melodyContractPcsForStyle,
  type LocalScaleContext, type LocalScaleChordLike,
} from '../knowledge/mgLocalScaleResolver';

export interface ChordPitchSets {
  /** Chord root pc (0-11). */
  rootPc: number;
  /** Actual sounding bass pc (0-11) — equals rootPc for root-position
   *  chords, differs for slash chords. Consumed by NoteChooser's B
   *  token (IV LickGen.java:3063 uses root with `// FIX!` TODO; we
   *  thread the real bass through to support G7/D, F/G, pedal-on-
   *  tonic etc.). */
  bassPc: number;
  /** Original chord type string — used by NoteChooser's X token to
   *  resolve degree labels chord-family-aware (per IV makeRelativeNote
   *  semantics: degree '7' on m7 = b7 = 10 semis, on maj7 = 11 semis). */
  chordType: string;
  /** Basic chord tones (root, 3rd, 5th, 7th) as absolute pcs. */
  chordTones: number[];
  /** Color extensions (9, 11, 13, alterations) — NEVER overlap chordTones. */
  colorTones: number[];
  /** Scale tones — chord's mode, MINUS chord and color tones. */
  scaleTones: number[];
  /** Half-step neighbor pcs of the NEXT chord's tones (or current's
   *  if no next). For A tokens. */
  approachTargets: number[];
  /** All other pcs (12 - union of above). */
  outsideTones: number[];
  /** IV vocab landing priority (high → low). Absolute pcs. Empty when
   *  no vocab entry exists for this chord. NoteChooser uses this to
   *  bias C/L token landings toward jazz-pianist preference order
   *  (typically 7 → 3 → 9 → 5 → root). */
  priorityPcs: number[];
  /** False when the upstream HarmonicPlan is the complete local admission contract. */
  allowChromaticRandom?: boolean;
}

/** ACG token-contract 的稳定声部候选。role 是和弦语义角色而非数组位置。 */
export interface AcgStableToneCandidate {
  pc: number;
  role: AcgStableRole;
}

const normalizePc = (value: number): number => ((value % 12) + 12) % 12;

/**
 * ACG 的稳定落点必须来自 HarmonicPlan 的 stableToneMap ∩ chordScaleMap。
 * 只有旧测试/外部调用没有下发 plan map 时才退回实际 chord spelling；这保证
 * grammar 的 stableRoles 永远是在权威和声合同上筛选，而不是在 renderer 猜一遍。
 */
export function acgStablePcsForChord(chord: ChordBlock): number[] {
  const declaredStable = [...(chord.stableTonePcs ?? [])].map(normalizePc);
  const declaredScale = new Set([...(chord.chordScalePcs ?? [])].map(normalizePc));
  if (declaredStable.length > 0) {
    const admitted = declaredScale.size > 0
      ? declaredStable.filter((pc) => declaredScale.has(pc))
      : declaredStable;
    if (admitted.length > 0) return [...new Set(admitted)].sort((a, b) => a - b);
  }

  const fallback = (CHORD_TYPES[chord.type] ?? [0, 4, 7])
    .map((interval) => normalizePc(chord.rootPc + interval));
  const admittedFallback = declaredScale.size > 0
    ? fallback.filter((pc) => declaredScale.has(pc))
    : fallback;
  return [...new Set(admittedFallback.length > 0 ? admittedFallback : fallback)].sort((a, b) => a - b);
}

/**
 * Map a declared stable pc to the limited role vocabulary used by ACG return
 * grammar. Suspended fourths occupy the third-slot; extensions (9/11/13) do
 * not impersonate a fifth, so stableRoles remains a genuinely hard filter.
 */
export function acgStableRoleForPc(chord: ChordBlock, pc: number): AcgStableRole | null {
  const interval = normalizePc(normalizePc(pc) - normalizePc(chord.rootPc));
  if (interval === 0) return 'root';
  if (interval === 3 || interval === 4 || interval === 5) return 'third';
  if (interval === 6 || interval === 7 || interval === 8) return 'fifth';
  if (interval === 10 || interval === 11) return 'seventh';
  return null;
}

/**
 * The single source of truth for ACG arrival eligibility. Both scheduler and
 * realizer call this, so `stableRoles` cannot be weakened by a later fallback.
 */
export function acgStableToneCandidates(
  chord: ChordBlock,
  allowedRoles: readonly AcgStableRole[],
): AcgStableToneCandidate[] {
  const allowed = new Set(allowedRoles);
  return acgStablePcsForChord(chord)
    .map((pc) => ({ pc, role: acgStableRoleForPc(chord, pc) }))
    .filter((candidate): candidate is AcgStableToneCandidate => candidate.role !== null && allowed.has(candidate.role))
    .sort((a, b) => a.pc - b.pc || a.role.localeCompare(b.role));
}

/** Map chord type → preferred scale name. CLEAN-ROOM: derived from
 *  music theory family conventions (Mixolydian for dom7, Dorian for
 *  ii7, etc.). Falls back to "Ionian" when no mapping. */
function pickScaleForChord(chordType: string): string {
  const t = chordType.toLowerCase();
  if (t.includes('sus')) return 'Mixolydian';  // sus on dominants
  if (t === 'maj7' || t === 'maj9' || t === 'maj13' || t.startsWith('maj') || t === '6' || t === '6/9' || t === 'add9') {
    return t.includes('#11') || t.includes('lyd') ? 'Lydian' : 'Ionian';
  }
  if (t === 'm7b5' || t === 'm9b5') return 'Locrian';
  if (t === 'dim' || t === 'dim7') return 'Locrian';
  if (t.startsWith('m') && !t.startsWith('maj')) {
    // Default minor → Dorian (jazz default). m7b5 caught above.
    return 'Dorian';
  }
  if (t.includes('alt') || t.includes('b9') || t.includes('#9') || t.includes('b13') || t.includes('#5')) {
    return 'Altered';  // dom altered
  }
  if (t.includes('#11')) return 'Lydian Dominant';
  // Plain dom7 / 9 / 13 etc. → Mixolydian
  return 'Mixolydian';
}

/** Build the chord-relative chord-tone pcs from CHORD_TYPES. IV-faithful:
 *  CHORD_TYPES intervals are the chord's spell (root + 3 + 5 + 7 + any
 *  declared extensions like 9 / 11 / 13 / alts). All of them are part of
 *  identity. No "BASIC vs extension" filter — that was OUR theory and
 *  dropped maj9's 9, sus4's 4, 6/9's 6 etc. from the fallback chord
 *  pool. IV trusts vocab.spell verbatim; when vocab is absent we trust
 *  CHORD_TYPES the same way. */
function buildChordTones(chordType: string, rootPc: number): number[] {
  const ivs = CHORD_TYPES[chordType] ?? [0, 4, 7];
  const set = new Set<number>();
  for (const iv of ivs) set.add(((rootPc + iv) % 12 + 12) % 12);
  if (set.size === 0) set.add(rootPc);
  return [...set].sort((a, b) => a - b);
}

/** Build scale-tone pcs (chord's mode) MINUS chord and color tones. */
function buildScaleTones(scaleName: string, rootPc: number, exclude: Set<number>): number[] {
  const ivs = SCALE_TYPES[scaleName] ?? SCALE_TYPES['Ionian'];
  const out: number[] = [];
  for (const iv of ivs) {
    const pc = (rootPc + iv) % 12;
    if (!exclude.has(pc)) out.push(pc);
  }
  return out;
}

/** Build approach-target pcs: half-step neighbors of the next chord's
 *  chord tones (or current chord's if next is absent). */
function buildApproachTargets(currentChordTones: number[], nextChordTones: number[] | null): number[] {
  const targets = nextChordTones && nextChordTones.length > 0 ? nextChordTones : currentChordTones;
  const set = new Set<number>();
  for (const pc of targets) {
    set.add((pc + 1) % 12);
    set.add((pc + 11) % 12);
  }
  // Remove any pc that's also a chord tone — approach should be DIFFERENT
  for (const pc of targets) set.delete(pc);
  return [...set].sort((a, b) => a - b);
}

function hardAvoidPcsForMelodyPool(chordType: string, rootPc: number): Set<number> {
  const lower = chordType.toLowerCase();
  const avoidIntervals: number[] = [];

  if (lower.includes('sus')) {
    avoidIntervals.push(4);
  } else if (lower.startsWith('maj') || lower === '6' || lower === '6/9' || lower === 'add9') {
    avoidIntervals.push(5);
  } else if (lower === 'm7' || lower === 'm9' || lower === 'm11' || lower === 'm13') {
    avoidIntervals.push(11);
  } else if (lower.startsWith('m') && !lower.startsWith('maj')) {
    // Minor triads / half-diminished / minor-major variants keep their
    // vocab scale color; the hard M7 filter is only for m7-family pools.
  } else if (lower.includes('dim') || lower.includes('aug') || lower.includes('b5')) {
    // Symmetric/altered sonorities do not have one universal avoid pc.
  } else if (!/alt|b9|#9|b13|#11/.test(lower)) {
    avoidIntervals.push(5);
  }

  return new Set(avoidIntervals.map(iv => (rootPc + iv) % 12));
}

export interface BuildPitchSetsArgs {
  chord: ChordBlock;
  nextChord?: ChordBlock | null;
  /** ★ MG full-parity G2:本地音阶语境(style/key/mode)。给定 → 走 orthogonal admission
   *  (结构音 = chord contract ∩ resolved local scale,空则回退 contract,忠实当前 MG);
   *  缺省 → 旧 vocab/fallback 路径(逐字节不变,opt-in)。 */
  localScaleContext?: LocalScaleContext;
}

export function buildPitchSets(args: BuildPitchSetsArgs): ChordPitchSets {
  const { chord, nextChord, localScaleContext } = args;

  // ★ MG full-parity G3:有 localScaleContext → orthogonal pitch sets(当前 MG 行为)。
  if (localScaleContext) {
    return buildOrthogonalPitchSets(chord, nextChord ?? null, localScaleContext);
  }

  // PRIMARY: query IV vocab for hand-curated data. Vocab pcs are stored
  // C-relative — transpose to chord.rootPc here.
  const def = lookupChordDef(chord.type);
  if (def) {
    return buildFromVocab(def, chord.rootPc, chord.bassPc, chord.type, nextChord, chord.forcedScale);
  }

  // FALLBACK (no vocab entry): IV-faithful split — chord tones = ALL
  // CHORD_TYPES intervals (the engine's spell); color is empty (we have
  // no authoritative color source without vocab); scale = derived mode.
  // priority falls back to chord-tone order per IV ChordForm.java:754
  // (`if priority==null return spell`).
  const chordTones = buildChordTones(chord.type, chord.rootPc);
  const colorTones: number[] = [];
  const scaleName = chord.forcedScale && SCALE_TYPES[chord.forcedScale]
    ? chord.forcedScale
    : pickScaleForChord(chord.type);
  const hardAvoidPcs = hardAvoidPcsForMelodyPool(chord.type, chord.rootPc);
  const exclude = new Set([...chordTones, ...hardAvoidPcs]);
  const scaleTones = buildScaleTones(scaleName, chord.rootPc, exclude);

  const nextChordTones = nextChord ? buildChordTones(nextChord.type, nextChord.rootPc) : null;
  const approachTargets = buildApproachTargets(chordTones, nextChordTones);

  // Outside = 12 - union
  const union = new Set<number>([...chordTones, ...scaleTones, ...approachTargets]);
  const outsideTones: number[] = [];
  for (let pc = 0; pc < 12; pc++) if (!union.has(pc)) outsideTones.push(pc);

  return { rootPc: chord.rootPc, bassPc: chord.bassPc, chordType: chord.type, chordTones, colorTones, scaleTones, approachTargets, outsideTones, priorityPcs: chordTones };
}

// ============================================================
// ★ MG full-parity G3:orthogonal pitch sets(忠实 port 当前 ../melodygenerative
//   PitchClassSets buildOrthogonalPitchSets + chordLikeFromBlock + isDeclaredColorPc +
//   priorityPcsForOrthogonalContract)。结构音 = written chord contract ∩ resolved local scale;
//   交集空 → 回退 contract(同 MG)。
//   ★ 适配:simulator ChordBlock 无 roman/borrowedFrom/borrowedSource(rootMidi 用 rootPc,pcOf 等价)→
//     这些 chord-level 标签缺省;jazz-chord-scale(type+func)/tonicization(localKeyPc)/altered(type)仍准,
//     borrowed/modal 退化到 type/global(invariant 仍立)。后续可把 roman/borrowed* 经 ChordBlock 补上提精度。
// ============================================================
function chordLikeFromBlock(chord: ChordBlock): LocalScaleChordLike {
  return {
    rootMidi: chord.rootPc, // pcOf(rootPc) === rootPc;无 rootMidi 字段,用 pc 等价
    type: chord.type,
    roman: chord.roman ?? '',
    effectiveFunc: chord.functionHint,
    forcedScale: chord.forcedScale,
    localTonalCenterPc: chord.localKeyPc,
    borrowedFrom: chord.borrowedFrom,
    borrowedSource: chord.borrowedSource,
  } as LocalScaleChordLike;
}

function isDeclaredColorPc(chordType: string, rootPc: number, pc: number): boolean {
  const literal = CHORD_TYPES[chordType] ?? CHORD_TYPES.maj;
  const interval = ((pc - rootPc) % 12 + 12) % 12;
  const basic = new Set([0, 3, 4, 5, 7, 10, 11]);
  return literal.some((iv) => ((iv % 12) + 12) % 12 === interval) && !basic.has(interval);
}

function priorityPcsForOrthogonalContract(chordType: string, rootPc: number, pcs: number[]): number[] {
  const literal = CHORD_TYPES[chordType] ?? CHORD_TYPES.maj;
  const wantedIntervals = [3, 4, 10, 11, 2, 9, 7, 0, 5, 6, 8, 1];
  const wanted: number[] = [];
  for (const interval of wantedIntervals) {
    if (!literal.some((iv) => ((iv % 12) + 12) % 12 === interval)) continue;
    const pc = (rootPc + interval) % 12;
    if (pcs.includes(pc) && !wanted.includes(pc)) wanted.push(pc);
  }
  for (const pc of pcs) if (!wanted.includes(pc)) wanted.push(pc);
  return wanted;
}

function buildOrthogonalPitchSets(chord: ChordBlock, nextChord: ChordBlock | null, ctx: LocalScaleContext): ChordPitchSets {
  const chordLike = chordLikeFromBlock(chord);
  const admission = resolveMelodyAdmissionContext(ctx, chordLike);
  // ACG PIANOSONG 已有 HarmonicPlan 下发的 stableToneMap/chordScaleMap。这里直接
  // 消费该权威合同，而非用通用 chord vocabulary 二次猜测；这样主链里的强拍/长音
  // 从一开始就在 plan 的稳定音与局部音阶交集中，不依赖后段 pitch snap 修复。
  const style = ctx.style.toUpperCase();
  const acgPlanSemantics = style === 'ACG' && (chord.stableTonePcs?.length ?? 0) > 0;
  const lofiPlanSemantics = style === 'LOFI' && (chord.stableTonePcs?.length ?? 0) > 0;
  const declaredStable = new Set([...(chord.stableTonePcs ?? [])].map((pc) => ((pc % 12) + 12) % 12));
  const declaredColor = new Set([...(chord.colorTonePcs ?? [])].map((pc) => ((pc % 12) + 12) % 12));
  const declaredAvoid = new Set([...(chord.avoidTonePcs ?? [])].map((pc) => ((pc % 12) + 12) % 12));
  const declaredScale = new Set([...(chord.chordScalePcs ?? [])].map((pc) => ((pc % 12) + 12) % 12));
  const structural = acgPlanSemantics
    ? (() => {
      const admitted = declaredScale.size > 0
        ? [...declaredStable].filter((pc) => declaredScale.has(pc))
        : [...declaredStable];
      return new Set(admitted.length > 0 ? admitted : [...declaredStable]);
    })()
    : (admission.intersectionPcs.size > 0 ? admission.intersectionPcs : admission.contractPcs);
  const scalePcs = (acgPlanSemantics || lofiPlanSemantics) && declaredScale.size > 0
    ? declaredScale
    : admission.localScale.pcs;
  const chordTones = lofiPlanSemantics
    ? [...declaredStable].filter((pc) =>
      !declaredAvoid.has(pc) && (scalePcs.size === 0 || scalePcs.has(pc))).sort((a, b) => a - b)
    : [...structural].sort((a, b) => a - b);
  const colorTones = lofiPlanSemantics
    ? [...declaredColor].filter((pc) =>
      !declaredAvoid.has(pc)
      && !chordTones.includes(pc)
      && (scalePcs.size === 0 || scalePcs.has(pc))).sort((a, b) => a - b)
    : chordTones.filter((pc) => isDeclaredColorPc(chord.type, chord.rootPc, pc)).sort((a, b) => a - b);
  const admitted = new Set([...chordTones, ...colorTones]);
  const scaleTones = [...scalePcs]
    .filter((pc) => !admitted.has(pc) && !declaredAvoid.has(pc))
    .sort((a, b) => a - b);

  let nextStructural: number[] | null = null;
  if (nextChord) {
    const nextDeclaredStable = new Set([...(nextChord.stableTonePcs ?? [])].map((pc) => ((pc % 12) + 12) % 12));
    const nextDeclaredScale = new Set([...(nextChord.chordScalePcs ?? [])].map((pc) => ((pc % 12) + 12) % 12));
    if ((style === 'ACG' || style === 'LOFI') && nextDeclaredStable.size > 0) {
      const admitted = nextDeclaredScale.size > 0
        ? [...nextDeclaredStable].filter((pc) => nextDeclaredScale.has(pc))
        : [...nextDeclaredStable];
      nextStructural = (admitted.length > 0 ? admitted : [...nextDeclaredStable]).sort((a, b) => a - b);
    } else {
      const nextLike = chordLikeFromBlock(nextChord);
      const nextScale = resolveLocalScale(ctx, nextLike);
      const nextContract = melodyContractPcsForStyle(ctx.style, nextLike, nextChord.rootPc);
      const nextIntersection = [...nextContract].filter((pc) => nextScale.pcs.has(pc));
      nextStructural = (nextIntersection.length > 0 ? nextIntersection : [...nextContract]).sort((a, b) => a - b);
    }
  }
  const approachTargets = buildApproachTargets(chordTones, nextStructural);
  const union = new Set<number>([...chordTones, ...scaleTones, ...approachTargets]);
  const outsideTones: number[] = [];
  for (let pc = 0; pc < 12; pc++) if (!union.has(pc)) outsideTones.push(pc);

  return {
    rootPc: chord.rootPc, bassPc: chord.bassPc, chordType: chord.type,
    chordTones, colorTones, scaleTones, approachTargets, outsideTones,
    priorityPcs: priorityPcsForOrthogonalContract(chord.type, chord.rootPc, chordTones),
    allowChromaticRandom: !lofiPlanSemantics,
  };
}

// Build sets from an IV vocab definition. The vocab provides:
//   spell      → chord-tone source (verbatim)
//   color      → authoritative color set (verbatim)
//   priority   → landing-order preference for NoteChooser
//   approach   → per-chord-tone chromatic neighbor map
//   scales     → preferred scales (we pick the first IV-listed one)
function buildFromVocab(
  def: ImprovisorChordDef,
  rootPc: number,
  bassPc: number,
  chordType: string,
  nextChord: ChordBlock | null | undefined,
  forcedScale?: string,
): ChordPitchSets {
  // Chord tones: vocab.spell is AUTHORITATIVE. IV's spell lists every
  // pc that the listener perceives as "part of this chord's identity":
  //   CM7   spell = [C,E,G,B]      (root + 3 + 5 + 7)
  //   CM9   spell = [C,E,G,B,D]    (includes 9 — 9 is part of CM9's identity)
  //   C7sus4 spell = [C,F,G,A#]    (includes 4 — sus replaces 3 with 4)
  // We do NOT filter by BASIC_PCS here — that heuristic was wrong for
  // both maj9-family (loses 9) and sus chords (loses 4). Trust the vocab.
  const chordTonesSet = new Set<number>();
  for (const pc of def.spell) chordTonesSet.add((rootPc + pc) % 12);
  if (chordTonesSet.size === 0) chordTonesSet.add(rootPc);
  const chordTones = [...chordTonesSet].sort((a, b) => a - b);

  // Color tones: vocab.color verbatim, IV-faithful. IV trusts its vocab
  // color list as authoritative; no theory-side filter is layered on top.
  //   CM7   color = [A,D,F#]   (9, 13, #11)
  //   CM9   color = [A,F#]
  //   m     color = [2,5,8,6,9,10,11]   (full Dorian/Aeolian palette)
  // Any "avoid"-style filtering is OUR theory, not IV's — left out.
  const colorTonesSet = new Set<number>();
  const hardAvoidPcs = hardAvoidPcsForMelodyPool(chordType, rootPc);
  for (const pc of def.color) {
    const transposed = (rootPc + pc) % 12;
    if (!hardAvoidPcs.has(transposed)) colorTonesSet.add(transposed);
  }
  const colorTones = [...colorTonesSet].sort((a, b) => a - b);

  // Scale tones — IV-faithful: take the first vocab-listed scale, map
  // its name → our SCALE_TYPES key, transpose by chord root (IV vocab
  // is C-rooted; scale names carry their own root letter that is
  // transposed by rootPc), subtract chord + color tones. No
  // theory-side "avoidPc" filtering or scenario-driven reordering;
  // IV trusts its vocab scale order as authoritative.
  const exclude = new Set<number>([...chordTones, ...colorTones, ...hardAvoidPcs]);
  let scaleName = forcedScale && SCALE_TYPES[forcedScale]
    ? forcedScale
    : pickScaleForChord(def.ivSuffix);
  let scaleRootPc = rootPc;
  if (!forcedScale || !SCALE_TYPES[forcedScale]) {
    for (const ivScaleName of def.scales) {
      const ourScaleName = mapIvScaleName(ivScaleName);
      if (!ourScaleName) continue;
      const ivRootPc = parseIvScaleRoot(ivScaleName) ?? 0;
      scaleName = ourScaleName;
      scaleRootPc = (ivRootPc + rootPc) % 12;
      break;
    }
  }
  const scaleTones = buildScaleTones(scaleName, scaleRootPc, exclude);

  // Approach targets: prefer vocab.approach map when present. Each entry
  // (targetPc, fromPcs[]) means "fromPcs are legal half-step approaches
  // to targetPc". For A tokens, we want the FROM pcs (the neighbors).
  // Cross-chord: if nextChord is given, fold in the next chord's approach
  // sources as well so A-tokens at chord boundaries can lead into next.
  const approachSet = new Set<number>();
  for (const entry of def.approach) {
    for (const pc of entry.fromPcs) approachSet.add((rootPc + pc) % 12);
  }
  if (nextChord) {
    const nextDef = lookupChordDef(nextChord.type);
    if (nextDef) {
      for (const entry of nextDef.approach) {
        for (const pc of entry.fromPcs) approachSet.add((nextChord.rootPc + pc) % 12);
      }
    } else {
      // Fallback: generic half-step neighbors of next chord's basic tones
      const nextTones = buildChordTones(nextChord.type, nextChord.rootPc);
      for (const t of nextTones) {
        approachSet.add((t + 1) % 12);
        approachSet.add((t + 11) % 12);
      }
    }
  }
  // Approach should NOT overlap chord tones (an approach is by definition
  // a non-chord-tone neighbor).
  for (const t of chordTones) approachSet.delete(t);
  const approachTargets = [...approachSet].sort((a, b) => a - b);

  // Priority: vocab.priority transposed (high-priority pc first).
  const priorityPcs = def.priority.map(pc => (rootPc + pc) % 12);

  // Outside = 12 - union
  const union = new Set<number>([...chordTones, ...colorTones, ...scaleTones, ...approachTargets]);
  const outsideTones: number[] = [];
  for (let pc = 0; pc < 12; pc++) if (!union.has(pc)) outsideTones.push(pc);

  return { rootPc, bassPc, chordType, chordTones, colorTones, scaleTones, approachTargets, outsideTones, priorityPcs };
}

// Parse the leading root letter (with optional accidental) from an IV
// scale name and return its pitch class. Examples:
//   "C major"        → 0   (C)
//   "Bb melodic minor" → 10 (Bb)
//   "G major pentatonic" → 7 (G)
//   "F# dorian"      → 6   (F#)
//   "Db diminished"  → 1   (Db)
// Returns null if the name doesn't start with a recognizable note letter.
export function parseIvScaleRoot(ivName: string): number | null {
  const m = ivName.match(/^([A-Ga-g])([#b]?)/);
  if (!m) return null;
  const letterPcs: Record<string, number> = {
    c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
  };
  const base = letterPcs[m[1].toLowerCase()];
  if (base === undefined) return null;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return ((base + acc) % 12 + 12) % 12;
}

// Map an IV scale name (everything after the root letter — e.g., "major",
// "major pentatonic", "bebop dominant") to our SCALE_TYPES key. The
// match order is critical: compound names containing a generic mode
// word (e.g., "major pentatonic" / "major blues" / "minor blues") must
// be matched BEFORE the generic mode word triggers a wrong return.
// Returns null when no mapping exists; caller falls back to vocab's
// pickScaleForChord default.
function mapIvScaleName(ivName: string): string | null {
  const name = ivName.toLowerCase();

  // — Pentatonics first (5-note, distinct identity vs 7-note modes) —
  if (name.includes('major pentatonic') || name.includes('ionian pentatonic')) return 'Major Pentatonic';
  if (name.includes('minor six pentatonic')) return 'Minor Six Pentatonic';
  if (name.includes('mixolydian pentatonic')) return 'Mixolydian Pentatonic';
  if (name.includes('lydian pentatonic')) return 'Lydian Pentatonic';
  if (name.includes('locrian pentatonic')) return 'Locrian Pentatonic';
  if (name.includes('minor pentatonic')) return 'Minor Pentatonic';
  if (name.includes('pentatonic')) return 'Major Pentatonic';  // unqualified default

  // — Blues family —
  if (name.includes('composite blues')) return 'Composite Blues';
  if (name.includes('country blues')) return 'Country Blues';
  if (name.includes('major blues')) return 'Major Blues';
  if (name.includes('minor blues')) return 'Minor Pentatonic';  // closest (no Minor Blues type)
  if (name.includes('blues')) return 'Blues';

  // — Bebop family —
  if (name.includes('bebop major')) return 'Bebop Major';
  if (name.includes('bebop dominant')) return 'Bebop Dominant';
  if (name.includes('bebop dorian')) return 'Bebop Dorian';
  if (name.includes('bebop melodic minor')) return 'Bebop Melodic Minor';
  if (name.includes('bebop minor') || name.includes('minor bebop')) return 'Bebop Melodic Minor';

  // — Compound modal names (must precede simple modes) —
  if (name.includes('lydian dominant')) return 'Lydian Dominant';
  if (name.includes('phrygian dominant')) return 'Phrygian Dominant';
  if (name.includes('mixolydian b6') || name.includes('mixolydian flat six')) return 'Mixolydian b6';
  if (name.includes('lydian #9') || name.includes('lydian sharp nine')) return 'Lydian #9';
  if (name.includes('harmonic minor')) return 'Harmonic Minor';
  if (name.includes('harmonic major')) return 'Harmonic Major';
  if (name.includes('melodic minor')) return 'Melodic Minor';
  if (name.includes('double harmonic')) return 'Double Harmonic Major';

  // — Simple modes —
  if (name.includes('ionian')) return 'Ionian';
  if (name.includes('dorian')) return 'Dorian';
  if (name.includes('phrygian')) return 'Phrygian';
  if (name.includes('lydian')) return 'Lydian';
  if (name.includes('mixolydian')) return 'Mixolydian';
  if (name.includes('aeolian')) return 'Aeolian';
  if (name.includes('locrian')) return 'Locrian';

  // — Symmetric / advanced —
  if (name.includes('altered')) return 'Altered';
  if (name.includes('whole tone')) return 'Whole Tone';
  if (name.includes('augmented')) return 'Augmented';
  if (name.includes('diminished')) return 'Half-Whole Diminished';  // dom-context default
  if (name.includes('chromatic')) return 'Chromatic';
  if (name.includes('in-sen') || name.includes('in sen')) return 'In-Sen';

  // — Generic "major" / "minor" last so compound names above win —
  if (name.includes('major')) return 'Ionian';
  if (name.includes('minor')) return 'Aeolian';

  return null;
}
