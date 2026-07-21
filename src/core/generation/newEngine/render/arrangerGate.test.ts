import { describe, expect, it } from 'vitest';
import { buildArrangementPlan } from '../arranger/arranger';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import { buildBandSpec } from '../band/bandEngine';
import { beats, createRandomContext, createTimebase, midi, ticks } from '../foundation';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import { gateByDensity, renderSongFull } from './renderCoordinator';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
const PPQ = timebase.ppq;

const planFor = (sections: readonly { id: string; startBeat: number; durationBeats: number }[]) => ({
  chordTimeline: sections.map((section) => ({
    id: `${section.id}-chord`,
    sectionId: section.id,
    startBeat: beats(section.startBeat),
    durationBeats: beats(section.durationBeats),
  })),
} as unknown as HarmonicPlan);

const note = (pitch: number, startBeat: number, durationBeats = 0.5, velocity = 80): NoteIR => ({
  pitch: midi(pitch),
  startTick: ticks(startBeat * PPQ),
  durationTicks: ticks(durationBeats * PPQ),
  velocity,
});

const performance = (
  values: Record<string, Record<string, { entryMode: string; densityBudget: number }>>,
) => values as unknown as ArrangementPlan['rolePerformanceBySection'];

describe('render/arrangerGate · presence, entry timing and density contracts', () => {
  it('inactive lead 与 dropout lead 都静音；pickup 授权窗口仍优先', () => {
    const plan = planFor([{ id: 'intro', startBeat: 0, durationBeats: 4 }]);
    const lead: TrackIR = { role: 'lead', notes: [note(60, 0), note(62, 2)] };

    const inactive = gateByDensity([lead], plan, timebase, { intro: ['comp'] })[0];
    expect(inactive.notes).toEqual([]);

    const dropout = gateByDensity([lead], plan, timebase, { intro: ['lead'] }, {
      rolePerformanceBySection: performance({ lead: { intro: { entryMode: 'dropout', densityBudget: 1 } } }),
    })[0];
    expect(dropout.notes).toEqual([]);

    const pickup = gateByDensity([lead], plan, timebase, { intro: [] }, {
      pickupWindows: [{ lo: 0, hi: PPQ, roles: new Set(['lead']) }],
      rolePerformanceBySection: performance({ lead: { intro: { entryMode: 'dropout', densityBudget: 1 } } }),
    })[0];
    expect(pickup.notes.map((event) => event.pitch as number)).toEqual([60]);
  });

  it('opening delay 丢弃阈值前 lead brick，但裁起跨阈值的 pad/comp 长音组；权威 override 可保留自身时间', () => {
    const plan = planFor([{ id: 'intro', startBeat: 0, durationBeats: 16 }]);
    const lead: TrackIR = { role: 'lead', notes: [note(60, 0), note(62, 4), note(64, 8)] };
    const pad: TrackIR = { role: 'pad', notes: [note(48, 0, 8)] };
    const comp: TrackIR = { role: 'comp', notes: [note(60, 0, 8), note(64, 0, 8), note(67, 0, 8)] };
    const rolePerformanceBySection = performance({
      lead: { intro: { entryMode: 'delayed', densityBudget: 1 } },
      pad: { intro: { entryMode: 'downbeat', densityBudget: 1 } },
      comp: { intro: { entryMode: 'delayed', densityBudget: 1 } },
    });
    const openingGesture = {
      sectionId: 'intro',
      roleDelayBars: { lead: 2, pad: 1 },
    } as unknown as ArrangementPlan['openingGesture'];
    const active = { intro: ['lead', 'pad', 'comp'] };

    const [gatedLead, gatedPad, gatedComp] = gateByDensity([lead, pad, comp], plan, timebase, active, {
      rolePerformanceBySection,
      openingGesture,
    });
    expect(gatedLead.notes.map((event) => event.startTick as number)).toEqual([8 * PPQ]);
    expect(gatedPad.notes).toMatchObject([{ startTick: ticks(4 * PPQ), durationTicks: ticks(4 * PPQ) }]);
    expect(gatedComp.notes).toHaveLength(3);
    expect(new Set(gatedComp.notes.map((event) => event.startTick as number))).toEqual(new Set([4 * PPQ]));
    expect(gatedComp.notes.every((event) => (event.durationTicks as number) === 4 * PPQ)).toBe(true);

    const authoritative = gateByDensity([lead], plan, timebase, active, {
      rolePerformanceBySection,
      openingGesture,
      preserveLeadTiming: true,
    })[0];
    expect(authoritative.notes).toEqual(lead.notes);
  });

  it('可为风格合同强制首段角色即时进入，覆盖 opening gesture 与 delayed entry', () => {
    const plan = planFor([{ id: 'intro', startBeat: 0, durationBeats: 8 }]);
    const bass: TrackIR = { role: 'bass', notes: [note(36, 0), note(38, 4)] };
    const active = { intro: ['bass'] };
    const options = {
      rolePerformanceBySection: performance({ bass: { intro: { entryMode: 'delayed', densityBudget: 1 } } }),
      openingGesture: { sectionId: 'intro', roleDelayBars: { bass: 1 } } as unknown as ArrangementPlan['openingGesture'],
      forceImmediateOpeningRoles: new Set<TrackIR['role']>(['bass']),
    };

    const [gated] = gateByDensity([bass], plan, timebase, active, options);
    expect(gated.notes.map((event) => event.startTick as number)).toEqual([0, 4 * PPQ]);
  });

  it('comp densityBudget 以 onset chord group 为单位温和限流，优先保留强拍且不拆和弦', () => {
    const plan = planFor([{ id: 'verse', startBeat: 0, durationBeats: 4 }]);
    const comp: TrackIR = {
      role: 'comp',
      notes: [
        note(60, 0), note(64, 0), note(67, 0),
        note(61, 0.25), note(62, 0.5), note(63, 0.75), note(64, 1), note(65, 1.25),
        note(66, 1.5), note(67, 2), note(68, 2.5), note(69, 3), note(70, 3.5),
      ],
    };
    const out = gateByDensity([comp], plan, timebase, { verse: ['comp'] }, {
      rolePerformanceBySection: performance({ comp: { verse: { entryMode: 'downbeat', densityBudget: 0 } } }),
    })[0];
    const onsetTicks = [...new Set(out.notes.map((event) => event.startTick as number))].sort((a, b) => a - b);

    expect(onsetTicks).toEqual([0, 0.5 * PPQ, PPQ, 1.5 * PPQ, 2 * PPQ, 2.5 * PPQ, 3 * PPQ, 3.5 * PPQ]);
    expect(out.notes.filter((event) => (event.startTick as number) === 0).map((event) => event.pitch as number))
      .toEqual([60, 64, 67]);

    const withPickup = gateByDensity([comp], plan, timebase, { verse: ['comp'] }, {
      pickupWindows: [{ lo: 0.25 * PPQ, hi: 0.5 * PPQ, roles: new Set(['comp']) }],
      rolePerformanceBySection: performance({ comp: { verse: { entryMode: 'downbeat', densityBudget: 0 } } }),
    })[0];
    expect([...new Set(withPickup.notes.map((event) => event.startTick as number))].sort((a, b) => a - b))
      .toEqual([0, 0.25 * PPQ, 0.5 * PPQ, PPQ, 1.5 * PPQ, 2 * PPQ, 2.5 * PPQ, 3 * PPQ]);
  });
});

describe('render/arrangerGate · climax dynamics integration', () => {
  it('同一编曲仅增加 climaxMap 时，目标段回归力度更强且事件不增删', () => {
    const seed = 396040;
    const band = buildBandSpec({ seed, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
    const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
    const instrumentation = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'), harmonic);
    const tb = createTimebase({
      meter: arrangement.meter,
      tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }],
    });
    const noClimax = { ...arrangement, climaxMap: [] } as unknown as ArrangementPlan;
    const base = renderSongFull(band, noClimax, harmonic, instrumentation, tb, createRandomContext(seed)).ir;
    const comp = base.tracks.find((track) => track.role === 'comp')!;
    const beatsPerBar = arrangement.meter.numerator * (4 / arrangement.meter.denominator);
    let cursor = 0;
    const ranges = arrangement.sections.map((section) => {
      const lo = cursor * tb.ppq;
      cursor += section.bars * beatsPerBar;
      return { id: section.id, lo, hi: cursor * tb.ppq, energy: arrangement.energyBySection[section.id] ?? 0.5 };
    });
    const target = ranges
      .filter((range) => comp.notes.some((event) => (event.startTick as number) >= range.lo && (event.startTick as number) < range.hi))
      .sort((a, b) => a.energy - b.energy)[0];
    expect(target).toBeDefined();
    expect(target.energy).toBeLessThan(1);

    const withClimax = {
      ...noClimax,
      climaxMap: [{ sectionId: target.id, intensity: 1 }],
    } as unknown as ArrangementPlan;
    const stronger = renderSongFull(band, withClimax, harmonic, instrumentation, tb, createRandomContext(seed)).ir;
    const inTarget = (track: NonNullable<typeof comp>) => track.notes.filter(
      (event) => (event.startTick as number) >= target.lo && (event.startTick as number) < target.hi,
    );
    const baseNotes = inTarget(comp);
    const strongerNotes = inTarget(stronger.tracks.find((track) => track.role === 'comp')! as typeof comp);
    const averageVelocity = (events: readonly NoteIR[]) => events.reduce((sum, event) => sum + event.velocity, 0) / events.length;

    expect(strongerNotes).toHaveLength(baseNotes.length);
    expect(averageVelocity(strongerNotes)).toBeGreaterThan(averageVelocity(baseNotes));
  });
});
