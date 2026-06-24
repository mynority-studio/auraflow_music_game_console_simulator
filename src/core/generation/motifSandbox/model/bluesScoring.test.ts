import { describe, it, expect } from 'vitest';
import { scoreProgressionAgainstMelodicBrick } from './melodyProgressionScorer';
import type { ProgressionCandidate } from './progressionCandidateProvider';
import type { ProgressionPrototype, ProgressionSlot } from '../../newEngine/knowledge/progressions';
import type { UserMelodicBrick, MotifHarmonyIntent, StructuralMelodyTone } from './melodicBrickTypes';

// followup 2.4:结构蓝音落点能否调味 → 偏向有 S/D/borrowed 槽的候选。C 大调布鲁斯,beat0 强 Eb(pc3)。
const slot = (roman: string, scaleDegree: number, func: 'T' | 'S' | 'D'): ProgressionSlot =>
  ({ roman, type: 'maj', scaleDegree, rootOffset: [0, 2, 4, 5, 7, 9, 11][(scaleDegree - 1) % 7], effectiveFunc: func });
const proto = (id: string, slots: ProgressionSlot[]): ProgressionPrototype =>
  ({ id, style: 'pop' as never, mode: 'major' as never, sectionRoles: ['verse'] as never, lengthBars: 4, slots, weight: 1, cadence: 'loop' });
const cand = (p: ProgressionPrototype): ProgressionCandidate => ({ prototype: p, fittedSlots: p.slots, modeMatch: true });

const tone = (midi: number, onsetBeat: number, weight: number): StructuralMelodyTone =>
  ({ midi, scaleDegree: 1, onsetBeat, durationBeat: 1.5, weight, role: 'strongBeat' });
const brick: UserMelodicBrick = {
  id: 'b', sourceMotifId: 'm', keyPc: 0, mode: 'major', lengthBeats: 16, lengthBars: 4, quoteBeats: 16,
  head: null, tail: null, allTones: [], structuralTones: [tone(63, 0, 0.8)], // Eb(pc3)强结构音 @beat0
  contour: [], rhythmSignature: [], cadenceMotion: null, functions: [], primaryFunction: 'opening', evidence: [],
};
const intent: MotifHarmonyIntent = { targetFunctions: ['T'], cadenceNeed: 'none', startStability: 'stable', endingStability: 'open', preferTemplateCadence: ['loop'], preferredStartDegrees: [1], preferredLandingDegrees: [1], avoidDegenerateProgressions: [] };

// 候选 A:beat0 = V(D 功能,可调味接蓝音);候选 B:beat0 = I(纯 tonic,不可调味)
const A = cand(proto('A-Vstart', [slot('V', 5, 'D'), slot('IV', 4, 'S'), slot('I', 1, 'T'), slot('I', 1, 'T')]));
const B = cand(proto('B-Istart', [slot('I', 1, 'T'), slot('I', 1, 'T'), slot('I', 1, 'T'), slot('I', 1, 'T')]));

describe('motifSandbox/blues-aware 进行评分(followup 2.4)', () => {
  it('★ 布鲁斯:结构蓝音落点有 S/D 槽的候选 A 获 bluesSeasoningOpportunity 优势 + total 不输 B', () => {
    const sa = scoreProgressionAgainstMelodicBrick(brick, intent, A, 0, { inputTonality: 'majorBlues' });
    const sb = scoreProgressionAgainstMelodicBrick(brick, intent, B, 0, { inputTonality: 'majorBlues' });
    expect(sa.breakdown.bluesSeasoningOpportunity!).toBeGreaterThan(sb.breakdown.bluesSeasoningOpportunity ?? 0);
    expect(sa.total).toBeGreaterThan(sb.total); // A 整体也胜出
  });

  it('★ 布鲁斯:结构蓝音不再计 strongNonChord 罚(bluesPassingTolerance 记下被免的罚)', () => {
    const sa = scoreProgressionAgainstMelodicBrick(brick, intent, A, 0, { inputTonality: 'majorBlues' });
    expect(sa.breakdown.strongNonChordPenalty).toBe(0);          // Eb 是蓝音 → 不罚
    expect(sa.breakdown.bluesPassingTolerance!).toBeGreaterThan(0); // 记下免掉的量
  });

  it('★ 非布鲁斯:blues 字段为 0,结构蓝音仍按 strongNonChord 罚(行为不变)', () => {
    const sa = scoreProgressionAgainstMelodicBrick(brick, intent, A, 0); // 无 inputTonality
    expect(sa.breakdown.bluesSeasoningOpportunity).toBe(0);
    expect(sa.breakdown.bluesStructuralSupport).toBe(0);
    expect(sa.breakdown.strongNonChordPenalty).toBeGreaterThan(0); // Eb 非和弦音 → 罚(非布鲁斯不容忍)
  });
});
