import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderSongFull } from './renderCoordinator';
import { createTimebase, createRandomContext, beats } from '../foundation';

// ============================================================
// outro 回归主音(2026-06-08):用户「outro 和声没回归 T、戛然而止;outro 可以有旋律但要回归主音」。
//   ① 和声:tonal 收尾段末两和弦强制 V7→I(authentic cadence,ensureAuthenticEnding)。
//   ② 旋律:收尾段不丢 lead(LEAD_NEVER_DROP)+ 末和弦区间末音 snap 到主音(mgLeadRenderer)。
//   ③ modal 旁路:落调式中心,不强加功能 V-I。
// ============================================================

function pieces(seed: number, style: string) {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
  const instrumentation = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'));
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
  const timebase = createTimebase({ meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }] });
  const res = renderSongFull(band, arrangement, plan, instrumentation, timebase, createRandomContext(seed));
  return { band, arrangement, instrumentation, plan, timebase, ...res };
}

describe('harmony · 收尾真终止 V7→I(tonal)', () => {
  for (const style of ['pop', 'rnb', 'lofi', 'jazz']) {
    it(`${style}:末和弦=I,倒二=V;无 fatal audit`, () => {
      for (let seed = 0; seed < 15; seed++) {
        const { plan, arrangement, audit } = pieces(seed, style);
        const last = arrangement.sections[arrangement.sections.length - 1];
        const spans = plan.chordTimeline.filter((c) => c.sectionId === last.id);
        expect(spans.length).toBeGreaterThanOrEqual(2);
        expect(spans[spans.length - 1].roman.degree).toBe(1);    // I 落家
        expect(spans[spans.length - 2].roman.degree).toBe(5);    // V 前导
        expect(audit.findings.some((f) => f.severity === 'fatal')).toBe(false); // V7→I 未引入致命非法
      }
    });
  }

  it('modal:不强加 V→I(落调式中心,末和弦非 deg5→deg1 模板)', () => {
    // modal 旁路:ensureAuthenticEnding 不触及 → 不应总是 V→I。统计若全部 deg5→deg1 则说明误强加。
    let v1 = 0;
    for (let seed = 0; seed < 12; seed++) {
      const { plan, arrangement } = pieces(seed, 'modal');
      const last = arrangement.sections[arrangement.sections.length - 1];
      const spans = plan.chordTimeline.filter((c) => c.sectionId === last.id);
      if (spans.length >= 2 && spans[spans.length - 1].roman.degree === 1 && spans[spans.length - 2].roman.degree === 5) v1++;
    }
    expect(v1).toBeLessThan(12); // 非全部 → modal 没被功能终止覆盖
  });
});

describe('render · 收尾旋律落主和弦音(Option A:旋律=MG 真源,不 snap;和声 V7→I 是"回 T")', () => {
  it('outro 有 lead(不被 gate 删)+ 多数落【主和弦音 1/3/5】(MG 自然解决,非强 snap 主音)', () => {
    let noLead = 0, chordTone = 0, checked = 0;
    for (const style of ['pop', 'rnb', 'lofi', 'jazz']) {
      for (let seed = 0; seed < 15; seed++) {
        const { band, arrangement, ir, timebase } = pieces(seed, style);
        const bpb = arrangement.meter.numerator;
        const last = arrangement.sections[arrangement.sections.length - 1];
        let cur = 0; for (const s of arrangement.sections) { if (s.id === last.id) break; cur += s.bars * bpb; }
        const lo = timebase.beatToTick(beats(cur)) as number, hi = timebase.beatToTick(beats(cur + last.bars * bpb)) as number;
        checked++;
        const lead = (ir.tracks.find((t) => t.role === 'lead')?.notes ?? []).filter((n) => (n.startTick as number) >= lo && (n.startTick as number) < hi);
        if (lead.length === 0) { noLead++; continue; }
        const lastNote = lead.reduce((a, b) => ((b.startTick as number) > (a.startTick as number) ? b : a));
        const pc = (((lastNote.pitch as number) - (band.key as number)) % 12 + 12) % 12;
        if ([0, 3, 4, 7].includes(pc)) chordTone++; // 主和弦音(1 / b3 或 3 / 5)
      }
    }
    // outro 基本都有旋律(lead 不被密度弧 gate 删);MG 自然解决落在主和弦音上(非强制 snap exact 主音)
    expect(noLead).toBeLessThanOrEqual(2);
    expect(chordTone / checked).toBeGreaterThan(0.55);
  });
});

describe('Loop G · EndingPlan cadence orchestration', () => {
  it('sustainRoles = pad优先/无pad用comp(不含 lead);protectLeadTiming=true', () => {
    for (const style of ['pop', 'rnb', 'lofi', 'jazz']) {
      for (let seed = 0; seed < 12; seed++) {
        const { band, instrumentation } = pieces(seed, style);
        const ep = instrumentation.endingPlan;
        expect(ep.protectLeadTiming).toBe(true);
        expect(ep.sustainRoles).not.toContain('lead');             // lead 不默认延留
        if (band.instrumentPool.includes('pad')) expect(ep.sustainRoles).toContain('pad');
        else if (band.instrumentPool.includes('comp')) expect(ep.sustainRoles).toContain('comp');
      }
    }
  });

  it('末小节有声由 sustainRole(非 lead)承担:tag/cold/fade 末小节去掉 lead 仍有音', () => {
    for (const style of ['pop', 'rnb', 'lofi', 'jazz']) {
      for (let seed = 0; seed < 12; seed++) {
        const { arrangement, ir, timebase } = pieces(seed, style);
        const bpb = arrangement.meter.numerator;
        const total = arrangement.sections.reduce((n, s) => n + s.bars, 0) * bpb;
        const lo = timebase.beatToTick(beats(total - bpb)) as number, hi = timebase.beatToTick(beats(total)) as number;
        // 排除 lead 后,末小节仍有 overlap 音(comp/pad/bass 承担收尾)
        const nonLead = ir.tracks.filter((t) => t.role !== 'lead').reduce((n, tr) => n + tr.notes.filter((x) => (x.startTick as number) < hi && ((x.startTick as number) + (x.durationTicks as number)) > lo).length, 0);
        expect(nonLead, `${style}/${seed} 末小节仅靠 lead`).toBeGreaterThan(0);
      }
    }
  });
});
