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
function fixtures(opts: { drumNotes?: ReturnType<typeof note>[]; compNotes?: ReturnType<typeof note>[] }) {
  const ir = { tracks: [
    { role: 'drum', notes: opts.drumNotes ?? [] },
    { role: 'comp', notes: opts.compNotes ?? [] },
    { role: 'bass', notes: [note(0), note(BAR * 2)] }, // bass 在两段下拍都有
  ] } as unknown as MusicalIR;
  const arrangement = { sections: [{ id: 'intro', bars: 2 }, { id: 'verse1', bars: 4 }], meter: { numerator: 4, denominator: 4 } } as unknown as ArrangementPlan;
  const instrumentation = {
    transitionPlan: {
      boundaries: [{ fromSectionId: 'intro', toSectionId: 'verse1', boundaryBar: 2, prepBar: 1, entry: 'lead-in', pickupRoles: ['drum'], releaseRoles: [], downbeatAnchorRoles: ['bass'], protectPickupFromGate: true }],
      songEntry: { firstSectionId: 'intro', hasIntro: true, mode: 'normal-intro', downbeatAnchorRoles: [], delayedRoles: [] },
    },
    endingPlan: { coldStop: false },
    activeRolesBySection: { intro: ['comp', 'lead'], verse1: ['bass', 'comp', 'drum', 'lead'] },
    textureBySection: { intro: 'pad', verse1: 'active-comp' },
    textureYieldPolicy: { 'active-comp': 'active', pad: 'floating', 'sustained-block': 'floating', arpeggio: 'active', 'walking-bass': 'active' },
  } as unknown as InstrumentationPlan;
  return { ir, arrangement, instrumentation };
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
});

describe('Loop H · golden seeds 不触发音乐性 warning', () => {
  const MUS = ['transition-pickup-missing', 'section-downbeat-anchor-missing', 'song-start-abrupt', 'outro-harmonic-support-missing', 'comp-continuity-gap', 'lead-groove-desync'];
  const golden: [number, string][] = [[3, 'pop'], [3, 'rnb'], [3, 'lofi'], [7, 'pop'], [42, 'pop'], [77, 'jazz'], [64062, 'pop'], [633823, 'pop'], [633823, 'lofi']];
  for (const [seed, style] of golden) {
    it(`${seed}/${style}:无衔接/收尾/comp 音乐性 warning`, () => {
      const t = traceGeneration({ seed, styleHint: style, mood: 'build', targetDuration: 120 } as never);
      const hit = t.audit.findings.filter((f) => MUS.includes(f.ruleId)).map((f) => f.ruleId);
      expect(hit).toEqual([]);
    });
  }
});
