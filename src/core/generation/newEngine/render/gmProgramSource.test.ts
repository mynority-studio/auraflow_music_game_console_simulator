import { describe, it, expect } from 'vitest';
import { renderSongFull } from './renderCoordinator';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createTimebase, createRandomContext } from '../foundation';
import { canPlayComp } from '../knowledge/instruments';
import type { BandSpec } from '../band/BandSpec';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });

function pipeline(band: BandSpec, seed: number) {
  const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
  const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
  const instrumentation = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'), harmonic);
  const { ir } = renderSongFull(band, arrangement, harmonic, instrumentation, timebase, createRandomContext(seed));
  return { instrumentation, arrangement, ir };
}

describe('render/gmProgramSource — TrackIR program 来自器配层链选,不漏 provisional', () => {
  it('renderSongFull 给每条轨挂 program/bank = instrumentation 段级生效值', () => {
    const band = buildBandSpec({ seed: 9, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    const { instrumentation, arrangement, ir } = pipeline(band, 9);
    const baseSec = arrangement.sections.find((s) => s.role !== 'chorus') ?? arrangement.sections[0];
    const firstSec = arrangement.sections[0].id;
    for (const t of ir.tracks) {
      // initial program/bank 对应首段;此处用 base 段做 sanity(无音色切换段)
      expect(t.program).toBe(instrumentation.programByRoleSection[t.role][firstSec]);
      expect(t.bank).toBe(instrumentation.bankByRoleSection[t.role][firstSec]);
      expect(instrumentation.programByRoleSection[t.role][baseSec.id]).toBe(instrumentation.roleProgram[t.role]);
    }
  });

  it('★ band.roleProgram.comp 故意不兼容(管风琴 16)→ render 用链修后的 comp,不漏 provisional', () => {
    const base = buildBandSpec({ seed: 12, styleHint: 'rnb', mood: 'build', targetDuration: 120 });
    expect(base.instrumentPool).toContain('comp');
    // 注入非法 comp(管风琴=持续音,不能做衰减节奏 comp)
    const band: BandSpec = { ...base, roleProgram: { ...base.roleProgram, comp: 16 } };

    const { instrumentation, ir } = pipeline(band, 12);
    // 器配层生效 comp 被链/repair 修成可 comp 乐器,绝不是 16
    expect(instrumentation.roleProgram.comp).not.toBe(16);
    expect(canPlayComp(instrumentation.roleProgram.comp)).toBe(true);
    // render 落到 comp 轨的 program = 生效值,provisional 16 不漏进 IR
    const compTrack = ir.tracks.find((t) => t.role === 'comp')!;
    expect(compTrack.program).toBe(instrumentation.roleProgram.comp);
    expect(compTrack.program).not.toBe(16);
    // 所有段的 comp program 也都不是 16
    for (const v of Object.values(instrumentation.programByRoleSection.comp)) expect(v).not.toBe(16);
  });

  it('确定性:同 seed 两次渲染 → comp/bass program 一致', () => {
    const band = buildBandSpec({ seed: 21, styleHint: 'lofi', mood: 'build', targetDuration: 120 });
    const a = pipeline(band, 21).ir;
    const b = pipeline(band, 21).ir;
    const prog = (ir: typeof a, role: string) => ir.tracks.find((t) => t.role === role)?.program;
    expect(prog(a, 'comp')).toBe(prog(b, 'comp'));
    expect(prog(a, 'bass')).toBe(prog(b, 'bass'));
  });
});
