import { describe, expect, it } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { beats, createRandomContext, createTimebase, pc } from '../foundation';
import { buildHarmonicPlan } from '../harmony/harmonyEngine';
import { grooveContractById } from '../knowledge/grooveContracts';
import { DRUM } from '../knowledge/grooves';
import { renderDrums } from '../render/drumRenderer';
import type { OpeningDrumEntry, Section } from './ArrangementPlan';
import { buildArrangementPlan } from './arranger';
import { planDrumPerformance } from './drumPerformancePlanner';

const harmonic = buildHarmonicPlan({
  key: pc(0),
  beatsPerBar: 4,
  sectionId: 'opening',
  progression: [{ degree: 1, quality: 'maj7', bars: 2 }],
});
const section: Section = {
  id: 'opening', role: 'intro', functionTag: 'setup', bars: 2, hookPolicy: 'none',
};
const contract = grooveContractById('pop_citypop_boogie')!;

function performance(entry: OpeningDrumEntry) {
  return planDrumPerformance(
    [section],
    'pop',
    { opening: contract },
    { opening: 0.3 },
    { opening: 'downbeat' },
    entry,
  );
}

describe('arranger/opening drum entry projection', () => {
  it.each([
    ['none', 'none'],
    ['hatsOnly', 'hat-only'],
    ['brushLoop', 'hat-only'],
    ['backbeatDelayed', 'hat-only'],
    ['halftimePocket', 'hat-only'],
    ['kickOnly', 'kick-only'],
    ['rideOnly', 'ride-only'],
    ['fourOnFloorRamp', 'kick-hat'],
    ['tomPickup', 'full'],
  ] as const)('%s 投影到首段既有 entryMode=%s', (opening, expected) => {
    expect(performance(opening).opening.entryMode).toBe(expected);
  });

  it('buildArrangementPlan 把实际 openingGesture 接进首段鼓手合同', () => {
    const expected = new Map<OpeningDrumEntry, string>([
      ['none', 'none'], ['hatsOnly', 'hat-only'], ['brushLoop', 'hat-only'],
      ['backbeatDelayed', 'hat-only'], ['halftimePocket', 'hat-only'],
      ['kickOnly', 'kick-only'], ['rideOnly', 'ride-only'],
      ['fourOnFloorRamp', 'kick-hat'], ['tomPickup', 'full'],
    ]);
    for (const style of ['pop', 'rnb', 'lofi', 'jazz', 'acg']) {
      for (let seed = 0; seed < 8; seed++) {
        const plan = buildArrangementPlan(
          buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 90 }),
          { rng: createRandomContext(seed), mood: 'build', targetDuration: 90 },
        );
        expect(plan.drumPerformanceBySection[plan.sections[0].id].entryMode).toBe(expected.get(plan.openingGesture.drumEntry));
      }
    }
  });

  it('首段合同被真实 drum renderer 消费，第二小节恢复完整 pattern', () => {
    const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
    const track = renderDrums(harmonic, timebase, 4, {
      patternBySection: {
        opening: [
          { drum: DRUM.KICK, beat: 0, vel: 100 },
          { drum: DRUM.SNARE, beat: 1, vel: 90 },
          { drum: DRUM.CHAT, beat: 0.5, vel: 60 },
        ],
      },
      performanceBySection: performance('hatsOnly'),
    });
    const barEnd = Number(timebase.beatToTick(beats(4)));
    const firstBar = track.notes.filter((note) => Number(note.startTick) < barEnd).map((note) => Number(note.pitch));
    const secondBar = track.notes.filter((note) => Number(note.startTick) >= barEnd).map((note) => Number(note.pitch));
    expect(firstBar).toContain(DRUM.CHAT);
    expect(firstBar).not.toContain(DRUM.KICK);
    expect(firstBar).not.toContain(DRUM.SNARE);
    expect(secondBar).toEqual(expect.arrayContaining([DRUM.KICK, DRUM.SNARE, DRUM.CHAT]));
  });
});
