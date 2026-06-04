// ============================================================
// newEngine · knowledge · HarmonicCoherence(和声连贯"债务模型"评估器,B-port 纯规则)
// ------------------------------------------------------------
// Provenance:忠实 port 自 melodygenerative/src/lib/harmonicCoherence.ts。
// 普适债务模型:每个制造张力的和弦生成 ResolutionObligation(张力是什么/期待什么目标/
//   哪些音要去哪/目标要稳多久/未解决是否可接受=风格相关)。同一评分器 + 每风格 policy。
// 诊断性(不改生成):buildResolutionLedger → score* → collectIssues → evaluateHarmony 合成 0..1。
// 输入 = CoherenceChord(ChordDef 子集);消费层把我方 ChordSpan 适配成此 shape。
// ============================================================

const pc = (n: number): number => ((n % 12) + 12) % 12;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** 评分输入:消费方按此 shape 喂和弦(roman/borrowedSource 等富信息由消费层提供)。 */
export interface CoherenceChord {
  type: string;
  rootMidi: number;
  notesMidi: number[];
  bassMidi: number;
  roman: string;
  chordSymbol: string;
  duration: number;
  effectiveFunc?: 'T' | 'S' | 'D';
  analysisKeyPc?: number;
  localRoman?: string;
  localTonalCenterPc?: number;
  borrowedSource?: string;   // modal_interchange / secondary_dominant / secondary_ii_v / backdoor_dominant …
  borrowedFrom?: string;
  mustResolve?: boolean;
}

export type ResolutionRole =
  | 'none' | 'diatonic_motion' | 'secondary_dominant' | 'secondary_ii_v'
  | 'tritone_substitution' | 'backdoor_dominant' | 'modal_color' | 'local_modal_color'
  | 'home_dominant' | 'dominant_evasion_to_modal_cadence' | 'blues_color';

export interface Tendency {
  fromPc: number;
  toPc: number;
  direction?: 'up' | 'down' | 'nearest';
  weight: number;
  name: string;
}

export interface ResolutionObligation {
  id: string;
  sourceChordIndex: number;
  targetChordIndex: number | null;
  role: ResolutionRole;
  analysisKeyPc: number;
  targetPc: number | null;
  tendencies: Tendency[];
  targetStability: { minBeats: number; requireStrongBeat: boolean; weight: number };
  allowPivot: boolean;
  severity: 'hard' | 'medium' | 'soft';
}

export interface HarmonicCoherencePolicy {
  style: 'POP' | 'JAZZ' | 'RNB' | 'BLUES' | 'LOFI';
  guideToneStrictness: number;
  tendencyResolutionStrictness: number;
  targetStabilityBeats: number;
  allowDelayedResolution: boolean;
  allowUnresolvedColor: boolean;
  bassResolutionWeight: number;
  localColorFreedom: number;
  passThreshold: number;
}

export interface CoherenceReport {
  score: number;
  passed: boolean;
  policy: HarmonicCoherencePolicy;
  subscores: { identity: number; guideTone: number; tendency: number; targetStability: number; bass: number; localColor: number };
  obligations: ResolutionObligation[];
  issues: CoherenceIssue[];
}

export interface CoherenceIssue {
  chordIndex: number;
  kind: string;
  severity: 'high' | 'mid' | 'low';
  message: string;
}

export const COHERENCE_POLICIES: Record<string, HarmonicCoherencePolicy> = {
  POP: { style: 'POP', guideToneStrictness: 0.45, tendencyResolutionStrictness: 0.65, targetStabilityBeats: 2, allowDelayedResolution: false, allowUnresolvedColor: true, bassResolutionWeight: 0.75, localColorFreedom: 0.25, passThreshold: 0.72 },
  JAZZ: { style: 'JAZZ', guideToneStrictness: 0.85, tendencyResolutionStrictness: 0.95, targetStabilityBeats: 2, allowDelayedResolution: true, allowUnresolvedColor: false, bassResolutionWeight: 0.8, localColorFreedom: 0.55, passThreshold: 0.80 },
  RNB: { style: 'RNB', guideToneStrictness: 0.65, tendencyResolutionStrictness: 0.7, targetStabilityBeats: 1.5, allowDelayedResolution: true, allowUnresolvedColor: true, bassResolutionWeight: 0.55, localColorFreedom: 0.65, passThreshold: 0.70 },
  BLUES: { style: 'BLUES', guideToneStrictness: 0.4, tendencyResolutionStrictness: 0.35, targetStabilityBeats: 4, allowDelayedResolution: true, allowUnresolvedColor: true, bassResolutionWeight: 0.9, localColorFreedom: 0.2, passThreshold: 0.68 },
  LOFI: { style: 'LOFI', guideToneStrictness: 0.30, tendencyResolutionStrictness: 0.25, targetStabilityBeats: 2, allowDelayedResolution: true, allowUnresolvedColor: true, bassResolutionWeight: 0.45, localColorFreedom: 0.55, passThreshold: 0.60 },
};

// —— helpers ——
function chordPcs(chord: CoherenceChord): Set<number> {
  const pcs = new Set<number>();
  pcs.add(pc(chord.bassMidi));
  for (const m of chord.notesMidi ?? []) pcs.add(pc(m));
  return pcs;
}

function chordQuality(type: string): 'maj' | 'min' | 'dom' | 'dim' | 'sus' | 'other' {
  if (!type) return 'other';
  if (type === 'm7b5' || type === 'm9b5' || type === 'dim' || type === 'dim7') return 'dim';
  if (type.startsWith('sus') || type === '7sus4' || type === '9sus4' || type === '13sus4' || type === 'm7sus4') return 'sus';
  if (type === 'maj' || type === 'maj7' || type === 'maj9' || type === 'maj13' || type === 'maj7#11' || type === 'add9' || type === '6' || type === '6/9' || type === 'maj9#11') return 'maj';
  if (type.startsWith('m') && !type.startsWith('maj')) return 'min';
  if (type === '7' || type === '9' || type === '11' || type === '13' || type === '7b9' || type === '7#9' || type === '7b13' || type === '7#11' || type === '7alt' || type === '13b9' || type === '7#5' || type === 'aug') return 'dom';
  return 'other';
}

/** BLUES 例外:I7 / IV7 是色彩,非传统属。 */
function isBluesColorChord(chord: CoherenceChord, globalKeyPc: number, policyStyle: string): boolean {
  if (policyStyle !== 'BLUES') return false;
  const rel = pc(pc(chord.rootMidi) - globalKeyPc);
  if (rel !== 0 && rel !== 5) return false;
  return chordQuality(chord.type) === 'dom';
}

// —— obligation builders ——
function makeDominantObligation(chord: CoherenceChord, index: number, targetPc: number, targetQuality: 'major' | 'minor', role: ResolutionRole, severity: 'hard' | 'medium', next: CoherenceChord | null, policy: HarmonicCoherencePolicy): ResolutionObligation {
  const rootPc = pc(chord.rootMidi);
  const third = pc(rootPc + 4);
  const flat7 = pc(rootPc + 10);
  const targetThird = targetQuality === 'minor' ? pc(targetPc + 3) : pc(targetPc + 4);
  const targetFifth = pc(targetPc + 7);
  const tendencies: Tendency[] = [
    { fromPc: third, toPc: targetPc, direction: 'up', weight: 1.0, name: 'dom 3rd → target root' },
    { fromPc: flat7, toPc: targetThird, direction: 'down', weight: 1.0, name: 'dom b7 → target 3rd' },
  ];
  const t = chord.type;
  if (t.includes('b9')) tendencies.push({ fromPc: pc(rootPc + 1), toPc: targetFifth, direction: 'down', weight: 0.7, name: 'b9 → target 5th' });
  if (t.includes('#9')) tendencies.push({ fromPc: pc(rootPc + 3), toPc: targetPc, direction: 'up', weight: 0.5, name: '#9 → target root' });
  if (t.includes('b13')) tendencies.push({ fromPc: pc(rootPc + 8), toPc: targetFifth, direction: 'down', weight: 0.6, name: 'b13 → target 5th' });
  const nextRootPc = next ? pc(next.rootMidi) : -1;
  return { id: `dom-${index}`, sourceChordIndex: index, targetChordIndex: nextRootPc === targetPc ? index + 1 : null, role, analysisKeyPc: chord.analysisKeyPc ?? targetPc, targetPc, tendencies, targetStability: { minBeats: policy.targetStabilityBeats, requireStrongBeat: true, weight: 1.0 }, allowPivot: policy.allowDelayedResolution, severity };
}

function makeSubVObligation(chord: CoherenceChord, index: number, targetPc: number, next: CoherenceChord | null, policy: HarmonicCoherencePolicy): ResolutionObligation {
  const rootPc = pc(chord.rootMidi);
  const third = pc(rootPc + 4);
  const flat7 = pc(rootPc + 10);
  const tendencies: Tendency[] = [
    { fromPc: rootPc, toPc: targetPc, direction: 'down', weight: 1.0, name: 'subV root → target root (half-step)' },
    { fromPc: third, toPc: pc(targetPc + 4), direction: 'down', weight: 1.0, name: 'subV 3rd → target 3rd (half-step)' },
    { fromPc: flat7, toPc: targetPc, direction: 'up', weight: 1.0, name: 'subV b7 → target root (half-step)' },
  ];
  const nextRootPc = next ? pc(next.rootMidi) : -1;
  return { id: `subv-${index}`, sourceChordIndex: index, targetChordIndex: nextRootPc === targetPc ? index + 1 : null, role: 'tritone_substitution', analysisKeyPc: chord.analysisKeyPc ?? targetPc, targetPc, tendencies, targetStability: { minBeats: policy.targetStabilityBeats, requireStrongBeat: true, weight: 1.0 }, allowPivot: false, severity: 'hard' };
}

function makeBackdoorObligation(chord: CoherenceChord, index: number, globalKeyPc: number, next: CoherenceChord | null, policy: HarmonicCoherencePolicy): ResolutionObligation {
  const rootPc = pc(chord.rootMidi);
  const third = pc(rootPc + 4);
  const flat7 = pc(rootPc + 10);
  const targetThird = pc(globalKeyPc + 4);
  const tendencies: Tendency[] = [
    { fromPc: rootPc, toPc: globalKeyPc, direction: 'up', weight: 0.8, name: 'bVII7 root → I root (whole step)' },
    { fromPc: third, toPc: targetThird, direction: 'up', weight: 1.0, name: 'bVII7 3rd → I 3rd' },
    { fromPc: flat7, toPc: pc(globalKeyPc + 4), direction: 'down', weight: 0.9, name: 'bVII7 b7 → I 3rd (smooth voice-lead)' },
  ];
  const nextRootPc = next ? pc(next.rootMidi) : -1;
  return { id: `backdoor-${index}`, sourceChordIndex: index, targetChordIndex: nextRootPc === globalKeyPc ? index + 1 : null, role: 'backdoor_dominant', analysisKeyPc: globalKeyPc, targetPc: globalKeyPc, tendencies, targetStability: { minBeats: policy.targetStabilityBeats, requireStrongBeat: true, weight: 1.0 }, allowPivot: false, severity: 'hard' };
}

function makeDominantEvasionObligation(vChord: CoherenceChord, vIndex: number, bviiChord: CoherenceChord, tonicChord: CoherenceChord, tonicIndex: number, globalKeyPc: number, policy: HarmonicCoherencePolicy): ResolutionObligation {
  const vRootPc = pc(vChord.rootMidi);
  const vThird = pc(vRootPc + 4);
  const vFlat7 = pc(vRootPc + 10);
  const bviiRootPc = pc(bviiChord.rootMidi);
  const tonicQuality = chordQuality(tonicChord.type);
  const tonicThird = tonicQuality === 'min' ? pc(globalKeyPc + 3) : pc(globalKeyPc + 4);
  const tendencies: Tendency[] = [
    { fromPc: vFlat7, toPc: tonicThird, direction: 'down', weight: 0.7, name: 'V b7 → tonic b3/3 (modal voice-leading via bVII)' },
    { fromPc: bviiRootPc, toPc: globalKeyPc, direction: 'up', weight: 0.9, name: 'bVII root → tonic root (Aeolian cadence signature)' },
    { fromPc: vRootPc, toPc: globalKeyPc, direction: 'down', weight: 0.5, name: 'V root → tonic root (delayed via bVII)' },
    { fromPc: vThird, toPc: pc(bviiRootPc + 4), direction: 'up', weight: 0.0, name: 'V leading-tone EVADED to bVII 3rd (modal stylistic choice)' },
  ];
  return { id: `evasion-${vIndex}`, sourceChordIndex: vIndex, targetChordIndex: tonicIndex, role: 'dominant_evasion_to_modal_cadence', analysisKeyPc: globalKeyPc, targetPc: globalKeyPc, tendencies, targetStability: { minBeats: policy.targetStabilityBeats, requireStrongBeat: true, weight: 0.7 }, allowPivot: true, severity: 'soft' };
}

/** 检测 V → 全局 bVII → i/I 的属-规避调式终止式。 */
function detectDominantEvasion(chords: CoherenceChord[], i: number, globalKeyPc: number): { bvii: CoherenceChord; tonic: CoherenceChord; tonicIndex: number } | null {
  const v = chords[i];
  const bvii = chords[i + 1];
  const tonic = chords[i + 2];
  if (!v || !bvii || !tonic) return null;
  if (v.effectiveFunc !== 'D' || v.borrowedSource) return null;
  if (chordQuality(v.type) !== 'dom') return null;
  if (pc(pc(v.rootMidi) - globalKeyPc) !== 7) return null;
  if (bvii.borrowedSource !== 'modal_interchange') return null;
  if (bvii.roman.includes('/')) return null;
  if (bvii.analysisKeyPc !== undefined && bvii.analysisKeyPc !== globalKeyPc) return null;
  if (pc(pc(bvii.rootMidi) - globalKeyPc) !== 10) return null;
  if (pc(pc(tonic.rootMidi) - globalKeyPc) !== 0) return null;
  return { bvii, tonic, tonicIndex: i + 2 };
}

// —— ledger builder ——
export function buildResolutionLedger(chords: CoherenceChord[], policy: HarmonicCoherencePolicy, globalKeyPc: number): ResolutionObligation[] {
  const obligations: ResolutionObligation[] = [];
  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    const next = i + 1 < chords.length ? chords[i + 1] : null;
    if (isBluesColorChord(chord, globalKeyPc, policy.style)) continue;

    if (chord.roman.startsWith('subV/')) {
      obligations.push(makeSubVObligation(chord, i, chord.localTonalCenterPc ?? globalKeyPc, next, policy));
      continue;
    }
    if ((chord.borrowedSource === 'secondary_dominant' || chord.borrowedSource === 'secondary_ii_v') && chord.roman.startsWith('V/')) {
      const targetPc = chord.localTonalCenterPc ?? globalKeyPc;
      const targetPart = chord.roman.split('/')[1] ?? '';
      const targetQuality: 'major' | 'minor' = /[A-Z]/.test(targetPart.replace(/^[b#]/, '')[0] ?? 'i') ? 'major' : 'minor';
      const role: ResolutionRole = chord.borrowedSource === 'secondary_ii_v' ? 'secondary_ii_v' : 'secondary_dominant';
      obligations.push(makeDominantObligation(chord, i, targetPc, targetQuality, role, 'hard', next, policy));
      continue;
    }
    if (chord.borrowedSource === 'backdoor_dominant') {
      obligations.push(makeBackdoorObligation(chord, i, globalKeyPc, next, policy));
      continue;
    }
    if (chord.effectiveFunc === 'D' && !chord.borrowedSource && chordQuality(chord.type) === 'dom') {
      const rel = pc(pc(chord.rootMidi) - globalKeyPc);
      if (rel === 7) {
        const evasion = detectDominantEvasion(chords, i, globalKeyPc);
        if (evasion) obligations.push(makeDominantEvasionObligation(chord, i, evasion.bvii, evasion.tonic, evasion.tonicIndex, globalKeyPc, policy));
        else obligations.push(makeDominantObligation(chord, i, globalKeyPc, 'major', 'home_dominant', 'medium', next, policy));
      }
    }
  }
  return obligations;
}

// —— scorers ——
export function scoreChordIdentity(chords: CoherenceChord[]): number {
  if (chords.length === 0) return 1;
  let totalChecks = 0;
  let passedChecks = 0;
  for (const chord of chords) {
    const pcs = chordPcs(chord);
    const rootPc = pc(chord.rootMidi);
    const q = chordQuality(chord.type);
    const t = chord.type;
    const has = (iv: number) => pcs.has(pc(rootPc + iv));
    if (q === 'min' && (t === 'min' || t === 'm7' || t === 'm9' || t === 'm11')) { totalChecks++; if (has(3)) passedChecks++; }
    if (q === 'dim' && (t === 'm7b5' || t === 'm9b5')) { totalChecks += 3; if (has(3)) passedChecks++; if (has(6)) passedChecks++; if (has(10)) passedChecks++; }
    if (q === 'dom') { totalChecks += 2; if (has(4)) passedChecks++; if (has(10)) passedChecks++; }
    if (q === 'maj' && (t === 'maj7' || t === 'maj9' || t === 'maj13' || t === 'maj7#11' || t === 'maj9#11')) { totalChecks += 2; if (has(4)) passedChecks++; if (has(11)) passedChecks++; }
    if (q === 'sus' && (t === '7sus4' || t === '9sus4' || t === '13sus4')) { totalChecks += 2; if (has(5)) passedChecks++; if (has(10)) passedChecks++; }
  }
  return totalChecks > 0 ? passedChecks / totalChecks : 1;
}

export function scoreGuideTones(chords: CoherenceChord[], policy: HarmonicCoherencePolicy): number {
  if (chords.length === 0) return 1;
  let total = 0;
  let sumScore = 0;
  for (const chord of chords) {
    const pcs = chordPcs(chord);
    const rootPc = pc(chord.rootMidi);
    const q = chordQuality(chord.type);
    const has = (iv: number) => pcs.has(pc(rootPc + iv));
    if (policy.style === 'BLUES') continue;
    let chordScore = -1;
    if (q === 'min' && (chord.effectiveFunc === 'S' || chord.effectiveFunc === 'T')) chordScore = (has(3) ? 0.5 : 0) + (has(10) ? 0.5 : 0);
    else if (q === 'dom' && chord.effectiveFunc === 'D') chordScore = (has(4) ? 0.5 : 0) + (has(10) ? 0.5 : 0);
    else if (q === 'maj' && chord.effectiveFunc === 'T') chordScore = (has(4) ? 0.5 : 0) + ((has(11) || has(9)) ? 0.5 : 0);
    if (chordScore >= 0) { total++; sumScore += chordScore; }
  }
  if (total === 0) return 1;
  const gap = 1 - sumScore / total;
  return clamp01(1 - gap * policy.guideToneStrictness);
}

export function scoreTendencyResolution(obligations: ResolutionObligation[], chords: CoherenceChord[], policy: HarmonicCoherencePolicy): number {
  if (obligations.length === 0) return 1;
  let weightTotal = 0;
  let weightHit = 0;
  for (const o of obligations) {
    const targetIdx = o.targetChordIndex;
    if (targetIdx === null) {
      const allowance = policy.allowDelayedResolution ? 0.3 : 0;
      const w = o.tendencies.reduce((s, t) => s + t.weight, 0);
      weightTotal += w;
      weightHit += allowance * w;
      continue;
    }
    const targetPcs = chordPcs(chords[targetIdx]);
    for (const tend of o.tendencies) {
      weightTotal += tend.weight;
      if (targetPcs.has(tend.toPc)) weightHit += tend.weight;
    }
  }
  if (weightTotal === 0) return 1;
  const gap = 1 - weightHit / weightTotal;
  return clamp01(1 - gap * policy.tendencyResolutionStrictness);
}

export function scoreTargetStability(obligations: ResolutionObligation[], chords: CoherenceChord[], policy: HarmonicCoherencePolicy): number {
  if (obligations.length === 0) return 1;
  let total = 0;
  let sumScore = 0;
  for (const o of obligations) {
    if (o.targetChordIndex === null) continue;
    total++;
    const target = chords[o.targetChordIndex];
    let s = 0;
    if (o.targetPc !== null && pc(target.rootMidi) === o.targetPc) s += 0.4;
    if (target.duration >= o.targetStability.minBeats) s += 0.3;
    const next2 = chords[o.targetChordIndex + 1];
    if (!next2 || !next2.mustResolve) s += 0.3;
    else if (target.duration < policy.targetStabilityBeats) s -= 0.2;
    sumScore += clamp01(s);
  }
  return total > 0 ? sumScore / total : 1;
}

export function scoreBassMotion(obligations: ResolutionObligation[], chords: CoherenceChord[]): number {
  if (obligations.length === 0) return 1;
  let total = 0;
  let sumScore = 0;
  for (const o of obligations) {
    if (o.targetChordIndex === null) continue;
    total++;
    const src = chords[o.sourceChordIndex];
    const tgt = chords[o.targetChordIndex];
    const motion = pc(pc(tgt.bassMidi) - pc(src.bassMidi));
    let s = 0.5;
    if (o.role === 'tritone_substitution') {
      if (motion === 11) s = 1.0; else if (motion === 1) s = 0.4; else s = 0.3;
    } else if (o.role === 'secondary_dominant' || o.role === 'secondary_ii_v' || o.role === 'home_dominant') {
      if (motion === 5) s = 1.0; else if (motion === 11) s = 0.6; else s = 0.4;
    } else if (o.role === 'dominant_evasion_to_modal_cadence') {
      if (motion === 5) s = 1.0; else if (motion === 11) s = 0.6; else s = 0.4;
    } else if (o.role === 'backdoor_dominant') {
      if (motion === 2) s = 1.0; else s = 0.4;
    }
    sumScore += s;
  }
  return total > 0 ? sumScore / total : 1;
}

export function scoreLocalColorRoles(chords: CoherenceChord[], globalKeyPc: number, policy: HarmonicCoherencePolicy): number {
  const localColorIndices: number[] = [];
  for (let i = 0; i < chords.length; i++) {
    if (/^(iv|bII|bVI|bVII|IV) of /.test(chords[i].borrowedFrom ?? '')) localColorIndices.push(i);
  }
  if (localColorIndices.length === 0) return 1;
  let sumScore = 0;
  for (const i of localColorIndices) {
    const c = chords[i];
    const next = chords[i + 1];
    const next2 = chords[i + 2];
    const localCenterPc = c.analysisKeyPc ?? globalKeyPc;
    const localRomanHead = c.localRoman ?? '';
    let role: 'neighbor_return' | 'local_predominant' | 'pivot_to_global' | 'decorative_tail' = 'decorative_tail';
    if (next && pc(next.rootMidi) === localCenterPc) role = 'neighbor_return';
    else if (next && next.localRoman === 'V' && next2 && pc(next2.rootMidi) === localCenterPc) role = 'local_predominant';
    else if (next && (next.roman.startsWith('subV/') || next.roman === 'V' || next.roman === 'V7') && next2 && pc(next2.rootMidi) === globalKeyPc) role = 'pivot_to_global';
    let s = 0.5;
    if (role === 'neighbor_return') s = 1.0;
    else if (role === 'local_predominant') s = 0.95;
    else if (role === 'pivot_to_global') s = 0.8;
    else if (role === 'decorative_tail') s = localRomanHead === 'bII' ? 0.25 : 0.55;
    sumScore += s;
  }
  return clamp01(sumScore / localColorIndices.length + policy.localColorFreedom * 0.15);
}

// —— issue collector ——
export function collectIssues(chords: CoherenceChord[], obligations: ResolutionObligation[], policy: HarmonicCoherencePolicy, globalKeyPc: number): CoherenceIssue[] {
  const issues: CoherenceIssue[] = [];
  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    const pcs = chordPcs(chord);
    const rootPc = pc(chord.rootMidi);
    const q = chordQuality(chord.type);
    const has = (iv: number) => pcs.has(pc(rootPc + iv));
    if (policy.style === 'JAZZ' || policy.guideToneStrictness > 0.7) {
      if (q === 'min' && chord.effectiveFunc === 'S' && !has(10)) issues.push({ chordIndex: i, kind: 'missing_guide_tones', severity: 'mid', message: `${chord.chordSymbol}: minor predominant missing b7 (jazz ii needs 3+b7)` });
      if (q === 'dom' && chord.effectiveFunc === 'D' && (!has(4) || !has(10))) issues.push({ chordIndex: i, kind: 'missing_guide_tones', severity: 'high', message: `${chord.chordSymbol}: dominant missing 3 or b7` });
    }
    if (chord.roman.startsWith('subV/') && pc(chord.bassMidi) !== pc(chord.rootMidi)) issues.push({ chordIndex: i, kind: 'weak_subV_bass', severity: 'mid', message: `${chord.chordSymbol}: subV with non-root bass weakens half-step bass resolution` });
    if (/^bII of /.test(chord.borrowedFrom ?? '')) {
      const next = chords[i + 1];
      const next2 = chords[i + 2];
      const localCenterPc = chord.analysisKeyPc ?? globalKeyPc;
      const isNeighborReturn = next && pc(next.rootMidi) === localCenterPc;
      const isLocalPredominant = next && next.localRoman === 'V' && next2 && pc(next2.rootMidi) === localCenterPc;
      const isPivotToGlobal = next && (next.roman.startsWith('subV/') || next.roman === 'V') && next2 && pc(next2.rootMidi) === globalKeyPc;
      if (!isNeighborReturn && !isLocalPredominant && !isPivotToGlobal) issues.push({ chordIndex: i, kind: 'local_bII_decorative_tail', severity: 'mid', message: `${chord.chordSymbol} (local bII): no clear role — not neighbor / pivot / predominant` });
    }
  }
  if (chords.length > 0) {
    const last = chords[chords.length - 1];
    if (last.mustResolve) issues.push({ chordIndex: chords.length - 1, kind: 'unresolved_final_dominant', severity: 'high', message: `Song ends on ${last.chordSymbol} (mustResolve=true) without target` });
  }
  for (const o of obligations) {
    if (o.targetChordIndex !== null) {
      const target = chords[o.targetChordIndex];
      const next2 = chords[o.targetChordIndex + 1];
      if (target.duration < policy.targetStabilityBeats && next2?.mustResolve) issues.push({ chordIndex: o.targetChordIndex, kind: 'target_not_stable', severity: 'mid', message: `Target ${target.chordSymbol} only ${target.duration} beats before another resolution demand` });
    }
  }
  for (const o of obligations) {
    if (o.severity === 'hard' && o.targetChordIndex === null && !policy.allowDelayedResolution) issues.push({ chordIndex: o.sourceChordIndex, kind: 'unresolved_hard_obligation', severity: 'high', message: `${chords[o.sourceChordIndex].chordSymbol} (${o.role}) didn't resolve to expected target pc=${o.targetPc}` });
  }
  return issues;
}

// —— top-level evaluator ——
export function evaluateHarmony(chords: CoherenceChord[], styleName: string, globalKeyPc: number): CoherenceReport {
  const policy = COHERENCE_POLICIES[styleName] ?? COHERENCE_POLICIES.POP;
  const obligations = buildResolutionLedger(chords, policy, globalKeyPc);
  const subscores = {
    identity: scoreChordIdentity(chords),
    guideTone: scoreGuideTones(chords, policy),
    tendency: scoreTendencyResolution(obligations, chords, policy),
    targetStability: scoreTargetStability(obligations, chords, policy),
    bass: scoreBassMotion(obligations, chords),
    localColor: scoreLocalColorRoles(chords, globalKeyPc, policy),
  };
  const score = 0.20 * subscores.identity + 0.20 * subscores.guideTone + 0.20 * subscores.tendency + 0.15 * subscores.targetStability + 0.15 * subscores.bass + 0.10 * subscores.localColor;
  const issues = collectIssues(chords, obligations, policy, globalKeyPc);
  return { score: clamp01(score), passed: score >= policy.passThreshold, policy, subscores, obligations, issues };
}
