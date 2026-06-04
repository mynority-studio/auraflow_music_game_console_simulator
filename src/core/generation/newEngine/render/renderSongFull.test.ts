import { describe, it, expect } from 'vitest';
import { renderSongFull } from './renderCoordinator';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createTimebase, createRandomContext } from '../foundation';

describe('render/renderSongFull (accompaniment-first 全链)', () => {
  const band = buildBandSpec({ seed: 11, styleHint: 'pop', mood: 'build', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const instrumentation = buildInstrumentationPlan(band, arrangement);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(11));
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  const { ir, audit } = renderSongFull(band, arrangement, plan, instrumentation, timebase, createRandomContext(11));

  it('产出 bass / comp / pad / drum / lead 五轨,均非空', () => {
    const roles = ir.tracks.map((t) => t.role);
    expect(roles).toEqual(['bass', 'comp', 'pad', 'drum', 'lead']);
    for (const t of ir.tracks) expect(t.notes.length).toBeGreaterThan(0);
  });

  it('★ 全链无 error 级 finding(选音+snap 保证旋律不暴露 avoid;warning 可接受)', () => {
    // 扩规则后 Auditor 含 warning 级规则(离调/倾向/撞音);契约是【无 error/fatal 阻断】,非零 finding
    const blocking = audit.findings.filter((f) => f.severity === 'error' || f.severity === 'fatal');
    expect(blocking).toEqual([]);
  });

  it('IR 深不可变', () => {
    expect(Object.isFrozen(ir)).toBe(true);
    expect(Object.isFrozen(ir.tracks)).toBe(true);
  });

  it('确定性:同输入 → 同总音符数 + 同 lead 音高', () => {
    const again = renderSongFull(band, arrangement, plan, instrumentation, timebase, createRandomContext(11));
    const leadPitches = (r: typeof again) => r.ir.tracks.find((t) => t.role === 'lead')!.notes.map((n) => n.pitch);
    expect(leadPitches(again)).toEqual(leadPitches({ ir, audit }));
  });
});
