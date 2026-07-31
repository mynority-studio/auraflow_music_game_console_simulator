import { describe, expect, it } from 'vitest';
import {
  minimumVoiceLeadingAssignment,
  minimumVoiceLeadingDistance,
} from './foundationVoiceLeading';
import { planFoundationVoicing } from './foundationVoicingPlanner';

describe('LOFI foundation voice leading', () => {
  it('uses distinct one-to-one voices instead of letting several voices claim one neighbor', () => {
    const assignment = minimumVoiceLeadingAssignment([48, 60], [49, 50]);
    expect(assignment.pairs).toEqual([
      { previous: 48, current: 49, distance: 1 },
      { previous: 60, current: 50, distance: 10 },
    ]);
    expect(minimumVoiceLeadingDistance([48, 60], [49, 50])).toBe(11);
  });

  it('keeps a short extended-chord cycle in the authored LOFI register deterministically', () => {
    const intent = {
      family: 'drop2' as const,
      register: [48, 72] as const,
      maxVoicesWithBass: 4,
    };
    const chords = [
      { rootPc: 5, chordType: 'maj9' },
      { rootPc: 4, chordType: 'm7' },
      { rootPc: 2, chordType: 'm9' },
      { rootPc: 0, chordType: 'maj9' },
    ];
    const render = () => {
      let previous: number[] = [];
      return chords.map((chord) => {
        const voicing = planFoundationVoicing({
          ...chord,
          bassMidi: 36 + chord.rootPc,
          previous,
          intent,
          includeRoot: false,
          register: intent.register,
        });
        previous = voicing;
        return voicing;
      });
    };
    const first = render();
    expect(render()).toEqual(first);
    expect(first.every((voicing) =>
      voicing.length >= 2
      && voicing.length <= 4
      && voicing.every((pitch) => pitch >= 48 && pitch <= 72))).toBe(true);
    const movement = first.slice(1).map((voicing, index) =>
      minimumVoiceLeadingAssignment(first[index], voicing).maximumDistance);
    expect(Math.max(...movement)).toBeLessThanOrEqual(7);
  });
});
