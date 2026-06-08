import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderSongFull } from './renderCoordinator';
import { createTimebase, createRandomContext, beats } from '../foundation';

// ============================================================
// CODEX directive Loop C/D/E(2026-06-08):transitionPlan + lineup-aware activeRoles + transition-aware gate。
// ============================================================

function pieces(seed: number, style: string) {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
  const instrumentation = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'));
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
  const timebase = createTimebase({ meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }] });
  const { ir } = renderSongFull(band, arrangement, plan, instrumentation, timebase, createRandomContext(seed));
  return { band, arrangement, instrumentation, plan, timebase, ir };
}

describe('Loop C · transitionPlan', () => {
  it('结构:每个 boundary 有 from/to/prepBar=boundaryBar-1;lead-in 有 pickupRoles;songEntry mode 合理', () => {
    const { arrangement, instrumentation } = pieces(3, 'pop');
    const tp = instrumentation.transitionPlan;
    expect(tp.boundaries.length).toBe(arrangement.sections.length - 1);
    for (const b of tp.boundaries) {
      expect(b.prepBar).toBe(b.boundaryBar - 1);
      if (b.entry === 'lead-in') expect(b.pickupRoles.length).toBeGreaterThan(0);
    }
    expect(['normal-intro', 'staged-first-bar', 'direct-anchor']).toContain(tp.songEntry.mode);
    // 有 intro(setup)→ normal-intro
    const first = arrangement.sections[0];
    if (first.functionTag === 'setup' || first.role === 'intro') expect(tp.songEntry.mode).toBe('normal-intro');
  });

  it('确定性:同 seed → 同 transitionPlan', () => {
    const a = JSON.stringify(pieces(42, 'pop').instrumentation.transitionPlan);
    const b = JSON.stringify(pieces(42, 'pop').instrumentation.transitionPlan);
    expect(a).toBe(b);
  });
});

describe('Loop D · no-pad floating/收尾段 comp 托底', () => {
  for (const [seed, style] of [[64062, 'pop'], [0, 'pop']] as const) {
    it(`${style}/${seed}:无 pad 时 outro activeRoles 含 comp 且渲染`, () => {
      const { band, arrangement, instrumentation, ir, timebase } = pieces(seed, style);
      if (band.instrumentPool.includes('pad')) return; // 仅验无 pad 编制
      const last = arrangement.sections[arrangement.sections.length - 1];
      expect((instrumentation.activeRolesBySection[last.id] ?? [])).toContain('comp');
      const bpb = arrangement.meter.numerator;
      let cur = 0; for (const s of arrangement.sections) { if (s.id === last.id) break; cur += s.bars * bpb; }
      const lo = timebase.beatToTick(beats(cur)) as number, hi = timebase.beatToTick(beats(cur + last.bars * bpb)) as number;
      const comp = (ir.tracks.find((t) => t.role === 'comp')?.notes ?? []).filter((n) => (n.startTick as number) >= lo && (n.startTick as number) < hi);
      expect(comp.length).toBeGreaterThan(0); // 有 pad 在场段 bit 不变,这里只验无 pad 兜底
    });
  }
});

describe('Loop E · lead-in pickup 不被 gate 删', () => {
  for (const [seed, style] of [[3, 'pop'], [3, 'lofi'], [42, 'pop']] as const) {
    it(`${style}/${seed}:lead-in 边界 prepBar 内 pickup 角色有音(即便上一段不含该角色)`, () => {
      const { arrangement, instrumentation, ir, timebase } = pieces(seed, style);
      const bpb = arrangement.meter.numerator; const barTicks = bpb * timebase.ppq;
      const leadIns = instrumentation.transitionPlan.boundaries.filter((b) => b.pickupRoles.length > 0);
      expect(leadIns.length).toBeGreaterThan(0);
      for (const b of leadIns) {
        const lo = b.prepBar * barTicks, hi = lo + barTicks;
        // pickup 角色里至少 drum(fill)在 prepBar 出现
        const present = b.pickupRoles.filter((r) => (ir.tracks.find((t) => t.role === r)?.notes ?? []).some((n) => (n.startTick as number) >= lo && (n.startTick as number) < hi));
        expect(present.length).toBeGreaterThan(0);
      }
    });
  }
});
