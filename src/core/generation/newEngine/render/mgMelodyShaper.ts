// ============================================================
// newEngine · render · MgMelodyShaper(MG strict 移植 Loop 6 — 用户决策C 全量接收)
// ------------------------------------------------------------
// Provenance: ../melodygenerative/src/lib/musicEngine.ts 的 shapeMelodyHarmony + 闭包(15 个 this. 方法)
//   抽成独立函数。逻辑区段 sed 提取自源(零重打),仅做机械改写:
//   ① this.<method>( → <method>(  ② this.songMeterContext.strongBeats → 模块级 _strongBeats
//   ③ private <name>( → export function <name>(  ④ ChordDef/NoteEvent/StyleName → 本地等价类型。
// 旋律对和声的塑形裁决(snap 到音阶/melody contract/结构音 + LOFI crawl-hold/resolution/tonicization)。
// 确定性,无 RNG(stableUnitInterval = FNV-1a hash,确定)。entry = shapeMelodyHarmony。
// ============================================================

import {
  resolveLocalScale, buildRunScale,
  melodyContractPcsForStyle as sharedMelodyContractPcsForStyle,
} from '../knowledge/mgLocalScaleResolver';
import {
  CHORD_TYPES, MELODY_RANGE, noteToMidi, modeToKeyFamily, evaluateNoteInChordContext,
  type StyleName,
} from '../knowledge/mgMusicTheory';
import type { MgNoteEvent } from './mgMelodyRealizer';

type NoteEvent = MgNoteEvent;

/** ChordDef 的够宽子集(shaper 实读字段)。parity 喂 MG ChordDef[] JSON(全字段),此类型仅声明所读。 */
export interface ShaperChord {
  root?: string;
  rootMidi: number;
  bassMidi: number;
  type: string;
  roman: string;
  duration?: number;
  effectiveFunc?: 'T' | 'S' | 'D';
  forcedScale?: string;
  localTonalCenterPc?: number;
  mustResolve?: boolean;
  borrowedSource?: string;
  borrowedFrom?: string | null;
  notesMidi?: number[];
  notes?: string[];
  chordSymbol?: string;
  // ★ Gap A(2026-06-09):全字段路径 —— 携带分析/离调上下文(shaper 不全读,字段完整性 + 下游可用)。
  bass?: string;                  // bass 音名(slash/pedal 时 ≠ root)
  analysisKeyPc?: number;         // 该和弦分析所在调中心(离调区=localTonalCenterPc,否则 undefined)
  localRoman?: string;            // 离调区内的局部 roman(仅 localTonalCenterPc 存在时)
  tonicizationPlacement?: string; // 离调放置(prologue/payoff…)
  widePianoVoicing?: readonly number[]; // 宽钢琴 voicing(voicing 层附着时;passthrough 不丢)
}
type ChordDef = ShaperChord;

const UNRESOLVED_TENSION_THRESHOLD = 0.5;

// 模块级 strongBeats(原 this.songMeterContext.strongBeats)。entry shapeMelodyHarmony 每次设置;
// 同步单次调用 → 无重入问题;确定性不变。4/4 默认 [0,2]。
let _strongBeats: number[] = [0, 2];

// 原 musicEngine.ts:841 harmonicFunctionFromRoman(逐值内联;getHarmonicFunction 包它)。
function harmonicFunctionFromRoman(romanOriginal: string): 'T' | 'S' | 'D' {
  const base = romanOriginal.split('/')[0].replace(/maj7|maj9|maj13|m7|m9|m11|sus4|7sus4|9sus4|7b13|7#9|7alt|dim|aug|\+|o|ø|[0-9]/g, '');
  if (['V', 'v', 'vii', 'VII'].includes(base) || romanOriginal.includes('/')) return 'D';
  if (['IV', 'iv', 'ii', 'II', 'bVI', 'bVII'].includes(base)) return 'S';
  return 'T';
}
function getHarmonicFunction(romanOriginal: string): 'T' | 'S' | 'D' {
  return harmonicFunctionFromRoman(romanOriginal);
}
// 原 this.melodyContractPcsForStyle 包 localScaleResolver 的 melodyContractPcsForStyle(import 为 shared)。
function melodyContractPcsForStyle(style: StyleName, chord: ChordDef, chordRootPc: number): Set<number> {
  return sharedMelodyContractPcsForStyle(style, chord, chordRootPc);
}

// ── re-sync(MG 活跃开发追加):LOFI Phrygian bII shadow ──────────────
// 原 musicEngine.ts isPhrygianBiiShadowSource(1165)+ applyLofiPhrygianBiiShadowMelody(shaper 新增方法)。
// shapeMelodyHarmony 在 anchored 后、lateResolved 前插一步(仅 applyLofiParadigm)。
// 注:仅当 chord.borrowedSource='modal_interchange' + roman bII + borrowedFrom 含 Phrygian/bII 才触发。
function isPhrygianBiiShadowSource(chord: ChordDef): boolean {
  return chord.borrowedSource === 'modal_interchange'
    && /^bII\b/.test(chord.roman ?? '')
    && /Phrygian|bII/i.test(chord.borrowedFrom ?? '');
}

export function applyLofiPhrygianBiiShadowMelody(
  melody: NoteEvent[],
  chords: ChordDef[],
  starts: number[],
): NoteEvent[] {
  const out = melody.map(e => ({ ...e }));
  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    if (!isPhrygianBiiShadowSource(chord)) continue;
    const start = starts[i] ?? i * 4;
    const end = start + (chord.duration ?? 4);
    const rootPc = ((chord.rootMidi % 12) + 12) % 12;
    const barMelody = out
      .filter(e => e.part === 'melody' && e.time >= start - 0.001 && e.time < end - 0.001)
      .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
    if (barMelody.some(e => e.time < start + 1.01 && ((e.noteNumber % 12) + 12) % 12 === rootPc)) {
      continue;
    }
    const first = barMelody.find(e => e.time <= start + 0.08 && e.duration >= 0.75) ?? null;
    const seedMidi = first?.noteNumber ?? 72;
    const rootMidi = snapMidiToNearestPcSet(seedMidi, new Set([rootPc]), 9);
    if (((rootMidi % 12) + 12) % 12 !== rootPc) continue;
    if (rootMidi < MELODY_RANGE.LOW || rootMidi > MELODY_RANGE.HIGH) continue;
    if (first && first.duration >= 1.0) {
      first.time = start + 0.5;
      first.duration = Math.max(0.25, first.duration - 0.5);
    } else if (first) {
      first.noteNumber = rootMidi;
      first.velocity = Math.max(first.velocity, 98);
      first.origin = 'develop';
      first.lickSource = true;
      continue;
    }
    out.push({
      noteNumber: rootMidi,
      time: start,
      duration: 0.5,
      velocity: first ? Math.max(first.velocity, 98) : 98,
      part: 'melody',
      origin: 'develop',
      lickSource: true,
    });
  }
  return out.sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
}

// ============================================================
// 以下为 musicEngine.ts 区段忠实提取 + 机械改写(this./strongBeats/private)
// ============================================================

    export function runScaleForChordContext(
        style: StyleName,
        chord: ChordDef,
        func: 'T' | 'S' | 'D',
        musicKey: string,
        musicMode: string,
    ): number[] {
        return buildRunScale(localScaleForChordContext(style, chord, func, musicKey, musicMode));
    }

    export function localScaleForChordContext(
        style: StyleName,
        chord: ChordDef,
        func: 'T' | 'S' | 'D',
        musicKey: string,
        musicMode: string,
    ) {
        return resolveLocalScale(
            { style, key: musicKey, mode: musicMode },
            { ...chord, effectiveFunc: chord.effectiveFunc ?? func },
        );
    }

    export function snapMidiToNearestPcSet(targetMidi: number, pcs: Set<number>, maxDistance = 8): number {
        if (pcs.size === 0) return targetMidi;
        let best = targetMidi;
        let bestScore = Infinity;
        for (let midi = MELODY_RANGE.LOW; midi <= MELODY_RANGE.HIGH; midi++) {
            const pc = ((midi % 12) + 12) % 12;
            if (!pcs.has(pc)) continue;
            const distance = Math.abs(midi - targetMidi);
            if (distance > maxDistance) continue;
            const registerPenalty = midi < 55 ? 0.8 : midi > 81 ? 0.4 : 0;
            const score = distance + registerPenalty;
            if (score < bestScore) {
                bestScore = score;
                best = midi;
            }
        }
        return bestScore === Infinity ? targetMidi : best;
    }

    export function stableUnitInterval(label: string): number {
        let h = 2166136261;
        for (let i = 0; i < label.length; i++) {
            h ^= label.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0) / 4294967296;
    }

    export function chordThirdPc(chord: ChordDef): number | null {
        const intervals = CHORD_TYPES[chord.type] ?? [];
        const third = intervals.includes(4) ? 4 : intervals.includes(3) ? 3 : null;
        if (third === null) return null;
        return (((chord.rootMidi % 12) + third) % 12 + 12) % 12;
    }

    // ★ MG full-parity G9:旋律解决子系统 helper(忠实 port 当前 ../melodygenerative musicEngine,
    //   private 方法 → 本命名空间 function;this.X → X)。供 applyMelodicResolutionParadigm 当前 MG 版用。
    function melodicIntervalClass(fromMidi: number, toMidi: number): number {
        const semitones = Math.abs(toMidi - fromMidi) % 12;
        return Math.min(semitones, 12 - semitones);
    }
    function chordSeventhPc(chord: ChordDef): number | null {
        const intervals = CHORD_TYPES[chord.type] ?? [];
        const seventh = intervals.includes(11) ? 11 : intervals.includes(10) ? 10 : null;
        if (seventh === null) return null;
        return (((chord.rootMidi % 12) + seventh) % 12 + 12) % 12;
    }
    function chordFifthPc(chord: ChordDef): number | null {
        const intervals = CHORD_TYPES[chord.type] ?? [];
        const fifth = intervals.includes(7) ? 7 : null;
        if (fifth === null) return null;
        return (((chord.rootMidi % 12) + fifth) % 12 + 12) % 12;
    }
    function isJpop456DeceptiveResolution(style: StyleName, sourceChord: ChordDef, sourceFunc: 'T' | 'S' | 'D', targetChord: ChordDef): boolean {
        if (style !== 'ACG' || sourceFunc !== 'D') return false;
        const sourceBase = sourceChord.roman.split('/')[0].replace(/^[b#n]+/, '');
        const targetBase = targetChord.roman.split('/')[0].replace(/^[b#n]+/, '');
        if (sourceBase !== 'V' || targetBase !== 'vi') return false;
        const sourceRootPc = ((sourceChord.rootMidi % 12) + 12) % 12;
        const targetRootPc = ((targetChord.rootMidi % 12) + 12) % 12;
        return ((targetRootPc - sourceRootPc + 12) % 12) === 2;
    }
    function isRnbFloatingTonicNinth(style: StyleName, notePc: number, chord: ChordDef, func: 'T' | 'S' | 'D'): boolean {
        if (style !== 'RNB' || func !== 'T') return false;
        const baseRoman = chord.roman.split('/')[0].replace(/^[b#n]+/, '');
        if (baseRoman !== 'I' && baseRoman !== 'i') return false;
        const rootPc = ((chord.rootMidi % 12) + 12) % 12;
        if (((notePc - rootPc + 12) % 12) !== 2) return false;
        const intervals = CHORD_TYPES[chord.type] ?? [];
        return intervals.some((iv) => ((iv % 12) + 12) % 12 === 2);
    }
    function boundaryResolutionThreshold(style: StyleName): number {
        if (style === 'LOFI') return 0.40;
        if (style === 'POP') return 0.45;
        if (style === 'RNB') return 0.50;
        if (style === 'JAZZ') return 0.50;
        return UNRESOLVED_TENSION_THRESHOLD;
    }
    function guideToneThirdProbability(style: StyleName): number {
        if (style === 'POP') return 0.80;
        if (style === 'LOFI') return 0.65;
        if (style === 'JAZZ') return 0.50;
        if (style === 'RNB') return 0.40;
        if (style === 'ACG') return 0.25;
        return 0.60;
    }
    function styleGuideToneTargetPc(style: StyleName, targetChord: ChordDef, referenceMidi: number, label: string): number | null {
        const thirdPc = chordThirdPc(targetChord);
        const seventhPc = chordSeventhPc(targetChord);
        if (thirdPc === null) return seventhPc;
        if (seventhPc === null) return thirdPc;
        const roll = stableUnitInterval(`voiceleading-guide-tone|${style}|${targetChord.chordSymbol ?? targetChord.roman}|${referenceMidi}|${label}`);
        return roll < guideToneThirdProbability(style) ? thirdPc : seventhPc;
    }
    function isGuideToneCompatibleWithNextBrickFirst(candidateMidi: number, nextBrickFirstMidi?: number | null): boolean {
        if (nextBrickFirstMidi === undefined || nextBrickFirstMidi === null) return true;
        const distance = Math.abs(candidateMidi - nextBrickFirstMidi);
        if (distance <= 2) return true;
        const intervalClass = melodicIntervalClass(candidateMidi, nextBrickFirstMidi);
        return intervalClass === 0 || intervalClass === 3 || intervalClass === 4 || intervalClass === 5;
    }
    function guideTonePreferenceScore(style: StyleName, candidatePc: number, candidateMidi: number, selectedGuideTonePc: number | null, guideTonePcs: Set<number>, nextBrickFirstMidi?: number | null): number {
        if (!guideTonePcs.has(candidatePc)) return 0;
        if (!isGuideToneCompatibleWithNextBrickFirst(candidateMidi, nextBrickFirstMidi)) return 0;
        const selectedBonusByStyle: Record<StyleName, number> = { POP: -10, JAZZ: -5, LOFI: -7, RNB: -6, ACG: -3, BLUES: -4 };
        const selected = selectedGuideTonePc !== null && candidatePc === selectedGuideTonePc;
        const hasBrickReference = nextBrickFirstMidi !== undefined && nextBrickFirstMidi !== null;
        const scale = hasBrickReference ? 1 : 0.45;
        const base = selected ? selectedBonusByStyle[style] ?? -5 : Math.round((selectedBonusByStyle[style] ?? -5) * 0.45);
        return base * scale;
    }
    function chooseTargetChordSuspensionResolution(
        style: StyleName, sourceMidi: number, targetChord: ChordDef, targetFunc: 'T' | 'S' | 'D',
        musicKey: string, musicMode: string, tonalCharacter: 'tonal' | 'modal',
        options: { maxDistance?: number; preferredPc?: number | null; minUrgency?: number; guideReferenceMidi?: number | null } = {},
    ): { pc: number; midi: number; urgency: number } | null {
        const keyRootPc = ((noteToMidi(musicKey + '0') % 12) + 12) % 12;
        const modeFamily = modeToKeyFamily(musicMode);
        const targetRootPc = ((targetChord.rootMidi % 12) + 12) % 12;
        const targetRunScale = runScaleForChordContext(style, targetChord, targetFunc, musicKey, musicMode);
        const targetRunScalePcs = new Set(targetRunScale.map((m) => ((m % 12) + 12) % 12));
        const sourcePc = ((sourceMidi % 12) + 12) % 12;
        const targetAssessment = evaluateNoteInChordContext(sourcePc, targetChord.type, targetRootPc, targetFunc, null, null, keyRootPc, targetChord.forcedScale, tonalCharacter === 'modal', targetRunScalePcs, tonalCharacter, targetChord.localTonalCenterPc, modeFamily);
        const minUrgency = options.minUrgency ?? boundaryResolutionThreshold(style);
        if (targetAssessment.urgency < minUrgency) return null;
        const targetContract = melodyContractPcsForStyle(style, targetChord, targetRootPc);
        const strictTargets = targetAssessment.resolutionTargets.filter((pc) => targetContract.has(pc) && targetRunScalePcs.has(pc));
        const fallbackTargets = targetAssessment.resolutionTargets.filter((pc) => targetContract.has(pc));
        const candidatePcs = strictTargets.length > 0 ? strictTargets : fallbackTargets;
        if (candidatePcs.length === 0) return null;
        const targetThirdPc = chordThirdPc(targetChord);
        const targetSeventhPc = chordSeventhPc(targetChord);
        const guideTonePc = styleGuideToneTargetPc(style, targetChord, sourceMidi, `suspension|${targetFunc}|${candidatePcs.join(',')}`);
        const guideTonePcs = new Set([targetThirdPc, targetSeventhPc].filter((pc): pc is number => pc !== null));
        const preferredPc = options.preferredPc ?? null;
        const maxDistance = options.maxDistance ?? 14;
        let best: { pc: number; midi: number; score: number } | null = null;
        for (const pc of candidatePcs) {
            const midi = snapMidiToNearestPcSet(sourceMidi, new Set([pc]), maxDistance);
            if (((midi % 12) + 12) % 12 !== pc) continue;
            if (midi < MELODY_RANGE.LOW || midi > MELODY_RANGE.HIGH) continue;
            const targetIndex = targetAssessment.resolutionTargets.indexOf(pc);
            const interval = midi - sourceMidi;
            const distance = Math.abs(interval);
            let score = targetIndex * 30 + distance * 3;
            if (preferredPc !== null && pc === preferredPc) score -= 4;
            score += guideTonePreferenceScore(style, pc, midi, guideTonePc, guideTonePcs, options.guideReferenceMidi);
            if (interval === -1) score -= 24;
            if (interval === 1) score -= 12;
            if (!targetRunScalePcs.has(pc)) score += 30;
            if (!best || score < best.score) best = { pc, midi, score };
        }
        return best ? { pc: best.pc, midi: best.midi, urgency: targetAssessment.urgency } : null;
    }
    function chooseLongResolutionTarget(
        style: StyleName, sourceMidi: number, sourceChord: ChordDef, sourceFunc: 'T' | 'S' | 'D',
        targetChord: ChordDef, targetFunc: 'T' | 'S' | 'D', musicKey: string, musicMode: string, tonalCharacter: 'tonal' | 'modal',
        options: { maxDistance?: number; preferredPc?: number | null; guideReferenceMidi?: number | null } = {},
    ): { pc: number; midi: number } | null {
        const keyRootPc = ((noteToMidi(musicKey + '0') % 12) + 12) % 12;
        const modeFamily = modeToKeyFamily(musicMode);
        const sourceRootPc = ((sourceChord.rootMidi % 12) + 12) % 12;
        const targetRootPc = ((targetChord.rootMidi % 12) + 12) % 12;
        const sourcePc = ((sourceMidi % 12) + 12) % 12;
        const sourceRunScale = runScaleForChordContext(style, sourceChord, sourceFunc, musicKey, musicMode);
        const sourceRunScalePcs = new Set(sourceRunScale.map((m) => ((m % 12) + 12) % 12));
        const targetRunScale = runScaleForChordContext(style, targetChord, targetFunc, musicKey, musicMode);
        const targetRunScalePcs = new Set(targetRunScale.map((m) => ((m % 12) + 12) % 12));
        const sourceAssessment = evaluateNoteInChordContext(sourcePc, sourceChord.type, sourceRootPc, sourceFunc, targetChord.type, targetRootPc, keyRootPc, sourceChord.forcedScale, tonalCharacter === 'modal', sourceRunScalePcs, tonalCharacter, sourceChord.localTonalCenterPc, modeFamily);
        const targetContract = melodyContractPcsForStyle(style, targetChord, targetRootPc);
        const strictCandidates = [...targetContract].filter((pc) => targetRunScalePcs.has(pc));
        const candidates = strictCandidates.length > 0 ? strictCandidates : [...targetContract];
        const targetThirdPc = chordThirdPc(targetChord);
        const targetSeventhPc = chordSeventhPc(targetChord);
        const targetFifthPc = chordFifthPc(targetChord);
        const guideTonePc = styleGuideToneTargetPc(style, targetChord, sourceMidi, `long|${sourceFunc}->${targetFunc}|${sourceChord.chordSymbol ?? sourceChord.roman}`);
        const guideTonePcs = new Set([targetThirdPc, targetSeventhPc].filter((pc): pc is number => pc !== null));
        const preferredPc = options.preferredPc ?? null;
        const maxDistance = options.maxDistance ?? 7;
        const isJpop456Deceptive = isJpop456DeceptiveResolution(style, sourceChord, sourceFunc, targetChord);
        const consonanceRank = { consonant: 0, colortone: 1, tension: 2, avoid: 4 } as const;
        let best: { pc: number; midi: number; score: number } | null = null;
        for (const pc of candidates) {
            const midi = snapMidiToNearestPcSet(sourceMidi, new Set([pc]), maxDistance);
            if (((midi % 12) + 12) % 12 !== pc) continue;
            if (midi < MELODY_RANGE.LOW || midi > MELODY_RANGE.HIGH) continue;
            const candidateAssessment = evaluateNoteInChordContext(pc, targetChord.type, targetRootPc, targetFunc, null, null, keyRootPc, targetChord.forcedScale, tonalCharacter === 'modal', targetRunScalePcs, tonalCharacter, targetChord.localTonalCenterPc, modeFamily);
            if (candidateAssessment.consonance === 'avoid') continue;
            const interval = midi - sourceMidi;
            const distance = Math.abs(interval);
            const targetIndex = sourceAssessment.resolutionTargets.indexOf(pc);
            let score = candidateAssessment.urgency * 100 + consonanceRank[candidateAssessment.consonance as keyof typeof consonanceRank] * 15 + distance * 3 - Math.max(0, sourceAssessment.urgency - candidateAssessment.urgency) * 30;
            if (targetIndex >= 0) score -= targetIndex === 0 ? 85 : targetIndex === 1 ? 60 : 40;
            if (preferredPc !== null && pc === preferredPc) score -= 4;
            score += guideTonePreferenceScore(style, pc, midi, guideTonePc, guideTonePcs, options.guideReferenceMidi);
            if (isJpop456Deceptive) {
                const targetRoot = ((targetChord.rootMidi % 12) + 12) % 12;
                if (targetThirdPc !== null && pc === targetThirdPc) score -= 32;
                if (targetFifthPc !== null && pc === targetFifthPc) score -= 22;
                if (pc === targetRoot) score += 18;
                if (interval === 1) score -= 18;
                if (interval === -1) score -= 18;
                if (interval === 2) score -= 10;
                if (distance <= 2) score -= 8;
            }
            if (style === 'LOFI' && candidateAssessment.consonance === 'colortone') score -= 6;
            if (distance === 1) score -= 12;
            if (interval === -1) score -= 8;
            if (interval === 0 && sourceAssessment.urgency >= 0.4) score += 20;
            if (!targetRunScalePcs.has(pc)) score += 25;
            if (!best || score < best.score) best = { pc, midi, score };
        }
        return best ? { pc: best.pc, midi: best.midi } : null;
    }
    function chooseMelodicResolutionConnector(sourceMidi: number, targetMidi: number, targetPc: number, legalTargetPcs: Set<number>, style: StyleName): number | null {
        const direct = targetMidi - sourceMidi;
        const directDistance = Math.abs(direct);
        if (directDistance < 3 || directDistance > 9) return null;
        const direction = Math.sign(direct);
        const maxInto = style === 'JAZZ' ? 6 : 5;
        const maxOut = style === 'POP' ? 3 : 4;
        let best: { midi: number; score: number } | null = null;
        for (const pc of legalTargetPcs) {
            if (pc === targetPc) continue;
            const midi = snapMidiToNearestPcSet(sourceMidi, new Set([pc]), Math.max(3, directDistance - 1));
            if (((midi % 12) + 12) % 12 !== pc) continue;
            if (midi < MELODY_RANGE.LOW || midi > MELODY_RANGE.HIGH) continue;
            if (midi === sourceMidi || midi === targetMidi) continue;
            const into = midi - sourceMidi;
            const out = targetMidi - midi;
            if (Math.sign(into) !== direction || Math.sign(out) !== direction) continue;
            if (Math.abs(into) >= directDistance || Math.abs(out) >= directDistance) continue;
            if (Math.abs(into) > maxInto || Math.abs(out) > maxOut) continue;
            let score = Math.abs(into) * 1.2 + Math.abs(out) * 1.8;
            if (Math.abs(out) <= 2) score -= 8;
            if (Math.abs(into) <= 2) score -= 4;
            if (style === 'RNB' && Math.abs(out) <= 3) score -= 3;
            if (!best || score < best.score) best = { midi, score };
        }
        return best?.midi ?? null;
    }


    export function isLofiWeakScaleDecoration(
        event: NoteEvent,
        prev: NoteEvent | null,
        next: NoteEvent | null,
        runScalePcs: Set<number>,
        chordAt: (time: number) => { chord: ChordDef; start: number },
        style: StyleName,
        maxStep = 3,
        requireBothContractSupport = false,
    ): boolean {
        const maxDuration = style === 'LOFI' ? 0.25 : 0.5;
        if (event.duration > maxDuration) return false;
        if (!prev || !next) return false;
        const { chord, start } = chordAt(event.time);
        const chordEnd = start + (chord.duration ?? 4);
        if (prev.time < start - 0.001 || next.time >= chordEnd - 0.001) return false;
        const beatInChord = event.time - start;
        const strongBeat = _strongBeats.some(sb => Math.abs(beatInChord - sb) < 0.08);
        if (strongBeat) return false;

        const eventPc = ((event.noteNumber % 12) + 12) % 12;
        if (!runScalePcs.has(eventPc)) return false;

        const prevCtx = chordAt(prev.time);
        const nextCtx = chordAt(next.time);
        const prevPc = ((prev.noteNumber % 12) + 12) % 12;
        const nextPc = ((next.noteNumber % 12) + 12) % 12;
        const prevRootPc = ((prevCtx.chord.rootMidi % 12) + 12) % 12;
        const nextRootPc = ((nextCtx.chord.rootMidi % 12) + 12) % 12;
        const prevInContract = melodyContractPcsForStyle(style, prevCtx.chord, prevRootPc).has(prevPc);
        const nextInContract = melodyContractPcsForStyle(style, nextCtx.chord, nextRootPc).has(nextPc);
        const into = Math.abs(event.noteNumber - prev.noteNumber);
        const out = Math.abs(next.noteNumber - event.noteNumber);
        const supported = requireBothContractSupport
            ? prevInContract && nextInContract
            : prevInContract || nextInContract;
        return supported && into <= maxStep && out <= maxStep;
    }

    export function isLofiFastChromaticDecoration(
        event: NoteEvent,
        prev: NoteEvent | null,
        next: NoteEvent | null,
        chordAt: (time: number) => { chord: ChordDef; start: number },
        style: StyleName,
    ): boolean {
        if (style === 'POP') return false;
        const maxDuration = style === 'LOFI' ? 0.25 : 0.5;
        if (event.duration > maxDuration) return false;
        if (!prev || !next) return false;
        const { chord, start } = chordAt(event.time);
        const chordEnd = start + (chord.duration ?? 4);
        if (prev.time < start - 0.001 || next.time >= chordEnd - 0.001) return false;
        const beatInChord = event.time - start;
        const strongBeat = _strongBeats.some(sb => Math.abs(beatInChord - sb) < 0.08);
        if (strongBeat) return false;

        const prevCtx = chordAt(prev.time);
        const nextCtx = chordAt(next.time);
        const prevPc = ((prev.noteNumber % 12) + 12) % 12;
        const nextPc = ((next.noteNumber % 12) + 12) % 12;
        const prevRootPc = ((prevCtx.chord.rootMidi % 12) + 12) % 12;
        const nextRootPc = ((nextCtx.chord.rootMidi % 12) + 12) % 12;
        const prevInContract = melodyContractPcsForStyle(style, prevCtx.chord, prevRootPc).has(prevPc);
        const nextInContract = melodyContractPcsForStyle(style, nextCtx.chord, nextRootPc).has(nextPc);
        if (!prevInContract || !nextInContract) return false;

        const into = Math.abs(event.noteNumber - prev.noteNumber);
        const out = Math.abs(next.noteNumber - event.noteNumber);
        const neighbor = prevPc === nextPc && into === 1 && out === 1;
        const passing = Math.sign(event.noteNumber - prev.noteNumber) === Math.sign(next.noteNumber - event.noteNumber)
            && into === 1
            && out === 1;
        return neighbor || passing;
    }

    export function lofiDominantLandingPc(chord: ChordDef): number | null {
        const rootPc = ((chord.rootMidi % 12) + 12) % 12;
        const intervals = CHORD_TYPES[chord.type] ?? [];
        if (intervals.includes(10)) return (rootPc + 10) % 12;
        return null;
    }

    export function lofiSoftLandingPc(chord: ChordDef): number | null {
        const rootPc = ((chord.rootMidi % 12) + 12) % 12;
        const intervals = CHORD_TYPES[chord.type] ?? [];
        const preferred = [
            intervals.includes(4) ? 4 : intervals.includes(3) ? 3 : null,
            intervals.includes(14) ? 2 : null,
            intervals.includes(9) ? 9 : intervals.includes(21) ? 9 : null,
            intervals.includes(11) ? 11 : null,
        ].filter((iv): iv is number => iv !== null);
        return preferred.length > 0 ? (rootPc + preferred[0]) % 12 : null;
    }

    export function applyLofiCrawlHoldParadigm(
        melody: NoteEvent[],
        chords: ChordDef[],
        starts: number[],
        musicKey: string,
        musicMode: string,
        tonalCharacter: 'tonal' | 'modal',
    ): NoteEvent[] {
        const out = melody.map(e => ({ ...e }));
        const baseRoman = (roman: string): string =>
            roman.split('/')[0].replace(/^[b#n]+/, '');
        const melodyIn = (start: number, end: number) => out
            .filter(e => e.part === 'melody' && e.time >= start - 0.001 && e.time < end - 0.001)
            .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);

        for (let i = 0; i <= chords.length - 3; i++) {
            const c0 = chords[i];
            const c1 = chords[i + 1];
            const c2 = chords[i + 2];
            const r0 = baseRoman(c0.roman);
            const r1 = baseRoman(c1.roman);
            const r2 = baseRoman(c2.roman);
            const f0 = c0.effectiveFunc ?? getHarmonicFunction(c0.roman);
            const f1 = c1.effectiveFunc ?? getHarmonicFunction(c1.roman);
            const f2 = c2.effectiveFunc ?? getHarmonicFunction(c2.roman);
            const isCadenceFrame = (r0 === 'ii' || r0 === 'iiø')
                && (f0 === 'S' || r0 === 'ii' || r0 === 'iiø')
                && (f1 === 'D' || ['V', 'v'].includes(r1))
                && (f2 === 'T' || ['I', 'i'].includes(r2));
            if (!isCadenceFrame) continue;

            const sourceStart = starts[i];
            const sourceEnd = starts[i] + (c0.duration ?? 4);
            const sourceWindowStart = sourceStart + (c0.duration ?? 4) * 0.5;
            const sourceTail = melodyIn(sourceWindowStart, sourceEnd)
                .filter(e => e.duration <= 0.75)
                .slice(-4);
            const hasUsableSource = sourceTail.length >= 3
                && sourceTail[sourceTail.length - 1].noteNumber > sourceTail[0].noteNumber
                && sourceTail.slice(1).every((e, idx) => {
                    const delta = e.noteNumber - sourceTail[idx].noteNumber;
                    return delta > 0 && delta <= 4;
                });
            const hasFavoriteRegister = hasUsableSource
                && sourceTail[0].noteNumber >= 65
                && sourceTail[sourceTail.length - 1].noteNumber >= 71;
            if (!hasUsableSource || !hasFavoriteRegister) {
                continue;
            }

            const sourceLandingPc = lofiDominantLandingPc(c1) ?? lofiSoftLandingPc(c1);
            if (sourceLandingPc !== null) {
                const sourceLandingStart = starts[i + 1];
                const sourceLandingEnd = sourceLandingStart + (c1.duration ?? 4);
                const sourceLanding = chooseLongResolutionTarget(
                    'LOFI',
                    sourceTail[sourceTail.length - 1].noteNumber,
                    c0,
                    f0,
                    c1,
                    f1,
                    musicKey,
                    musicMode,
                    tonalCharacter,
                    { maxDistance: 9, preferredPc: sourceLandingPc },
                );
                if (sourceLanding) {
                    for (let k = out.length - 1; k >= 0; k--) {
                        const e = out[k];
                        if (e.part === 'melody'
                            && e.time >= sourceLandingStart - 0.001
                            && e.time < Math.min(sourceLandingEnd, sourceLandingStart + 2.0) - 0.001) {
                            out.splice(k, 1);
                        }
                    }
                    out.push({
                        noteNumber: sourceLanding.midi,
                        time: sourceLandingStart,
                        duration: Math.min(2, sourceLandingEnd - sourceLandingStart),
                        velocity: 100,
                        part: 'melody',
                        origin: 'develop',
                        lickSource: true,
                    });
                }
            }

            const landingPc = lofiSoftLandingPc(c2);
            const targetStart = starts[i + 2];
            const targetEnd = targetStart + (c2.duration ?? 4);
            const sourceHold = melodyIn(starts[i + 1], starts[i + 1] + (c1.duration ?? 4))
                .filter(e => e.duration >= 1.5)
                .sort((a, b) => b.duration - a.duration || b.noteNumber - a.noteNumber)[0];
            const crawlUpperNeighborSeed = sourceTail[sourceTail.length - 1].noteNumber + 5;
            const landingSeed = sourceHold && sourceHold.noteNumber >= crawlUpperNeighborSeed - 2
                ? sourceHold.noteNumber
                : crawlUpperNeighborSeed;
            const landing = chooseLongResolutionTarget(
                'LOFI',
                landingSeed,
                c1,
                f1,
                c2,
                f2,
                musicKey,
                musicMode,
                tonalCharacter,
                { maxDistance: 14, preferredPc: landingPc },
            );
            if (!landing) continue;
            for (let k = out.length - 1; k >= 0; k--) {
                const e = out[k];
                if (e.part === 'melody' && e.time >= targetStart - 0.001 && e.time < Math.min(targetEnd, targetStart + 2.0) - 0.001) {
                    out.splice(k, 1);
                }
            }
            out.push({
                noteNumber: landing.midi,
                time: targetStart,
                duration: Math.min(2, targetEnd - targetStart),
                velocity: sourceHold ? Math.max(92, Math.min(105, sourceHold.velocity)) : 98,
                part: 'melody',
                origin: 'develop',
                lickSource: true,
            });
        }

        if (chords.length >= 3) {
            for (let i = 0; i <= chords.length - 3; i++) {
                const c0 = chords[i];
                const c1 = chords[i + 1];
                const c2 = chords[i + 2];
                const r0 = baseRoman(c0.roman);
                const r1 = baseRoman(c1.roman);
                const r2 = baseRoman(c2.roman);
                const f0 = c0.effectiveFunc ?? getHarmonicFunction(c0.roman);
                const f1 = c1.effectiveFunc ?? getHarmonicFunction(c1.roman);
                const f2 = c2.effectiveFunc ?? getHarmonicFunction(c2.roman);
                const isCadenceFrame = (r0 === 'ii' || r0 === 'iiø')
                    && (f0 === 'S' || r0 === 'ii' || r0 === 'iiø')
                    && (f1 === 'D' || ['V', 'v'].includes(r1))
                    && (f2 === 'T' || ['I', 'i'].includes(r2));
                if (!isCadenceFrame) continue;

                const targetThirdPc = chordThirdPc(c2);
                if (targetThirdPc === null) continue;
                const targetStart = starts[i + 2];
                const targetEnd = targetStart + (c2.duration ?? 4);

                const earlyWindowEnd = Math.min(targetEnd, targetStart + 2.0);
                const existing = melodyIn(targetStart, earlyWindowEnd)[0] ?? null;
                const existingPc = existing ? ((existing.noteNumber % 12) + 12) % 12 : null;
                if (existing && existingPc === targetThirdPc && existing.duration >= 1.5) continue;

                for (let k = out.length - 1; k >= 0; k--) {
                    const e = out[k];
                    if (e.part === 'melody'
                        && e.time >= targetStart - 0.001
                        && e.time < earlyWindowEnd - 0.001) {
                        out.splice(k, 1);
                    }
                }

                const targetMidi = snapMidiToNearestPcSet(76, new Set([targetThirdPc]), 12);
                if (((targetMidi % 12) + 12) % 12 !== targetThirdPc) continue;
                out.push({
                    noteNumber: targetMidi,
                    time: targetStart,
                    duration: Math.min(2, targetEnd - targetStart),
                    velocity: 98,
                    part: 'melody',
                    origin: 'return',
                    lickSource: true,
                });
            }
        }
        const finalActiveMelodyAt = (time: number): NoteEvent | null =>
            out
                .filter(event => event.part === 'melody'
                    && event.time <= time + 0.025
                    && event.time + event.duration > time - 0.025)
                .sort((a, b) => b.noteNumber - a.noteNumber)[0] ?? null;

        return out
            .filter(event => {
                if (event.part !== 'chord') return true;
                const melody = finalActiveMelodyAt(event.time);
                if (!melody) return true;
                return event.noteNumber < melody.noteNumber;
            })
            .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
    }

    export function applyMelodicResolutionParadigm(
        style: StyleName,
        melody: NoteEvent[],
        chords: ChordDef[],
        starts: number[],
        musicKey: string,
        musicMode: string,
        tonalCharacter: 'tonal' | 'modal',
    ): NoteEvent[] {
        const out = melody.map(e => ({ ...e }));
        const baseRoman = (roman: string): string =>
            roman.split('/')[0].replace(/^[b#n]+/, '');
        const isTonicArrival = (chord: ChordDef): boolean => {
            const roman = baseRoman(chord.roman);
            const func = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
            return func === 'T' || roman === 'I' || roman === 'i';
        };
        const melodyInWindow = (start: number, end: number): NoteEvent[] =>
            out
                .filter(e => e.part === 'melody' && e.time >= start - 0.001 && e.time < end - 0.001)
                .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
        const eventBrickSpansBoundary = (event: NoteEvent, boundary: number): boolean =>
            event.brickIndex !== undefined
            && event.brickStartBeat !== undefined
            && event.brickEndBeat !== undefined
            && event.brickStartBeat < boundary - 0.001
            && event.brickEndBeat > boundary + 0.001;
        const applyTargetChordSuspensionBoundary = (targetIndex: number): void => {
            if (tonalCharacter !== 'tonal') return;
            if (targetIndex <= 0 || targetIndex >= chords.length) return;

            const targetChord = chords[targetIndex];
            const prevChord = chords[targetIndex - 1];
            const targetFunc = targetChord.effectiveFunc ?? getHarmonicFunction(targetChord.roman);
            const prevFunc = prevChord.effectiveFunc ?? getHarmonicFunction(prevChord.roman);
            const targetStart = starts[targetIndex];
            const targetEnd = targetStart + (targetChord.duration ?? 4);
            const prevStart = starts[targetIndex - 1];
            const prevEnd = prevStart + (prevChord.duration ?? 4);
            const targetThirdPc = chordThirdPc(targetChord);
            const threshold = boundaryResolutionThreshold(style);
            const candidateMap = new Map<NoteEvent, number>();
            const cadentialLookback = isTonicArrival(targetChord) && prevFunc === 'D';

            const addCandidate = (event: NoteEvent, scoreBias: number): void => {
                if (event.part !== 'melody') return;
                if (event.time >= targetStart - 0.001) return;
                if (event.duration < 0.25) return;
                if (eventBrickSpansBoundary(event, targetStart)) return;
                const prev = candidateMap.get(event);
                if (prev === undefined || scoreBias < prev) candidateMap.set(event, scoreBias);
            };

            const prevTail = melodyInWindow(prevStart, prevEnd)
                .filter(e => e.time >= prevEnd - 0.76 && e.time + e.duration >= prevEnd - 0.08)
                .sort((a, b) => b.time - a.time || b.noteNumber - a.noteNumber)[0] ?? null;
            if (prevTail) addCandidate(prevTail, cadentialLookback ? -8 : -32);

            if (cadentialLookback) {
                const lookbackStartIndex = targetIndex >= 2
                    && ((chords[targetIndex - 2].effectiveFunc ?? getHarmonicFunction(chords[targetIndex - 2].roman)) === 'S')
                    ? targetIndex - 2
                    : targetIndex - 1;
                for (let idx = lookbackStartIndex; idx < targetIndex; idx++) {
                    const start = starts[idx];
                    const end = start + (chords[idx].duration ?? 4);
                    for (const event of melodyInWindow(start, end)) {
                        const beatInChord = event.time - start;
                        const strongBeat = _strongBeats.some(sb => Math.abs(beatInChord - sb) < 0.08);
                        const structuralBias = strongBeat || event.duration >= 0.75 ? -8 : 0;
                        const recencyPenalty = Math.max(0, Math.min(24, (targetStart - event.time) * 1.25));
                        const highRegisterBonus = style === 'LOFI' && event.noteNumber >= 72 ? -8 : 0;
                        addCandidate(event, recencyPenalty + structuralBias + highRegisterBonus);
                    }
                }
            }

            let best: { event: NoteEvent; target: { pc: number; midi: number; urgency: number }; score: number } | null = null;
            for (const [event, scoreBias] of candidateMap.entries()) {
                if (isRnbFloatingTonicNinth(style, ((event.noteNumber % 12) + 12) % 12, prevChord, prevFunc)) continue;
                const target = chooseTargetChordSuspensionResolution(
                    style,
                    event.noteNumber,
                    targetChord,
                    targetFunc,
                    musicKey,
                    musicMode,
                    tonalCharacter,
                    { maxDistance: style === 'LOFI' ? 16 : 12, preferredPc: targetThirdPc, minUrgency: threshold },
                );
                if (!target) continue;
                const interval = target.midi - event.noteNumber;
                const distance = Math.abs(interval);
                let score = scoreBias - target.urgency * 100 + distance * 2;
                if (targetThirdPc !== null && target.pc === targetThirdPc) score -= 18;
                const targetRootPc = ((targetChord.rootMidi % 12) + 12) % 12;
                const eventPc = ((event.noteNumber % 12) + 12) % 12;
                const lofiFourToThree = style === 'LOFI'
                    && cadentialLookback
                    && targetThirdPc !== null
                    && target.pc === targetThirdPc
                    && ((eventPc - targetRootPc + 12) % 12) === 5;
                if (lofiFourToThree) score -= 120;
                if (interval === -1) score -= 24;
                if (event.time + event.duration >= targetStart - 0.08) score -= 18;
                if (style === 'LOFI' && cadentialLookback && event.noteNumber < 72) score += 36;
                if (!best || score < best.score) best = { event, target, score };
            }
            if (!best) return;

            if (best.event.time + best.event.duration > targetStart + 0.08) {
                best.event.duration = Math.max(0.25, targetStart - best.event.time);
            }

            const desiredDuration = style === 'LOFI' && best.target.urgency >= 0.7
                ? Math.min(2, targetEnd - targetStart)
                : Math.min(1, targetEnd - targetStart);
            const earlyWindowEnd = Math.min(targetEnd, targetStart + Math.max(1.01, desiredDuration + 0.01));
            const existing = out
                .filter(e => e.part === 'melody'
                    && e.time >= targetStart - 0.001
                    && e.time < earlyWindowEnd)
                .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber)[0] ?? null;

            if (existing) {
                existing.noteNumber = best.target.midi;
                existing.time = targetStart;
                existing.duration = Math.max(existing.duration, desiredDuration);
                existing.velocity = Math.max(existing.velocity, Math.min(105, best.event.velocity));
                existing.origin = 'return';
                existing.lickSource = true;
                return;
            }

            const nextLater = out
                .filter(e => e.part === 'melody' && e.time >= earlyWindowEnd && e.time < targetEnd)
                .sort((a, b) => a.time - b.time)[0] ?? null;
            const maxDurByNext = nextLater ? Math.max(0.25, nextLater.time - targetStart) : targetEnd - targetStart;
            out.push({
                noteNumber: best.target.midi,
                time: targetStart,
                duration: Math.min(desiredDuration, maxDurByNext),
                velocity: Math.max(92, Math.min(105, best.event.velocity)),
                part: 'melody',
                origin: 'return',
                lickSource: true,
            });
        };

        for (let targetIndex = 1; targetIndex < chords.length; targetIndex++) {
            const targetChord = chords[targetIndex];
            const dominantChord = chords[targetIndex - 1];
            const targetRoman = baseRoman(targetChord.roman);
            const dominantRoman = baseRoman(dominantChord.roman);
            const targetFunc = targetChord.effectiveFunc ?? getHarmonicFunction(targetChord.roman);
            const dominantFunc = dominantChord.effectiveFunc ?? getHarmonicFunction(dominantChord.roman);
            const resolvesSecondaryDominant = dominantChord.mustResolve
                || dominantChord.borrowedSource === 'secondary_dominant'
                || dominantChord.borrowedSource === 'secondary_ii_v'
                || dominantChord.localTonalCenterPc === ((targetChord.rootMidi % 12) + 12) % 12;
            if (targetFunc !== 'T' && !['I', 'i'].includes(targetRoman) && !resolvesSecondaryDominant) continue;
            if (dominantFunc !== 'D' && !['V', 'v'].includes(dominantRoman)) continue;

            const preDominantIndex = targetIndex - 2;
            const preDominantChord = preDominantIndex >= 0 ? chords[preDominantIndex] : null;
            const preDominantRoman = preDominantChord ? baseRoman(preDominantChord.roman) : '';
            const preDominantFunc = preDominantChord
                ? (preDominantChord.effectiveFunc ?? getHarmonicFunction(preDominantChord.roman))
                : null;
            const sourceIndex = !resolvesSecondaryDominant && preDominantChord && (preDominantFunc === 'S' || ['ii', 'iv', 'vi'].includes(preDominantRoman))
                ? preDominantIndex
                : targetIndex - 1;

            const tonicStart = starts[targetIndex];
            const tonicEnd = tonicStart + (targetChord.duration ?? 4);
            const sourceHoldMinDuration = style === 'LOFI' ? 1.0 : 1.25;
            const sourceCandidateIndexes = sourceIndex === targetIndex - 1
                ? [sourceIndex]
                : [sourceIndex, targetIndex - 1];
            let sourceChord = chords[sourceIndex];
            let sourceFunc = sourceChord.effectiveFunc ?? getHarmonicFunction(sourceChord.roman);
            let sourceHold: NoteEvent | null = null;
            for (const candidateIndex of sourceCandidateIndexes) {
                const candidateChord = chords[candidateIndex];
                const candidateStart = starts[candidateIndex];
                const candidateEnd = candidateStart + (candidateChord.duration ?? 4);
                const candidateHold = out
                    .filter(e => e.part === 'melody'
                        && e.time >= candidateStart - 0.001
                        && e.time < candidateEnd - 0.001
                        && e.duration >= sourceHoldMinDuration)
                    .sort((a, b) => b.duration - a.duration || b.noteNumber - a.noteNumber)[0];
                if (!candidateHold) continue;
                if (eventBrickSpansBoundary(candidateHold, tonicStart)) continue;
                if (!sourceHold || candidateHold.duration > sourceHold.duration || candidateIndex === sourceIndex) {
                    sourceChord = candidateChord;
                    sourceFunc = sourceChord.effectiveFunc ?? getHarmonicFunction(sourceChord.roman);
                    sourceHold = candidateHold;
                }
            }
            if (!sourceHold) continue;

            const target = chooseLongResolutionTarget(
                style,
                sourceHold.noteNumber,
                sourceChord,
                sourceFunc,
                targetChord,
                targetFunc,
                musicKey,
                musicMode,
                tonalCharacter,
                { maxDistance: 7, preferredPc: chordThirdPc(targetChord) },
            );
            if (!target) continue;
            const targetMidi = target.midi;

            if (sourceHold.time + sourceHold.duration > tonicStart + 0.08) {
                sourceHold.duration = Math.max(0.25, tonicStart - sourceHold.time);
            }

            const existing = out
                .filter(e => e.part === 'melody'
                    && e.time >= tonicStart - 0.001
                    && e.time < Math.min(tonicEnd, tonicStart + 2.01))
                .sort((a, b) => a.time - b.time)[0];
            if (existing) {
                existing.noteNumber = targetMidi;
                existing.time = tonicStart;
                existing.duration = Math.max(existing.duration, Math.min(2, tonicEnd - tonicStart));
                existing.origin = 'return';
                existing.lickSource = true;
            } else {
                out.push({
                    noteNumber: targetMidi,
                    time: tonicStart,
                    duration: Math.min(2, tonicEnd - tonicStart),
                    velocity: Math.max(92, Math.min(105, sourceHold.velocity)),
                    part: 'melody',
                    origin: 'return',
                    lickSource: true,
                });
            }
        }

        for (let targetIndex = 1; targetIndex < chords.length; targetIndex++) {
            applyTargetChordSuspensionBoundary(targetIndex);
        }

        if (tonalCharacter !== 'tonal') {
            return out.sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
        }
        const keyRootPc = ((noteToMidi(musicKey + '0') % 12) + 12) % 12;
        const modeFamily = modeToKeyFamily(musicMode);

        for (let i = 0; i < chords.length - 1; i++) {
            const chord = chords[i];
            const nextChord = chords[i + 1];
            const start = starts[i] ?? i * 4;
            const end = start + (chord.duration ?? 4);
            const nextStart = starts[i + 1] ?? end;
            const nextEnd = nextStart + (nextChord.duration ?? 4);
            const func = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
            const nextFunc = nextChord.effectiveFunc ?? getHarmonicFunction(nextChord.roman);

            const tail = out
                .filter(e => e.part === 'melody'
                    && e.time >= start - 0.001
                    && e.time < end - 0.001
                    && e.time >= end - 0.76)
                .sort((a, b) => b.time - a.time || b.noteNumber - a.noteNumber)[0];
            if (!tail) continue;
            if (eventBrickSpansBoundary(tail, nextStart)) continue;
            if (tail.time + tail.duration < end - 0.08) continue;

            const rootPc = ((chord.rootMidi % 12) + 12) % 12;
            const nextRootPc = ((nextChord.rootMidi % 12) + 12) % 12;
            const notePc = ((tail.noteNumber % 12) + 12) % 12;
            if (isRnbFloatingTonicNinth(style, notePc, chord, func)) continue;
            const runScale = runScaleForChordContext(style, chord, func, musicKey, musicMode);
            const runScalePcs = new Set(runScale.map(m => ((m % 12) + 12) % 12));
            const assessment = evaluateNoteInChordContext(
                notePc,
                chord.type,
                rootPc,
                func,
                nextChord.type,
                nextRootPc,
                keyRootPc,
                chord.forcedScale,
                false,
                runScalePcs,
                tonalCharacter,
                chord.localTonalCenterPc,
                modeFamily,
            );
            const tailResolutionThreshold = style === 'LOFI'
                ? 0.40
                : style === 'POP'
                    ? 0.45
                    : UNRESOLVED_TENSION_THRESHOLD;
            if (assessment.urgency < tailResolutionThreshold) continue;

            const nextContract = melodyContractPcsForStyle(style, nextChord, nextRootPc);
            const nextRunScale = runScaleForChordContext(style, nextChord, nextFunc, musicKey, musicMode);
            const nextRunScalePcs = new Set(nextRunScale.map(m => ((m % 12) + 12) % 12));
            const targetPcs = assessment.resolutionTargets
                .filter(pc => nextContract.has(pc) && nextRunScalePcs.has(pc));
            const targetPc = targetPcs[0] ?? assessment.resolutionTargets.find(pc => nextContract.has(pc));
            if (targetPc === undefined) continue;

            const targetMidi = snapMidiToNearestPcSet(tail.noteNumber, new Set([targetPc]), 14);
            if (((targetMidi % 12) + 12) % 12 !== targetPc) continue;
            if (targetMidi < MELODY_RANGE.LOW || targetMidi > MELODY_RANGE.HIGH) continue;

            if (tail.time + tail.duration > nextStart + 0.08) {
                tail.duration = Math.max(0.25, nextStart - tail.time);
            }

            const earlyWindowEnd = Math.min(nextEnd, nextStart + 1.01);
            const legalTargetPcs = new Set(targetPcs.length > 0 ? targetPcs : [...nextContract].filter(pc => nextRunScalePcs.has(pc)));
            const connectorMidi = chooseMelodicResolutionConnector(
                tail.noteNumber,
                targetMidi,
                targetPc,
                legalTargetPcs,
                style,
            );
            if (connectorMidi !== null) {
                const connectorDuration = style === 'JAZZ' ? 0.33 : 0.5;
                const landingTime = nextStart + connectorDuration;
                if (landingTime < Math.min(nextEnd, nextStart + 0.95)) {
                    for (let k = out.length - 1; k >= 0; k--) {
                        const event = out[k];
                        if (event.part === 'melody'
                            && event.time >= nextStart - 0.001
                            && event.time < landingTime - 0.001) {
                            out.splice(k, 1);
                        }
                    }

                    out.push({
                        noteNumber: connectorMidi,
                        time: nextStart,
                        duration: connectorDuration,
                        velocity: Math.max(82, Math.min(98, tail.velocity - 4)),
                        part: 'melody',
                        origin: 'develop',
                        lickSource: true,
                    });

                    const targetExisting = out
                        .filter(e => e.part === 'melody'
                            && e.time >= landingTime - 0.001
                            && e.time < earlyWindowEnd)
                        .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber)[0] ?? null;
                    if (targetExisting) {
                        targetExisting.noteNumber = targetMidi;
                        targetExisting.time = landingTime;
                        targetExisting.duration = Math.max(targetExisting.duration, Math.min(0.75, nextEnd - landingTime));
                        targetExisting.velocity = Math.max(targetExisting.velocity, Math.min(104, tail.velocity));
                        targetExisting.origin = 'return';
                        targetExisting.lickSource = true;
                    } else {
                        const nextLater = out
                            .filter(e => e.part === 'melody' && e.time >= earlyWindowEnd && e.time < nextEnd)
                            .sort((a, b) => a.time - b.time)[0] ?? null;
                        const maxDurByNext = nextLater ? Math.max(0.25, nextLater.time - landingTime) : nextEnd - landingTime;
                        out.push({
                            noteNumber: targetMidi,
                            time: landingTime,
                            duration: Math.min(0.75, maxDurByNext),
                            velocity: Math.max(92, Math.min(104, tail.velocity)),
                            part: 'melody',
                            origin: 'return',
                            lickSource: true,
                        });
                    }
                    continue;
                }
            }

            const existing = out
                .filter(e => e.part === 'melody'
                    && e.time >= nextStart - 0.001
                    && e.time < earlyWindowEnd)
                .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber)[0];
            if (existing) {
                const existingPc = ((existing.noteNumber % 12) + 12) % 12;
                if (existing.origin === 'return' && targetPcs.includes(existingPc)) continue;
                existing.noteNumber = targetMidi;
                existing.time = nextStart;
                existing.duration = Math.max(existing.duration, Math.min(1, nextEnd - nextStart));
                existing.velocity = Math.max(existing.velocity, Math.min(104, tail.velocity));
                existing.origin = 'return';
                existing.lickSource = true;
                continue;
            }

            const nextLater = out
                .filter(e => e.part === 'melody' && e.time >= earlyWindowEnd && e.time < nextEnd)
                .sort((a, b) => a.time - b.time)[0];
            const maxDurByNext = nextLater ? Math.max(0.25, nextLater.time - nextStart) : nextEnd - nextStart;
            out.push({
                noteNumber: targetMidi,
                time: nextStart,
                duration: Math.min(1, maxDurByNext),
                velocity: Math.max(92, Math.min(104, tail.velocity)),
                part: 'melody',
                origin: 'return',
                lickSource: true,
            });
        }

        if (chords.length > 1) {
            const chord = chords[chords.length - 1];
            const nextChord = chords[0];
            const start = starts[chords.length - 1] ?? 0;
            const end = start + (chord.duration ?? 4);
            const nextStart = starts[0] ?? 0;
            const nextEnd = nextStart + (nextChord.duration ?? 4);
            const func = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
            const nextFunc = nextChord.effectiveFunc ?? getHarmonicFunction(nextChord.roman);
            const loopTailCandidates = out
                .filter(e => e.part === 'melody'
                    && e.time >= start - 0.001
                    && e.time < end - 0.001)
                .sort((a, b) => b.time - a.time || b.noteNumber - a.noteNumber);
            const nearEndTail = loopTailCandidates
                .filter(e => e.time >= end - 0.76 && e.time + e.duration >= end - 0.08)[0];
            const structuralLastTail = loopTailCandidates
                .filter(e => e.duration >= 0.5)[0];
            const tail = nearEndTail ?? structuralLastTail ?? null;

            if (tail) {
                const rootPc = ((chord.rootMidi % 12) + 12) % 12;
                const nextRootPc = ((nextChord.rootMidi % 12) + 12) % 12;
                const notePc = ((tail.noteNumber % 12) + 12) % 12;
                if (isRnbFloatingTonicNinth(style, notePc, chord, func)) {
                    return out.sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
                }
                const runScale = runScaleForChordContext(style, chord, func, musicKey, musicMode);
                const runScalePcs = new Set(runScale.map(m => ((m % 12) + 12) % 12));
                const assessment = evaluateNoteInChordContext(
                    notePc,
                    chord.type,
                    rootPc,
                    func,
                    nextChord.type,
                    nextRootPc,
                    keyRootPc,
                    chord.forcedScale,
                    false,
                    runScalePcs,
                    tonalCharacter,
                    chord.localTonalCenterPc,
                    modeFamily,
                );
                const loopTailResolutionThreshold = style === 'JAZZ' ? 0.62 : 0.50;
                if (assessment.urgency >= loopTailResolutionThreshold) {
                    const nextContract = melodyContractPcsForStyle(style, nextChord, nextRootPc);
                    const nextRunScale = runScaleForChordContext(style, nextChord, nextFunc, musicKey, musicMode);
                    const nextRunScalePcs = new Set(nextRunScale.map(m => ((m % 12) + 12) % 12));
                    const targetPcs = assessment.resolutionTargets
                        .filter(pc => nextContract.has(pc) && nextRunScalePcs.has(pc));
                    const targetPc = targetPcs[0] ?? assessment.resolutionTargets.find(pc => nextContract.has(pc));
                    if (targetPc !== undefined) {
                        const targetMidi = snapMidiToNearestPcSet(tail.noteNumber, new Set([targetPc]), 14);
                        if (
                            ((targetMidi % 12) + 12) % 12 === targetPc
                            && targetMidi >= MELODY_RANGE.LOW
                            && targetMidi <= MELODY_RANGE.HIGH
                        ) {
                            if (tail.time + tail.duration > end + 0.08) {
                                tail.duration = Math.max(0.25, end - tail.time);
                            }

                            const earlyWindowEnd = Math.min(nextEnd, nextStart + 1.01);
                            const existing = out
                                .filter(e => e.part === 'melody'
                                    && e.time >= nextStart - 0.001
                                    && e.time < earlyWindowEnd)
                                .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber)[0];
                            if (existing) {
                                const existingPc = ((existing.noteNumber % 12) + 12) % 12;
                                if (!(existing.origin === 'return' && targetPcs.includes(existingPc))) {
                                    existing.noteNumber = targetMidi;
                                    existing.time = nextStart;
                                    existing.duration = Math.max(existing.duration, Math.min(1, nextEnd - nextStart));
                                    existing.velocity = Math.max(existing.velocity, Math.min(104, tail.velocity));
                                    existing.origin = 'return';
                                    existing.lickSource = true;
                                }
                            } else if (!existing) {
                                const nextLater = out
                                    .filter(e => e.part === 'melody' && e.time >= earlyWindowEnd && e.time < nextEnd)
                                    .sort((a, b) => a.time - b.time)[0];
                                const maxDurByNext = nextLater ? Math.max(0.25, nextLater.time - nextStart) : nextEnd - nextStart;
                                out.push({
                                    noteNumber: targetMidi,
                                    time: nextStart,
                                    duration: Math.min(1, maxDurByNext),
                                    velocity: Math.max(92, Math.min(104, tail.velocity)),
                                    part: 'melody',
                                    origin: 'return',
                                    lickSource: true,
                                });
                            }
                        }
                    }
                }
            }
        }

        return out.sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
    }

    export function applyLofiTonicizationColorAnchors(
        melody: NoteEvent[],
        chords: ChordDef[],
        starts: number[],
        musicKey: string,
        musicMode: string,
    ): NoteEvent[] {
        const out = melody.map(e => ({ ...e }));
        for (let i = 0; i < chords.length; i++) {
            const chord = chords[i];
            const isTonicizedDominant = chord.borrowedSource === 'secondary_dominant'
                || chord.borrowedSource === 'secondary_ii_v';
            if (!isTonicizedDominant || chord.localTonalCenterPc === undefined) continue;
            const tonicizedTarget = chord.roman.includes('/')
                ? chord.roman.split('/')[1]?.trim()
                : chord.borrowedFrom?.match(/\/([b#]?[ivIV]+)/)?.[1];
            if (tonicizedTarget !== 'vi') continue;

            const start = starts[i] ?? i * 4;
            const duration = chord.duration ?? 4;
            const func = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
            const runScale = runScaleForChordContext('LOFI', chord, func, musicKey, musicMode);
            const runScalePcs = new Set(runScale.map(m => ((m % 12) + 12) % 12));
            const localLeadingPc = (chord.localTonalCenterPc + 11) % 12;
            if (!runScalePcs.has(localLeadingPc)) continue;

            const barMelody = out
                .filter(e => e.part === 'melody'
                    && e.time >= start
                    && e.time < start + duration)
                .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
            const alreadyFrontLoaded = barMelody.some(e => {
                const beat = e.time - start;
                const pc = ((e.noteNumber % 12) + 12) % 12;
                return beat <= 1.5 && pc === localLeadingPc;
            });
            if (alreadyFrontLoaded) continue;

            const candidate = barMelody.find((e, idx) => {
                const beat = e.time - start;
                const strongBeat = _strongBeats.some(sb => Math.abs(beat - sb) < 0.08);
                return idx > 0
                    && idx < barMelody.length - 1
                    && beat > 0.01
                    && beat <= 1.5
                    && e.duration <= 0.5
                    && !strongBeat;
            });
            if (!candidate) continue;

            const candidateIndex = barMelody.findIndex(e => e === candidate);
            const prev = candidateIndex > 0 ? barMelody[candidateIndex - 1] : null;
            const next = candidateIndex >= 0 && candidateIndex < barMelody.length - 1
                ? barMelody[candidateIndex + 1]
                : null;
            let snapped = -1;
            let bestScore = Infinity;
            for (let midi = MELODY_RANGE.LOW; midi <= MELODY_RANGE.HIGH; midi++) {
                const pc = ((midi % 12) + 12) % 12;
                if (pc !== localLeadingPc) continue;
                const distance = Math.abs(midi - candidate.noteNumber);
                if (distance > 16) continue;
                const into = prev ? Math.abs(midi - prev.noteNumber) : 0;
                const outStep = next ? Math.abs(next.noteNumber - midi) : 0;
                if (prev && into > 3) continue;
                if (next && outStep > 3) continue;
                const score = distance + into * 0.5 + outStep * 0.5;
                if (score < bestScore) {
                    bestScore = score;
                    snapped = midi;
                }
            }
            if (snapped < 0) continue;
            if (snapped >= MELODY_RANGE.LOW && snapped <= MELODY_RANGE.HIGH) {
                candidate.noteNumber = snapped;
                candidate.velocity = Math.max(candidate.velocity, 92);
            }
        }
        return out.sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
    }

    export function shapeMelodyHarmony(
        style: StyleName,
        melody: NoteEvent[],
        chords: ChordDef[],
        musicKey: string,
        musicMode: string,
        tonalCharacter: 'tonal' | 'modal',
        applyLofiParadigm: boolean,
        strongBeats: number[] = [0, 2],
    ): NoteEvent[] {
        _strongBeats = strongBeats; // 设模块级 strongBeats(原 this.songMeterContext.strongBeats),helper 读它
        const starts: number[] = [];
        let acc = 0;
        for (const chord of chords) {
            starts.push(acc);
            acc += chord.duration ?? 4;
        }
        const keyRootPc = ((noteToMidi(musicKey + '0') % 12) + 12) % 12;
        const modeFamily = modeToKeyFamily(musicMode);

        const chordAt = (time: number): { chord: ChordDef; index: number; start: number } => {
            for (let i = 0; i < chords.length; i++) {
                const start = starts[i];
                const duration = chords[i].duration ?? 4;
                if (time >= start && time < start + duration) return { chord: chords[i], index: i, start };
            }
            const index = Math.max(0, chords.length - 1);
            return { chord: chords[index], index, start: starts[index] ?? 0 };
        };

        const shaped = melody.map(event => {
            if (event.part !== 'melody') return event;
            const { chord, index, start } = chordAt(event.time);
            const func = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
            const nextChord = chords[index + 1] ?? null;
            const rootPc = ((chord.rootMidi % 12) + 12) % 12;
            const notePc = ((event.noteNumber % 12) + 12) % 12;
            const localScale = localScaleForChordContext(style, chord, func, musicKey, musicMode);
            const runScale = buildRunScale(localScale);
            const runScalePcs = new Set(runScale.map(m => ((m % 12) + 12) % 12));
            const contractPcs = melodyContractPcsForStyle(style, chord, rootPc);
            const beatInChord = event.time - start;
            const strongBeat = _strongBeats.some(sb => Math.abs(beatInChord - sb) < 0.08);
            const structural = strongBeat || event.duration >= 0.75;
            const inChordContract = contractPcs.has(notePc);
            const inRelativeScale = runScalePcs.has(notePc);
            const localScaleStrict = localScale.strict;
            const scaleContractPcs = new Set([...contractPcs].filter(pc => runScalePcs.has(pc)));
            const scaleIntersectionRequired = localScaleStrict || structural;
            const breaksLocalScaleContract = scaleIntersectionRequired && inChordContract && !inRelativeScale;
            const assessment = evaluateNoteInChordContext(
                notePc,
                chord.type,
                rootPc,
                func,
                nextChord?.type ?? null,
                nextChord ? ((nextChord.rootMidi % 12) + 12) % 12 : null,
                keyRootPc,
                chord.forcedScale,
                tonalCharacter === 'modal',
                runScalePcs,
                tonalCharacter,
                chord.localTonalCenterPc,
                modeFamily,
            );

            const breaksStyleHarmony = !inChordContract
                && (assessment.consonance === 'avoid' || structural);
            if (!breaksStyleHarmony && !breaksLocalScaleContract) return event;

            const snapPcs = localScaleStrict
                ? scaleContractPcs
                : (inRelativeScale ? contractPcs : scaleContractPcs);
            const snapped = snapMidiToNearestPcSet(event.noteNumber, snapPcs.size > 0 ? snapPcs : contractPcs, 8);
            if (snapped === event.noteNumber) return event;
            return { ...event, noteNumber: snapped };
        });

        const tightenHarmonyDecorations = (input: NoteEvent[]): NoteEvent[] => {
            const melodyOnly = input
                .filter(e => e.part === 'melody')
                .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
            return input.map(event => {
            if (event.part !== 'melody') return event;
            const { chord, start } = chordAt(event.time);
            const rootPc = ((chord.rootMidi % 12) + 12) % 12;
            const notePc = ((event.noteNumber % 12) + 12) % 12;
            const contractPcs = melodyContractPcsForStyle(style, chord, rootPc);
            const func = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
            const localScale = localScaleForChordContext(style, chord, func, musicKey, musicMode);
            const runScale = buildRunScale(localScale);
            const runScalePcs = new Set(runScale.map(m => ((m % 12) + 12) % 12));
            const localScaleStrict = localScale.strict;
            const scaleContractPcs = new Set([...contractPcs].filter(pc => runScalePcs.has(pc)));
            const beatInChord = event.time - start;
            const strongBeat = _strongBeats.some(sb => Math.abs(beatInChord - sb) < 0.08);
            const structural = strongBeat || event.duration >= 0.75;
            const scaleIntersectionRequired = localScaleStrict || structural;
            if (contractPcs.has(notePc) && runScalePcs.has(notePc)) return event;

            const melodyIndex = melodyOnly.findIndex(e => e === event);
            const prev = melodyIndex > 0 ? melodyOnly[melodyIndex - 1] : null;
            const next = melodyIndex >= 0 && melodyIndex < melodyOnly.length - 1 ? melodyOnly[melodyIndex + 1] : null;
            const requireBothContractSupport = style === 'POP' || style === 'LOFI' || style === 'RNB';
            const weakDecorationMaxStep = style === 'POP' || style === 'LOFI' || style === 'RNB' ? 2 : 3;
            const decorative = runScalePcs.has(notePc)
                ? isLofiWeakScaleDecoration(event, prev, next, runScalePcs, chordAt, style, weakDecorationMaxStep, requireBothContractSupport)
                : isLofiFastChromaticDecoration(event, prev, next, chordAt, style);
            if (!strongBeat && decorative) return event;

            const snapPcs = localScaleStrict
                ? scaleContractPcs
                : (runScalePcs.has(notePc) ? contractPcs : scaleContractPcs);
            const snapped = snapMidiToNearestPcSet(event.noteNumber, snapPcs.size > 0 ? snapPcs : contractPcs, style === 'POP' ? 12 : 5);
            if (snapped === event.noteNumber) return event;
            return { ...event, noteNumber: snapped };
            });
        };

        const thinSlashBassMelodyDoubles = (input: NoteEvent[]): NoteEvent[] => {
            const isProtectedResolutionLanding = (event: NoteEvent, chord: ChordDef, index: number, start: number, notePc: number): boolean => {
                if (index <= 0) return false;
                if (Math.abs(event.time - start) > 0.08) return false;

                const prevChord = chords[index - 1];
                const prevStart = starts[index - 1] ?? Math.max(0, start - (prevChord.duration ?? 4));
                const prevEnd = prevStart + (prevChord.duration ?? 4);
                const prevFunc = prevChord.effectiveFunc ?? getHarmonicFunction(prevChord.roman);
                const currentFunc = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
                const prevRootPc = ((prevChord.rootMidi % 12) + 12) % 12;
                const currentRootPc = ((chord.rootMidi % 12) + 12) % 12;
                const prevTail = input
                    .filter(e => e.part === 'melody'
                        && e.time >= prevStart - 0.001
                        && e.time < prevEnd - 0.001
                        && e.time >= prevEnd - 0.76
                        && e.time + e.duration >= prevEnd - 0.08)
                    .sort((a, b) => b.time - a.time || b.noteNumber - a.noteNumber)[0];

                if (prevTail) {
                    const prevRunScale = runScaleForChordContext(style, prevChord, prevFunc, musicKey, musicMode);
                    const prevRunScalePcs = new Set(prevRunScale.map(m => ((m % 12) + 12) % 12));
                    const assessment = evaluateNoteInChordContext(
                        ((prevTail.noteNumber % 12) + 12) % 12,
                        prevChord.type,
                        prevRootPc,
                        prevFunc,
                        chord.type,
                        currentRootPc,
                        keyRootPc,
                        prevChord.forcedScale,
                        tonalCharacter === 'modal',
                        prevRunScalePcs,
                        tonalCharacter,
                        prevChord.localTonalCenterPc,
                        modeFamily,
                    );
                    if (assessment.urgency >= UNRESOLVED_TENSION_THRESHOLD && assessment.resolutionTargets.includes(notePc)) {
                        return true;
                    }
                }

                const chordThird = chordThirdPc(chord);
                if (chordThird === null || notePc !== chordThird) return false;
                if (currentFunc !== 'T' && !['I', 'i'].includes(chord.roman.split('/')[0])) return false;

                const sourceHold = input.some(e => {
                    if (e.part !== 'melody') return false;
                    if (e.time < prevStart - 0.001 || e.time >= prevEnd - 0.001) return false;
                    if (e.duration < 1.5) return false;
                    return Math.abs(e.noteNumber - event.noteNumber) === 1;
                });
                return sourceHold;
            };

            return input.map(event => {
                if (event.part !== 'melody') return event;
                const { chord, index, start } = chordAt(event.time);
                const bassPc = ((chord.bassMidi % 12) + 12) % 12;
                const rootPc = ((chord.rootMidi % 12) + 12) % 12;
                if (bassPc === rootPc) return event;
                const notePc = ((event.noteNumber % 12) + 12) % 12;
                if (notePc !== bassPc) return event;
                if (isProtectedResolutionLanding(event, chord, index, start, notePc)) return event;

                const upperMidis = chord.notesMidi ?? chord.notes.map(n => noteToMidi(n));
                const upperPcs = [...new Set(upperMidis.map(m => ((m % 12) + 12) % 12))];
                const upperContainsBassPc = upperPcs.includes(bassPc);
                if (!upperContainsBassPc) return event;

                const func = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
                const localScale = localScaleForChordContext(style, chord, func, musicKey, musicMode);
                const runScale = buildRunScale(localScale);
                const runScalePcs = new Set(runScale.map(m => ((m % 12) + 12) % 12));
                const contractPcs = melodyContractPcsForStyle(style, chord, rootPc);
                const localScaleStrict = localScale.strict;
                const beatInChord = event.time - start;
                const strongBeat = _strongBeats.some(sb => Math.abs(beatInChord - sb) < 0.08);
                const structural = strongBeat || event.duration >= 0.75;
                if (!structural) return event;
                const keepRoll = stableUnitInterval(`${style}|${chord.chordSymbol ?? chord.roman}|${event.time.toFixed(3)}|${event.noteNumber}`);
                if (keepRoll < 0.30) return event;

                const requireScale = localScaleStrict || structural;
                const voicedTargets = upperPcs.filter(pc => pc !== bassPc && contractPcs.has(pc));
                const strictTargets = voicedTargets.filter(pc => !requireScale || runScalePcs.has(pc));
                const fallbackTargets = voicedTargets.length > 0
                    ? voicedTargets
                    : [...contractPcs].filter(pc => pc !== bassPc);
                const targetPcs = new Set(strictTargets.length > 0 ? strictTargets : fallbackTargets);
                const snapped = snapMidiToNearestPcSet(event.noteNumber, targetPcs, style === 'POP' ? 12 : 7);
                const snappedPc = ((snapped % 12) + 12) % 12;
                if (snapped === event.noteNumber || snappedPc === bassPc) return event;
                return { ...event, noteNumber: snapped };
            });
        };

        const consumeReturnLandings = (input: NoteEvent[]): NoteEvent[] => {
            const out = input.map(event => ({ ...event }));
            const returns = out
                .filter(event => event.part === 'melody' && event.origin === 'return')
                .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);

            for (const landing of returns) {
                for (let i = out.length - 1; i >= 0; i--) {
                    const event = out[i];
                    if (event === landing || event.part !== 'melody') continue;
                    if (event.time < landing.time - 0.001) {
                        if (event.time + event.duration <= landing.time + 0.08) continue;
                        event.duration = Math.max(0.25, landing.time - event.time);
                        continue;
                    }
                    if (!landing.lickSource || landing.duration < 1.25) continue;
                    if (event.origin === 'return') continue;
                    if (event.time <= landing.time + 0.001) continue;
                    if (event.time >= landing.time + landing.duration - 0.08) continue;
                    out.splice(i, 1);
                }
            }

            return out.sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
        };

        const tightened = tightenHarmonyDecorations(shaped);
        const paradigmed = applyLofiParadigm
            ? applyLofiCrawlHoldParadigm(tightened, chords, starts, musicKey, musicMode, tonalCharacter)
            : tightened;
        const resolved = applyMelodicResolutionParadigm(style, paradigmed, chords, starts, musicKey, musicMode, tonalCharacter);
        const finalTightened = tightenHarmonyDecorations(consumeReturnLandings(resolved));
        const registered = finalTightened.map(event => {
            if (event.part !== 'melody') return event;
            let noteNumber = event.noteNumber;
            while (noteNumber < MELODY_RANGE.LOW && noteNumber + 12 <= MELODY_RANGE.HIGH) noteNumber += 12;
            while (noteNumber > MELODY_RANGE.HIGH && noteNumber - 12 >= MELODY_RANGE.LOW) noteNumber -= 12;
            return noteNumber === event.noteNumber ? event : { ...event, noteNumber };
        });
        const harmonyTight = tightenHarmonyDecorations(registered);
        const bassThinned = thinSlashBassMelodyDoubles(harmonyTight);
        const anchored = applyLofiParadigm
            ? applyLofiTonicizationColorAnchors(bassThinned, chords, starts, musicKey, musicMode)
            : bassThinned;
        const shadowed = applyLofiParadigm
            ? applyLofiPhrygianBiiShadowMelody(anchored, chords, starts)
            : anchored;
        const lateResolved = applyMelodicResolutionParadigm(style, shadowed, chords, starts, musicKey, musicMode, tonalCharacter);
        return consumeReturnLandings(tightenHarmonyDecorations(thinSlashBassMelodyDoubles(lateResolved)));
    }
