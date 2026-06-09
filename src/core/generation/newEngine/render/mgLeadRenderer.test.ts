import { describe, it, expect } from 'vitest';
import { renderMgMelody } from './mgLeadRenderer';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createTimebase, createRandomContext, pc } from '../foundation';

// ============================================================
// MG strict 移植 Loop 7 — renderMgMelody(生产 lead via MG 链)结构验证
// ------------------------------------------------------------
// Option B:MG 旋律喂【我们的】HarmonicPlan → 非 bit-match MG(和弦不同),
// 故只验结构正确:非空 / 在音域 / 确定性 / 落在 tick 网格 / 排序。
// ============================================================

function buildLead(style: string, seed: number) {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120, key: pc(0), mode: 'major' });
  const arrangement = buildArrangementPlan(band);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
  const timebase = createTimebase({ meter: arrangement.meter });
  return renderMgMelody(plan, band, timebase, seed); // ★ Loop 1:song seed 直通
}

describe('render/mgLeadRenderer · renderMgMelody (Loop 7)', () => {
  for (const style of ['pop', 'lofi', 'rnb', 'jazz']) {
    it(`★ ${style}:产非空 lead,音域合理,role/program 正确`, () => {
      const lead = buildLead(style, 7);
      expect(lead.role).toBe('lead');
      expect(lead.notes.length).toBeGreaterThan(0);
      for (const n of lead.notes) {
        expect(n.pitch).toBeGreaterThanOrEqual(48);
        expect(n.pitch).toBeLessThanOrEqual(96);
        expect(n.durationTicks).toBeGreaterThan(0);
        expect(n.velocity).toBeGreaterThanOrEqual(1);
        expect(n.velocity).toBeLessThanOrEqual(127);
      }
      expect(typeof lead.program).toBe('number');
    });
  }

  it('确定性:同 seed 两次完全一致', () => {
    const a = buildLead('pop', 11);
    const b = buildLead('pop', 11);
    expect(a.notes).toEqual(b.notes);
  });

  it('不同 seed → lead 发散', () => {
    const a = buildLead('pop', 11);
    const b = buildLead('pop', 12);
    expect(a.notes).not.toEqual(b.notes);
  });

  it('notes 按 startTick 升序', () => {
    const lead = buildLead('jazz', 7);
    for (let i = 1; i < lead.notes.length; i++) {
      expect(lead.notes[i].startTick).toBeGreaterThanOrEqual(lead.notes[i - 1].startTick);
    }
  });

  it('lead 覆盖到曲子后段(非只开头几拍)', () => {
    const lead = buildLead('pop', 7);
    const lastTick = lead.notes[lead.notes.length - 1].startTick;
    expect(lastTick).toBeGreaterThan(480 * 8); // 至少铺到第 8 拍之后
  });
});
