import { describe, expect, it } from 'vitest';
import { realizeAcgPianoScoreCompEvents } from './accompanimentRenderer';
import type { AcgPianoCompDirective } from '../arranger/acgPianoScorePlan';
import { buildSongBundle } from '../generation/GenerationController';

const VOICING = [48, 52, 55, 59];

function directive(events: AcgPianoCompDirective['events']): AcgPianoCompDirective {
  return {
    floorMidi: 48,
    ceilingMidi: 60,
    rollStepBeats: 0.08,
    maxVoices: 4,
    gesture: events.length === 0 ? 'tacet' : events[0]!.gesture,
    events,
    silenceWindows: events.length === 0 ? [{ startBeat: 0, endBeat: 4, reason: 'phrase-breath' }] : [],
  };
}

describe('render/acgPianoScoreExecution · arranger score is the timing owner', () => {
  it('keeps an authored block as a true same-tick chord', () => {
    const hits = realizeAcgPianoScoreCompEvents(directive([{
      id: 'block', gesture: 'block', atBeat: 1, durationBeats: 1.2,
      voices: 'all', attack: 'simultaneous', velocity: 0.3,
      harmonicTarget: 'current', role: 'arrival',
    }]), VOICING, undefined, 4);
    expect(hits).toEqual([{ tRel: 1, dur: 1.2, midis: VOICING, vel: 0.3 }]);
  });

  it('realizes an authored roll-up in strictly ascending pitch and score step order', () => {
    const hits = realizeAcgPianoScoreCompEvents(directive([{
      id: 'up', gesture: 'rolled-block', atBeat: 0.25, durationBeats: 1.2,
      voices: 'all', attack: 'roll-up', velocity: 0.3,
      harmonicTarget: 'current', role: 'underlay',
    }]), VOICING, undefined, 4);
    expect(hits.map((hit) => hit.midis[0])).toEqual(VOICING);
    hits.forEach((hit, index) => expect(hit.tRel).toBeCloseTo(0.25 + index * 0.05, 8));
    expect(hits.at(-1)!.tRel - hits[0]!.tRel).toBeCloseTo(0.15, 8);
  });

  it('caps complete roll spread at 0.15 beat for 2/3/4 voices without expanding a smaller authored step', () => {
    for (const voicing of [
      [48, 55],
      [48, 52, 55],
      [48, 52, 55, 59],
    ]) {
      const hits = realizeAcgPianoScoreCompEvents(directive([{
        id: `down-${voicing.length}`, gesture: 'rolled-block', atBeat: 0.5, durationBeats: 1.2,
        voices: 'all', attack: 'roll-down', velocity: 0.3,
        harmonicTarget: 'current', role: 'answer',
      }]), voicing, undefined, 4);
      const expectedStep = Math.min(0.08, 0.15 / (voicing.length - 1));
      expect(hits.map((hit) => hit.midis[0])).toEqual([...voicing].reverse());
      hits.forEach((hit, index) =>
        expect(hit.tRel).toBeCloseTo(0.5 + index * expectedStep, 8));
      expect(hits.at(-1)!.tRel - hits[0]!.tRel).toBeLessThanOrEqual(0.15 + 1e-8);
    }
  });

  it('executes the production planner’s arp-down as a strict descent for 2/3/4 voice chords', () => {
    const planned = Array.from({ length: 48 }, (_, seed) => buildSongBundle({ seed, styleHint: 'acg', mood: 'lyrical', targetDuration: 90 }))
      .flatMap((bundle) => Object.values(bundle.acgPianoScorePlan?.spanById ?? {}))
      .flatMap((span) => span.comp.events.map((event) => ({ span, event })))
      .find(({ event }) => event.gesture === 'arp-down');
    expect(planned, 'fixture sweep needs an arranger-authored arp-down').toBeDefined();
    if (!planned) return;

    expect(planned.event).toMatchObject({ voices: 'all', attack: 'roll-down' });
    const productionDirective: AcgPianoCompDirective = {
      ...planned.span.comp,
      maxVoices: 4,
      events: [planned.event],
    };
    for (const voicing of [[48, 55], [48, 52, 55], [48, 52, 55, 59]]) {
      const hits = realizeAcgPianoScoreCompEvents(productionDirective, voicing, undefined, 4);
      expect(hits.map((hit) => hit.midis[0])).toEqual([...voicing].reverse());
      for (let index = 1; index < hits.length; index++) {
        expect(hits[index]!.midis[0]).toBeLessThan(hits[index - 1]!.midis[0]!);
      }
    }
  });

  it('keeps a planned tacet completely empty', () => {
    expect(realizeAcgPianoScoreCompEvents(directive([]), VOICING, undefined, 4)).toEqual([]);
  });
});
