import { describe, expect, it } from 'vitest';
import { hashSeedToInt } from '../../state/MusicGenerationSeedStore';
import { generateSong } from '../generation/newEngine/generation/GenerationController';
import type { InstrumentRole, TrackIR } from '../generation/newEngine/ir/MusicalIR';
import { musicalIRToMidiEvents, roomWetFor } from './musicalIrToMidi';
import type { MidiEvent } from './MidiScheduler';
import {
  applyPopFiveTrackMidiGuard,
  POP_ROLE_ONSET_VELOCITY_BUDGET,
  POP_ROLE_VELOCITY_CAP,
} from './popFiveTrackMidiGuard';

const ROLE_CHANNEL: Readonly<Record<InstrumentRole, number>> = {
  lead: 1, comp: 2, bass: 3, pad: 4, drum: 9,
};

function noteOnSums(events: readonly MidiEvent[], channel: number): number[] {
  const sums = new Map<number, number>();
  for (const event of events) {
    if (event.type !== 'noteOn' || event.channel !== channel || event.data2 <= 0) continue;
    sums.set(event.ticks, (sums.get(event.ticks) ?? 0) + event.data2);
  }
  return [...sums.values()];
}

describe('audio/popFiveTrackMidiGuard', () => {
  it('只改 POP 出板 Note On 的力度峰值，不改输入事件或其它风格', () => {
    const input: MidiEvent[] = [60, 64, 67, 71].map((pitch) => ({
      ticks: 480, type: 'noteOn', channel: 2, data1: pitch, data2: 127,
    }));
    const before = structuredClone(input);
    const out = applyPopFiveTrackMidiGuard(input, 'pop');

    expect(input).toEqual(before);
    expect(out.map((event) => event.data1)).toEqual([60, 64, 67, 71]);
    expect(Math.max(...out.map((event) => event.data2))).toBeLessThanOrEqual(POP_ROLE_VELOCITY_CAP.comp);
    expect(out.reduce((sum, event) => sum + event.data2, 0)).toBeLessThanOrEqual(POP_ROLE_ONSET_VELOCITY_BUDGET.comp);
    expect(applyPopFiveTrackMidiGuard(input, 'jazz')).toEqual(input);
  });

  it('w5q300 的五轨出板不再出现段落 CC7 跳变或单轨 onset 峰值', () => {
    expect(hashSeedToInt('w5q300')).toBe(3459232512);
    const result = generateSong({
      seed: hashSeedToInt('w5q300'),
      styleHint: 'pop',
      mood: 'build',
      targetDuration: 90,
    });
    expect(result.ir).toBeTruthy();

    for (const track of result.ir!.tracks as readonly TrackIR[]) {
      const programTicks = new Set((track.programChanges ?? []).map((change) => change.atTick as number));
      expect((track.mixChanges ?? []).every((change) => programTicks.has(change.atTick as number)), track.role).toBe(true);
    }

    const guarded = applyPopFiveTrackMidiGuard(
      musicalIRToMidiEvents(result.ir!, roomWetFor('pop')),
      'pop',
    );
    for (const role of Object.keys(ROLE_CHANNEL) as InstrumentRole[]) {
      const noteOns = guarded.filter((event) => event.type === 'noteOn' && event.channel === ROLE_CHANNEL[role] && event.data2 > 0);
      expect(Math.max(0, ...noteOns.map((event) => event.data2)), `${role} velocity`)
        .toBeLessThanOrEqual(POP_ROLE_VELOCITY_CAP[role]);
      expect(Math.max(0, ...noteOnSums(guarded, ROLE_CHANNEL[role])), `${role} onset sum`)
        .toBeLessThanOrEqual(POP_ROLE_ONSET_VELOCITY_BUDGET[role]);
    }
  });
});
