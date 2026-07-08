import { describe, it, expect } from 'vitest';
import { renderSongFull } from './renderCoordinator';
import { generateSong } from '../generation/GenerationController';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createTimebase, createRandomContext } from '../foundation';

describe('render/gmMixAttachment — 混音落 IR(端到端)', () => {
  const band = buildBandSpec({ seed: 11, styleHint: 'pop', mood: 'build', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const instrumentation = buildInstrumentationPlan(band, arrangement);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(11));
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  const { ir } = renderSongFull(band, arrangement, plan, instrumentation, timebase, createRandomContext(11));

  it('renderSongFull 给【每条轨】挂上 mix(CC7/10/91/93 全整数 0..127)', () => {
    expect(ir.tracks.length).toBeGreaterThan(0);
    for (const t of ir.tracks) {
      expect(t.mix, `${t.role} 缺 mix`).toBeDefined();
      for (const v of [t.mix!.volume, t.mix!.pan, t.mix!.reverb, t.mix!.chorus]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(127);
      }
    }
  });

  it('混音承重不变量:bass 干居中 / pad 比 comp 更湿', () => {
    const bass = ir.tracks.find((t) => t.role === 'bass')!.mix!;
    const comp = ir.tracks.find((t) => t.role === 'comp')?.mix;
    const pad = ir.tracks.find((t) => t.role === 'pad')?.mix;
    expect(bass.reverb).toBeLessThanOrEqual(8);
    expect(bass.pan).toBe(64);
    if (comp && pad) expect(pad.reverb).toBeGreaterThanOrEqual(comp.reverb + 20);
  });
});

describe('render/gmMixAttachment — programChanges ⟹ mixChanges(同 tick 耦合)', () => {
  // pop seed=3:lead 轨有段落音色切换(programChanges)→ 必带对应 mixChanges。
  const res = generateSong({ seed: 3, styleHint: 'pop', mood: 'build', targetDuration: 120 });

  it('有 programChanges 的轨 → 必有 mixChanges,且每个 program 切换 tick 都有 mix 刷新', () => {
    const switched = res.ir!.tracks.filter((t) => t.programChanges && t.programChanges.length);
    expect(switched.length).toBeGreaterThan(0); // 该 seed 确有切换(防回归静默)
    for (const t of switched) {
      expect(t.mixChanges, `${t.role} 有 pc 无 mc`).toBeDefined();
      const mcTicks = new Set((t.mixChanges ?? []).map((m) => m.atTick as number));
      for (const pc of t.programChanges!) {
        expect(mcTicks.has(pc.atTick as number), `pc@${pc.atTick} 无匹配 mixChange`).toBe(true);
      }
    }
  });

  it('EP programChanges 同步 CC72/CC74,换出时重置避免 tail 残留', () => {
    const isEp = (p: number | undefined) => p === 4 || p === 5;
    const programAt = (t: any, tick: number) => {
      let p = t.program;
      for (const pc of t.programChanges ?? []) {
        if ((pc.atTick as number) <= tick) p = pc.program;
        else break;
      }
      return p;
    };
    const hasCc = (t: any, tick: number, controller: number, value: number) =>
      (t.ccEvents ?? []).some((e) => (e.atTick as number) === tick && e.controller === controller && e.value === value);

    const switched = res.ir!.tracks.filter((t) => (t.programChanges ?? []).some((pc) => isEp(t.program) !== isEp(pc.program)));
    expect(switched.length).toBeGreaterThan(0);
    for (const t of switched) {
      for (const pc of t.programChanges ?? []) {
        const tick = pc.atTick as number;
        const before = programAt(t, tick - 1);
        if (isEp(before) === isEp(pc.program)) continue;
        const release = isEp(pc.program) ? 96 : 64;
        const brightness = isEp(pc.program) ? 54 : 64;
        expect(hasCc(t, tick, 72, release), `${t.role} pc@${tick} 缺 CC72=${release}`).toBe(true);
        expect(hasCc(t, tick, 74, brightness), `${t.role} pc@${tick} 缺 CC74=${brightness}`).toBe(true);
      }
    }
  });
});

describe('render/gmMixAttachment — lead 事件不受混音影响', () => {
  // 不比较/不改 lead 音符内容(parity 由 mgFinalLeadParity 守);此处只验证混音附加是【确定性、无副作用】的:
  // 同输入两次渲染 → lead 音符逐一致(混音挂载没碰 lead note 事件)。
  it('lead 音符在重复渲染下逐字节一致(混音挂载无副作用)', () => {
    const a = generateSong({ seed: 3, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    const b = generateSong({ seed: 3, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    const lead = (r: typeof a) => r.ir!.tracks.find((t) => t.role === 'lead')!.notes;
    expect(lead(a)).toEqual(lead(b));
    // lead 同样挂了 mix(参与混音),但 note 事件与混音正交
    expect(a.ir!.tracks.find((t) => t.role === 'lead')!.mix).toBeDefined();
  });
});
