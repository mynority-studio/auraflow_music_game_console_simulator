import { describe, it, expect } from 'vitest';
import { applyFinalDrumFollow, renderDrums } from './drumRenderer';
import { drumGrooveVariants, drumPerformanceVariants, DRUM, type GrooveKind, type DrumHit } from '../knowledge/grooves';
import { materializePopRockFill } from '../knowledge/drumFillVocabulary';
import { planGroove } from '../arranger/groovePlanner';
import { buildHarmonicPlan, buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { createTimebase, createRandomContext, midi, pc, ticks } from '../foundation';
import type { GrooveScorePlan, Section, SectionFunctionTag } from '../arranger/ArrangementPlan';

// ============================================================
// 鼓组 groove(2026-06-08):4 macro 风格 × 4 GrooveKind × 2-3 变体。
//   分层:GROOVE 下发=Arranger(planGroove) · 变体匹配=器配(drumPatternBySection) ·
//          词汇=KB(drumGrooveVariants) · 消费=drumRenderer(patternBySection 主权威)。
//   验收:词汇密度有序/jazz 用 ride;Arranger 按 functionTag 下发且 repeatGroup 一致;
//          器配同演奏法 key→同变体;renderDrums 逐段换鼓型;确定性。
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
    const families = ['tr808-lofi-boombap', 'tr808-lofi-dusty-break', 'tr808-lofi-minimal'] as const;
    const sigs = new Set<string>();
    for (const family of families) {
      const variants = drumPerformanceVariants({ patternFamily: family });
      expect(variants.length).toBeGreaterThanOrEqual(2);
      sigs.add(variants[0].map((h) => `${h.drum}@${h.beat}`).join('|'));
    }
    expect(sigs.size).toBe(families.length);
  });

  it('POP/JAZZ/RNB DrumPerformance family 具备各自鼓手打法语汇', () => {
    const families = [
      'citypop-disco-boogie',
      'citypop-syncopated-boogie',
      'tr808-rnb-pocket',
      'tr808-dilla-pocket',
      'tr808-trap-soul-halftime',
      'tr808-lofi-boombap',
      'tr808-lofi-dusty-break',
      'tr808-lofi-minimal',
      'rnb-neo-soul-pocket',
      'rnb-dilla-pocket',
      'rnb-gospel-triplet',
      'jazz-brush-ballad',
      'smooth-jazz-backbeat',
    ];
    const sigs = new Set<string>();
    for (const family of families) {
      const variants = drumPerformanceVariants({ patternFamily: family });
      expect(variants.length, family).toBeGreaterThanOrEqual(2);
      sigs.add(variants[0].map((h) => `${h.drum}@${h.beat}`).join('|'));
    }
    expect(sigs.size).toBe(families.length);
  });

  it('TR-808 鼓机族使用独立 machine 语汇,不混 Room/Brush 颜色', () => {
    const machineOnly = new Set<number>([DRUM.KICK, DRUM.SNARE, DRUM.SIDESTICK, DRUM.CLAP, DRUM.CHAT, DRUM.OHAT]);
    for (const family of ['tr808-rnb-pocket', 'tr808-dilla-pocket', 'tr808-trap-soul-halftime', 'tr808-lofi-boombap', 'tr808-lofi-dusty-break', 'tr808-lofi-minimal'] as const) {
      for (const variant of drumPerformanceVariants({ patternFamily: family })) {
        expect(variant.every((h) => machineOnly.has(h.drum)), family).toBe(true);
        expect(variant.some((h) => h.drum === DRUM.CHAT && h.beat % 0.5 !== 0), `${family} 16th machine hats`).toBe(true);
        expect(variant.some((h) => h.drum === DRUM.TAMB || h.drum === DRUM.SHAKER || h.drum === DRUM.RIDE), `${family} no room/brush color`).toBe(false);
      }
    }
  });

  it('CityPop / RNB / Jazz brush 的打法特征不退回通用 backbeat', () => {
    const backbeatDrums = new Set<number>([DRUM.SNARE, DRUM.SIDESTICK, DRUM.CLAP]);
    for (const variant of drumPerformanceVariants({ patternFamily: 'citypop-syncopated-boogie' })) {
      expect(variant.some((h) => backbeatDrums.has(h.drum) && h.beat === 1), 'citypop 2').toBe(true);
      expect(variant.some((h) => backbeatDrums.has(h.drum) && h.beat === 3), 'citypop 4').toBe(true);
      expect(variant.some((h) => h.drum === DRUM.CHAT && h.beat % 0.5 !== 0), 'citypop 16th hats').toBe(true);
      expect(variant.some((h) => h.drum === DRUM.TAMB), 'citypop tambourine').toBe(true);
      expect(variant.some((h) => h.drum === DRUM.KICK && h.beat % 1 !== 0), 'citypop sync kick').toBe(true);
    }
    for (const family of ['rnb-neo-soul-pocket', 'rnb-dilla-pocket']) {
      for (const variant of drumPerformanceVariants({ patternFamily: family })) {
        expect(variant.some((h) => h.drum === DRUM.SHAKER || h.drum === DRUM.CHAT), `${family} shaker/hat`).toBe(true);
        expect(variant.some((h) => backbeatDrums.has(h.drum) && h.vel <= 34), `${family} ghost`).toBe(true);
      }
    }
    for (const variant of drumPerformanceVariants({ patternFamily: 'jazz-brush-ballad' })) {
      expect(variant.some((h) => h.drum === DRUM.RIDE), 'brush ride').toBe(true);
      expect(variant.some((h) => h.drum === DRUM.PHAT && h.beat === 1), 'brush hat 2').toBe(true);
      expect(variant.some((h) => h.drum === DRUM.PHAT && h.beat === 3), 'brush hat 4').toBe(true);
      expect(variant.filter((h) => backbeatDrums.has(h.drum)).every((h) => h.vel <= 30), 'brush soft snare').toBe(true);
    }
  });

  it('POP 参考打法具备 CityPop/现代 POP 鼓手语汇,不是旧八分帽模板', () => {
    const backbeatDrums = new Set<number>([DRUM.SNARE, DRUM.CLAP]);
    for (const family of ['citypop-syncopated-boogie', 'citypop-disco-boogie', 'jpop-driving-8ths', 'pop-backbeat'] as const) {
      for (const variant of drumPerformanceVariants({ patternFamily: family })) {
        expect(variant.some((h) => h.drum === DRUM.CHAT && h.beat % 0.5 !== 0), `${family} 16th hats`).toBe(true);
        expect(variant.some((h) => backbeatDrums.has(h.drum) && h.beat === 1), `${family} backbeat 2`).toBe(true);
        expect(variant.some((h) => backbeatDrums.has(h.drum) && h.beat === 3), `${family} backbeat 4`).toBe(true);
      }
    }
    for (const family of ['citypop-syncopated-boogie', 'citypop-disco-boogie'] as const) {
      for (const variant of drumPerformanceVariants({ patternFamily: family })) {
        expect(variant.some((h) => h.drum === DRUM.TAMB), `${family} tambourine engine`).toBe(true);
        expect(variant.some((h) => h.drum === DRUM.OHAT), `${family} open-hat lift`).toBe(true);
      }
    }
    for (const variant of drumPerformanceVariants({ patternFamily: 'citypop-disco-boogie' })) {
      expect(variant.filter((h) => h.drum === DRUM.KICK && Number.isInteger(h.beat)).length, 'citypop disco four-on-floor').toBeGreaterThanOrEqual(4);
    }
    for (const variant of drumPerformanceVariants({ patternFamily: 'citypop-syncopated-boogie' })) {
      expect(variant.some((h) => h.drum === DRUM.KICK && h.beat % 1 !== 0), 'citypop syncopated kick').toBe(true);
    }
    for (const family of ['pop-backbeat', 'jpop-driving-8ths'] as const) {
      const variants = drumPerformanceVariants({ patternFamily: family });
      const allHits = variants.flat();
      expect(allHits.some((h) => h.drum === DRUM.KICK && h.beat % 1 !== 0), `${family} syncopated kick answer`).toBe(true);
      expect(allHits.some((h) => backbeatDrums.has(h.drum) && h.vel <= 44 && h.beat !== 1 && h.beat !== 3), `${family} ghost backbeat detail`).toBe(true);
      expect(allHits.some((h) => h.drum === DRUM.TAMB || h.drum === DRUM.SHAKER || h.drum === DRUM.CONGA_HI || h.drum === DRUM.CONGA_LO), `${family} light bar percussion`).toBe(true);
    }
  });

  it('LOFI boombap/dusty-break 主体打法具备 hiphop backbeat + 切分 kick + 16 分帽', () => {
    for (const family of ['tr808-lofi-boombap', 'tr808-lofi-dusty-break'] as const) {
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
    expect(g.s4).toBe('straight');   // POP hook 默认只 lift,不直接硬推 driving
    expect(g.s5).toBe('sparse');     // breakdown
    expect(g.s6).toBe('sparse');     // outro
    expect(planGroove(sections, 'pop', 'upbeat dance 快歌').s4).toBe('driving');
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

  it('无 functionTag → 按 role(intro/outro→sparse,POP chorus 默认 straight,其余→base)', () => {
    const g = planGroove([sec('i', 'intro'), sec('v', 'verse'), sec('c', 'chorus'), sec('o', 'outro')], 'pop');
    expect(g.i).toBe('sparse');
    expect(g.c).toBe('straight');
    expect(g.o).toBe('sparse');
    expect(g.v).toBe('straight'); // pop base
    expect(planGroove([sec('c', 'chorus')], 'pop', 'upbeat dance 快歌').c).toBe('driving');
  });
});

describe('arranger + 器配 · grooveBySection / drumPatternBySection', () => {
  for (const style of STYLES) {
    it(`${style}:每段都有 groove + drum pattern;同演奏法 key → 同变体(repeatGroup 一致)`, () => {
      const seed = 4242;
      const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
      const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
      const instr = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'));

      const sig = (hits: readonly DrumHit[]) => hits.map((h) => `${h.drum}@${h.beat}:${h.vel}`).join('|');
      const patByPerformanceKey: Record<string, string> = {};
      for (const s of arrangement.sections) {
        const gk = arrangement.grooveBySection[s.id];
        expect(gk).toBeDefined();
        const pat = instr.drumPatternBySection[s.id];
        expect(pat).toBeDefined();
        expect(pat.length).toBeGreaterThan(0);
        // 同演奏法 key → 同变体；不同功能段即使同 groove 也允许不同手法。
        const perf = arrangement.drumPerformanceBySection?.[s.id];
        const performanceKey = perf
          ? `${perf.patternFamily}:${s.repeatGroup ?? s.functionTag ?? s.role}:${perf.role}:${perf.complexity}`
          : `legacy:${gk}`;
        const sg = sig(pat);
        if (patByPerformanceKey[performanceKey]) expect(sg).toBe(patByPerformanceKey[performanceKey]);
        else patByPerformanceKey[performanceKey] = sg;
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
      id: 'test', sectionId: sid0, grooveContractId: 'test', feelProfileId: 'pop-tight-backbeat', role: 'breakdown', kitProgram: 8, patternFamily: 'pop-backbeat', complexity: 1, intensity: 1, densityCeiling: 1,
      entryMode: 'hat-only', fillPolicy: 'none', fillAmount: 0, fillComplexity: 0, phraseVariation: 1,
      maxMoveTicks: 12, humanizeAmount: 1, feelOffsetMs: 0,
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
      id: 'test', sectionId: sid, grooveContractId: 'test', feelProfileId: 'pop-tight-backbeat', role: 'timekeeper', kitProgram: 8, patternFamily: 'pop-backbeat', complexity: 1, intensity: 1, densityCeiling: 1,
      entryMode: 'full', fillPolicy: 'none', fillAmount: 0, fillComplexity: 0, phraseVariation: 1,
      maxMoveTicks: 12, humanizeAmount: 1, feelOffsetMs: 0,
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
      id: 'test', sectionId: sid, grooveContractId: 'test', feelProfileId: 'rnb-dilla-voices', role: 'timekeeper', kitProgram: 25, patternFamily: 'tr808-dilla-pocket', complexity: 2, intensity: 2, densityCeiling: 1,
      entryMode: 'full', fillPolicy: 'none', fillAmount: 0, fillComplexity: 0, phraseVariation: 0,
      maxMoveTicks: 24, humanizeAmount: 3, feelOffsetMs: 25,
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
      id: 'test', sectionId: sid, grooveContractId: 'test', feelProfileId: 'pop-tight-backbeat', role: 'timekeeper', kitProgram: 8, patternFamily: 'pop-backbeat', complexity: 1, intensity: 1, densityCeiling: 1,
      entryMode: 'full', fillPolicy: 'light', phraseVariation: 0,
      maxMoveTicks: 12, humanizeAmount: 1, feelOffsetMs: 0,
      timingProfile: 'tight', velocityProfile: 'flat', kickPolicy: 'syncopated', snarePolicy: 'backbeat',
      hatPolicy: 'eighths', cymbalPolicy: 'section-crash', tomPolicy: 'turnaround', foregroundGuard: 'normal',
    } as const;
    const low = renderDrums(plan, timebase, 4, { style: 'pop', fillBars: new Set([0]), performanceBySection: { [sid]: { ...base, fillAmount: 1, fillComplexity: 1 } } });
    const high = renderDrums(plan, timebase, 4, { style: 'pop', fillBars: new Set([0]), performanceBySection: { [sid]: { ...base, fillAmount: 2, fillComplexity: 2 } } });
    const bar0 = (t: typeof low) => t.notes.filter((n) => (n.startTick as number) < timebase.ppq * 4).length;
    expect(bar0(high)).toBeGreaterThan(bar0(low));
  });

  it('逐小节 drumInteraction 会实际让 kick 跟 Bass、snare catch Comp，而不是只记录字段', () => {
    const base: DrumHit[] = [
      { drum: DRUM.KICK, beat: 0, vel: 100 },
      { drum: DRUM.KICK, beat: 2, vel: 88 },
      { drum: DRUM.SNARE, beat: 1, vel: 84 },
      { drum: DRUM.SNARE, beat: 3, vel: 88 },
      ...Array.from({ length: 8 }, (_, index) => ({ drum: DRUM.CHAT, beat: index * 0.5, vel: 42 })),
    ];
    const makeScore = (
      kickFollow: 'bass' | 'pulse',
      snareFollow: 'backbeat' | 'comping' | 'lead-accents',
    ): GrooveScorePlan => ({
      grooveContractId: 'test-follow',
      bySection: {
        [sid]: {
          sectionId: sid,
          grooveContractId: 'test-follow',
          bars: [0, 1].map((absoluteBar) => ({
            sectionId: sid,
            barInSection: absoluteBar,
            absoluteBar,
            phraseIndex: 0,
            phraseBarIndex: absoluteBar,
            role: 'base',
            beatStrength: [1, 0.9, 1, 0.9],
            subdivision: 'sixteenth',
            subdivisionAccent: [1, 0.65, 0.84, 0.62],
            phraseAccent: 1,
            drumInteraction: {
              kickFollow,
              snareFollow,
              structuralKickBeats: kickFollow === 'bass' ? [0] : [0, 2],
              structuralSnareBeats: snareFollow === 'backbeat' ? [1, 3] : [],
              kickResponseLimit: kickFollow === 'bass' ? 2 : 0,
              snareResponseLimit: snareFollow === 'backbeat' ? 0 : 2,
            },
          })),
        },
      },
      boundaries: [],
    });
    const note = (beat: number, velocity: number) => ({
      pitch: midi(48),
      startTick: ticks(Math.round(beat * timebase.ppq)),
      durationTicks: ticks(Math.round(timebase.ppq * 0.4)),
      velocity,
    });
    const followSources = {
      bass: { notes: [note(0, 92), note(1.5, 90), note(2.75, 84)] },
      comp: { notes: [note(1.5, 70), note(1.5, 62), note(3.5, 74)] },
      lead: { notes: [note(0.75, 88), note(2.25, 82)] },
    };
    const followed = renderDrums(plan, timebase, 4, {
      patternBySection: { [sid]: base },
      grooveScorePlan: makeScore('bass', 'comping'),
      followSources,
    });
    const fixed = renderDrums(plan, timebase, 4, {
      patternBySection: { [sid]: base },
      grooveScorePlan: makeScore('pulse', 'backbeat'),
      followSources,
    });
    const leadCaught = renderDrums(plan, timebase, 4, {
      patternBySection: { [sid]: base },
      grooveScorePlan: makeScore('pulse', 'lead-accents'),
      followSources,
    });
    const beatsOf = (track: typeof followed, pitch: number) => track.notes
      .filter((entry) => entry.pitch === pitch && (entry.startTick as number) < timebase.ppq * 4)
      .map((entry) => (entry.startTick as number) / timebase.ppq);

    expect(beatsOf(followed, DRUM.KICK)).toEqual([0, 1.5, 2.75]);
    expect(beatsOf(fixed, DRUM.KICK)).toEqual([0, 2]);
    expect(beatsOf(followed, DRUM.SNARE)).toEqual(expect.arrayContaining([1.5, 3.5]));
    expect(beatsOf(fixed, DRUM.SNARE)).not.toEqual(expect.arrayContaining([1.5, 3.5]));
    expect(beatsOf(leadCaught, DRUM.SNARE)).toEqual(expect.arrayContaining([0.75, 2.25]));

    const shiftedBass = [
      { ...note(1.5, 90), startTick: ticks(Math.round(1.5 * timebase.ppq) + 11) },
      { ...note(2.75, 84), startTick: ticks(Math.round(2.75 * timebase.ppq) + 17) },
    ];
    const baseDrum = renderDrums(plan, timebase, 4, {
      patternBySection: { [sid]: base },
      grooveScorePlan: makeScore('bass', 'backbeat'),
    });
    const final = applyFinalDrumFollow([baseDrum, { role: 'bass', notes: shiftedBass }], {
      beatsPerBar: 4,
      ppq: timebase.ppq,
      grooveScorePlan: makeScore('bass', 'backbeat'),
      followSources: { bass: { notes: shiftedBass }, comp: { notes: [] }, lead: { notes: [] } },
    });
    const finalKicks = final.find((track) => track.role === 'drum')!.notes
      .filter((entry) => entry.pitch === DRUM.KICK && (entry.startTick as number) < timebase.ppq * 4)
      .map((entry) => entry.startTick as number);
    expect(finalKicks).toEqual([0, shiftedBass[0].startTick as number, shiftedBass[1].startTick as number]);
    expect(finalKicks).not.toContain(2 * timebase.ppq);

    const earlyNextDownbeat = [{
      ...note(4, 94),
      startTick: ticks(4 * timebase.ppq - 8),
    }];
    const anchored = applyFinalDrumFollow([baseDrum, { role: 'bass', notes: earlyNextDownbeat }], {
      beatsPerBar: 4,
      ppq: timebase.ppq,
      grooveScorePlan: makeScore('bass', 'backbeat'),
      followSources: { bass: { notes: earlyNextDownbeat }, comp: { notes: [] }, lead: { notes: [] } },
    });
    const secondBarKick = anchored.find((track) => track.role === 'drum')!.notes.find((entry) =>
      entry.pitch === DRUM.KICK
      && Math.abs((entry.startTick as number) - 4 * timebase.ppq) <= 16);
    expect(secondBarKick?.startTick as number).toBe(4 * timebase.ppq);
  });

  it('GrooveScore 边界会先遮掉旧 loop 的 fill 窗口，再实现 RNB pocket turn 与唯一落点', () => {
    const base: DrumHit[] = [
      { drum: DRUM.KICK, beat: 0, vel: 96 },
      { drum: DRUM.SNARE, beat: 1, vel: 82 },
      ...Array.from({ length: 8 }, (_, index) => ({ drum: DRUM.CHAT, beat: index * 0.5, vel: 42 })),
    ];
    const grooveScorePlan = {
      grooveContractId: 'test-rnb',
      bySection: {},
      boundaries: [{
        id: 'a->b:rnb-pocket-turn',
        fromSectionId: sid,
        toSectionId: sid,
        sourceBar: 0,
        landingBar: 1,
        kind: 'fill',
        intensity: 2,
        durationBeats: 1,
        baseMask: 'mask-window',
        drumFillFamily: 'rnb-pocket-turn',
        landing: 'kick',
        opening: false,
      }],
    } satisfies GrooveScorePlan;
    const rendered = renderDrums(plan, timebase, 4, {
      patternBySection: { [sid]: base },
      grooveScorePlan,
    });
    const at = (beat: number, pitch: number) => rendered.notes.filter((note) =>
      (note.startTick as number) === Math.round(beat * timebase.ppq)
      && (note.pitch as number) === pitch);
    const fillWindow = rendered.notes.filter((note) => {
      const beat = (note.startTick as number) / timebase.ppq;
      return beat >= 3 && beat < 4;
    });

    expect(at(3.5, DRUM.CHAT)).toHaveLength(0);
    expect(at(3.25, DRUM.SIDESTICK)).toHaveLength(1);
    expect(at(3.5, DRUM.SNARE)).toHaveLength(1);
    expect(at(3.75, DRUM.KICK)).toHaveLength(1);
    expect(fillWindow.some((note) => new Set<number>([DRUM.TOM_LO, DRUM.TOM_MID, DRUM.TOM_HI]).has(note.pitch as number))).toBe(false);
    expect(at(4, DRUM.KICK)).toHaveLength(1);
  });

  it('POP ballad performance 会把旧式 hard fill 降级为 sidestick,不出 tom/crash/open snare', () => {
    const base: DrumHit[] = [
      { drum: DRUM.KICK, beat: 0, vel: 88 },
      { drum: DRUM.SNARE, beat: 2, vel: 86 },
      ...Array.from({ length: 4 }, (_, index) => ({ drum: DRUM.CHAT, beat: index, vel: 30 })),
    ];
    const performance = {
      id: 'ballad', sectionId: sid, grooveContractId: 'pop_ballad_halftime', feelProfileId: 'pop-ballad-soft',
      role: 'timekeeper', kitProgram: 8, patternFamily: 'ballad-halftime', complexity: 1, intensity: 1, densityCeiling: 0.42,
      entryMode: 'full', fillPolicy: 'light', fillAmount: 1, fillComplexity: 1, phraseVariation: 0,
      maxMoveTicks: 12, humanizeAmount: 1, feelOffsetMs: 7,
      timingProfile: 'behind-snare', velocityProfile: 'ghosted', kickPolicy: 'halftime', snarePolicy: 'rim',
      hatPolicy: 'eighths', cymbalPolicy: 'none', tomPolicy: 'none', foregroundGuard: 'strict',
    } as const;
    const grooveScorePlan = {
      grooveContractId: 'pop_ballad_halftime',
      bySection: {
        [sid]: {
          sectionId: sid,
          grooveContractId: 'pop_ballad_halftime',
          bars: [0, 1].map((absoluteBar) => ({
            sectionId: sid,
            barInSection: absoluteBar,
            absoluteBar,
            phraseIndex: 0,
            phraseBarIndex: absoluteBar,
            role: 'base',
            beatStrength: [1, 0.86, 0.98, 0.84],
            subdivision: 'eighth',
            subdivisionAccent: [1, 0.72],
            phraseAccent: 1,
            drumInteraction: {
              kickFollow: 'pulse',
              snareFollow: 'backbeat',
              structuralKickBeats: [0, 2],
              structuralSnareBeats: [2],
              kickResponseLimit: 0,
              snareResponseLimit: 0,
            },
          })),
        },
      },
      boundaries: [{
        id: 'verse->chorus:legacy-hard',
        fromSectionId: sid,
        toSectionId: sid,
        sourceBar: 0,
        landingBar: 1,
        kind: 'fill',
        intensity: 3,
        durationBeats: 2,
        baseMask: 'mask-window',
        drumFillFamily: 'pop-tom-build',
        fillFunction: 'climax',
        fillScore: materializePopRockFill({
          rhythmClass: 'syncopated-sixteenth',
          orchestration: 'linear-hand-foot',
          function: 'climax',
          variant: 3,
          durationBeats: 2,
          intensity: 3,
        }),
        landing: 'kick-crash',
        opening: false,
      }],
    } satisfies GrooveScorePlan;
    const rendered = renderDrums(plan, timebase, 4, {
      patternBySection: { [sid]: base },
      performanceBySection: { [sid]: performance },
      grooveScorePlan,
    });
    const pitches = rendered.notes.map((note) => note.pitch as number);
    const toms = new Set<number>([DRUM.TOM_LO, DRUM.TOM_MID, DRUM.TOM_HI]);
    const kickVelocities = rendered.notes
      .filter((note) => (note.pitch as number) === DRUM.KICK)
      .map((note) => note.velocity);

    expect(pitches).toContain(DRUM.SIDESTICK);
    expect(pitches).not.toContain(DRUM.SNARE);
    expect(pitches).not.toContain(DRUM.CRASH);
    expect(pitches.some((pitch) => toms.has(pitch))).toBe(false);
    expect(Math.max(...kickVelocities)).toBeLessThanOrEqual(84);
  });

  it('Renderer 会逐击消费 Arranger 写下的 POP/Rock hand-foot fill score', () => {
    const base: DrumHit[] = [
      { drum: DRUM.KICK, beat: 0, vel: 96 },
      { drum: DRUM.SNARE, beat: 1, vel: 82 },
      ...Array.from({ length: 8 }, (_, index) => ({ drum: DRUM.CHAT, beat: index * 0.5, vel: 42 })),
    ];
    const fillScore = materializePopRockFill({
      rhythmClass: 'syncopated-sixteenth',
      orchestration: 'linear-hand-foot',
      function: 'climax',
      variant: 3,
      durationBeats: 2,
      intensity: 3,
    });
    const grooveScorePlan = {
      grooveContractId: 'test-pop-rock',
      bySection: {},
      boundaries: [{
        id: 'verse->chorus:pop-rock',
        fromSectionId: sid,
        toSectionId: sid,
        sourceBar: 0,
        landingBar: 1,
        kind: 'fill',
        intensity: 3,
        durationBeats: 2,
        baseMask: 'mask-window',
        drumFillFamily: 'pop-tom-build',
        fillFunction: 'climax',
        fillScore,
        landing: 'none',
        opening: false,
      }],
    } satisfies GrooveScorePlan;
    const rendered = renderDrums(plan, timebase, 4, {
      patternBySection: { [sid]: base },
      grooveScorePlan,
    });
    const pitchByVoice = {
      kick: DRUM.KICK,
      snare: DRUM.SNARE,
      'tom-high': DRUM.TOM_HI,
      'tom-mid': DRUM.TOM_MID,
      'tom-low': DRUM.TOM_LO,
    } as const;

    for (const hit of fillScore.hits) {
      const tick = Math.round((4 + hit.offsetBeatsFromEnd) * timebase.ppq);
      expect(rendered.notes.some((note) =>
        (note.startTick as number) === tick
        && (note.pitch as number) === pitchByVoice[hit.voice]), `${hit.voice}@${hit.offsetBeatsFromEnd}`).toBe(true);
    }
    expect(rendered.notes.some((note) =>
      (note.startTick as number) === timebase.ppq * 2
      && (note.pitch as number) === DRUM.CHAT)).toBe(false);
    expect(fillScore.hits.some((hit) => hit.voice === 'kick')).toBe(true);
    expect(fillScore.hits.some((hit) => hit.voice.startsWith('tom-'))).toBe(true);
  });

  it('Renderer consumes bar trajectory so the scored climax is dynamically above a settled bar', () => {
    const pattern: DrumHit[] = [
      { drum: DRUM.KICK, beat: 0, vel: 100 },
      { drum: DRUM.SNARE, beat: 1, vel: 84 },
      { drum: DRUM.SNARE, beat: 3, vel: 88 },
    ];
    const bar = (absoluteBar: number, trajectory: 'settled' | 'peak', energy: number) => ({
      sectionId: sid,
      barInSection: absoluteBar,
      absoluteBar,
      phraseIndex: 0,
      phraseBarIndex: absoluteBar,
      role: 'base' as const,
      beatStrength: [1, 0.9, 1, 0.9],
      subdivision: 'sixteenth' as const,
      subdivisionAccent: [1, 0.65, 0.84, 0.62],
      phraseAccent: 1,
      energy,
      trajectory,
    });
    const grooveScorePlan = {
      grooveContractId: 'test-trajectory',
      bySection: {
        [sid]: {
          sectionId: sid,
          grooveContractId: 'test-trajectory',
          bars: [bar(0, 'settled', 0.52), bar(1, 'peak', 0.9)],
        },
      },
      boundaries: [],
    } satisfies GrooveScorePlan;
    const rendered = renderDrums(plan, timebase, 4, {
      patternBySection: { [sid]: pattern },
      grooveScorePlan,
    });
    const kickAtBar = (barIndex: number) => rendered.notes.find((note) =>
      (note.pitch as number) === DRUM.KICK
      && (note.startTick as number) === barIndex * 4 * timebase.ppq)!;

    expect(kickAtBar(1).velocity).toBeGreaterThan(kickAtBar(0).velocity);
  });

  it('GrooveScore phrase roles materially author ghost, lift and turnaround events', () => {
    const pattern: DrumHit[] = [
      { drum: DRUM.KICK, beat: 0, vel: 100 },
      { drum: DRUM.SNARE, beat: 1, vel: 94 },
      { drum: DRUM.SNARE, beat: 3, vel: 96 },
      ...Array.from({ length: 8 }, (_, index) => ({ drum: DRUM.CHAT, beat: index * 0.5, vel: 48 })),
    ];
    const bar = (absoluteBar: number, role: 'answer' | 'turnaround') => ({
      sectionId: sid, barInSection: absoluteBar, absoluteBar, phraseIndex: 0, phraseBarIndex: absoluteBar,
      role, beatStrength: [1, 0.9, 1, 0.88], subdivision: 'sixteenth' as const,
      subdivisionAccent: [1, 0.68, 0.86, 0.64], phraseAccent: 1,
      drumInteraction: {
        kickFollow: 'pulse' as const, snareFollow: 'backbeat' as const,
        structuralKickBeats: [0], structuralSnareBeats: [1, 3], kickResponseLimit: 0, snareResponseLimit: 0,
      },
    });
    const grooveScorePlan = {
      grooveContractId: 'pop_citypop_boogie',
      bySection: {
        [sid]: {
          sectionId: sid, grooveContractId: 'pop_citypop_boogie',
          bars: [bar(0, 'answer'), bar(1, 'turnaround')],
        },
      },
      boundaries: [],
    } satisfies GrooveScorePlan;
    const performance = {
      id: 'phrase-consumption', sectionId: sid, grooveContractId: 'pop_citypop_boogie',
      feelProfileId: 'pop-driving-rock', role: 'lift', kitProgram: 8, patternFamily: 'citypop-disco-boogie',
      complexity: 3, intensity: 2, densityCeiling: 1, entryMode: 'full', fillPolicy: 'none',
      fillAmount: 0, fillComplexity: 0, phraseVariation: 3, timingProfile: 'tight', maxMoveTicks: 16,
      humanizeAmount: 2, feelOffsetMs: 0, velocityProfile: 'ghosted', kickPolicy: 'syncopated',
      snarePolicy: 'ghost-before-backbeat', hatPolicy: 'eighths', cymbalPolicy: 'section-crash',
      tomPolicy: 'turnaround', foregroundGuard: 'normal',
    } as const;
    const rendered = renderDrums(plan, timebase, 4, {
      style: 'pop', patternBySection: { [sid]: pattern }, performanceBySection: { [sid]: performance },
      grooveScorePlan, tempoBpm: 120,
    });
    const hasNear = (pitch: number, beat: number, tolerance = 0.06) => rendered.notes.some((note) =>
      (note.pitch as number) === pitch
      && Math.abs((note.startTick as number) / timebase.ppq - beat) <= tolerance);

    expect(hasNear(DRUM.SNARE, 0.75)).toBe(true);
    expect(hasNear(DRUM.OHAT, 1.5)).toBe(true);
    expect(hasNear(DRUM.TOM_MID, 7.5)).toBe(true);
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
