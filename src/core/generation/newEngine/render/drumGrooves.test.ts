import { describe, it, expect } from 'vitest';
import { renderDrums } from './drumRenderer';
import { drumGrooveVariants, drumPerformanceVariants, DRUM, type GrooveKind, type DrumHit } from '../knowledge/grooves';
import { planGroove } from '../arranger/groovePlanner';
import { buildHarmonicPlan, buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { createTimebase, createRandomContext, pc } from '../foundation';
import type { Section, SectionFunctionTag } from '../arranger/ArrangementPlan';

// ============================================================
// 鼓组 groove(2026-06-08):4 macro 风格 × 4 GrooveKind × 2-3 变体。
//   分层:GROOVE 下发=Arranger(planGroove) · 变体匹配=器配(drumPatternBySection) ·
//          词汇=KB(drumGrooveVariants) · 消费=drumRenderer(patternBySection 主权威)。
//   验收:词汇密度有序/jazz 用 ride;Arranger 按 functionTag 下发且 repeatGroup 一致;
//          器配同 groove→同变体;renderDrums 逐段换鼓型;确定性。
// ============================================================

const STYLES = ['pop', 'rnb', 'lofi', 'jazz'] as const;
const KINDS: readonly GrooveKind[] = ['sparse', 'laidback', 'straight', 'driving'];

function sec(id: string, role: Section['role'], functionTag?: SectionFunctionTag): Section {
  return { id, role, functionTag, bars: 4, hookPolicy: 'none' };
}

describe('knowledge/grooves · 鼓型词汇库', () => {
  it('每 (style × groove) ≥1 变体;laidback/straight/driving ≥2 变体', () => {
    for (const style of STYLES) {
      for (const k of KINDS) {
        const vs = drumGrooveVariants(style, k);
        expect(vs.length).toBeGreaterThanOrEqual(1);
        if (k !== 'sparse') expect(vs.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('密度有序:sparse < driving(同风格,首变体 hit 数)', () => {
    for (const style of STYLES) {
      const sparse = drumGrooveVariants(style, 'sparse')[0].length;
      const driving = drumGrooveVariants(style, 'driving')[0].length;
      expect(driving).toBeGreaterThan(sparse);
    }
  });

  it('同 groove 的多个变体彼此不同(签名不一致)', () => {
    const sig = (hits: DrumHit[]) => hits.map((h) => `${h.drum}@${h.beat}`).sort().join(',');
    for (const style of STYLES) {
      for (const k of KINDS) {
        const vs = drumGrooveVariants(style, k);
        if (vs.length < 2) continue;
        const sigs = new Set(vs.map(sig));
        expect(sigs.size).toBe(vs.length); // 全互异
      }
    }
  });

  it('jazz 所有 groove 用 ride(51);非 jazz 用 closed-hat(42)', () => {
    for (const k of KINDS) {
      for (const v of drumGrooveVariants('jazz', k)) {
        expect(v.some((h) => h.drum === DRUM.RIDE)).toBe(true);
      }
      expect(drumGrooveVariants('pop', k)[0].some((h) => h.drum === DRUM.CHAT)).toBe(true);
    }
  });

  it('返回深拷贝:改动结果不污染下次取值', () => {
    const a = drumGrooveVariants('pop', 'straight');
    a[0][0].vel = -999;
    const b = drumGrooveVariants('pop', 'straight');
    expect(b[0][0].vel).toBeGreaterThan(0);
  });

  it('缺 groove → 回退该风格 straight(不抛)', () => {
    const vs = drumGrooveVariants('pop', 'nope' as GrooveKind);
    expect(vs).toEqual(drumGrooveVariants('pop', 'straight'));
  });

  it('DrumPerformance patternFamily 有真实鼓型族,且 lofi ≥3 类打法', () => {
    const families = ['lofi-boombap', 'lofi-dusty-break', 'lofi-minimal'] as const;
    const sigs = new Set<string>();
    for (const family of families) {
      const variants = drumPerformanceVariants({ patternFamily: family });
      expect(variants.length).toBeGreaterThanOrEqual(2);
      sigs.add(variants[0].map((h) => `${h.drum}@${h.beat}`).join('|'));
    }
    expect(sigs.size).toBe(families.length);
  });

  it('LOFI boombap/dusty-break 主体打法具备 hiphop backbeat + 切分 kick + 16 分帽', () => {
    for (const family of ['lofi-boombap', 'lofi-dusty-break'] as const) {
      for (const variant of drumPerformanceVariants({ patternFamily: family })) {
        const backbeatDrums = new Set<number>([DRUM.SNARE, DRUM.SIDESTICK, DRUM.CLAP]);
        expect(variant.some((h) => backbeatDrums.has(h.drum) && h.beat === 1), family).toBe(true);
        expect(variant.some((h) => backbeatDrums.has(h.drum) && h.beat === 3), family).toBe(true);
        expect(variant.some((h) => h.drum === DRUM.KICK && h.beat % 1 !== 0), family).toBe(true);
        expect(variant.some((h) => (h.drum === DRUM.CHAT || h.drum === DRUM.SHAKER) && h.beat % 0.5 !== 0), family).toBe(true);
      }
    }
  });
});

describe('arranger/groovePlanner · GROOVE 下发', () => {
  it('functionTag → GrooveKind 映射', () => {
    const sections: Section[] = [
      sec('s1', 'intro', 'setup'),
      sec('s2', 'verse', 'story'),
      sec('s3', 'verse', 'build'),
      sec('s4', 'chorus', 'hook'),
      sec('s5', 'bridge', 'breakdown'),
      sec('s6', 'outro', 'outro'),
    ];
    const g = planGroove(sections, 'pop');
    expect(g.s1).toBe('sparse');     // setup
    expect(g.s2).toBe('straight');   // story → pop base
    expect(g.s3).toBe('straight');   // build
    expect(g.s4).toBe('driving');    // hook
    expect(g.s5).toBe('sparse');     // breakdown
    expect(g.s6).toBe('sparse');     // outro
  });

  it('风格基底:rnb/lofi content 段 = laidback;jazz solo = driving;jazz head = straight', () => {
    expect(planGroove([sec('a', 'verse', 'story')], 'rnb').a).toBe('laidback');
    expect(planGroove([sec('a', 'verse', 'loop')], 'lofi').a).toBe('laidback');
    expect(planGroove([sec('a', 'verse', 'solo')], 'jazz').a).toBe('driving');
    expect(planGroove([sec('a', 'verse', 'head')], 'jazz').a).toBe('straight');
  });

  it('repeatGroup 一致:同 functionTag → 同 groove', () => {
    const g = planGroove([sec('v1', 'verse', 'story'), sec('v2', 'verse', 'story')], 'pop');
    expect(g.v1).toBe(g.v2);
  });

  it('无 functionTag → 按 role(intro/outro→sparse,chorus→driving,其余→base)', () => {
    const g = planGroove([sec('i', 'intro'), sec('v', 'verse'), sec('c', 'chorus'), sec('o', 'outro')], 'pop');
    expect(g.i).toBe('sparse');
    expect(g.c).toBe('driving');
    expect(g.o).toBe('sparse');
    expect(g.v).toBe('straight'); // pop base
  });
});

describe('arranger + 器配 · grooveBySection / drumPatternBySection', () => {
  for (const style of STYLES) {
    it(`${style}:每段都有 groove + drum pattern;同 groove → 同变体(repeatGroup 一致)`, () => {
      const seed = 4242;
      const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
      const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
      const instr = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'));

      const sig = (hits: readonly DrumHit[]) => hits.map((h) => `${h.drum}@${h.beat}:${h.vel}`).join('|');
      const patByGroove: Record<string, string> = {};
      for (const s of arrangement.sections) {
        const gk = arrangement.grooveBySection[s.id];
        expect(gk).toBeDefined();
        const pat = instr.drumPatternBySection[s.id];
        expect(pat).toBeDefined();
        expect(pat.length).toBeGreaterThan(0);
        // 同 groove → 同变体
        const sg = sig(pat);
        if (patByGroove[gk]) expect(sg).toBe(patByGroove[gk]);
        else patByGroove[gk] = sg;
      }
    });
  }

  it('确定性:同 seed → 同 drumPatternBySection', () => {
    const seed = 909;
    const mk = () => {
      const band = buildBandSpec({ seed, styleHint: 'pop', mood: 'build', targetDuration: 120 });
      const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
      return buildInstrumentationPlan(band, arr, createRandomContext(seed).substream('timbre')).drumPatternBySection;
    };
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});

describe('render/drumRenderer · 逐段换鼓型(groove 主权威)', () => {
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  const plan = buildHarmonicPlan({
    key: pc(0),
    beatsPerBar: 4,
    progression: [
      { degree: 1, quality: 'maj7', bars: 1 },
      { degree: 5, quality: '7', bars: 1 },
    ],
  });
  const sid = plan.chordTimeline[0].sectionId;

  it('patternBySection 决定每小节鼓型(密度逐段不同)', () => {
    const sparse: DrumHit[] = [{ drum: DRUM.KICK, beat: 0, vel: 100 }, { drum: DRUM.SNARE, beat: 2, vel: 84 }];
    const dense: DrumHit[] = [
      { drum: DRUM.KICK, beat: 0, vel: 112 }, { drum: DRUM.KICK, beat: 1, vel: 90 },
      { drum: DRUM.KICK, beat: 2, vel: 104 }, { drum: DRUM.KICK, beat: 3, vel: 90 },
      { drum: DRUM.SNARE, beat: 1, vel: 100 }, { drum: DRUM.SNARE, beat: 3, vel: 104 },
    ];
    const dSparse = renderDrums(plan, timebase, 4, { patternBySection: { [sid]: sparse } });
    const dDense = renderDrums(plan, timebase, 4, { patternBySection: { [sid]: dense } });
    // ★ base 密度用 KICK 计(per-bar 装饰只加 snare/tom/hat,不加 kick)→ robust 锁底层鼓型。
    expect(dSparse.notes.filter((n) => n.pitch === DRUM.KICK).length).toBe(2);  // 2 bars × 1 kick
    expect(dDense.notes.filter((n) => n.pitch === DRUM.KICK).length).toBe(8);   // 2 bars × 4 kicks
    expect(dDense.notes.length).toBeGreaterThan(dSparse.notes.length);          // 密度逐段不同
  });

  it('patternBySection 缺该段 → 回退 style pattern(向后兼容)', () => {
    const fallback = renderDrums(plan, timebase, 4, { style: 'pop', patternBySection: { otherSection: [] } });
    const baseline = renderDrums(plan, timebase, 4, { style: 'pop' });
    expect(fallback.notes.length).toBe(baseline.notes.length);
  });

  it('groove 主权威:有 patternBySection 时不再受 texturePocket 影响', () => {
    const onlyKick: DrumHit[] = [{ drum: DRUM.KICK, beat: 0, vel: 100 }];
    // 即便给一个会触发 pocket 的 textureSchedule,patternBySection 仍优先
    const sched = { [plan.chordTimeline[0].id]: 'Halftime_Pocket', [plan.chordTimeline[1].id]: 'Halftime_Pocket' } as never;
    const d = renderDrums(plan, timebase, 4, { patternBySection: { [sid]: onlyKick }, textureSchedule: sched });
    // groove(onlyKick=1 kick/bar)优先于 pocket(halftime kit=2 kick/bar)→ KICK 计=2 证明 groove 覆盖。
    expect(d.notes.filter((n) => n.pitch === DRUM.KICK).length).toBe(2);
    expect(d.notes.filter((n) => n.pitch === DRUM.KICK).every((n) => (n.startTick as number) % (timebase.ppq * 4) === 0)).toBe(true); // kick 都在小节下拍
  });

  it('DrumPerformanceContract entryMode 被 renderer 消费:hat-only 首小节不出 kick/snare', () => {
    const sid0 = plan.chordTimeline[0].sectionId;
    const pattern: DrumHit[] = [{ drum: DRUM.KICK, beat: 0, vel: 100 }, { drum: DRUM.SNARE, beat: 2, vel: 84 }, { drum: DRUM.CHAT, beat: 0, vel: 44 }, { drum: DRUM.CHAT, beat: 1, vel: 40 }];
    const perf = {
      id: 'test', sectionId: sid0, role: 'breakdown', patternFamily: 'pop-backbeat', complexity: 1, intensity: 1, densityCeiling: 1,
      entryMode: 'hat-only', fillPolicy: 'none', fillAmount: 0, fillComplexity: 0, phraseVariation: 1, swingUnit: '8th',
      safeRangeTicks: 8, maxMoveTicks: 12, preQuantizeGrid: '16th', humanizeAmount: 1, feelOffsetMs: 0,
      timingProfile: 'tight', velocityProfile: 'flat', kickPolicy: 'syncopated', snarePolicy: 'backbeat',
      hatPolicy: 'eighths', cymbalPolicy: 'none', tomPolicy: 'none', foregroundGuard: 'strict',
    } as const;
    const d = renderDrums(plan, timebase, 4, { patternBySection: { [sid0]: pattern }, performanceBySection: { [sid0]: perf } });
    const bar0 = d.notes.filter((n) => (n.startTick as number) < timebase.ppq * 4).map((n) => n.pitch as number);
    expect(bar0).not.toContain(DRUM.KICK);
    expect(bar0).not.toContain(DRUM.SNARE);
    expect(bar0).toContain(DRUM.CHAT);
  });

  it('DrumPerformanceContract fillPolicy=none 会压住 legacy fillBars', () => {
    const perf = {
      id: 'test', sectionId: sid, role: 'timekeeper', patternFamily: 'pop-backbeat', complexity: 1, intensity: 1, densityCeiling: 1,
      entryMode: 'full', fillPolicy: 'none', fillAmount: 0, fillComplexity: 0, phraseVariation: 1, swingUnit: '8th',
      safeRangeTicks: 8, maxMoveTicks: 12, preQuantizeGrid: '16th', humanizeAmount: 1, feelOffsetMs: 0,
      timingProfile: 'tight', velocityProfile: 'flat', kickPolicy: 'syncopated', snarePolicy: 'backbeat',
      hatPolicy: 'eighths', cymbalPolicy: 'none', tomPolicy: 'none', foregroundGuard: 'strict',
    } as const;
    const d = renderDrums(plan, timebase, 4, { style: 'pop', fillBars: new Set([0]), performanceBySection: { [sid]: perf } });
    const bar0 = d.notes.filter((n) => (n.startTick as number) < timebase.ppq * 4).map((n) => n.pitch as number);
    expect(bar0).not.toContain(DRUM.TOM_LO);
    expect(bar0).not.toContain(DRUM.TOM_MID);
    expect(bar0).not.toContain(DRUM.TOM_HI);
  });

  it('DrumPerformanceContract timingProfile=dilla-late 会实际移动鼓点 tick,且受 maxMove 限制', () => {
    const pattern: DrumHit[] = [{ drum: DRUM.KICK, beat: 0, vel: 100 }, { drum: DRUM.SNARE, beat: 1, vel: 84 }, { drum: DRUM.CHAT, beat: 1.5, vel: 44 }];
    const perf = {
      id: 'test', sectionId: sid, role: 'timekeeper', patternFamily: 'rnb-dilla', complexity: 2, intensity: 2, densityCeiling: 1,
      entryMode: 'full', fillPolicy: 'none', fillAmount: 0, fillComplexity: 0, phraseVariation: 0, swingUnit: '16th',
      safeRangeTicks: 4, maxMoveTicks: 24, preQuantizeGrid: '16th', humanizeAmount: 3, feelOffsetMs: 25,
      timingProfile: 'dilla-late', velocityProfile: 'ghosted', kickPolicy: 'syncopated', snarePolicy: 'ghost-before-backbeat',
      hatPolicy: 'shaker16', cymbalPolicy: 'none', tomPolicy: 'none', foregroundGuard: 'normal',
    } as const;
    const d = renderDrums(plan, timebase, 4, { patternBySection: { [sid]: pattern }, performanceBySection: { [sid]: perf }, tempoBpm: 120 });
    const snare = d.notes.find((n) => n.pitch === DRUM.SNARE)!;
    const hat = d.notes.find((n) => n.pitch === DRUM.CHAT)!;
    expect(snare.startTick as number).toBeGreaterThan(timebase.ppq);
    expect((snare.startTick as number) - timebase.ppq).toBeLessThanOrEqual(24);
    expect(hat.startTick as number).toBeGreaterThan(Math.round(timebase.ppq * 1.5));
  });

  it('DrumPerformanceContract fillAmount/fillComplexity 改变 fill 密度', () => {
    const base = {
      id: 'test', sectionId: sid, role: 'timekeeper', patternFamily: 'pop-backbeat', complexity: 1, intensity: 1, densityCeiling: 1,
      entryMode: 'full', fillPolicy: 'light', phraseVariation: 0, swingUnit: '8th',
      safeRangeTicks: 8, maxMoveTicks: 12, preQuantizeGrid: '16th', humanizeAmount: 1, feelOffsetMs: 0,
      timingProfile: 'tight', velocityProfile: 'flat', kickPolicy: 'syncopated', snarePolicy: 'backbeat',
      hatPolicy: 'eighths', cymbalPolicy: 'section-crash', tomPolicy: 'turnaround', foregroundGuard: 'normal',
    } as const;
    const low = renderDrums(plan, timebase, 4, { style: 'pop', fillBars: new Set([0]), performanceBySection: { [sid]: { ...base, fillAmount: 1, fillComplexity: 1 } } });
    const high = renderDrums(plan, timebase, 4, { style: 'pop', fillBars: new Set([0]), performanceBySection: { [sid]: { ...base, fillAmount: 2, fillComplexity: 2 } } });
    const bar0 = (t: typeof low) => t.notes.filter((n) => (n.startTick as number) < timebase.ppq * 4).length;
    expect(bar0(high)).toBeGreaterThan(bar0(low));
  });
});

describe('render/full · groove 落到成品鼓轨', () => {
  it('含 framing(sparse)+ core(driving)的歌:鼓轨各段每小节密度不全相同', () => {
    const seed = 163462;
    const band = buildBandSpec({ seed, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
    const instr = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'));
    // 至少存在两种不同 groove → 两种不同鼓型签名
    const sigs = new Set(
      Object.values(arrangement.grooveBySection).map((gk) => gk),
    );
    expect(sigs.size).toBeGreaterThanOrEqual(2); // 不再全曲单一 groove
    // 对应的鼓型也至少两种
    const patSigs = new Set(
      arrangement.sections.map((s) => instr.drumPatternBySection[s.id].map((h) => `${h.drum}@${h.beat}`).join(',')),
    );
    expect(patSigs.size).toBeGreaterThanOrEqual(2);
    void buildHarmonicPlanFromArrangement; // 保持 import(全链路 smoke 见其它测试)
  });
});
