import { describe, it, expect } from 'vitest';
import { auditMusicality } from './musicalityAuditor';
import { traceGeneration } from '../generation/trace';
import { createTimebase, ticks } from '../foundation';
import type { MusicalIR } from '../ir/MusicalIR';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';

// ============================================================
// Loop H musicalityAuditor:规则在【该报时报】+ golden seeds 不触发(Loop A-G 修后干净)。
// ============================================================

const PPQ = 480, BAR = PPQ * 4;
const tb = createTimebase({ meter: { numerator: 4, denominator: 4 } });
const note = (startTick: number, vel = 80, dur = 240) => ({ pitch: 60 as never, startTick: ticks(startTick), durationTicks: ticks(dur), velocity: vel });

// 最小 fixture:intro(2bar) + verse1(4bar);lead-in 边界 prepBar=1。
function fixtures(opts: { drumNotes?: ReturnType<typeof note>[]; compNotes?: ReturnType<typeof note>[]; padNotes?: ReturnType<typeof note>[] }) {
  const tracks = [
    { role: 'drum', notes: opts.drumNotes ?? [] },
    { role: 'comp', notes: opts.compNotes ?? [] },
    { role: 'bass', notes: [note(0), note(BAR * 2)] }, // bass 在两段下拍都有
    ...(opts.padNotes ? [{ role: 'pad', notes: opts.padNotes }] : []),
  ];
  const ir = { tracks } as unknown as MusicalIR;
  const arrangement = {
    sections: [{ id: 'intro', bars: 2 }, { id: 'verse1', bars: 4 }],
    meter: { numerator: 4, denominator: 4 },
    openingGesture: { sectionId: 'intro', textureEntry: 'none', roleDelayBars: { comp: 0 } },
  } as unknown as ArrangementPlan;
  const instrumentation = {
    transitionPlan: {
      boundaries: [{ fromSectionId: 'intro', toSectionId: 'verse1', boundaryBar: 2, prepBar: 1, entry: 'lead-in', pickupRoles: ['drum'], releaseRoles: [], downbeatAnchorRoles: ['bass'], protectPickupFromGate: true }],
      songEntry: { firstSectionId: 'intro', hasIntro: true, mode: 'normal-intro', downbeatAnchorRoles: [], delayedRoles: [] },
    },
    endingPlan: { coldStop: false },
    activeRolesBySection: { intro: ['comp', 'lead'], verse1: opts.padNotes ? ['bass', 'comp', 'pad', 'drum', 'lead'] : ['bass', 'comp', 'drum', 'lead'] },
    textureBySection: { intro: 'pad', verse1: 'active-comp' },
    textureYieldPolicy: { 'active-comp': 'active', pad: 'floating', 'sustained-block': 'floating', arpeggio: 'active', 'walking-bass': 'active' },
    needsDownbeatCompAnchorBySection: { intro: false, verse1: false },
  } as unknown as InstrumentationPlan;
  return { ir, arrangement, instrumentation };
}

function openingCompFixture(args: {
  compNotes: ReturnType<typeof note>[];
  compDelayBars: number;
  textureEntry: 'pianoRiff' | 'rhodesDust' | 'bellMotif' | 'synthPulse';
}) {
  const f = fixtures({ drumNotes: [note(BAR + 240)], compNotes: args.compNotes });
  (f.arrangement as unknown as { openingGesture: { sectionId: string; textureEntry: string; roleDelayBars: { comp: number } } }).openingGesture = {
    sectionId: 'intro', textureEntry: args.textureEntry, roleDelayBars: { comp: args.compDelayBars },
  };
  const instrumentation = f.instrumentation as unknown as {
    activeRolesBySection: Record<string, string[]>;
    textureBySection: Record<string, string>;
  };
  instrumentation.activeRolesBySection = { intro: ['comp'], verse1: [] };
  instrumentation.textureBySection = { intro: 'arpeggio', verse1: 'pad' };
  return f;
}

describe('Loop H · 规则触发', () => {
  it('transition-pickup-missing:lead-in prepBar 无 drum pickup → 报', () => {
    const { ir, arrangement, instrumentation } = fixtures({ drumNotes: [] }); // prepBar(1) 无鼓
    const ids = auditMusicality(ir, arrangement, instrumentation, tb, 'pop').findings.map((f) => f.ruleId);
    expect(ids).toContain('transition-pickup-missing');
  });

  it('有 pickup 时不报', () => {
    const { ir, arrangement, instrumentation } = fixtures({ drumNotes: [note(BAR + 240)] }); // prepBar 内有鼓
    const ids = auditMusicality(ir, arrangement, instrumentation, tb, 'pop').findings.map((f) => f.ruleId);
    expect(ids).not.toContain('transition-pickup-missing');
  });

  it('comp-continuity-gap:comp active 段大空洞(>1.5拍/pop)→ 报', () => {
    // verse1(active-comp,bar2-6 = tick 3840..11520)只有起始一个 comp → 后面 4 拍空洞
    const { ir, arrangement, instrumentation } = fixtures({ drumNotes: [note(BAR + 240)], compNotes: [note(BAR * 2, 80, 240)] });
    const ids = auditMusicality(ir, arrangement, instrumentation, tb, 'pop').findings.map((f) => f.ruleId);
    expect(ids).toContain('comp-continuity-gap');
  });

  it('opening comp 计划入场前的留白不计入 continuity gap', () => {
    const f = openingCompFixture({
      compDelayBars: 1,
      textureEntry: 'synthPulse',
      compNotes: [note(BAR, 80, BAR)],
    });
    const ids = auditMusicality(f.ir, f.arrangement, f.instrumentation, tb, 'pop').findings.map((finding) => finding.ruleId);
    expect(ids).not.toContain('comp-continuity-gap');
  });

  it('opening riff 一小节以内的句法呼吸不误报', () => {
    const f = openingCompFixture({
      compDelayBars: 0,
      textureEntry: 'pianoRiff',
      compNotes: [note(0, 80, PPQ), note(PPQ * 5, 80, PPQ * 3)],
    });
    const ids = auditMusicality(f.ir, f.arrangement, f.instrumentation, tb, 'pop').findings.map((finding) => finding.ruleId);
    expect(ids).not.toContain('comp-continuity-gap');
  });

  it('opening riff 超过一小节的空洞仍报警', () => {
    const lateStart = Math.round(PPQ * 5.25);
    const f = openingCompFixture({
      compDelayBars: 0,
      textureEntry: 'rhodesDust',
      compNotes: [note(0, 80, PPQ), note(lateStart, 80, BAR * 2 - lateStart)],
    });
    const ids = auditMusicality(f.ir, f.arrangement, f.instrumentation, tb, 'pop').findings.map((finding) => finding.ruleId);
    expect(ids).toContain('comp-continuity-gap');
  });

  it('pad active 持续承接和声时,comp 让位不误报断层', () => {
    const { ir, arrangement, instrumentation } = fixtures({
      drumNotes: [note(BAR + 240)],
      compNotes: [note(BAR * 2, 80, 240)],
      padNotes: [note(BAR * 2, 56, BAR * 4)],
    });
    const ids = auditMusicality(ir, arrangement, instrumentation, tb, 'pop').findings.map((f) => f.ruleId);
    expect(ids).not.toContain('comp-continuity-gap');
  });

  it('吉他 COMP 短扫拨不套键盘铺底连续性误报', () => {
    const f = fixtures({
      drumNotes: [note(BAR + 240)],
      compNotes: [note(BAR * 2, 80, 134), note(BAR * 3, 76, 134), note(BAR * 4, 72, 134)],
    });
    const comp = f.ir.tracks.find((t) => t.role === 'comp') as unknown as { program: number };
    comp.program = 25;
    const ids = auditMusicality(f.ir, f.arrangement, f.instrumentation, tb, 'pop').findings.map((finding) => finding.ruleId);
    expect(ids).not.toContain('comp-continuity-gap');
  });

  it('texture-clock-drift(Loop I):LOFI comp 柱式块【系统性】离 8 分格远 → 报', () => {
    // 4 个柱式块全落在 +0.58(dusty chop 整体漂)→ 100% drift > 15% 阈值
    const blocks: ReturnType<typeof note>[] = [];
    for (const beat of [4, 5, 6, 7]) {
      const t = Math.round((beat + 0.58) * PPQ);
      blocks.push(note(t, 60), { pitch: 64 as never, startTick: t as never, durationTicks: 240 as never, velocity: 60 });
    }
    const { ir, arrangement, instrumentation } = fixtures({ drumNotes: [note(BAR + 240)], compNotes: blocks });
    const ids = auditMusicality(ir, arrangement, instrumentation, tb, 'lofi').findings.map((f) => f.ruleId);
    expect(ids).toContain('texture-clock-drift');
  });

  it('structural-comp-anchor-late(Loop I):no-pad comp 支撑段下拍无 comp → 报', () => {
    // verse1 标 needsDownbeatCompAnchor;comp 只在段中(BAR*3)无段首(BAR*2)anchor
    const f = fixtures({ drumNotes: [note(BAR + 240)], compNotes: [note(BAR * 3, 60, 240)] });
    (f.instrumentation as unknown as { needsDownbeatCompAnchorBySection: Record<string, boolean> }).needsDownbeatCompAnchorBySection = { intro: false, verse1: true };
    const ids = auditMusicality(f.ir, f.arrangement, f.instrumentation, tb, 'pop').findings.map((x) => x.ruleId);
    expect(ids).toContain('structural-comp-anchor-late');
  });
});

describe('Loop H · golden seeds 不触发音乐性 warning', () => {
  const MUS = ['transition-pickup-missing', 'section-downbeat-anchor-missing', 'song-start-abrupt', 'outro-harmonic-support-missing', 'comp-continuity-gap', 'lead-groove-desync'];
  const golden: [number, string][] = [[3, 'pop'], [3, 'rnb'], [3, 'lofi'], [7, 'pop'], [42, 'pop'], [77, 'jazz'], [64062, 'pop'], [633823, 'pop'], [633823, 'lofi'], [361134, 'pop']];
  for (const [seed, style] of golden) {
    it(`${seed}/${style}:无衔接/收尾/comp 音乐性 warning`, () => {
      const t = traceGeneration({ seed, styleHint: style, mood: 'build', targetDuration: 120 } as never);
      const hit = t.audit.findings.filter((f) => MUS.includes(f.ruleId)).map((f) => f.ruleId);
      expect(hit).toEqual([]);
    });
  }
});
