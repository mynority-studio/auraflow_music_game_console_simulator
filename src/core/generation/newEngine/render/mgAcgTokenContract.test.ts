import { describe, expect, it } from 'vitest';
import { buildChordPart, type MgChordDef } from './mgChordPart';
import { realizeTokens } from './mgMelodyRealizer';
import type { AcgReturnGestureIntent, ScheduledToken } from './mgTokenScheduler';

const chord = (
  root: string,
  rootMidi: number,
  type: string,
  effectiveFunc: 'T' | 'S' | 'D',
  stableTonePcs: number[],
  chordScalePcs: number[],
): MgChordDef => ({ root, rootMidi, type, bassMidi: rootMidi, duration: 4, effectiveFunc, stableTonePcs, chordScalePcs });

const D_TO_T = buildChordPart([
  chord('G', 55, '7', 'D', [7, 11, 2, 5], [7, 9, 11, 0, 2, 4, 5]),
  chord('C', 60, 'm9', 'T', [0, 3, 7, 10, 2], [0, 2, 3, 5, 7, 8, 10]),
  chord('F', 53, 'm9', 'S', [5, 8, 0, 3, 7], [5, 7, 8, 10, 0, 1, 3]),
]);

const ACG_CONTEXT = { style: 'ACG', key: 'C', mode: 'Aeolian' } as const;
const ORDINARY_STABLE_CONTRACT = {
  harmonicScope: 'current-chord' as const,
  stableRoles: ['root', 'third', 'fifth', 'seventh'] as const,
};

function dArrival(overrides: Partial<AcgReturnGestureIntent> = {}): AcgReturnGestureIntent {
  return {
    gestureId: 'd-return',
    chordIndex: 1,
    targetChordIndex: 1,
    function: 'D',
    shape: 'sigh',
    role: 'arrival',
    arrivalBeat: 4,
    harmonicScope: 'next-chord',
    stableRoles: ['root', 'third', 'fifth'],
    targetPc: 0,
    targetRole: 'root',
    ...overrides,
  };
}

describe('render/mgAcgTokenContract', () => {
  it('realizes a D next-chord token as harmonic-7 → stable dyad in one pass', () => {
    const arrival = dArrival({
      dyad: {
        voicing: 'below-topline',
        partnerRoles: ['root', 'third', 'fifth'],
        preferredIntervals: [3, 4, 7, 8, 9],
        partnerPc: 3,
        partnerRole: 'third',
      },
    });
    const approach: AcgReturnGestureIntent = {
      ...arrival,
      role: 'approach',
      approachDirection: 'below',
      approachSemitones: 1,
      colorIntent: 'harmonic7',
    };
    const tokens: ScheduledToken[] = [
      { token: { kind: 'A', duration: 0.5, acg: { colorIntent: 'harmonic7' } }, startBeat: 3.5, acgReturn: approach },
      {
        token: {
          kind: 'G', duration: 1,
          acg: { harmonicScope: 'next-chord', stableRoles: arrival.stableRoles, dyad: arrival.dyad },
        },
        startBeat: 4,
        acgReturn: arrival,
      },
    ];

    const events = realizeTokens({
      scheduledTokens: tokens,
      chordPart: D_TO_T,
      registerCenter: 74,
      localScaleContext: ACG_CONTEXT,
    });

    const approachEvent = events.find((event) => event.acgReturnRole === 'approach')!;
    const topline = events.find((event) => event.acgReturnRole === 'arrival' && event.acgReturnVoice === 'topline')!;
    const dyad = events.find((event) => event.acgReturnVoice === 'dyad')!;
    expect(approachEvent.noteNumber % 12).toBe(11); // B: G major / harmonic-minor leading tone
    expect(topline.noteNumber % 12).toBe(0); // C: next-chord target root
    expect(dyad.noteNumber % 12).toBe(3); // Eb: legal target-chord third
    expect(dyad.time).toBe(topline.time);
    expect(dyad.duration).toBe(topline.duration);
    expect(dyad.noteNumber).toBeLessThan(topline.noteNumber);
    expect(dyad.velocity).toBeLessThan(topline.velocity);
  });

  it('realizes a supported Dorian-6 grammar intent only as an immediate 6→5 resolution', () => {
    const sPart = buildChordPart([
      // F Dorian: the asserted scale admission contains D natural (the 6).
      chord('F', 53, 'm9', 'S', [5, 8, 0, 3, 7], [5, 7, 8, 10, 0, 2, 3]),
    ]);
    const arrival: AcgReturnGestureIntent = {
      gestureId: 's-dorian',
      chordIndex: 0,
      targetChordIndex: 0,
      function: 'S',
      shape: 'sigh',
      role: 'arrival',
      arrivalBeat: 1.25,
      harmonicScope: 'current-chord',
      stableRoles: ['third', 'fifth', 'seventh'],
      targetPc: 0,
      targetRole: 'fifth',
    };
    const approach: AcgReturnGestureIntent = {
      ...arrival,
      role: 'approach',
      approachDirection: 'above',
      approachSemitones: 2,
      colorIntent: 'dorian6',
    };
    const events = realizeTokens({
      scheduledTokens: [
        { token: { kind: 'A', duration: 0.25, acg: { colorIntent: 'dorian6' } }, startBeat: 1, acgReturn: approach },
        { token: { kind: 'G', duration: 0.75, acg: { harmonicScope: 'current-chord', stableRoles: arrival.stableRoles } }, startBeat: 1.25, acgReturn: arrival },
      ],
      chordPart: sPart,
      registerCenter: 74,
      localScaleContext: ACG_CONTEXT,
    });
    expect(events.map((event) => event.noteNumber % 12)).toEqual([2, 0]); // D → C
    expect(Math.abs(events[0].noteNumber - events[1].noteNumber)).toBe(2);
  });

  it('realizes a Phrygian ♭2 only as the immediate upper-neighbour return to tonic', () => {
    const tPart = buildChordPart([
      // This cadence explicitly admits the borrowed Phrygian ♭2 in its
      // HarmonicPlan scale contract. The realizer must not invent it when
      // the contract excludes it.
      chord('C', 60, 'm9', 'T', [0, 3, 7, 10], [0, 1, 3, 5, 7, 8, 10]),
    ]);
    const arrival: AcgReturnGestureIntent = {
      gestureId: 't-phrygian',
      chordIndex: 0,
      targetChordIndex: 0,
      function: 'T',
      shape: 'sigh',
      role: 'arrival',
      arrivalBeat: 1.5,
      harmonicScope: 'current-chord',
      stableRoles: ['root', 'third', 'fifth'],
      targetPc: 0,
      targetRole: 'root',
    };
    const approach: AcgReturnGestureIntent = {
      ...arrival,
      role: 'approach',
      approachDirection: 'above',
      approachSemitones: 2,
      colorIntent: 'phrygianb2',
    };
    const events = realizeTokens({
      scheduledTokens: [
        { token: { kind: 'A', duration: 0.5, acg: { colorIntent: 'phrygianb2' } }, startBeat: 1, acgReturn: approach },
        { token: { kind: 'G', duration: 0.75, acg: { harmonicScope: 'current-chord', stableRoles: arrival.stableRoles } }, startBeat: 1.5, acgReturn: arrival },
      ],
      chordPart: tPart,
      registerCenter: 74,
      localScaleContext: ACG_CONTEXT,
    });
    expect(events.map((event) => event.noteNumber % 12)).toEqual([1, 0]); // Db → C
    expect(Math.abs(events[0].noteNumber - events[1].noteNumber)).toBe(1);
  });

  it('fails closed when a token tries to violate stableRoles or next-chord scope', () => {
    const illegalS: AcgReturnGestureIntent = {
      gestureId: 'illegal-s-root',
      chordIndex: 2,
      targetChordIndex: 2,
      function: 'S',
      shape: 'stableSingle',
      role: 'arrival',
      arrivalBeat: 8.5,
      harmonicScope: 'current-chord',
      stableRoles: ['third', 'fifth', 'seventh'],
      targetPc: 5,
      targetRole: 'root',
    };
    const illegalD = dArrival({
      gestureId: 'illegal-d-inside-source',
      chordIndex: 0,
      targetChordIndex: 0,
      arrivalBeat: 2,
      targetPc: 7,
      targetRole: 'root',
    });
    const events = realizeTokens({
      scheduledTokens: [
        { token: { kind: 'G', duration: 0.75 }, startBeat: 8.5, acgReturn: illegalS },
        { token: { kind: 'G', duration: 0.75 }, startBeat: 2, acgReturn: illegalD },
      ],
      chordPart: D_TO_T,
      registerCenter: 74,
      localScaleContext: ACG_CONTEXT,
    });
    expect(events).toEqual([]);
  });

  it('requires harmonicScope and stableRoles on every arrival terminal, not only its sidecar intent', () => {
    const events = realizeTokens({
      scheduledTokens: [
        // The intent is otherwise fully valid, so this specifically proves
        // that the grammar terminal cannot omit its token contract.
        { token: { kind: 'G', duration: 0.75 }, startBeat: 4, acgReturn: dArrival() },
      ],
      chordPart: D_TO_T,
      registerCenter: 74,
      localScaleContext: ACG_CONTEXT,
    });
    expect(events).toEqual([]);
  });

  it('rejects a dyad sidecar that the arrival token did not declare', () => {
    const arrival = dArrival({
      dyad: {
        voicing: 'below-topline',
        partnerRoles: ['root', 'third', 'fifth'],
        preferredIntervals: [3, 4, 7, 8, 9],
        partnerPc: 3,
        partnerRole: 'third',
      },
    });
    const events = realizeTokens({
      scheduledTokens: [{
        // The sidecar's resolved partner must originate in this grammar
        // terminal; omitting dyad here is not a permissive fallback.
        token: { kind: 'G', duration: 1, acg: { harmonicScope: 'next-chord', stableRoles: arrival.stableRoles } },
        startBeat: 4,
        acgReturn: arrival,
      }],
      chordPart: D_TO_T,
      registerCenter: 74,
      localScaleContext: ACG_CONTEXT,
    });
    expect(events).toEqual([]);
  });

  it('anchors an ordinary near-strong scale token before it can become an out-of-contract structural note', () => {
    const planned = buildChordPart([
      // C (pc 0) is a legal local-scale colour here, but not a declared
      // stable/color contract tone.  1.97 is intentionally within the final
      // auditor's strong-beat tolerance around beat 2.
      chord('G', 55, 'maj9', 'D', [7, 11, 2, 6], [7, 9, 11, 0, 2, 4, 6]),
    ]);
    const events = realizeTokens({
      scheduledTokens: [{
        token: { kind: 'S', duration: 0.62, acg: ORDINARY_STABLE_CONTRACT },
        startBeat: 1.97,
      }],
      chordPart: planned,
      registerCenter: 74,
      localScaleContext: ACG_CONTEXT,
    });
    expect(events).toHaveLength(1);
    expect([7, 11, 2, 6]).toContain(events[0]!.noteNumber % 12);
    expect(events[0]!.noteNumber % 12).not.toBe(0);
  });

  it('anchors a 0.75-beat free X carrier before it becomes a long scale-only exposure', () => {
    const planned = buildChordPart([
      // Bb (pc 10) belongs to C Aeolian but is not a declared stable tone.
      chord('C', 60, 'm9', 'T', [0, 3, 7], [0, 2, 3, 5, 7, 8, 10]),
    ]);
    const events = realizeTokens({
      scheduledTokens: [{
        token: { kind: 'X', duration: 0.775, acg: ORDINARY_STABLE_CONTRACT },
        startBeat: 1.71875,
      }],
      chordPart: planned,
      registerCenter: 74,
      // Without the ACG long-tone contract, this selects the last free X
      // candidate (Bb) and reproduces the former ≥0.75-beat audit failure.
      rng: () => 0.99,
      localScaleContext: ACG_CONTEXT,
    });
    expect(events).toHaveLength(1);
    expect([0, 3, 7]).toContain(events[0]!.noteNumber % 12);
    expect(events[0]!.noteNumber % 12).not.toBe(10);
  });

  it('fails closed instead of inferring a stable landing for an uncontracted ACG structural carrier', () => {
    const planned = buildChordPart([
      chord('C', 60, 'm9', 'T', [0, 3, 7], [0, 2, 3, 5, 7, 8, 10]),
    ]);
    const events = realizeTokens({
      scheduledTokens: [{ token: { kind: 'S', duration: 0.75 }, startBeat: 1.75 }],
      chordPart: planned,
      registerCenter: 74,
      localScaleContext: ACG_CONTEXT,
    });
    expect(events).toEqual([]);
  });

  it('rejects a borrowed-color sidecar that is not declared by its approach token', () => {
    const arrival = dArrival();
    const injectedColor: AcgReturnGestureIntent = {
      ...arrival,
      role: 'approach',
      approachDirection: 'below',
      approachSemitones: 1,
      colorIntent: 'harmonic7',
    };
    const events = realizeTokens({
      scheduledTokens: [
        // No token-level color intent: the sidecar must not manufacture one.
        { token: { kind: 'A', duration: 0.5 }, startBeat: 3.5, acgReturn: injectedColor },
        {
          token: { kind: 'G', duration: 1, acg: { harmonicScope: 'next-chord', stableRoles: arrival.stableRoles } },
          startBeat: 4,
          acgReturn: arrival,
        },
      ],
      chordPart: D_TO_T,
      registerCenter: 74,
      localScaleContext: ACG_CONTEXT,
    });
    expect(events).toEqual([]);
  });

  it('rejects a token-side borrowed color when its approach sidecar omits it', () => {
    const arrival = dArrival();
    const missingColorSidecar: AcgReturnGestureIntent = {
      ...arrival,
      role: 'approach',
      approachDirection: 'below',
      approachSemitones: 1,
    };
    const events = realizeTokens({
      scheduledTokens: [
        { token: { kind: 'A', duration: 0.5, acg: { colorIntent: 'harmonic7' } }, startBeat: 3.5, acgReturn: missingColorSidecar },
        {
          token: { kind: 'G', duration: 1, acg: { harmonicScope: 'next-chord', stableRoles: arrival.stableRoles } },
          startBeat: 4,
          acgReturn: arrival,
        },
      ],
      chordPart: D_TO_T,
      registerCenter: 74,
      localScaleContext: ACG_CONTEXT,
    });
    expect(events).toEqual([]);
  });
});
