import { describe, expect, it } from 'vitest';
import type { MidiAnalysisReport } from '../../analysis/midi/types';
import { takeoverSnapshotFromMidiAnalysis } from './midiTakeoverSnapshot';

describe('leadTakeoverSandbox/midiTakeoverSnapshot', () => {
  it('converts original-PPQ analysis ticks to beats and selects the separated Lead channel', () => {
    const report = {
      document: { timeDivision: { kind: 'ppq', ppq: 96 } },
      meter: { selected: { numerator: 4, denominator: 4 } },
      key: { candidates: [{ tonicPc: 6, mode: 'minor' }] },
      harmony: {
        windows: [{
          window: {
            id: 'w1',
            measureLabel: 'M1',
          },
        }],
        chordTimeline: [{
          rootPc: 6,
          type: 'min',
          startTick: 0,
          endTick: 384,
          sourceWindowIds: ['w1'],
        }],
      },
      noteSpans: { notes: [] },
      noteLayers: {
        measures: [{
          measure: {
            id: 'measure-1',
            label: 'M1',
            startTick: 0,
            endTick: 384,
          },
          notes: [
            {
              id: 'n1@m1',
              noteId: 'n1',
              pitch: 42,
              isOnset: true,
              voiceKind: 'bass',
              structuralRole: 'backbone',
              metricLevel: 'downbeat',
              melodicFunction: 'chordTone',
              performedAccent: 1,
              structuralScore: 0.9,
              chordTone: true,
            },
            {
              id: 'n2@m1',
              noteId: 'n2',
              pitch: 64,
              isOnset: true,
              voiceKind: 'melody',
              structuralRole: 'ambiguous',
              metricLevel: 'beat',
              melodicFunction: 'chordTone',
              performedAccent: 0.5,
              structuralScore: 0.5,
              chordTone: true,
            },
            {
              id: 'n3@m1',
              noteId: 'n3',
              pitch: 55,
              isOnset: true,
              voiceKind: 'accompaniment',
              structuralRole: 'ambiguous',
              metricLevel: 'strongBeat',
              melodicFunction: 'chordTone',
              performedAccent: 0.6,
              structuralScore: 0.6,
              chordTone: true,
            },
            {
              id: 'ignored@m1',
              noteId: 'ignored',
              pitch: 99,
              isOnset: true,
              voiceKind: 'unassigned',
              structuralRole: 'ornament',
              metricLevel: 'offbeat',
              melodicFunction: 'unknown',
              performedAccent: 0,
              structuralScore: 0,
              chordTone: false,
            },
          ],
        }],
      },
      voices: {
        parts: [{
          id: 't2:ch3:melody',
          sourceLaneId: 't2:ch3',
          kind: 'melody',
          noteIds: ['lead-1'],
          noteCount: 12,
          minPitch: 62,
          maxPitch: 82,
          meanPitch: 72,
          confidence: 0.91,
          evidence: [],
        }],
      },
      inventory: {
        lanes: [{
          id: 't2:ch3',
          channel: 3,
          noteCount: 12,
          role: 'lead',
          roleConfidence: 0.9,
          meanPitch: 72,
        }],
      },
    } as unknown as MidiAnalysisReport;

    const result = takeoverSnapshotFromMidiAnalysis(report, 'measure-notes', 167);

    expect(result).toMatchObject({
      nativeLeadChannel: 3,
      canMuteNativeLead: true,
      nativeMuteStrategy: 'lead-channel',
      nativeLeadNoteRange: null,
      leadLaneId: 't2:ch3',
      leadSelectionSource: 'separated-melody',
      snapshot: {
        key: 'F#',
        tonality: 'minor',
        bpm: 167,
        timeSignature: [4, 4],
        layoutMode: 'measure-notes',
        source: 'midi-analysis',
        chords: [{
          rootPc: 6,
          quality: 'min',
          startBeat: 0,
          durationBeats: 4,
        }],
        measures: [{
          label: 'M1',
          startBeat: 0,
          durationBeats: 4,
          notes: expect.any(Array),
        }],
      },
    });
    expect(result.snapshot.measures?.[0]?.notes.map((note) => note.sourceMidi))
      .toEqual([42, 64, 55]);
    expect(result.snapshot.measures?.[0]?.notes.map((note) => note.voiceKind))
      .toEqual(['bass', 'melody', 'accompaniment']);
  });

  it('mutes only analyzed melody-note events when lead and accompaniment share a MIDI channel', () => {
    const report = {
      document: { timeDivision: { kind: 'ppq', ppq: 480 } },
      meter: { selected: { numerator: 4, denominator: 4 } },
      key: { candidates: [] },
      harmony: { windows: [], chordTimeline: [] },
      noteSpans: {
        notes: [
          {
            id: 'lead-a',
            trackIndex: 1,
            channel: 0,
            pitch: 72,
            startTick: 0,
            soundingEndTick: 480,
          },
          {
            id: 'lead-b',
            trackIndex: 1,
            channel: 0,
            pitch: 76,
            startTick: 480,
            soundingEndTick: 960,
          },
          {
            id: 'comp-a',
            trackIndex: 2,
            channel: 0,
            pitch: 60,
            startTick: 0,
            soundingEndTick: 960,
          },
        ],
      },
      noteLayers: { measures: [] },
      voices: {
        parts: [
          {
            sourceLaneId: 't1:ch0',
            kind: 'melody',
            noteIds: ['lead-a', 'lead-b'],
            noteCount: 20,
            confidence: 0.9,
          },
          {
            sourceLaneId: 't2:ch0',
            kind: 'accompaniment',
            noteCount: 80,
            confidence: 0.9,
          },
        ],
      },
      inventory: {
        lanes: [
          {
            id: 't1:ch0',
            channel: 0,
            noteCount: 20,
            role: 'lead',
            roleConfidence: 0.9,
            meanPitch: 72,
            maxPitch: 84,
          },
          {
            id: 't2:ch0',
            channel: 0,
            noteCount: 80,
            role: 'comp',
            roleConfidence: 0.9,
            meanPitch: 60,
            maxPitch: 79,
          },
        ],
      },
    } as unknown as MidiAnalysisReport;

    const result = takeoverSnapshotFromMidiAnalysis(report, 'chord-analysis', 120);

    expect(result).toMatchObject({
      nativeLeadChannel: 0,
      canMuteNativeLead: false,
      nativeMuteStrategy: 'top-voice-notes',
      nativeLeadNoteRange: null,
      nativeLeadNoteTargets: [
        { channel: 0, midi: 72, startTick: 0, endTick: 480 },
        { channel: 0, midi: 76, startTick: 480, endTick: 960 },
      ],
      nativeMuteLaneId: 't1:ch0',
      leadLaneId: 't1:ch0',
    });
  });

  it('extracts one highest note per onset when a mixed piano lane has no identifiable lead part', () => {
    const report = {
      document: { timeDivision: { kind: 'ppq', ppq: 96 } },
      meter: { selected: { numerator: 4, denominator: 4 } },
      key: { candidates: [] },
      harmony: { windows: [], chordTimeline: [] },
      noteSpans: {
        notes: [
          { id: 'n1', trackIndex: 1, channel: 0, pitch: 48, startTick: 0, soundingEndTick: 96 },
          { id: 'n2', trackIndex: 1, channel: 0, pitch: 60, startTick: 0, soundingEndTick: 96 },
          { id: 'n3', trackIndex: 1, channel: 0, pitch: 72, startTick: 0, soundingEndTick: 96 },
          { id: 'n4', trackIndex: 1, channel: 0, pitch: 50, startTick: 96, soundingEndTick: 192 },
          { id: 'n5', trackIndex: 1, channel: 0, pitch: 67, startTick: 96, soundingEndTick: 192 },
        ],
      },
      noteLayers: { measures: [] },
      voices: {
        parts: [{
          sourceLaneId: 't1:ch0',
          kind: 'accompaniment',
          noteIds: ['n1', 'n2', 'n3', 'n4', 'n5'],
          noteCount: 5,
          confidence: 0.7,
        }],
      },
      inventory: {
        lanes: [{
          id: 't1:ch0',
          channel: 0,
          noteCount: 5,
          role: 'mixed',
          roleConfidence: 0.7,
          meanPitch: 59.4,
          maxPitch: 72,
        }],
      },
    } as unknown as MidiAnalysisReport;

    const result = takeoverSnapshotFromMidiAnalysis(report, 'measure-notes', 120);

    expect(result).toMatchObject({
      nativeMuteStrategy: 'top-voice-notes',
      nativeLeadChannel: 0,
      nativeMuteLaneId: 't1:ch0',
      leadSelectionSource: 'highest-register-fallback',
      nativeLeadNoteTargets: [
        { channel: 0, midi: 72, startTick: 0, endTick: 480 },
        { channel: 0, midi: 67, startTick: 480, endTick: 960 },
      ],
    });
  });

  it('does not mistake every staggered arpeggio note for a fallback top voice', () => {
    const notes = [
      48, 55, 60, 52, 59, 64, 53, 62, 67, 69,
    ].map((pitch, index) => ({
      id: `arp-${index}`,
      trackIndex: 1,
      channel: 0,
      pitch,
      startTick: index * 96,
      soundingEndTick: (index + 1) * 96,
    }));
    const report = {
      document: { timeDivision: { kind: 'ppq', ppq: 96 } },
      meter: { selected: { numerator: 4, denominator: 4 } },
      key: { candidates: [] },
      harmony: { windows: [], chordTimeline: [] },
      noteSpans: { notes },
      noteLayers: { measures: [] },
      voices: {
        parts: [{
          sourceLaneId: 't1:ch0',
          kind: 'accompaniment',
          noteIds: notes.map((note) => note.id),
          noteCount: notes.length,
          confidence: 0.8,
        }],
      },
      inventory: {
        lanes: [{
          id: 't1:ch0',
          channel: 0,
          noteCount: notes.length,
          role: 'comp',
          roleConfidence: 0.8,
          meanPitch: 58.9,
          maxPitch: 69,
        }],
      },
    } as unknown as MidiAnalysisReport;

    const result = takeoverSnapshotFromMidiAnalysis(report, 'measure-notes', 120);

    expect(result.nativeMuteStrategy).toBe('top-voice-notes');
    expect(result.nativeLeadNoteTargets).toHaveLength(4);
    expect(result.nativeLeadNoteTargets?.map((target) => target.midi))
      .toEqual([64, 62, 67, 69]);
    expect(result.nativeLeadNoteTargets?.length ?? 0)
      .toBeLessThanOrEqual(Math.floor(notes.length * 0.4));
  });
});
