// ============================================================
// newEngine · render · jazz walking bass 解决到位(真洞修复,2026-06-05)
// ------------------------------------------------------------
// 锁:walking 末拍接入不在强拍漏裸半音外音;解决法多样(半音弱拍/音阶级进/留白/环绕);确定性。
// ============================================================

import { describe, expect, it } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderBass } from './bassRenderer';
import { createRandomContext, createTimebase, beats, pc } from '../foundation';

const tb = createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm: 90 }] });
const tpb = tb.beatToTick(beats(1)) as number;

function jazzBass(seed: number) {
  const band = buildBandSpec({ seed, styleHint: 'jazz', mood: 'x', targetDuration: 150, key: pc(0) });
  const plan = buildHarmonicPlanFromArrangement(band, buildArrangementPlan(band), createRandomContext(seed));
  return { plan, bass: renderBass(plan, tb, 'jazz') };
}

describe('jazz walking bass 解决到位', () => {
  it('强拍上无裸半音外音(既非和弦音也非本 span 音阶音)', () => {
    let strongExternal = 0;
    let strongTotal = 0;
    for (let seed = 0; seed < 30; seed++) {
      const { plan, bass } = jazzBass(seed);
      for (const n of bass.notes) {
        const beatPos = (n.startTick as number) / tpb;
        const beatInBar = ((beatPos % 4) + 4) % 4;
        if (beatInBar !== 0 && beatInBar !== 2) continue; // 只看强拍
        const span = plan.chordTimeline.find((c) => beatPos >= (c.startBeat as number) && beatPos < (c.startBeat as number) + (c.durationBeats as number));
        if (!span) continue;
        strongTotal++;
        const pcv = (n.pitch as number) % 12;
        const scale = plan.chordScaleMap[span.id] as readonly number[];
        const stable = plan.stableToneMap[span.id] as readonly number[];
        if (!scale.includes(pcv) && !stable.includes(pcv)) strongExternal++;
      }
    }
    expect(strongTotal).toBeGreaterThan(100);
    expect(strongExternal).toBe(0); // ★ 真洞已封
  });

  it('walking 仍出音(没被解决逻辑掏空)+ 确定性', () => {
    const a = jazzBass(5);
    const b = jazzBass(5);
    expect(a.bass.notes.length).toBeGreaterThan(0);
    expect(JSON.stringify(a.bass.notes)).toBe(JSON.stringify(b.bass.notes));
  });
});
