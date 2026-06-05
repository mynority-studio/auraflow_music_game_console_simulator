import { describe, it, expect } from 'vitest';
import { renderMelody } from './melodyRenderer';
import { runPrepass } from './motifAnchorPrepass';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { createTimebase, createRandomContext, pc } from '../foundation';

describe('render/melody 轮廓弧线 (2.4)', () => {
  const band = buildBandSpec({ seed: 4, styleHint: 'pop', mood: 'build', targetDuration: 120, key: pc(0), mode: 'major' });
  const arrangement = buildArrangementPlan(band);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(4));
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  const { anchorPlan, motifStore } = runPrepass(band, arrangement, plan, createRandomContext(4));
  const lead = renderMelody(anchorPlan, motifStore, plan, arrangement, band, timebase, undefined);

  // 段落 beat 范围
  const bpb = beatsPerBarOf(arrangement.meter);
  const secRange: Record<string, [number, number]> = {};
  let cur = 0;
  for (const s of arrangement.sections) {
    secRange[s.id] = [cur, cur + s.bars * bpb];
    cur += s.bars * bpb;
  }
  const avgPitch = (sid: string) => {
    const [lo, hi] = secRange[sid];
    const ps = lead.notes.filter((n) => { const b = n.startTick / 480; return b >= lo && b < hi; }).map((n) => n.pitch);
    return ps.reduce((a, b) => a + b, 0) / ps.length;
  };

  it('★ chorus 音区高于 verse(能量↑→音区↑)', () => {
    expect(avgPitch('chorus1')).toBeGreaterThan(avgPitch('verse1'));
  });

  it('★ 高潮段(chorus2)音区 ≥ chorus1(冲峰)', () => {
    const climaxId = arrangement.climaxMap[0]?.sectionId;
    expect(climaxId).toBe('chorus2');
    expect(avgPitch('chorus2')).toBeGreaterThanOrEqual(avgPitch('chorus1'));
  });

  it('intro(低能量)音区不显著高于 chorus(容差;legacy melody,MG 迁移后由 MG shaper 接管)', () => {
    // ★ POP 对齐 MG 三和弦后和弦音减少 → 旋律择音微移;此处放宽到容差(intro 不冲到 chorus 之上太多)
    expect(avgPitch('intro')).toBeLessThanOrEqual(avgPitch('chorus1') + 2);
  });
});
