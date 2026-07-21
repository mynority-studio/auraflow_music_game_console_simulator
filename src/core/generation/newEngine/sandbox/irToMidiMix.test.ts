import { describe, expect, it } from 'vitest';
import { musicalIRToMidiEvents } from './irToMidi';
import { freezeMusicalIR } from '../ir/MusicalIR';
import { createTimebase, midi, ticks } from '../foundation';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });

describe('newEngine/sandbox/irToMidi — Dream 5504 raw-default contract', () => {
  const boundary = 1920;
  const ir = freezeMusicalIR({
    tracks: [{
      role: 'comp', bank: 8, program: 4,
      programChanges: [{ atTick: ticks(boundary), bank: 0, program: 0 }],
      mix: { volume: 12, pan: 1, reverb: 127, chorus: 127, expression: 3 },
      mixChanges: [{ atTick: ticks(boundary), mix: { volume: 127, pan: 127, reverb: 127, chorus: 127 } }],
      pedalEvents: [{ atTick: ticks(0), down: true }, { atTick: ticks(boundary), down: false }],
      ccEvents: [{ atTick: ticks(0), controller: 74, value: 127 }],
      pitchBendEvents: [{ atTick: ticks(120), value: 4096 }],
      notes: [
        { pitch: midi(60), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 },
        { pitch: midi(64), startTick: ticks(boundary), durationTicks: ticks(240), velocity: 80 },
      ],
    }, {
      role: 'drum', program: 8,
      mix: { volume: 1, pan: 1, reverb: 127, chorus: 127 },
      notes: [{ pitch: midi(36), startTick: ticks(0), durationTicks: ticks(120), velocity: 90 }],
    }],
    timebase,
    durationTicks: ticks(boundary + 480),
  });
  const events = musicalIRToMidiEvents(ir);

  it('所有轨先 CC121 复位；只有原声钢琴边界可额外写 CC64 off', () => {
    expect(events.filter((event) => event.type === 'cc')).toEqual([
      { ticks: 0, type: 'cc', channel: 2, data1: 121, data2: 0 },
      { ticks: 0, type: 'cc', channel: 2, data1: 0, data2: 8 },
      { ticks: boundary, type: 'cc', channel: 2, data1: 0, data2: 0 },
      { ticks: boundary, type: 'cc', channel: 2, data1: 64, data2: 0 },
      { ticks: 0, type: 'cc', channel: 9, data1: 121, data2: 0 },
    ]);
    expect(events.some((event) => event.type === 'pitchBend')).toBe(false);
  });

  it('CC0 在同拍 Program Change 之前；鼓轨只接收默认状态复位', () => {
    for (const tick of [0, boundary]) {
      const atTick = events.filter((event) => event.channel === 2 && event.ticks === tick);
      expect(atTick.findIndex((event) => event.type === 'cc' && event.data1 === 0))
        .toBeLessThan(atTick.findIndex((event) => event.type === 'programChange'));
    }
    expect(events.filter((event) => event.channel === 9 && event.type === 'cc')).toEqual([
      { ticks: 0, type: 'cc', channel: 9, data1: 121, data2: 0 },
    ]);
  });

  it('控制元数据不会改变音符内容', () => {
    expect(events.filter((event) => event.type === 'noteOn').map((event) => [event.channel, event.data1, event.data2]))
      .toEqual([[2, 60, 80], [2, 64, 80], [9, 36, 90]]);
  });
});
