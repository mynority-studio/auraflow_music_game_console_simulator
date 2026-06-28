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
    export function melodicIntervalClass(fromMidi: number, toMidi: number): number {
        const semitones = Math.abs(toMidi - fromMidi) % 12;
        return Math.min(semitones, 12 - semitones);
    }
    export function chordSeventhPc(chord: ChordDef): number | null {
        const intervals = CHORD_TYPES[chord.type] ?? [];
        const seventh = intervals.includes(11) ? 11 : intervals.includes(10) ? 10 : null;
        if (seventh === null) return null;
        return (((chord.rootMidi % 12) + seventh) % 12 + 12) % 12;
    }
    export function chordFifthPc(chord: ChordDef): number | null {
        const intervals = CHORD_TYPES[chord.type] ?? [];
        const fifth = intervals.includes(7) ? 7 : null;
        if (fifth === null) return null;
        return (((chord.rootMidi % 12) + fifth) % 12 + 12) % 12;
    }
    export function isJpop456DeceptiveResolution(style: StyleName, sourceChord: ChordDef, sourceFunc: 'T' | 'S' | 'D', targetChord: ChordDef): boolean {
        if (style !== 'ACG' || sourceFunc !== 'D') return false;
        const sourceBase = sourceChord.roman.split('/')[0].replace(/^[b#n]+/, '');
        const targetBase = targetChord.roman.split('/')[0].replace(/^[b#n]+/, '');
        if (sourceBase !== 'V' || targetBase !== 'vi') return false;
        const sourceRootPc = ((sourceChord.rootMidi % 12) + 12) % 12;
        const targetRootPc = ((targetChord.rootMidi % 12) + 12) % 12;
        return ((targetRootPc - sourceRootPc + 12) % 12) === 2;
    }
    export function isRnbFloatingTonicNinth(style: StyleName, notePc: number, chord: ChordDef, func: 'T' | 'S' | 'D'): boolean {
        if (style !== 'RNB' || func !== 'T') return false;
        const baseRoman = chord.roman.split('/')[0].replace(/^[b#n]+/, '');
        if (baseRoman !== 'I' && baseRoman !== 'i') return false;
        const rootPc = ((chord.rootMidi % 12) + 12) % 12;
        if (((notePc - rootPc + 12) % 12) !== 2) return false;
        const intervals = CHORD_TYPES[chord.type] ?? [];
        return intervals.some((iv) => ((iv % 12) + 12) % 12 === 2);
    }
    export function boundaryResolutionThreshold(style: StyleName): number {
        if (style === 'LOFI') return 0.40;
        if (style === 'POP') return 0.45;
        if (style === 'RNB') return 0.50;
        if (style === 'JAZZ') return 0.50;
        return UNRESOLVED_TENSION_THRESHOLD;
    }
    export function guideToneThirdProbability(style: StyleName): number {
        if (style === 'POP') return 0.80;
        if (style === 'LOFI') return 0.65;
        if (style === 'JAZZ') return 0.50;
        if (style === 'RNB') return 0.40;
        if (style === 'ACG') return 0.25;
        return 0.60;
    }
    export function styleGuideToneTargetPc(style: StyleName, targetChord: ChordDef, referenceMidi: number, label: string): number | null {
        const thirdPc = chordThirdPc(targetChord);
        const seventhPc = chordSeventhPc(targetChord);
        if (thirdPc === null) return seventhPc;
        if (seventhPc === null) return thirdPc;
        const roll = stableUnitInterval(`voiceleading-guide-tone|${style}|${targetChord.chordSymbol ?? targetChord.roman}|${referenceMidi}|${label}`);
        return roll < guideToneThirdProbability(style) ? thirdPc : seventhPc;
    }
    export function isGuideToneCompatibleWithNextBrickFirst(candidateMidi: number, nextBrickFirstMidi?: number | null): boolean {
        if (nextBrickFirstMidi === undefined || nextBrickFirstMidi === null) return true;
        const distance = Math.abs(candidateMidi - nextBrickFirstMidi);
        if (distance <= 2) return true;
        const intervalClass = melodicIntervalClass(candidateMidi, nextBrickFirstMidi);
        return intervalClass === 0 || intervalClass === 3 || intervalClass === 4 || intervalClass === 5;
    }
    export function guideTonePreferenceScore(style: StyleName, candidatePc: number, candidateMidi: number, selectedGuideTonePc: number | null, guideTonePcs: Set<number>, nextBrickFirstMidi?: number | null): number {
        if (!guideTonePcs.has(candidatePc)) return 0;
        if (!isGuideToneCompatibleWithNextBrickFirst(candidateMidi, nextBrickFirstMidi)) return 0;
        const selectedBonusByStyle: Record<StyleName, number> = { POP: -10, JAZZ: -5, LOFI: -7, RNB: -6, ACG: -3, BLUES: -4 };
        const selected = selectedGuideTonePc !== null && candidatePc === selectedGuideTonePc;
        const hasBrickReference = nextBrickFirstMidi !== undefined && nextBrickFirstMidi !== null;
        const scale = hasBrickReference ? 1 : 0.45;
        const base = selected ? selectedBonusByStyle[style] ?? -5 : Math.round((selectedBonusByStyle[style] ?? -5) * 0.45);
        return base * scale;
    }
    export function chooseTargetChordSuspensionResolution(
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
    export function chooseLongResolutionTarget(
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
    export function chooseMelodicResolutionConnector(sourceMidi: number, targetMidi: number, targetPc: number, legalTargetPcs: Set<number>, style: StyleName): number | null {
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
// ============================================================
// ★ MG full-parity Phase C-2(2026-06-28):post-shaper 生产链 + boundary VL helper 港自当前 MG musicEngine.ts
//   (3516-3762 helper · 5045-6078 4 主函数)。机械改写:X→X · private→function · songMeterContext.beatsPerMeasure→4。
//   复用本模块已有 G9 helper(getHarmonicFunction/chordThirdPc/snapMidiToNearestPcSet/chooseLongResolutionTarget/…)。
// ============================================================

    function isBoundaryMetaphorDissonance(fromMidi: number, toMidi: number): boolean {
        const ic = melodicIntervalClass(fromMidi, toMidi);
        return ic === 1 || ic === 6;
    }

    function boundaryLeapLimit(style: StyleName): number {
        if (style === 'JAZZ') return 10;
        if (style === 'ACG') return 12;
        if (style === 'RNB') return 7;
        if (style === 'POP' || style === 'LOFI') return 8;
        return 9;
    }

    function boundaryConnectorSegmentLimit(style: StyleName): number {
        if (style === 'JAZZ') return 8;
        if (style === 'ACG') return 9;
        return 7;
    }

    function melodyBrickBoundaryInfos(events: NoteEvent[], songEnd: number): MelodyBrickBoundaryInfo[] {
        const audibleMelody = events
            .filter(event => event.part === 'melody' && event.duration > 0)
            .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
        const melody = events
            .filter(event => event.part === 'melody'
                && event.duration > 0
                && event.brickIndex !== undefined)
            .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
        if (melody.length <= 1) return [];

        const segments: Array<{ brickIndex: number; events: NoteEvent[] }> = [];
        for (const event of melody) {
            const brickIndex = event.brickIndex;
            if (brickIndex === undefined) continue;
            const last = segments[segments.length - 1];
            if (!last || last.brickIndex !== brickIndex) {
                segments.push({ brickIndex, events: [event] });
            } else {
                last.events.push(event);
            }
        }

        const out: MelodyBrickBoundaryInfo[] = [];
        for (let i = 1; i < segments.length; i++) {
            const sourceEvents = segments[i - 1].events;
            const targetEvents = segments[i].events;
            const brickPrev = sourceEvents[sourceEvents.length - 1];
            const next = targetEvents[0];
            if (!brickPrev || !next) continue;
            const boundary = next.time;
            if (boundary <= 0.001 || boundary >= songEnd - 0.001) continue;
            const sourceStart = sourceEvents[0]?.brickStartBeat
                ?? sourceEvents[0]?.time
                ?? Math.max(0, boundary - 4);
            const prev = audibleMelody
                .filter(event => event.time < boundary - 0.001
                    && event.time >= Math.max(sourceStart, brickPrev.time) - 0.001)
                .sort((a, b) => b.time - a.time || b.noteNumber - a.noteNumber)[0]
                ?? brickPrev;
            const sourceEnd = brickPrev.brickEndBeat ?? boundary;
            const targetStart = next.brickStartBeat ?? next.time;
            const lastTarget = targetEvents[targetEvents.length - 1];
            const targetEnd = next.brickEndBeat
                ?? (lastTarget ? lastTarget.time + lastTarget.duration : next.time + next.duration);
            out.push({
                boundary,
                prev,
                next,
                sourceStart: Math.max(0, sourceStart),
                sourceEnd: Math.max(sourceEnd, boundary),
                targetStart,
                targetEnd: Math.min(songEnd, Math.max(targetEnd, next.time + next.duration)),
            });
        }
        return out;
    }

    function candidateMidisForPcNear(pc: number, idealMidi: number, radius = 18): number[] {
        const normalizedPc = ((pc % 12) + 12) % 12;
        const out: number[] = [];
        for (let midi = MELODY_RANGE.LOW; midi <= MELODY_RANGE.HIGH; midi++) {
            if (((midi % 12) + 12) % 12 !== normalizedPc) continue;
            if (Math.abs(midi - idealMidi) > radius) continue;
            out.push(midi);
        }
        return out.sort((a, b) => Math.abs(a - idealMidi) - Math.abs(b - idealMidi)).slice(0, 4);
    }

    function chooseBoundarySourceMidi(
        originalMidi: number,
        landingMidi: number,
        legalSourcePcs: Set<number>,
        style: StyleName,
    ): number | null {
        const maxSourceMove = style === 'JAZZ' ? 8 : style === 'ACG' ? 8 : 12;
        const candidates = [...legalSourcePcs]
            .flatMap(pc => candidateMidisForPcNear(pc, originalMidi, maxSourceMove))
            .filter((midi, idx, arr) => arr.indexOf(midi) === idx);
        let best: { midi: number; score: number } | null = null;
        for (const midi of candidates) {
            const sourceMove = Math.abs(midi - originalMidi);
            if (sourceMove > maxSourceMove) continue;
            const landingDistance = Math.abs(landingMidi - midi);
            const ic = melodicIntervalClass(midi, landingMidi);
            let score = sourceMove * 2 + landingDistance * 1.4;
            score += Math.max(0, landingDistance - boundaryLeapLimit(style)) * 8;
            if (landingDistance <= boundaryLeapLimit(style)) score -= 10;
            if (ic === 6) score += 1000;
            if (ic === 1) score += 500;
            if (landingDistance <= 4 && ic !== 1 && ic !== 6) score -= 12;
            if (midi === originalMidi && ic !== 1 && ic !== 6) score -= 3;
            if (!best || score < best.score) best = { midi, score };
        }
        if (!best) return null;
        return best.midi;
    }

    function chooseBoundaryLandingMidi(
        originalLandingMidi: number,
        sourceMidi: number,
        legalLandingPcs: Set<number>,
        style: StyleName,
        targetChord?: ChordDef,
        label: string = 'boundary-landing',
    ): number | null {
        const maxLandingMove = style === 'JAZZ' || style === 'ACG' ? 8 : 12;
        const candidates = [...legalLandingPcs]
            .flatMap(pc => candidateMidisForPcNear(pc, originalLandingMidi, maxLandingMove))
            .filter((midi, idx, arr) => arr.indexOf(midi) === idx);
        const targetThirdPc = targetChord ? chordThirdPc(targetChord) : null;
        const targetSeventhPc = targetChord ? chordSeventhPc(targetChord) : null;
        const guideTonePc = targetChord
            ? styleGuideToneTargetPc(style, targetChord, sourceMidi, label)
            : null;
        const guideTonePcs = new Set([targetThirdPc, targetSeventhPc].filter((pc): pc is number => pc !== null));
        let best: { midi: number; score: number } | null = null;
        for (const midi of candidates) {
            const landingMove = Math.abs(midi - originalLandingMidi);
            if (landingMove > maxLandingMove) continue;
            const sourceDistance = Math.abs(midi - sourceMidi);
            const ic = melodicIntervalClass(sourceMidi, midi);
            const midiPc = ((midi % 12) + 12) % 12;
            let score = landingMove * 2.2 + sourceDistance * 1.4;
            score += guideTonePreferenceScore(
                style,
                midiPc,
                midi,
                guideTonePc,
                guideTonePcs,
                originalLandingMidi,
            );
            score += Math.max(0, sourceDistance - boundaryLeapLimit(style)) * 8;
            if (sourceDistance <= boundaryLeapLimit(style)) score -= 10;
            if (ic === 6) score += 1000;
            if (ic === 1) score += 500;
            if (sourceDistance <= 4 && ic !== 1 && ic !== 6) score -= 12;
            if (midi === originalLandingMidi && ic !== 1 && ic !== 6) score -= 3;
            if (!best || score < best.score) best = { midi, score };
        }
        return best?.midi ?? null;
    }

    function chooseBoundaryVoiceLeadingConnectors(
        sourceMidi: number,
        landingMidi: number,
        sourceLegalPcs: Set<number>,
        landingLegalPcs: Set<number>,
        style: StyleName,
    ): number[] {
        const direct = landingMidi - sourceMidi;
        const directDistance = Math.abs(direct);
        const leapLimit = boundaryLeapLimit(style);
        const needsBridge = directDistance > leapLimit || isBoundaryMetaphorDissonance(sourceMidi, landingMidi);
        if (!needsBridge || directDistance === 0 || sourceLegalPcs.size === 0) return [];

        const segmentLimit = boundaryConnectorSegmentLimit(style);
        const commonPcs = [...sourceLegalPcs].filter(pc => landingLegalPcs.has(pc));
        const connectorPcs = [...new Set([...commonPcs, ...sourceLegalPcs])];
        const pathLengths = directDistance > leapLimit + 4 ? [2, 1] : [1, 2];
        const direction = Math.sign(direct);
        let best: { path: number[]; score: number } | null = null;

        const evaluatePath = (path: number[]): number | null => {
            const seq = [sourceMidi, ...path, landingMidi];
            let score = 0;
            for (let i = 1; i < seq.length; i++) {
                const prev = seq[i - 1];
                const curr = seq[i];
                const interval = curr - prev;
                const distance = Math.abs(interval);
                if (distance === 0 && i < seq.length - 1) return null;
                if (distance > segmentLimit) return null;
                if (melodicIntervalClass(prev, curr) === 6) return null;
                if (melodicIntervalClass(prev, curr) === 1 && i === seq.length - 1) return null;
                if (directDistance > leapLimit && Math.sign(interval) !== direction) score += 18;
                if (distance >= directDistance && directDistance > leapLimit) return null;
                score += distance * (i === seq.length - 1 ? 2.2 : 1.5);
                if (distance <= 2) score -= 6;
                if (distance <= 4) score -= 2;
                if (melodicIntervalClass(prev, curr) === 1) score += 14;
            }
            for (const midi of path) {
                const pc = ((midi % 12) + 12) % 12;
                if (landingLegalPcs.has(pc)) score -= 12;
                if (commonPcs.includes(pc)) score -= 10;
            }
            const lastToLanding = Math.abs(landingMidi - path[path.length - 1]);
            if (lastToLanding <= 2) score -= 10;
            return score;
        };

        for (const pathLength of pathLengths) {
            const positions: number[][] = [];
            for (let i = 0; i < pathLength; i++) {
                const ideal = sourceMidi + (direct * (i + 1)) / (pathLength + 1);
                const candidates = connectorPcs
                    .flatMap(pc => candidateMidisForPcNear(pc, ideal))
                    .filter((midi, idx, arr) => arr.indexOf(midi) === idx)
                    .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))
                    .slice(0, 14);
                if (candidates.length === 0) {
                    positions.length = 0;
                    break;
                }
                positions.push(candidates);
            }
            if (positions.length !== pathLength) continue;

            const visit = (idx: number, path: number[]) => {
                if (idx === positions.length) {
                    const score = evaluatePath(path);
                    if (score === null) return;
                    if (!best || score < best.score) best = { path: [...path], score };
                    return;
                }
                for (const midi of positions[idx]) {
                    if (path.includes(midi)) continue;
                    visit(idx + 1, [...path, midi]);
                }
            };
            visit(0, []);
        }

        return best?.path ?? [];
    }


interface MelodyBrickBoundaryInfo {
  boundary: number;
  prev: NoteEvent;
  next: NoteEvent;
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
}
    export function enforceMonophonicMelody(melody: NoteEvent[]): NoteEvent[] {
        const sorted = melody
            .filter(event => event.part === 'melody')
            .map(event => ({ ...event }))
            .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
        const out: NoteEvent[] = [];
        const eventPriority = (event: NoteEvent) =>
            (event.origin === 'return' ? 4 : 0)
            + Math.min(2, event.duration)
            + event.velocity / 127;

        for (const event of sorted) {
            if (event.duration <= 0) continue;
            const last = out[out.length - 1];
            if (!last) {
                out.push(event);
                continue;
            }

            if (Math.abs(event.time - last.time) < 0.001) {
                if (eventPriority(event) >= eventPriority(last)) {
                    out[out.length - 1] = event;
                }
                continue;
            }

            const lastEnd = last.time + last.duration;
            if (event.time < lastEnd - 0.001) {
                const clipped = event.time - last.time;
                if (clipped >= 0.05) {
                    last.duration = clipped;
                } else if (eventPriority(event) > eventPriority(last)) {
                    out[out.length - 1] = event;
                    continue;
                } else {
                    continue;
                }
            }

            out.push(event);
        }

        return out;
    }

    export function applyMelodyBoundaryVoiceLeadingContract(
        events: NoteEvent[],
        chords: ChordDef[],
        style: StyleName,
        musicKey: string,
        musicMode: string,
        tonalCharacter: 'tonal' | 'modal',
    ): NoteEvent[] {
        if (chords.length <= 1) return events;
        const beatsPerMeasure = 4;
        const starts: number[] = [];
        let songEnd = 0;
        for (const chord of chords) {
            starts.push(songEnd);
            songEnd += chord.duration ?? beatsPerMeasure;
        }

        const pcOf = (midi: number): number => ((midi % 12) + 12) % 12;
        const chordIndexAt = (time: number): number => {
            const clamped = Math.max(0, Math.min(songEnd - 0.001, time));
            for (let i = starts.length - 1; i >= 0; i--) {
                if (clamped >= starts[i] - 0.001) return i;
            }
            return 0;
        };
        const legalMelodyPcs = (chord: ChordDef): Set<number> => {
            const func = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
            const rootPc = pcOf(chord.rootMidi);
            const contract = melodyContractPcsForStyle(style, chord, rootPc);
            const localScale = localScaleForChordContext(style, chord, func, musicKey, musicMode);
            const strict = new Set([...contract].filter(pc => localScale.pcs.has(pc)));
            return strict.size > 0 ? strict : contract;
        };
        const sourceHoldDuration = (): number => {
            if (style === 'RNB') return 2.0;
            if (style === 'LOFI') return 1.75;
            if (style === 'POP') return 1.5;
            if (style === 'ACG') return 2.25;
            if (style === 'JAZZ') return 1.0;
            return 1.5;
        };
        const landingHoldDuration = (): number => {
            if (style === 'RNB') return 1.0;
            if (style === 'LOFI') return 1.25;
            if (style === 'POP') return 1.0;
            if (style === 'ACG') return 1.5;
            if (style === 'JAZZ') return 0.67;
            return 1.0;
        };
        const melodyAt = (list: NoteEvent[], start: number, end: number): NoteEvent[] =>
            list
                .filter(event => event.part === 'melody'
                    && event.time >= start - 0.001
                    && event.time < end - 0.001
                    && event.duration > 0)
                .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
        let out = events.map(event => ({ ...event }));
        const isRecognizedBoundaryResolution = (
            sourceMidi: number,
            landingMidi: number,
            sourceChord: ChordDef,
            sourceFunc: 'T' | 'S' | 'D',
            targetChord: ChordDef,
            targetFunc: 'T' | 'S' | 'D',
        ): boolean => {
            if (melodicIntervalClass(sourceMidi, landingMidi) !== 1) return false;
            const keyRootPc = pcOf(noteToMidi(musicKey + '0'));
            const modeFamily = modeToKeyFamily(musicMode);
            const sourceRootPc = pcOf(sourceChord.rootMidi);
            const targetRootPc = pcOf(targetChord.rootMidi);
            const sourceScale = localScaleForChordContext(style, sourceChord, sourceFunc, musicKey, musicMode);
            const assessment = evaluateNoteInChordContext(
                pcOf(sourceMidi),
                sourceChord.type,
                sourceRootPc,
                sourceFunc,
                targetChord.type,
                targetRootPc,
                keyRootPc,
                sourceChord.forcedScale,
                tonalCharacter === 'modal',
                sourceScale.pcs,
                tonalCharacter,
                sourceChord.localTonalCenterPc,
                modeFamily,
            );
            return assessment.urgency >= boundaryResolutionThreshold(style)
                && assessment.resolutionTargets.includes(pcOf(landingMidi));
        };

        for (const boundaryInfo of melodyBrickBoundaryInfos(out, songEnd)) {
            const boundary = boundaryInfo.boundary;
            const prevIndex = chordIndexAt(boundaryInfo.prev.time + 0.001);
            const nextIndex = chordIndexAt(boundaryInfo.next.time + 0.001);
            const prevChord = chords[prevIndex];
            const nextChord = chords[nextIndex];
            if (!prevChord || !nextChord) continue;

            const prevFunc = prevChord.effectiveFunc ?? getHarmonicFunction(prevChord.roman);
            const nextFunc = nextChord.effectiveFunc ?? getHarmonicFunction(nextChord.roman);
            const nextStart = starts[nextIndex] ?? boundary;
            const chordNextEnd = nextStart + (nextChord.duration ?? beatsPerMeasure);
            const nextEnd = Math.min(chordNextEnd, Math.max(boundaryInfo.targetEnd, boundary + 0.25));
            const sourceWindowStart = boundaryInfo.sourceStart;
            const prevLegal = legalMelodyPcs(prevChord);
            const nextLegal = legalMelodyPcs(nextChord);
            if (prevLegal.size === 0 || nextLegal.size === 0) continue;

            const currentMelody = out
                .filter(event => event.part === 'melody')
                .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
            const sourceEvents = melodyAt(currentMelody, sourceWindowStart, boundary);
            const existingTail = sourceEvents[sourceEvents.length - 1] ?? null;
            if (!existingTail) continue;
            if (existingTail.origin === 'motif') continue;
            const isBrickBoundaryTail = existingTail === boundaryInfo.prev
                || (existingTail.brickIndex !== undefined
                    && existingTail.brickIndex === boundaryInfo.prev.brickIndex
                    && Math.abs(existingTail.time - boundaryInfo.prev.time) < 0.001);
            const canMutateSource = existingTail.origin === 'return'
                || existingTail.grammarSlopeRole === 'last'
                || (isBrickBoundaryTail && existingTail.grammarSlopeRole !== 'inside');

            const protectedLanding = melodyAt(out, boundary, Math.min(nextEnd, boundary + 0.12))
                .find(event => event.origin === 'return'
                    && event.duration >= (style === 'JAZZ' ? 0.67 : 1.0)
                    && nextLegal.has(pcOf(event.noteNumber))) ?? null;
            const protectedTarget = protectedLanding
                ? { pc: pcOf(protectedLanding.noteNumber), midi: protectedLanding.noteNumber }
                : null;
            const early = melodyAt(out, boundary, Math.min(nextEnd, boundary + 1.01))[0] ?? null;
            const passiveTarget = early && nextLegal.has(pcOf(early.noteNumber))
                ? { pc: pcOf(early.noteNumber), midi: early.noteNumber }
                : null;
            let targetIsExistingMelody = protectedTarget !== null || passiveTarget !== null;
            let sourceMidi = existingTail.noteNumber;
            if (!prevLegal.has(pcOf(sourceMidi))) {
                const snapped = snapMidiToNearestPcSet(sourceMidi, prevLegal, 14);
                if (canMutateSource && prevLegal.has(pcOf(snapped))) {
                    sourceMidi = snapped;
                }
            }
            if (!prevLegal.has(pcOf(sourceMidi))) continue;

            const forcedResolutionTarget = chooseTargetChordSuspensionResolution(
                style,
                sourceMidi,
                nextChord,
                nextFunc,
                musicKey,
                musicMode,
                tonalCharacter,
                {
                    maxDistance: style === 'LOFI' ? 16 : style === 'JAZZ' ? 12 : 14,
                    preferredPc: chordThirdPc(nextChord),
                    minUrgency: boundaryResolutionThreshold(style),
                    guideReferenceMidi: early?.noteNumber ?? boundaryInfo.next.noteNumber,
                },
            );
            const earlyCanRetarget = early
                && Math.abs(early.time - boundary) < 0.12
                && early.origin !== 'motif'
                && ((early.origin === 'return' && early.grammarSlopeRole !== 'inside') || early.grammarSlopeRole === 'last');
            let retargetedEarlyTarget: { pc: number; midi: number } | null = null;
            if (
                forcedResolutionTarget
                && early
                && pcOf(early.noteNumber) !== forcedResolutionTarget.pc
                && earlyCanRetarget
            ) {
                early.noteNumber = forcedResolutionTarget.midi;
                early.origin = 'return';
                early.lickSource = true;
                early.duration = Math.max(
                    early.duration,
                    Math.max(0.25, Math.min(landingHoldDuration(), nextEnd - boundary)),
                );
                targetIsExistingMelody = true;
                retargetedEarlyTarget = { pc: forcedResolutionTarget.pc, midi: forcedResolutionTarget.midi };
            }

            let target = retargetedEarlyTarget
                ?? protectedTarget
                ?? (forcedResolutionTarget ? { pc: forcedResolutionTarget.pc, midi: forcedResolutionTarget.midi } : null)
                ?? passiveTarget
                ?? chooseLongResolutionTarget(
                style,
                sourceMidi,
                prevChord,
                prevFunc,
                nextChord,
                nextFunc,
                musicKey,
                musicMode,
                tonalCharacter,
                {
                    maxDistance: style === 'JAZZ' ? 7 : 9,
                    preferredPc: chordThirdPc(nextChord),
                    guideReferenceMidi: early?.noteNumber ?? boundaryInfo.next.noteNumber,
                },
            );
            if (!target) {
                target = chooseLongResolutionTarget(
                    style,
                    sourceMidi,
                    prevChord,
                    prevFunc,
                    nextChord,
                    nextFunc,
                    musicKey,
                    musicMode,
                    tonalCharacter,
                    {
                        maxDistance: 14,
                        preferredPc: chordThirdPc(nextChord),
                        guideReferenceMidi: early?.noteNumber ?? boundaryInfo.next.noteNumber,
                    },
                );
            }
            if (!target) continue;

            let directDistance = Math.abs(target.midi - sourceMidi);
            let directMetaphorBad = isBoundaryMetaphorDissonance(sourceMidi, target.midi)
                && !isRecognizedBoundaryResolution(sourceMidi, target.midi, prevChord, prevFunc, nextChord, nextFunc);
            if (canMutateSource && (directDistance > boundaryLeapLimit(style) || directMetaphorBad)) {
                const smootherSource = chooseBoundarySourceMidi(sourceMidi, target.midi, prevLegal, style)
                    ?? snapMidiToNearestPcSet(target.midi, prevLegal, 12);
                if (prevLegal.has(pcOf(smootherSource))) {
                    sourceMidi = smootherSource;
                    const smootherTarget = retargetedEarlyTarget ?? protectedTarget ?? chooseLongResolutionTarget(
                        style,
                        sourceMidi,
                        prevChord,
                        prevFunc,
                        nextChord,
                        nextFunc,
                        musicKey,
                        musicMode,
                        tonalCharacter,
                        {
                            maxDistance: style === 'JAZZ' ? 7 : 9,
                            preferredPc: chordThirdPc(nextChord),
                            guideReferenceMidi: early?.noteNumber ?? boundaryInfo.next.noteNumber,
                        },
                    );
                    if (smootherTarget) target = smootherTarget;
                    directDistance = Math.abs(target.midi - sourceMidi);
                    directMetaphorBad = isBoundaryMetaphorDissonance(sourceMidi, target.midi)
                        && !isRecognizedBoundaryResolution(sourceMidi, target.midi, prevChord, prevFunc, nextChord, nextFunc);
                }
            }

            const desiredSource = Math.min(sourceHoldDuration(), boundary - sourceWindowStart);
            if (desiredSource < 0.5) continue;
            const connectors = (!directMetaphorBad && directDistance <= boundaryLeapLimit(style))
                ? []
                : chooseBoundaryVoiceLeadingConnectors(sourceMidi, target.midi, prevLegal, nextLegal, style);
            const connectorDuration = style === 'JAZZ' ? 0.18 : 0.24;
            const connectorTimes = connectors.length === 2
                ? [boundary - (style === 'JAZZ' ? 0.52 : 0.62), boundary - (style === 'JAZZ' ? 0.28 : 0.32)]
                : connectors.length === 1
                    ? [boundary - (style === 'JAZZ' ? 0.28 : 0.34)]
                    : [];
            const firstConnectorTime = connectorTimes[0] ?? null;
            const canPlaceConnectors = connectors.length > 0
                && firstConnectorTime !== null
                && firstConnectorTime > sourceWindowStart + 0.08
                && firstConnectorTime > existingTail.time + 0.16
                && (
                    canMutateSource
                    || existingTail.time + existingTail.duration <= firstConnectorTime - 0.035
                );

            if (canMutateSource) {
                existingTail.noteNumber = sourceMidi;
            }

            const maxSourceEnd = canPlaceConnectors && firstConnectorTime !== null
                ? firstConnectorTime - 0.035
                : boundary;
            const desiredEnd = Math.min(maxSourceEnd, existingTail.time + desiredSource);
            if (canMutateSource && desiredEnd > existingTail.time + existingTail.duration + 0.05) {
                existingTail.duration = desiredEnd - existingTail.time;
            }
            if (canMutateSource && existingTail.time + existingTail.duration > maxSourceEnd + 0.001) {
                existingTail.duration = Math.max(0.12, maxSourceEnd - existingTail.time);
            }
            if (canPlaceConnectors) {
                connectors.forEach((midi, idx) => {
                    const t = connectorTimes[idx];
                    const nextT = connectorTimes[idx + 1] ?? boundary;
                    const d = Math.max(0.12, Math.min(connectorDuration, nextT - t - 0.035));
                    if (d <= 0.08) return;
                    out.push({
                        noteNumber: midi,
                        time: t,
                        duration: d,
                        velocity: Math.max(58, Math.min(96, existingTail.velocity - 8 + idx * 2)),
                        part: 'melody',
                        origin: 'return',
                        lickSource: true,
                        brickIndex: boundaryInfo.prev.brickIndex,
                        brickStartBeat: boundaryInfo.prev.brickStartBeat,
                        brickEndBeat: boundaryInfo.prev.brickEndBeat,
                        brickName: boundaryInfo.prev.brickName,
                        brickFamily: boundaryInfo.prev.brickFamily,
                    });
                });
            }
            if (!targetIsExistingMelody && !early) {
                const d = Math.max(0.25, Math.min(landingHoldDuration(), nextEnd - boundary));
                out.push({
                    noteNumber: target.midi,
                    time: boundary,
                    duration: d,
                    velocity: Math.max(72, Math.min(104, existingTail.velocity)),
                    part: 'melody',
                    origin: 'return',
                    lickSource: true,
                    brickIndex: boundaryInfo.next.brickIndex,
                    brickStartBeat: boundaryInfo.next.brickStartBeat,
                    brickEndBeat: boundaryInfo.next.brickEndBeat,
                    brickName: boundaryInfo.next.brickName,
                    brickFamily: boundaryInfo.next.brickFamily,
                });
            }
            if (protectedLanding) {
                const maxLandingDuration = Math.max(0.25, Math.min(landingHoldDuration(), nextEnd - boundary));
                protectedLanding.duration = Math.max(protectedLanding.duration, maxLandingDuration);
            }
        }

        const chordAtForDecoration = (time: number): { chord: ChordDef; start: number } => {
            const index = chordIndexAt(time);
            return { chord: chords[index], start: starts[index] ?? 0 };
        };
        const melodyBeforeTighten = out
            .filter(event => event.part === 'melody')
            .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
        out = out.map(event => {
            if (event.part !== 'melody') return event;
            const { chord } = chordAtForDecoration(event.time);
            const legal = legalMelodyPcs(chord);
            const notePc = pcOf(event.noteNumber);
            if (legal.has(notePc)) return event;
            if (event.origin !== 'return' && event.grammarSlopeRole !== 'last') return event;

            const func = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
            const localScale = localScaleForChordContext(style, chord, func, musicKey, musicMode);
            const melodyIndex = melodyBeforeTighten.findIndex(candidate => candidate === event);
            const prev = melodyIndex > 0 ? melodyBeforeTighten[melodyIndex - 1] : null;
            const next = melodyIndex >= 0 && melodyIndex < melodyBeforeTighten.length - 1
                ? melodyBeforeTighten[melodyIndex + 1]
                : null;
            const weakScaleDecoration = isLofiWeakScaleDecoration(
                event,
                prev,
                next,
                localScale.pcs,
                chordAtForDecoration,
                style,
                style === 'JAZZ' ? 3 : 2,
                style === 'POP' || style === 'LOFI' || style === 'RNB',
            );
            const fastChromaticDecoration = isLofiFastChromaticDecoration(
                event,
                prev,
                next,
                chordAtForDecoration,
                style,
            );
            if (weakScaleDecoration || fastChromaticDecoration) return event;

            const snapped = snapMidiToNearestPcSet(event.noteNumber, legal, style === 'JAZZ' ? 7 : 12);
            return legal.has(pcOf(snapped)) ? { ...event, noteNumber: snapped } : event;
        });

        for (const boundaryInfo of melodyBrickBoundaryInfos(out, songEnd)) {
            const boundary = boundaryInfo.boundary;
            const prevIndex = chordIndexAt(boundaryInfo.prev.time + 0.001);
            const nextIndex = chordIndexAt(boundaryInfo.next.time + 0.001);
            const prevChord = chords[prevIndex];
            const nextChord = chords[nextIndex];
            if (!prevChord || !nextChord) continue;
            const prevFunc = prevChord.effectiveFunc ?? getHarmonicFunction(prevChord.roman);
            const nextFunc = nextChord.effectiveFunc ?? getHarmonicFunction(nextChord.roman);
            const nextStart = starts[nextIndex] ?? boundary;
            const chordNextEnd = nextStart + (nextChord.duration ?? beatsPerMeasure);
            const nextEnd = Math.min(chordNextEnd, Math.max(boundaryInfo.targetEnd, boundary + 0.25));
            const currentMelody = out
                .filter(event => event.part === 'melody')
                .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
            const prev = melodyAt(currentMelody, boundaryInfo.sourceStart, boundary)
                .sort((a, b) => b.time - a.time || b.noteNumber - a.noteNumber)[0] ?? null;
            const next = melodyAt(currentMelody, boundary, Math.min(nextEnd, boundary + 1.01))[0] ?? null;
            if (!prev || !next || prev.origin === 'motif') continue;
            const badRelation = isBoundaryMetaphorDissonance(prev.noteNumber, next.noteNumber)
                && !isRecognizedBoundaryResolution(prev.noteNumber, next.noteNumber, prevChord, prevFunc, nextChord, nextFunc);
            const largeLeap = Math.abs(next.noteNumber - prev.noteNumber) > boundaryLeapLimit(style);
            if (!badRelation && !largeLeap) continue;

            const isBoundaryTail = prev === boundaryInfo.prev
                || (prev.brickIndex !== undefined
                    && prev.brickIndex === boundaryInfo.prev.brickIndex
                    && Math.abs(prev.time - boundaryInfo.prev.time) < 0.001);
            const canMutate = prev.origin === 'return'
                || prev.grammarSlopeRole === 'last'
                || (isBoundaryTail && prev.grammarSlopeRole !== 'inside');
            if (!canMutate) continue;

            const prevLegal = legalMelodyPcs(prevChord);
            const replacement = chooseBoundarySourceMidi(prev.noteNumber, next.noteNumber, prevLegal, style);
            if (replacement === null) continue;
            if (!prevLegal.has(pcOf(replacement))) continue;
            if (largeLeap && Math.abs(next.noteNumber - replacement) >= Math.abs(next.noteNumber - prev.noteNumber)) continue;
            if (isBoundaryMetaphorDissonance(replacement, next.noteNumber)
                && !isRecognizedBoundaryResolution(replacement, next.noteNumber, prevChord, prevFunc, nextChord, nextFunc)) {
                continue;
            }
            prev.noteNumber = replacement;
        }

        const melody = enforceMonophonicMelody(out.filter(event => event.part === 'melody'));
        for (const boundaryInfo of melodyBrickBoundaryInfos(melody, songEnd)) {
            const boundary = boundaryInfo.boundary;
            const prevIndex = chordIndexAt(boundaryInfo.prev.time + 0.001);
            const nextIndex = chordIndexAt(boundaryInfo.next.time + 0.001);
            const prevChord = chords[prevIndex];
            const nextChord = chords[nextIndex];
            if (!prevChord || !nextChord) continue;
            const prevFunc = prevChord.effectiveFunc ?? getHarmonicFunction(prevChord.roman);
            const nextFunc = nextChord.effectiveFunc ?? getHarmonicFunction(nextChord.roman);
            const nextStart = starts[nextIndex] ?? boundary;
            const chordNextEnd = nextStart + (nextChord.duration ?? beatsPerMeasure);
            const nextEnd = Math.min(chordNextEnd, Math.max(boundaryInfo.targetEnd, boundary + 0.25));
            const prev = melodyAt(melody, boundaryInfo.sourceStart, boundary)
                .sort((a, b) => b.time - a.time || b.noteNumber - a.noteNumber)[0] ?? null;
            const next = melodyAt(melody, boundary, Math.min(nextEnd, boundary + 1.01))[0] ?? null;
            if (!prev || !next || prev.origin === 'motif') continue;
            let forcedResolutionTarget = chooseTargetChordSuspensionResolution(
                style,
                prev.noteNumber,
                nextChord,
                nextFunc,
                musicKey,
                musicMode,
                tonalCharacter,
                {
                    maxDistance: style === 'LOFI' ? 16 : style === 'JAZZ' ? 12 : 14,
                    preferredPc: chordThirdPc(nextChord),
                    minUrgency: boundaryResolutionThreshold(style),
                    guideReferenceMidi: next?.noteNumber ?? boundaryInfo.next.noteNumber,
                },
            );
            if (!forcedResolutionTarget) {
                const keyRootPc = pcOf(noteToMidi(musicKey + '0'));
                const modeFamily = modeToKeyFamily(musicMode);
                const prevScale = localScaleForChordContext(style, prevChord, prevFunc, musicKey, musicMode);
                const assessment = evaluateNoteInChordContext(
                    pcOf(prev.noteNumber),
                    prevChord.type,
                    pcOf(prevChord.rootMidi),
                    prevFunc,
                    nextChord.type,
                    pcOf(nextChord.rootMidi),
                    keyRootPc,
                    prevChord.forcedScale,
                    tonalCharacter === 'modal',
                    prevScale.pcs,
                    tonalCharacter,
                    prevChord.localTonalCenterPc,
                    modeFamily,
                );
                const nextLegal = legalMelodyPcs(nextChord);
                const targetPcs = assessment.resolutionTargets.filter(pc => nextLegal.has(pc));
                if (assessment.urgency >= boundaryResolutionThreshold(style) && targetPcs.length > 0) {
                    let best: { pc: number; midi: number; score: number } | null = null;
                    for (const pc of targetPcs) {
                        const midi = snapMidiToNearestPcSet(next.noteNumber, new Set([pc]), 14);
                        if (pcOf(midi) !== pc) continue;
                        const score = Math.abs(midi - next.noteNumber) * 2
                            + Math.abs(midi - prev.noteNumber) * 0.5
                            + (pc === chordThirdPc(nextChord) ? -8 : 0);
                        if (!best || score < best.score) best = { pc, midi, score };
                    }
                    if (best) forcedResolutionTarget = { pc: best.pc, midi: best.midi, urgency: assessment.urgency };
                }
            }
            const nextCanRetarget = Math.abs(next.time - boundary) < 0.12
                && next.origin !== 'motif'
                && ((next.origin === 'return' && next.grammarSlopeRole !== 'inside') || next.grammarSlopeRole === 'last');
            if (forcedResolutionTarget && pcOf(next.noteNumber) !== forcedResolutionTarget.pc && nextCanRetarget) {
                next.noteNumber = forcedResolutionTarget.midi;
                next.origin = 'return';
                next.lickSource = true;
                next.duration = Math.max(
                    next.duration,
                    Math.max(0.25, Math.min(landingHoldDuration(), nextEnd - boundary)),
                );
            }
            const badRelation = isBoundaryMetaphorDissonance(prev.noteNumber, next.noteNumber)
                && !isRecognizedBoundaryResolution(prev.noteNumber, next.noteNumber, prevChord, prevFunc, nextChord, nextFunc);
            const largeLeap = Math.abs(next.noteNumber - prev.noteNumber) > boundaryLeapLimit(style);
            if (!badRelation && !largeLeap) continue;
            const isBoundaryTail = prev === boundaryInfo.prev
                || (prev.brickIndex !== undefined
                    && prev.brickIndex === boundaryInfo.prev.brickIndex
                    && Math.abs(prev.time - boundaryInfo.prev.time) < 0.001);
            const canMutate = prev.origin === 'return'
                || prev.grammarSlopeRole === 'last'
                || (isBoundaryTail && prev.grammarSlopeRole !== 'inside');
            if (!canMutate) continue;
            const prevLegal = legalMelodyPcs(prevChord);
            const replacement = chooseBoundarySourceMidi(prev.noteNumber, next.noteNumber, prevLegal, style);
            if (replacement === null || !prevLegal.has(pcOf(replacement))) continue;
            if (largeLeap && Math.abs(next.noteNumber - replacement) >= Math.abs(next.noteNumber - prev.noteNumber)) continue;
            if (isBoundaryMetaphorDissonance(replacement, next.noteNumber)
                && !isRecognizedBoundaryResolution(replacement, next.noteNumber, prevChord, prevFunc, nextChord, nextFunc)) {
                continue;
            }
            prev.noteNumber = replacement;
        }
        const others = out.filter(event => event.part !== 'melody');
        return [...others, ...melody].sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
    }

    export function extendMelodyTailHolds(
        events: NoteEvent[],
        chords: ChordDef[],
        style: StyleName,
        musicKey: string,
        musicMode: string,
    ): NoteEvent[] {
        const starts: number[] = [];
        let acc = 0;
        for (const chord of chords) {
            starts.push(acc);
            acc += chord.duration ?? 4;
        }
        const songEnd = acc;
        const chordIndexAt = (time: number): number => {
            for (let i = starts.length - 1; i >= 0; i--) {
                if (time >= starts[i] - 0.001) return i;
            }
            return 0;
        };
        const stableOnChord = (event: NoteEvent, chord: ChordDef): boolean => {
            const func = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
            const rootPc = ((chord.rootMidi % 12) + 12) % 12;
            const notePc = ((event.noteNumber % 12) + 12) % 12;
            const contract = melodyContractPcsForStyle(style, chord, rootPc);
            const localScale = localScaleForChordContext(style, chord, func, musicKey, musicMode);
            return contract.has(notePc) && localScale.pcs.has(notePc);
        };
        const desiredTailDuration = (event: NoteEvent): number => {
            if (event.origin === 'return') {
                if (style === 'RNB') return 2.5;
                if (style === 'POP' || style === 'LOFI') return 2.0;
                if (style === 'ACG') return 3.0;
                if (style === 'JAZZ') return 1.5;
            }
            if (style === 'RNB' || style === 'LOFI') return 2.0;
            if (style === 'POP') return 1.75;
            if (style === 'ACG') return 2.5;
            if (style === 'JAZZ') return 1.25;
            return 1.5;
        };
        const legalSustainEnd = (event: NoteEvent, fromIndex: number, maxEnd: number): number => {
            let legalEnd = maxEnd;
            for (let i = fromIndex; i < chords.length; i++) {
                const chordStart = starts[i] ?? 0;
                const chordEnd = chordStart + (chords[i].duration ?? 4);
                if (chordStart >= maxEnd - 0.001) break;
                if (!stableOnChord(event, chords[i])) {
                    legalEnd = Math.max(event.time + event.duration, chordStart);
                    break;
                }
                if (chordEnd >= maxEnd - 0.001) break;
            }
            return legalEnd;
        };

        const out = events.map(event => ({ ...event }));
        const melody = out
            .filter(event => event.part === 'melody')
            .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);

        for (let i = 0; i < melody.length; i++) {
            const event = melody[i];
            if (event.duration <= 0) continue;
            const chordIndex = chordIndexAt(event.time);
            const chord = chords[chordIndex];
            if (!chord || !stableOnChord(event, chord)) continue;

            const chordStart = starts[chordIndex] ?? 0;
            const chordEnd = chordStart + (chord.duration ?? 4);
            const next = melody[i + 1] ?? null;
            const eventEnd = event.time + event.duration;
            const nextTime = next?.time ?? songEnd;
            const gapToNext = nextTime - eventEnd;
            const gapToChordEnd = chordEnd - eventEnd;
            const isReturn = event.origin === 'return';
            const isSlopeTail = event.grammarSlopeRole === 'last';
            const isShortTail = isSlopeTail && event.duration <= 1.01 && (gapToNext >= 0.72 || gapToChordEnd >= 0.72);
            if (!isReturn && !isShortTail) continue;

            const desired = desiredTailDuration(event);
            if (event.duration >= desired - 0.05) continue;
            const maxEndByNext = next ? Math.max(eventEnd, next.time - 0.035) : songEnd;
            const maxEnd = Math.min(event.time + desired, maxEndByNext);
            const sustainEnd = legalSustainEnd(event, chordIndex, maxEnd);
            const newDuration = Math.max(event.duration, sustainEnd - event.time);
            if (newDuration < Math.min(desired, 1.45) && gapToNext < 1.0) continue;
            if (newDuration > event.duration + 0.20) {
                event.duration = newDuration;
            }
        }

        return out.sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
    }

    export function finalizeMelodyBoundaryVoiceLeading(
        events: NoteEvent[],
        chords: ChordDef[],
        style: StyleName,
        musicKey: string,
        musicMode: string,
        tonalCharacter: 'tonal' | 'modal',
    ): NoteEvent[] {
        if (chords.length <= 1) return events;
        const beatsPerMeasure = 4;
        const starts: number[] = [];
        let songEnd = 0;
        for (const chord of chords) {
            starts.push(songEnd);
            songEnd += chord.duration ?? beatsPerMeasure;
        }

        const pcOf = (midi: number): number => ((midi % 12) + 12) % 12;
        const keyRootPc = pcOf(noteToMidi(musicKey + '0'));
        const modeFamily = modeToKeyFamily(musicMode);
        const chordIndexAt = (time: number): number => {
            const clamped = Math.max(0, Math.min(songEnd - 0.001, time));
            for (let i = starts.length - 1; i >= 0; i--) {
                if (clamped >= starts[i] - 0.001) return i;
            }
            return 0;
        };
        const legalMelodyPcs = (chord: ChordDef): Set<number> => {
            const func = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
            const rootPc = pcOf(chord.rootMidi);
            const contract = melodyContractPcsForStyle(style, chord, rootPc);
            const localScale = localScaleForChordContext(style, chord, func, musicKey, musicMode);
            const strict = new Set([...contract].filter(pc => localScale.pcs.has(pc)));
            return strict.size > 0 ? strict : contract;
        };
        const melodyAt = (list: NoteEvent[], start: number, end: number): NoteEvent[] =>
            list
                .filter(event => event.part === 'melody'
                    && event.time >= start - 0.001
                    && event.time < end - 0.001
                    && event.duration > 0)
                .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
        const landingHoldDuration = (): number => {
            if (style === 'RNB') return 2.0;
            if (style === 'LOFI') return 1.5;
            if (style === 'POP') return 1.5;
            if (style === 'ACG') return 1.5;
            if (style === 'JAZZ') return 0.67;
            return 1.0;
        };
        const sourceAssessment = (
            sourceMidi: number,
            sourceChord: ChordDef,
            sourceFunc: 'T' | 'S' | 'D',
            targetChord: ChordDef,
            targetFunc: 'T' | 'S' | 'D',
        ) => {
            const sourceScale = localScaleForChordContext(style, sourceChord, sourceFunc, musicKey, musicMode);
            return evaluateNoteInChordContext(
                pcOf(sourceMidi),
                sourceChord.type,
                pcOf(sourceChord.rootMidi),
                sourceFunc,
                targetChord.type,
                pcOf(targetChord.rootMidi),
                keyRootPc,
                sourceChord.forcedScale,
                tonalCharacter === 'modal',
                sourceScale.pcs,
                tonalCharacter,
                sourceChord.localTonalCenterPc,
                modeFamily,
            );
        };
        const chooseSourceContextResolution = (
            sourceMidi: number,
            referenceMidi: number,
            sourceChord: ChordDef,
            sourceFunc: 'T' | 'S' | 'D',
            targetChord: ChordDef,
            targetFunc: 'T' | 'S' | 'D',
            targetLegal: Set<number>,
        ): { pc: number; midi: number; urgency: number } | null => {
            const assessment = sourceAssessment(sourceMidi, sourceChord, sourceFunc, targetChord, targetFunc);
            if (assessment.urgency < boundaryResolutionThreshold(style)) return null;
            const targetPcs = assessment.resolutionTargets.filter(pc => targetLegal.has(pc));
            if (targetPcs.length === 0) return null;
            const targetThirdPc = chordThirdPc(targetChord);
            const targetSeventhPc = chordSeventhPc(targetChord);
            const guideTonePc = styleGuideToneTargetPc(
                style,
                targetChord,
                sourceMidi,
                `source-context|${sourceFunc}->${targetFunc}|${targetPcs.join(',')}`,
            );
            const guideTonePcs = new Set([targetThirdPc, targetSeventhPc].filter((pc): pc is number => pc !== null));
            let best: { pc: number; midi: number; score: number } | null = null;
            for (const pc of targetPcs) {
                const midi = snapMidiToNearestPcSet(referenceMidi, new Set([pc]), 14);
                if (pcOf(midi) !== pc) continue;
                if (midi < MELODY_RANGE.LOW || midi > MELODY_RANGE.HIGH) continue;
                const intervalClass = melodicIntervalClass(sourceMidi, midi);
                let score = assessment.resolutionTargets.indexOf(pc) * 10
                    + Math.abs(midi - referenceMidi) * 2.0
                    + Math.abs(midi - sourceMidi) * 0.8;
                score += guideTonePreferenceScore(
                    style,
                    pc,
                    midi,
                    guideTonePc,
                    guideTonePcs,
                    referenceMidi,
                );
                if (Math.abs(midi - sourceMidi) <= 2) score -= 8;
                if (intervalClass === 6) score += 80;
                if (!best || score < best.score) best = { pc, midi, score };
            }
            return best ? { pc: best.pc, midi: best.midi, urgency: assessment.urgency } : null;
        };
        const isRecognizedBoundaryResolution = (
            sourceMidi: number,
            landingMidi: number,
            sourceChord: ChordDef,
            sourceFunc: 'T' | 'S' | 'D',
            targetChord: ChordDef,
            targetFunc: 'T' | 'S' | 'D',
        ): boolean => {
            if (melodicIntervalClass(sourceMidi, landingMidi) !== 1) return false;
            const assessment = sourceAssessment(sourceMidi, sourceChord, sourceFunc, targetChord, targetFunc);
            return assessment.urgency >= boundaryResolutionThreshold(style)
                && assessment.resolutionTargets.includes(pcOf(landingMidi));
        };
        const canMutateBoundaryTail = (event: NoteEvent, boundaryInfo: MelodyBrickBoundaryInfo): boolean => {
            if (event.origin === 'motif') return false;
            const lickBoundaryTail = event === boundaryInfo.prev
                || (event.brickIndex !== undefined
                    && event.brickIndex === boundaryInfo.prev.brickIndex
                    && Math.abs(event.time - boundaryInfo.prev.time) < 0.001);
            return event.origin === 'return'
                || event.grammarSlopeRole === 'last'
                || (lickBoundaryTail && event.grammarSlopeRole !== 'inside');
        };
        const canRetargetBoundaryLanding = (event: NoteEvent, boundary: number): boolean =>
            event.origin !== 'motif'
            && Math.abs(event.time - boundary) < 0.16
            && ((event.origin === 'return' && event.grammarSlopeRole !== 'inside') || event.grammarSlopeRole === 'last');

        const out = events.map(event => ({ ...event }));
        for (const boundaryInfo of melodyBrickBoundaryInfos(out, songEnd)) {
            const boundary = boundaryInfo.boundary;
            const prevIndex = chordIndexAt(boundaryInfo.prev.time + 0.001);
            const nextIndex = chordIndexAt(boundaryInfo.next.time + 0.001);
            const prevChord = chords[prevIndex];
            const nextChord = chords[nextIndex];
            if (!prevChord || !nextChord) continue;
            const prevFunc = prevChord.effectiveFunc ?? getHarmonicFunction(prevChord.roman);
            const nextFunc = nextChord.effectiveFunc ?? getHarmonicFunction(nextChord.roman);
            const nextStart = starts[nextIndex] ?? boundary;
            const chordNextEnd = nextStart + (nextChord.duration ?? beatsPerMeasure);
            const nextEnd = Math.min(chordNextEnd, Math.max(boundaryInfo.targetEnd, boundary + 0.25));
            const prevLegal = legalMelodyPcs(prevChord);
            const nextLegal = legalMelodyPcs(nextChord);
            if (prevLegal.size === 0 || nextLegal.size === 0) continue;

            let currentMelody = out
                .filter(event => event.part === 'melody')
                .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
            let prev = melodyAt(currentMelody, boundaryInfo.sourceStart, boundary)
                .sort((a, b) => b.time - a.time || b.noteNumber - a.noteNumber)[0] ?? null;
            let next = melodyAt(currentMelody, boundary, Math.min(nextEnd, boundary + 1.01))[0] ?? null;
            if (!prev) continue;

            if (style !== 'ACG') {
                const referenceMidi = next?.noteNumber ?? prev.noteNumber;
                const sourceTarget = chooseSourceContextResolution(
                    prev.noteNumber,
                    referenceMidi,
                    prevChord,
                    prevFunc,
                    nextChord,
                    nextFunc,
                    nextLegal,
                );
                const suspensionTarget = sourceTarget ?? chooseTargetChordSuspensionResolution(
                    style,
                    prev.noteNumber,
                    nextChord,
                    nextFunc,
                    musicKey,
                    musicMode,
                    tonalCharacter,
                    {
                        maxDistance: style === 'LOFI' ? 16 : style === 'JAZZ' ? 12 : 14,
                        preferredPc: chordThirdPc(nextChord),
                        minUrgency: boundaryResolutionThreshold(style),
                        guideReferenceMidi: next?.noteNumber ?? boundaryInfo.next.noteNumber,
                    },
                );

                if (suspensionTarget && (!next || pcOf(next.noteNumber) !== suspensionTarget.pc)) {
                    if (next && canRetargetBoundaryLanding(next, boundary)) {
                        next.noteNumber = suspensionTarget.midi;
                        next.origin = 'return';
                        next.lickSource = true;
                        next.duration = Math.max(
                            next.duration,
                            Math.max(0.25, Math.min(landingHoldDuration(), nextEnd - boundary)),
                        );
                    } else if (!next || next.time > boundary + 0.18) {
                        out.push({
                            noteNumber: suspensionTarget.midi,
                            time: boundary,
                            duration: Math.max(0.25, Math.min(landingHoldDuration(), nextEnd - boundary)),
                            velocity: Math.max(70, Math.min(104, prev.velocity)),
                            part: 'melody',
                            origin: 'return',
                            lickSource: true,
                            brickIndex: boundaryInfo.next.brickIndex,
                            brickStartBeat: boundaryInfo.next.brickStartBeat,
                            brickEndBeat: boundaryInfo.next.brickEndBeat,
                            brickName: boundaryInfo.next.brickName,
                            brickFamily: boundaryInfo.next.brickFamily,
                        });
                    }
                }
            }

            currentMelody = out
                .filter(event => event.part === 'melody')
                .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
            prev = melodyAt(currentMelody, boundaryInfo.sourceStart, boundary)
                .sort((a, b) => b.time - a.time || b.noteNumber - a.noteNumber)[0] ?? null;
            next = melodyAt(currentMelody, boundary, Math.min(nextEnd, boundary + 1.01))[0] ?? null;
            if (!prev || !next) continue;

            const gap = Math.max(0, next.time - (prev.time + prev.duration));
            const recognizedResolution = isRecognizedBoundaryResolution(
                prev.noteNumber,
                next.noteNumber,
                prevChord,
                prevFunc,
                nextChord,
                nextFunc,
            );
            const badRelation = isBoundaryMetaphorDissonance(prev.noteNumber, next.noteNumber)
                && !recognizedResolution
                && gap < 0.90;
            const largeLeap = Math.abs(next.noteNumber - prev.noteNumber) > boundaryLeapLimit(style)
                && gap < 0.75;
            if ((!badRelation && !largeLeap) || !canMutateBoundaryTail(prev, boundaryInfo)) continue;

            let repaired = false;
            const replacement = chooseBoundarySourceMidi(prev.noteNumber, next.noteNumber, prevLegal, style);
            if (replacement !== null && prevLegal.has(pcOf(replacement))) {
                const replacementRecognized = isRecognizedBoundaryResolution(
                    replacement,
                    next.noteNumber,
                    prevChord,
                    prevFunc,
                    nextChord,
                    nextFunc,
                );
                const replacementBad = isBoundaryMetaphorDissonance(replacement, next.noteNumber)
                    && !replacementRecognized;
                const replacementLarge = Math.abs(next.noteNumber - replacement) > boundaryLeapLimit(style);
                if (!replacementBad && (!largeLeap || !replacementLarge || Math.abs(next.noteNumber - replacement) < Math.abs(next.noteNumber - prev.noteNumber))) {
                    prev.noteNumber = replacement;
                    repaired = true;
                }
            }

            const afterSourceBad = isBoundaryMetaphorDissonance(prev.noteNumber, next.noteNumber)
                && !isRecognizedBoundaryResolution(prev.noteNumber, next.noteNumber, prevChord, prevFunc, nextChord, nextFunc);
            const afterSourceLarge = Math.abs(next.noteNumber - prev.noteNumber) > boundaryLeapLimit(style);
            if (repaired && !afterSourceBad && !afterSourceLarge) continue;
            if (!canRetargetBoundaryLanding(next, boundary)) continue;

            const landing = chooseBoundaryLandingMidi(
                next.noteNumber,
                prev.noteNumber,
                nextLegal,
                style,
                nextChord,
                `finalize|${prevChord.chordSymbol ?? prevChord.roman}->${nextChord.chordSymbol ?? nextChord.roman}|${boundary.toFixed(2)}`,
            );
            if (landing === null || !nextLegal.has(pcOf(landing))) continue;
            const landingRecognized = isRecognizedBoundaryResolution(
                prev.noteNumber,
                landing,
                prevChord,
                prevFunc,
                nextChord,
                nextFunc,
            );
            if (isBoundaryMetaphorDissonance(prev.noteNumber, landing) && !landingRecognized) continue;
            if (afterSourceLarge && Math.abs(landing - prev.noteNumber) >= Math.abs(next.noteNumber - prev.noteNumber)) continue;
            next.noteNumber = landing;
            next.origin = 'return';
            next.lickSource = true;
        }

        if (style === 'POP' || style === 'LOFI' || style === 'RNB') {
            const chordAtForDecoration = (time: number): { chord: ChordDef; start: number } => {
                const index = chordIndexAt(time);
                return { chord: chords[index], start: starts[index] ?? 0 };
            };
            const melody = out
                .filter(event => event.part === 'melody')
                .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
            for (let i = 0; i < melody.length; i++) {
                const event = melody[i];
                if (event.origin === 'motif') continue;
                if (event.origin !== 'return' && event.grammarSlopeRole !== 'last') continue;
                if (event.duration > 0.55) continue;
                const { chord } = chordAtForDecoration(event.time);
                const func = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
                const rootPc = pcOf(chord.rootMidi);
                const contract = melodyContractPcsForStyle(style, chord, rootPc);
                const localScale = localScaleForChordContext(style, chord, func, musicKey, musicMode);
                const legal = new Set([...contract].filter(pc => localScale.pcs.has(pc)));
                const targetPcs = legal.size > 0 ? legal : contract;
                const notePc = pcOf(event.noteNumber);
                if (targetPcs.has(notePc) || !localScale.pcs.has(notePc)) continue;
                const prev = melody[i - 1] ?? null;
                const next = melody[i + 1] ?? null;
                const weakScaleDecoration = isLofiWeakScaleDecoration(
                    event,
                    prev,
                    next,
                    localScale.pcs,
                    chordAtForDecoration,
                    style,
                    2,
                    true,
                );
                if (weakScaleDecoration) continue;

                let best: { midi: number; score: number } | null = null;
                for (const pc of targetPcs) {
                    for (const midi of candidateMidisForPcNear(pc, event.noteNumber, 8)) {
                        if (pcOf(midi) !== pc) continue;
                        let score = Math.abs(midi - event.noteNumber) * 1.5;
                        if (prev) {
                            const into = Math.abs(midi - prev.noteNumber);
                            score += into * 0.8;
                            if (into > boundaryLeapLimit(style)) score += 20;
                            if (melodicIntervalClass(prev.noteNumber, midi) === 6) score += 20;
                        }
                        if (next) {
                            const outDistance = Math.abs(next.noteNumber - midi);
                            score += outDistance * 1.1;
                            if (outDistance > boundaryLeapLimit(style)) score += 20;
                            if (melodicIntervalClass(midi, next.noteNumber) === 6) score += 20;
                        }
                        if (Math.abs(midi - event.noteNumber) <= 3) score -= 4;
                        if (!best || score < best.score) best = { midi, score };
                    }
                }
                if (best) event.noteNumber = best.midi;
            }
        }

        const melody = enforceMonophonicMelody(out.filter(event => event.part === 'melody'));
        const others = out.filter(event => event.part !== 'melody');
        return [...others, ...melody].sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
    }

