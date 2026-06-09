import { describe, it, expect } from 'vitest';
import { renderDrums } from './drumRenderer';
import { drumGrooveVariants, DRUM, type GrooveKind, type DrumHit } from '../knowledge/grooves';
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
