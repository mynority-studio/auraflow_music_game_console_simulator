import { describe, expect, it } from 'vitest';
import {
  musicalIRToMidiEvents,
  ROLE_CHANNEL,
  roomWetFor,
} from '../../../audio/musicalIrToMidi';
import { parseSMF } from '../../../audio/smfParser';
import { MidiScheduler } from '../../../audio/MidiScheduler';
import { musicalIRToSMF } from '../sandbox/midiFile';
import {
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V3,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V4,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V5,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V6,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V7,
} from './takeFiveFullCuration';
import { compileVideoReplicaScore, type VideoReplicaRole } from './VideoReplicaScore';
import { videoReplicaToSMF } from './videoReplicaMidi';

const CHANNEL_BY_ROLE: Readonly<Record<VideoReplicaRole, number>> = {
  bass: 3,
  comp: 2,
  lead: 1,
};

function multiset(values: readonly string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! << 24)
    | (bytes[offset + 1]! << 16)
    | (bytes[offset + 2]! << 8)
    | bytes[offset + 3]!
  ) >>> 0;
}

function readVlq(bytes: Uint8Array, cursor: { offset: number }): number {
  let value = 0;
  for (let index = 0; index < 4; index += 1) {
    const byte = bytes[cursor.offset++]!;
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error('Test SMF walker encountered an overlong VLQ');
}

/** Read the format-0 track directly because parseSMF intentionally omits meta events. */
function readEndOfTrackTick(bytes: Uint8Array): number {
  expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd');
  const headerLength = readU32(bytes, 4);
  const trackHeaderOffset = 8 + headerLength;
  expect(String.fromCharCode(...bytes.slice(trackHeaderOffset, trackHeaderOffset + 4))).toBe('MTrk');
  const trackLength = readU32(bytes, trackHeaderOffset + 4);
  const cursor = { offset: trackHeaderOffset + 8 };
  const trackEnd = cursor.offset + trackLength;
  let tick = 0;
  let runningStatus = 0;

  while (cursor.offset < trackEnd) {
    tick += readVlq(bytes, cursor);
    let status = bytes[cursor.offset]!;
    if ((status & 0x80) !== 0) {
      cursor.offset += 1;
      runningStatus = status;
    } else {
      if (runningStatus === 0) throw new Error('Test SMF walker encountered invalid running status');
      status = runningStatus;
    }

    if (status === 0xff) {
      const type = bytes[cursor.offset++]!;
      const length = readVlq(bytes, cursor);
      if (type === 0x2f) {
        expect(length).toBe(0);
        expect(cursor.offset).toBe(trackEnd);
        return tick;
      }
      cursor.offset += length;
      runningStatus = 0;
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      cursor.offset += readVlq(bytes, cursor);
      runningStatus = 0;
      continue;
    }

    const kind = status & 0xf0;
    cursor.offset += kind === 0xc0 || kind === 0xd0 ? 1 : 2;
  }

  throw new Error('Test SMF walker did not find an End-of-Track meta event');
}

describe('videoReplicaToSMF fixed-score transport', () => {
  it('preserves every Take Five v3 note event exactly through Score -> IR -> SMF', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V3;
    const { ir } = compileVideoReplicaScore(score);
    const bytes = videoReplicaToSMF(ir, score.source.bpm);
    const parsed = parseSMF(bytes);

    expect(score.notes).toHaveLength(534);
    expect(parsed.format).toBe(0);
    expect(parsed.trackCount).toBe(1);
    expect(parsed.division).toBe(480);
    expect(parsed.bpm).toBe(200);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.noteCount).toBe(534);

    const actualNoteOns = parsed.events.filter((event) => event.type === 'noteOn');
    const actualNoteOffs = parsed.events.filter((event) => event.type === 'noteOff');
    expect(actualNoteOns).toHaveLength(534);
    expect(actualNoteOffs).toHaveLength(534);

    const expectedOnKeys = score.notes.map((note) => [
      CHANNEL_BY_ROLE[note.role],
      note.performedStartTick,
      note.midi,
      note.velocity,
    ].join('|'));
    const actualOnKeys = actualNoteOns.map((event) => [
      event.channel,
      event.ticks,
      event.data1,
      event.data2,
    ].join('|'));
    expect(multiset(actualOnKeys)).toEqual(multiset(expectedOnKeys));

    const expectedOffKeys = score.notes.map((note) => [
      CHANNEL_BY_ROLE[note.role],
      note.performedStartTick + note.performedDurationTicks,
      note.midi,
      0,
    ].join('|'));
    const actualOffKeys = actualNoteOffs.map((event) => [
      event.channel,
      event.ticks,
      event.data1,
      event.data2,
    ].join('|'));
    expect(multiset(actualOffKeys)).toEqual(multiset(expectedOffKeys));

    expect(parsed.durationTicks).toBe(Math.max(...score.notes.map((note) => (
      note.performedStartTick + note.performedDurationTicks
    ))));
    expect(score.durationPerformedTicks).toBe(85_860);
    expect(readEndOfTrackTick(bytes)).toBe(score.durationPerformedTicks);
  });
});

describe('VideoReplica production browser MIDI transport', () => {
  it('preserves every v3 note through the canonical MusicalIR-to-MidiEvent adapter', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V3;
    const { ir } = compileVideoReplicaScore(score);
    const events = musicalIRToMidiEvents(ir, roomWetFor('jazz'));
    const actualNoteOns = events.filter((event) => event.type === 'noteOn');
    const actualNoteOffs = events.filter((event) => event.type === 'noteOff');

    expect(ROLE_CHANNEL).toMatchObject(CHANNEL_BY_ROLE);
    expect(actualNoteOns).toHaveLength(534);
    expect(actualNoteOffs).toHaveLength(534);

    expect(multiset(actualNoteOns.map((event) => [
      event.channel,
      event.ticks,
      event.data1,
      event.data2,
    ].join('|')))).toEqual(multiset(score.notes.map((note) => [
      CHANNEL_BY_ROLE[note.role],
      note.performedStartTick,
      note.midi,
      note.velocity,
    ].join('|'))));

    expect(multiset(actualNoteOffs.map((event) => [
      event.channel,
      event.ticks,
      event.data1,
      event.data2,
    ].join('|')))).toEqual(multiset(score.notes.map((note) => [
      CHANNEL_BY_ROLE[note.role],
      note.performedStartTick + note.performedDurationTicks,
      note.midi,
      0,
    ].join('|'))));

    expect(multiset(events.filter((event) => event.type === 'cc').map((event) => [
      event.channel,
      event.ticks,
      event.data1,
      event.data2,
    ].join('|')))).toEqual(multiset([
      '3|0|121|0',
      '3|0|0|0',
      '2|0|121|0',
      '2|0|0|0',
      '1|0|121|0',
      '1|0|0|0',
    ]));
    expect(multiset(events.filter((event) => event.type === 'programChange').map((event) => [
      event.channel,
      event.ticks,
      event.data1,
      event.data2,
    ].join('|')))).toEqual(multiset([
      '3|0|0|0',
      '2|0|0|0',
      '1|0|0|0',
    ]));
  });

  it('preserves the same events through the browser SMF writer and parser', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V3;
    const { ir } = compileVideoReplicaScore(score);
    const bytes = musicalIRToSMF(ir, score.source.bpm, 'jazz');
    const parsed = parseSMF(bytes);
    const actualNoteOns = parsed.events.filter((event) => event.type === 'noteOn');
    const actualNoteOffs = parsed.events.filter((event) => event.type === 'noteOff');

    expect(parsed).toMatchObject({
      format: 0,
      trackCount: 1,
      division: 480,
      bpm: 200,
      noteCount: 534,
      warnings: [],
    });
    expect(actualNoteOns).toHaveLength(534);
    expect(actualNoteOffs).toHaveLength(534);

    expect(multiset(actualNoteOns.map((event) => [
      event.channel,
      event.ticks,
      event.data1,
      event.data2,
    ].join('|')))).toEqual(multiset(score.notes.map((note) => [
      CHANNEL_BY_ROLE[note.role],
      note.performedStartTick,
      note.midi,
      note.velocity,
    ].join('|'))));
    expect(multiset(actualNoteOffs.map((event) => [
      event.channel,
      event.ticks,
      event.data1,
      event.data2,
    ].join('|')))).toEqual(multiset(score.notes.map((note) => [
      CHANNEL_BY_ROLE[note.role],
      note.performedStartTick + note.performedDurationTicks,
      note.midi,
      0,
    ].join('|'))));

    expect(multiset(parsed.events.filter((event) => event.type === 'cc').map((event) => [
      event.channel,
      event.ticks,
      event.data1,
      event.data2,
    ].join('|')))).toEqual(multiset([
      '3|0|121|0',
      '3|0|0|0',
      '2|0|121|0',
      '2|0|0|0',
      '1|0|121|0',
      '1|0|0|0',
    ]));
    expect(multiset(parsed.events.filter((event) => event.type === 'programChange').map((event) => [
      event.channel,
      event.ticks,
      event.data1,
      event.data2,
    ].join('|')))).toEqual(multiset([
      '3|0|0|0',
      '2|0|0|0',
      '1|0|0|0',
    ]));
    expect(parsed.durationTicks).toBe(Math.max(...score.notes.map((note) => (
      note.performedStartTick + note.performedDurationTicks
    ))));
    expect(readEndOfTrackTick(bytes)).toBe(score.durationPerformedTicks);
  });
});

describe('Take Five v4 transport regression', () => {
  it('carries the reviewed final E4 key-off through all three exact MIDI paths', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V4;
    const { ir } = compileVideoReplicaScore(score);
    const cliBytes = videoReplicaToSMF(ir, score.source.bpm);
    const cli = parseSMF(cliBytes);
    const production = musicalIRToMidiEvents(ir, roomWetFor('jazz'));
    const browserBytes = musicalIRToSMF(ir, score.source.bpm, 'jazz');
    const browser = parseSMF(browserBytes);

    const expectedOns = multiset(score.notes.map((note) => [
      CHANNEL_BY_ROLE[note.role],
      note.performedStartTick,
      note.midi,
      note.velocity,
    ].join('|')));
    const expectedOffs = multiset(score.notes.map((note) => [
      CHANNEL_BY_ROLE[note.role],
      note.performedStartTick + note.performedDurationTicks,
      note.midi,
      0,
    ].join('|')));

    for (const events of [cli.events, production, browser.events]) {
      const noteOns = events.filter((event) => event.type === 'noteOn');
      const noteOffs = events.filter((event) => event.type === 'noteOff');
      expect(noteOns).toHaveLength(534);
      expect(noteOffs).toHaveLength(534);
      expect(multiset(noteOns.map((event) => [
        event.channel, event.ticks, event.data1, event.data2,
      ].join('|')))).toEqual(expectedOns);
      expect(multiset(noteOffs.map((event) => [
        event.channel, event.ticks, event.data1, event.data2,
      ].join('|')))).toEqual(expectedOffs);
      expect(noteOffs.some((event) => (
        event.channel === CHANNEL_BY_ROLE.lead
        && event.ticks === 81_897
        && event.data1 === 64
      ))).toBe(true);
    }

    expect(readEndOfTrackTick(cliBytes)).toBe(85_860);
    expect(readEndOfTrackTick(browserBytes)).toBe(85_860);
  });
});

describe('Take Five v5 same-key reattack transport', () => {
  it('delivers every corrected Comp key-off before the same-tick reattack on all playback paths', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V5;
    const { ir } = compileVideoReplicaScore(score);
    const cli = parseSMF(videoReplicaToSMF(ir, score.source.bpm)).events;
    const browser = parseSMF(musicalIRToSMF(ir, score.source.bpm, 'jazz')).events;
    const scheduler = new MidiScheduler();
    scheduler.loadTrack(
      musicalIRToMidiEvents(ir, roomWetFor('jazz')),
      score.source.bpm,
      undefined,
      score.durationPerformedTicks,
    );
    const scheduled = scheduler.getChannelEvents(CHANNEL_BY_ROLE.comp);
    const reattacks = [
      [35_168, 50, 93],
      [37_362, 46, 78],
      [56_749, 47, 68],
      [61_042, 57, 76],
      [62_846, 45, 84],
      [64_520, 59, 83],
      [66_229, 59, 66],
      [71_007, 48, 61],
      [71_490, 45, 70],
      [71_713, 59, 93],
      [77_810, 53, 59],
      [78_943, 41, 78],
      [80_877, 55, 61],
    ] as const;

    for (const events of [cli, browser, scheduled]) {
      for (const [tick, pitch, velocity] of reattacks) {
        expect(events.filter((event) => (
          event.channel === CHANNEL_BY_ROLE.comp
          && event.ticks === tick
          && event.data1 === pitch
          && (event.type === 'noteOff' || event.type === 'noteOn')
        )).map((event) => [event.type, event.data2])).toEqual([
          ['noteOff', 0],
          ['noteOn', velocity],
        ]);
      }
    }
  });
});

describe('Take Five v6 complete transport regression', () => {
  it('preserves all 550 note-ons and note-offs and orders every same-tick key-off before key-on', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V6;
    const { ir } = compileVideoReplicaScore(score);
    const cli = parseSMF(videoReplicaToSMF(ir, score.source.bpm)).events;
    const browser = parseSMF(musicalIRToSMF(ir, score.source.bpm, 'jazz')).events;
    const scheduler = new MidiScheduler();
    scheduler.loadTrack(
      musicalIRToMidiEvents(ir, roomWetFor('jazz')),
      score.source.bpm,
      undefined,
      score.durationPerformedTicks,
    );
    const scheduled = Object.values(CHANNEL_BY_ROLE)
      .flatMap((channel) => scheduler.getChannelEvents(channel))
      .sort((left, right) => left.ticks - right.ticks);
    const expectedOns = multiset(score.notes.map((note) => [
      CHANNEL_BY_ROLE[note.role],
      note.performedStartTick,
      note.midi,
      note.velocity,
    ].join('|')));
    const expectedOffs = multiset(score.notes.map((note) => [
      CHANNEL_BY_ROLE[note.role],
      note.performedStartTick + note.performedDurationTicks,
      note.midi,
      0,
    ].join('|')));

    for (const events of [cli, browser, scheduled]) {
      const noteOns = events.filter((event) => event.type === 'noteOn');
      const noteOffs = events.filter((event) => event.type === 'noteOff');
      expect(noteOns).toHaveLength(550);
      expect(noteOffs).toHaveLength(550);
      expect(multiset(noteOns.map((event) => [
        event.channel, event.ticks, event.data1, event.data2,
      ].join('|')))).toEqual(expectedOns);
      expect(multiset(noteOffs.map((event) => [
        event.channel, event.ticks, event.data1, event.data2,
      ].join('|')))).toEqual(expectedOffs);

      const indexed = events.map((event, index) => ({ event, index }));
      const simultaneousReattacks = indexed.filter(({ event }) => (
        event.type === 'noteOn'
        && indexed.some(({ event: candidate }) => (
          candidate.type === 'noteOff'
          && candidate.channel === event.channel
          && candidate.ticks === event.ticks
          && candidate.data1 === event.data1
        ))
      ));
      expect(simultaneousReattacks.length).toBeGreaterThan(0);
      for (const { event: noteOn, index: noteOnIndex } of simultaneousReattacks) {
        const matchingOffIndexes = indexed
          .filter(({ event }) => (
            event.type === 'noteOff'
            && event.channel === noteOn.channel
            && event.ticks === noteOn.ticks
            && event.data1 === noteOn.data1
          ))
          .map(({ index }) => index);
        expect(Math.max(...matchingOffIndexes)).toBeLessThan(noteOnIndex);
      }
    }
  });
});

describe('Take Five v7 complete transport regression', () => {
  it('preserves all 550 note-ons and note-offs and orders every same-tick key-off before key-on', () => {
    const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V7;
    const { ir } = compileVideoReplicaScore(score);
    const cli = parseSMF(videoReplicaToSMF(ir, score.source.bpm)).events;
    const browser = parseSMF(musicalIRToSMF(ir, score.source.bpm, 'jazz')).events;
    const scheduler = new MidiScheduler();
    scheduler.loadTrack(
      musicalIRToMidiEvents(ir, roomWetFor('jazz')),
      score.source.bpm,
      undefined,
      score.durationPerformedTicks,
    );
    const scheduled = Object.values(CHANNEL_BY_ROLE)
      .flatMap((channel) => scheduler.getChannelEvents(channel))
      .sort((left, right) => left.ticks - right.ticks);
    const expectedOns = multiset(score.notes.map((note) => [
      CHANNEL_BY_ROLE[note.role],
      note.performedStartTick,
      note.midi,
      note.velocity,
    ].join('|')));
    const expectedOffs = multiset(score.notes.map((note) => [
      CHANNEL_BY_ROLE[note.role],
      note.performedStartTick + note.performedDurationTicks,
      note.midi,
      0,
    ].join('|')));

    for (const events of [cli, browser, scheduled]) {
      const noteOns = events.filter((event) => event.type === 'noteOn');
      const noteOffs = events.filter((event) => event.type === 'noteOff');
      expect(noteOns).toHaveLength(550);
      expect(noteOffs).toHaveLength(550);
      expect(multiset(noteOns.map((event) => [
        event.channel, event.ticks, event.data1, event.data2,
      ].join('|')))).toEqual(expectedOns);
      expect(multiset(noteOffs.map((event) => [
        event.channel, event.ticks, event.data1, event.data2,
      ].join('|')))).toEqual(expectedOffs);

      const indexed = events.map((event, index) => ({ event, index }));
      const simultaneousReattacks = indexed.filter(({ event }) => (
        event.type === 'noteOn'
        && indexed.some(({ event: candidate }) => (
          candidate.type === 'noteOff'
          && candidate.channel === event.channel
          && candidate.ticks === event.ticks
          && candidate.data1 === event.data1
        ))
      ));
      expect(simultaneousReattacks.length).toBeGreaterThan(0);
      for (const { event: noteOn, index: noteOnIndex } of simultaneousReattacks) {
        const matchingOffIndexes = indexed
          .filter(({ event }) => (
            event.type === 'noteOff'
            && event.channel === noteOn.channel
            && event.ticks === noteOn.ticks
            && event.data1 === noteOn.data1
          ))
          .map(({ index }) => index);
        expect(Math.max(...matchingOffIndexes)).toBeLessThan(noteOnIndex);
      }
    }
  });
});
