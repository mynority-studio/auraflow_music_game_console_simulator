import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderSongFull } from './renderCoordinator';
import { createTimebase, createRandomContext, beats } from '../foundation';

// ============================================================
// CODEX directive Loop I / §4.7:跨轨 texture clock 对齐。
//   7/lofi:dusty chop 不再落 +0.58,16 分格残差 <= 0.055;396040/pop no-pad comp 有下拍 anchor;
//   ★777870/rnb:verse 正向 golden,不被修坏(lead 手感 + comp pocket 保留)。
// ============================================================

function pieces(seed: number, style: string) {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
  const instrumentation = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'));
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
  const timebase = createTimebase({ meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }] });
  const { ir, audit } = renderSongFull(band, arrangement, plan, instrumentation, timebase, createRandomContext(seed));
  return { band, arrangement, instrumentation, plan, timebase, ir, audit };
}
const ruleIds = (audit: { findings: { ruleId: string }[] }) => audit.findings.map((f) => f.ruleId);

describe('Loop I · 7/lofi texture clock', () => {
  it('comp 柱式块(同 tick≥2 音)16 分格残差系统性 <= 0.055(dusty chop 不再落 +0.58);无 texture-clock-drift', () => {
    const { ir, timebase, audit } = pieces(7, 'lofi');
    const byTick: Record<number, number> = {};
    for (const n of ir.tracks.find((t) => t.role === 'comp')?.notes ?? []) byTick[n.startTick as number] = (byTick[n.startTick as number] ?? 0) + 1;
    const res = Object.entries(byTick).filter(([, c]) => c >= 2).map(([tickStr]) => { const b = Number(tickStr) / timebase.ppq; return Math.abs(b - Math.round(b * 2) / 2); });
    // 系统性对齐:均值贴格 + 绝大多数(>=90%)块在 0.055 内(容个别 off-grid span 锚点)
    const mean = res.reduce((a, b) => a + b, 0) / res.length;
    expect(mean).toBeLessThanOrEqual(0.04);
    expect(res.filter((r) => r <= 0.055).length / res.length).toBeGreaterThanOrEqual(0.9);
    expect(ruleIds(audit)).not.toContain('texture-clock-drift'); // 审计器单值阈值由 break 控,系统性不漂
  });
});

describe('Loop I · 396040/pop no-pad comp anchor', () => {
  it('无 structural-comp-anchor-late;content 段下拍有 comp', () => {
    const { band, arrangement, ir, timebase, audit } = pieces(396040, 'pop');
    expect(band.instrumentPool.includes('pad')).toBe(false); // 该 seed 无 pad
    expect(ruleIds(audit)).not.toContain('structural-comp-anchor-late');
    const comp = ir.tracks.find((t) => t.role === 'comp')?.notes ?? [];
    const bpb = arrangement.meter.numerator;
    let cur = 0, checked = 0;
    for (const s of arrangement.sections) {
      if (['story', 'build', 'hook'].includes(s.functionTag ?? '')) {
        const st = timebase.beatToTick(beats(cur * bpb)) as number;
        const eps = 0.08 * timebase.ppq;
        expect(comp.some((n) => Math.abs((n.startTick as number) - st) <= eps), `${s.id} 下拍无 comp anchor`).toBe(true);
        checked++;
      }
      cur += s.bars;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('★ Loop I · 777870/rnb verse 正向 golden(不被修坏)', () => {
  it('verse1:lead 手感保留 + comp pocket 保留', () => {
    const { arrangement, ir, timebase } = pieces(777870, 'rnb');
    const bpb = arrangement.meter.numerator;
    const v1 = arrangement.sections.find((s) => s.id === 'verse1');
    expect(v1).toBeTruthy();
    let cur = 0; for (const s of arrangement.sections) { if (s.id === 'verse1') break; cur += s.bars; }
    const lo = timebase.beatToTick(beats(cur * bpb)) as number, hi = timebase.beatToTick(beats((cur + v1!.bars) * bpb)) as number;
    const lead = (ir.tracks.find((t) => t.role === 'lead')?.notes ?? []).filter((n) => (n.startTick as number) >= lo && (n.startTick as number) < hi).sort((a, b) => (a.startTick as number) - (b.startTick as number));
    const comp = (ir.tracks.find((t) => t.role === 'comp')?.notes ?? []).filter((n) => (n.startTick as number) >= lo && (n.startTick as number) < hi);
    let restMax = 0, cursor = lo;
    for (const n of lead) { const gap = ((n.startTick as number) - cursor) / timebase.ppq; if (gap > restMax) restMax = gap; cursor = Math.max(cursor, (n.startTick as number) + (n.durationTicks as number)); }
    expect(lead.length).toBeGreaterThanOrEqual(50);                                  // 旋律密度(directive >=50)
    expect(restMax).toBeLessThanOrEqual(2.25);                                       // 不被量化撕碎
    // ★ Option A(strict parity):lead = MG 真源,首音由 MG 决定(可弱起/pickup,不再 pin 落段首);只验在段首 1 拍内。
    expect((lead[0].startTick as number) - lo).toBeLessThanOrEqual(timebase.ppq);
    const compDelta = Math.min(...comp.map((n) => Math.abs(((n.startTick as number) - lo) / timebase.ppq)));
    expect(compDelta).toBeLessThanOrEqual(0.05);                                     // comp 边界 pocket 保留(非机械直拍/非晚 wash)
  });
});
