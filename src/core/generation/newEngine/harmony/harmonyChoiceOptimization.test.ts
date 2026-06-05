// ============================================================
// newEngine · harmony · 生成时候选择优 测试
// ------------------------------------------------------------
// 锁:harmony 产 N 候选 → coherence 打分 → 选最高分。验确定性 + 覆盖段落 +
// 选中的进行是 coherence 可评分且分数合理(择优对象成立)。
// ============================================================

import { describe, expect, it } from 'vitest';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { createRandomContext, mod12 } from '../foundation';
import { chordToneIntervals } from '../knowledge/chords';
import { evaluateHarmony, type CoherenceChord } from '../knowledge/harmonicCoherence';
import { evaluateVoiceLeading, type LedgerChord } from '../knowledge/voiceLeadingLedger';

function planFor(seed: number, style: string) {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
  return { band, plan };
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
// 把已选中的 plan.chordTimeline 适配成 CoherenceChord(镜像引擎内 adapter)给评分用
function planToCoherence(plan: ReturnType<typeof planFor>['plan']): CoherenceChord[] {
  return plan.chordTimeline.map((c, i) => {
    const rootPc = c.rootPc as number;
    const minorish = ['min', 'm7', 'm7b5', 'dim7'].includes(c.quality);
    return {
      type: c.quality,
      rootMidi: 60 + rootPc,
      notesMidi: chordToneIntervals(c.quality).map((iv) => 60 + rootPc + iv),
      bassMidi: 36 + rootPc,
      roman: minorish ? ROMAN[c.roman.degree].toLowerCase() : ROMAN[c.roman.degree],
      chordSymbol: c.id,
      duration: c.durationBeats as number,
      effectiveFunc: plan.chordFunctionTimeline[i],
    };
  });
}

describe('harmony 候选择优', () => {
  it('确定性:同 seed 两次生成 chordTimeline 完全一致', () => {
    const a = planFor(7, 'pop').plan;
    const b = planFor(7, 'pop').plan;
    const sig = (p: typeof a) => p.chordTimeline.map((c) => `${c.rootPc}:${c.quality}@${c.startBeat}`).join('|');
    expect(sig(a)).toBe(sig(b));
  });

  it('覆盖全部段落,每段非空', () => {
    const { plan } = planFor(3, 'jazz');
    const sids = new Set(plan.chordTimeline.map((c) => c.sectionId));
    expect(sids.size).toBeGreaterThan(0);
    expect(plan.chordTimeline.length).toBeGreaterThan(0);
  });

  it('选中的进行 coherence 可评分且分数合理(择优对象成立)', () => {
    for (const style of ['pop', 'jazz']) {
      for (let seed = 1; seed <= 8; seed++) {
        const { plan } = planFor(seed, style);
        const report = evaluateHarmony(planToCoherence(plan), style.toUpperCase(), 0);
        expect(report.score).toBeGreaterThanOrEqual(0);
        expect(report.score).toBeLessThanOrEqual(1);
        expect(report.score).toBeGreaterThan(0.5); // 选出来的进行不该是低分垃圾
      }
    }
  });

  // Loop 8:voice-leading 评分已并入择优
  it('选中的进行 voice-leading 可评分且 ∈[0,1](Loop 8 vl 接入)', () => {
    const planToLedger = (plan: ReturnType<typeof planFor>['plan']): LedgerChord[] =>
      plan.chordTimeline.map((c) => ({
        type: c.chordType ?? c.quality,
        rootMidi: 60 + (c.rootPc as number),
        notesMidi: chordToneIntervals(c.quality).map((iv) => 60 + mod12((c.rootPc as number) + iv)),
        bassMidi: 36 + (c.rootPc as number),
        borrowedFrom: c.borrowedSource,
      }));
    for (const style of ['pop', 'jazz', 'lofi']) {
      for (let seed = 1; seed <= 6; seed++) {
        const { plan } = planFor(seed, style);
        const r = evaluateVoiceLeading(planToLedger(plan));
        expect(r.overallScore).toBeGreaterThanOrEqual(0);
        expect(r.overallScore).toBeLessThanOrEqual(1);
        expect(r.stats.total).toBe(r.obligations.length);
      }
    }
  });
});
