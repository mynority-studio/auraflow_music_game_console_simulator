import { describe, expect, it } from 'vitest';
import { beats, createTimebase, midi, pc, ticks } from '../foundation';
import { buildHarmonicPlan } from '../harmony/harmonyEngine';
import { freezeMusicalIR } from '../ir/MusicalIR';
import type { MgNoteEvent } from './mgMelodyRealizer';
import {
  auditLofiGrammarLocalHarmony,
  auditLofiTextureLocalHarmony,
} from './lofiLocalHarmonyAudit';

const timebase = createTimebase({
  ppq: 480,
  meter: { numerator: 4, denominator: 4 },
  tempoMap: [{ atBeat: beats(0), bpm: 76 }],
});

const plan = buildHarmonicPlan({
  key: pc(0),
  beatsPerBar: 4,
  progression: [
    { degree: 1, quality: 'maj7', bars: 1 },
    { degree: 4, quality: 'maj7', bars: 1 },
  ],
});

function grammarEvent(
  noteNumber: number,
  time: number,
  duration: number,
  grammarTokenKind: NonNullable<MgNoteEvent['grammarTokenKind']>,
): MgNoteEvent {
  return {
    noteNumber,
    time,
    duration,
    velocity: 80,
    part: 'melody',
    grammarTokenKind,
  };
}

describe('LOFI local harmony audit', () => {
  it('distinguishes structural, fill, resolved approach and cross-chord exposure', () => {
    const events = [
      grammarEvent(64, 0, 1, 'C'),       // E in Cmaj7
      grammarEvent(62, 1, 0.5, 'S'),     // D in C Ionian
      grammarEvent(66, 3, 0.5, 'A'),     // F# approaches G
      grammarEvent(67, 3.5, 0.5, 'C'),
      grammarEvent(65, 2, 0.5, 'C'),     // F is not Cmaj7 contract
      grammarEvent(71, 3.5, 1, 'G'),     // B remains a legal local-scale color over Fmaj7
    ];

    const audit = auditLofiGrammarLocalHarmony(events, plan);
    expect(audit.totalEvents).toBe(6);
    expect(audit.resolvedApproaches).toBe(1);
    expect(audit.findings.some((finding) =>
      finding.kind === 'grammar-structural-outside-contract'
      && finding.pitch === 65)).toBe(true);
    expect(audit.findings.some((finding) =>
      finding.kind === 'grammar-long-cross-chord-exposure'
      && finding.pitch === 71)).toBe(false);
  });

  it('audits texture chord spelling and attributes small negative boundary jitter to the next chord', () => {
    const ir = freezeMusicalIR({
      timebase,
      durationTicks: ticks(8 * 480),
      tracks: [{
        role: 'comp',
        notes: [
          { pitch: midi(64), startTick: ticks(0), durationTicks: ticks(240), velocity: 70 },
          { pitch: midi(65), startTick: ticks(480), durationTicks: ticks(240), velocity: 70 },
          // A belongs to Fmaj7 at beat 4, but the performed onset is 0.05 beat early.
          { pitch: midi(69), startTick: ticks(Math.round(3.95 * 480)), durationTicks: ticks(240), velocity: 70 },
          // C# is outside both local contracts and sustains across the boundary.
          { pitch: midi(61), startTick: ticks(Math.round(3.5 * 480)), durationTicks: ticks(480), velocity: 70 },
        ],
      }],
    });

    const audit = auditLofiTextureLocalHarmony(ir, plan, timebase, 'comp');
    expect(audit.totalNotes).toBe(4);
    expect(audit.conformingAttacks).toBe(2);
    expect(audit.findings.some((finding) =>
      finding.kind === 'texture-attack-outside-local-chord'
      && finding.pitch === 65)).toBe(true);
    expect(audit.findings.some((finding) =>
      finding.kind === 'texture-long-cross-chord-exposure'
      && finding.pitch === 61)).toBe(true);
    expect(audit.findings.some((finding) =>
      finding.kind === 'texture-attack-outside-local-chord'
      && finding.pitch === 69)).toBe(false);
  });
});
