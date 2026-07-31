import { describe, expect, it } from 'vitest';
import { hashSeedToInt } from '../../state/MusicGenerationSeedStore';
import { generateSong } from '../generation/newEngine/generation/GenerationController';
import type { InstrumentRole, TrackIR } from '../generation/newEngine/ir/MusicalIR';
import {
  DREAM5504_DEFAULT_CHANNEL_VOLUME,
  DREAM5504_LOFI_CHANNEL_MIX,
} from '../generation/newEngine/knowledge/gmMixProfile';
import {
  DEFAULT_CHANNELS,
  midiEventToRoutedMessage,
  resolveSchedulerOutputChannel,
} from '../generation/midiOutSandbox/midiOut';
import { MidiScheduler, type MidiEvent } from './MidiScheduler';
import { musicalIRToMidiEvents, ROLE_CHANNEL, roomWetFor } from './musicalIrToMidi';
import { applyPopFiveTrackMidiGuard } from './popFiveTrackMidiGuard';
import { isAcousticPianoVoice } from '../sound/GMBK5X128Voices';

const STYLES = ['pop', 'lofi', 'jazz', 'rnb'] as const;
const FORMAL_CHANNELS = new Set(Object.values(ROLE_CHANNEL));
// Every generated channel resets to Firm5504 defaults with CC121. CC7 and
// CC11 stay at their power-up values; Bank-0 pianos may add sustain CC64.

function guardedEvents(style: string, ir: NonNullable<ReturnType<typeof generateSong>['ir']>): MidiEvent[] {
  return applyPopFiveTrackMidiGuard(musicalIRToMidiEvents(ir, roomWetFor(style), style), style);
}

function sortedEvents(style: string, ir: NonNullable<ReturnType<typeof generateSong>['ir']>): MidiEvent[] {
  const scheduler = new MidiScheduler();
  scheduler.loadTrack(guardedEvents(style, ir), 100);
  return [...FORMAL_CHANNELS].flatMap((channel) => scheduler.getChannelEvents(channel));
}

function addressAtTick(track: TrackIR, tick: number): { bank: number; program: number } {
  let bank = track.bank ?? 0;
  let program = track.program ?? 0;
  for (const change of track.programChanges ?? []) {
    if ((change.atTick as number) > tick) break;
    bank = change.bank ?? bank;
    program = change.program;
  }
  return { bank, program };
}

function isAllowedController(track: TrackIR, event: MidiEvent, style?: string): boolean {
  if (event.data1 === 0 || event.data1 === 121) return true;
  if (style === 'lofi' && [7, 10, 91, 93].includes(event.data1)) return true;
  const current = addressAtTick(track, event.ticks);
  if (event.data1 === 64) {
    const previous = addressAtTick(track, event.ticks - 1);
    return track.role !== 'drum' && (isAcousticPianoVoice(current.bank, current.program)
      || (event.data2 <= 63 && isAcousticPianoVoice(previous.bank, previous.program)));
  }
  return false;
}

function assertTrackContract(track: TrackIR, events: readonly MidiEvent[], style: string): void {
  const channel = ROLE_CHANNEL[track.role];
  const channelEvents = events.filter((event) => event.channel === channel);
  const programTicks = new Set([0, ...(track.programChanges ?? []).map((change) => change.atTick as number)]);
  expect((track.mixChanges ?? []).every((change) => programTicks.has(change.atTick as number)), `${track.role} CC7 boundary`).toBe(true);
  expect(channelEvents.some((event) => event.type === 'programChange' && event.ticks === 0), `${track.role} initial PC`).toBe(true);
  expect(channelEvents.some((event) => event.type === 'cc' && event.ticks === 0 && event.data1 === 121 && event.data2 === 0), `${track.role} CC121 default`).toBe(true);
  expect(channelEvents.filter((event) => event.type === 'cc').every((event) => isAllowedController(track, event, style)), `${track.role} supported CC only`).toBe(true);
  expect(channelEvents.some((event) => event.type === 'cc' && [1, 72, 74].includes(event.data1)), `${track.role} no unsupported shaping`).toBe(false);
  expect(channelEvents.filter((event) => event.type === 'cc' && event.data1 === 7), `${style}/${track.role} CC7 macro`)
    .toHaveLength(style === 'lofi' ? 1 : 0);
  expect(channelEvents.filter((event) => event.type === 'cc' && event.data1 === 11), `${style}/${track.role} CC11 default`).toEqual([]);

  if (track.role === 'drum') {
    expect(channel).toBe(9); // scheduler raw n=9 -> documented MIDI Channel 10
    expect(channelEvents.some((event) => event.type === 'cc' && event.data1 === 0)).toBe(false);
  } else {
    expect(track.bank, `${track.role} explicit bank reset/selection`).toBeDefined();
    expect(channelEvents.some((event) => event.type === 'cc' && event.ticks === 0 && event.data1 === 0 && event.data2 === track.bank)).toBe(true);
  }

  for (const tick of programTicks) {
    const atTick = channelEvents.filter((event) => event.ticks === tick);
    const pcIndex = atTick.findIndex((event) => event.type === 'programChange');
    expect(pcIndex, `${track.role} PC@${tick}`).toBeGreaterThanOrEqual(0);
    if (track.role !== 'drum') {
      const bankIndex = atTick.findIndex((event) => event.type === 'cc' && event.data1 === 0);
      expect(bankIndex, `${track.role} CC0@${tick}`).toBeGreaterThanOrEqual(0);
      expect(bankIndex).toBeLessThan(pcIndex);
      const controllerEvents = atTick.filter((event) => event.type === 'cc');
      expect(controllerEvents.filter((event) => event.data1 === 0)).toHaveLength(1);
      expect(controllerEvents.every((event) => isAllowedController(track, event, style))).toBe(true);
    } else {
      const drumControllers = atTick.filter((event) => event.type === 'cc');
      if (tick !== 0) expect(drumControllers).toEqual([]);
      else if (style === 'lofi') {
        const mix = track.mix!;
        expect(drumControllers.map((event) => [event.data1, event.data2])).toEqual([
          [121, 0], [7, mix.volume], [10, mix.pan], [91, mix.reverb], [93, mix.chorus],
        ]);
      } else {
        expect(drumControllers).toEqual([{ ticks: 0, type: 'cc', channel, data1: 121, data2: 0 }]);
      }
    }
  }
}

describe('Dream 5504 manual-backed all-channel contract', () => {
  it('single/five-port upstream modes both preserve Lead/Comp/Bass/Pad/Drum = 1/2/3/4/10', () => {
    const schedulerEvents: MidiEvent[] = [
      { ticks: 0, type: 'noteOn', channel: 1, data1: 72, data2: 90 },
      { ticks: 0, type: 'noteOn', channel: 2, data1: 60, data2: 90 },
      { ticks: 0, type: 'noteOn', channel: 3, data1: 36, data2: 90 },
      { ticks: 0, type: 'noteOn', channel: 4, data1: 55, data2: 90 },
      { ticks: 0, type: 'noteOn', channel: 9, data1: 36, data2: 90 },
    ];
    for (const mode of ['single-port', 'five-port'] as const) {
      const routed = schedulerEvents.map((event) => midiEventToRoutedMessage(event, DEFAULT_CHANNELS, mode)!);
      expect(routed.map((item) => item.role)).toEqual(['lead', 'comp', 'bass', 'pad', 'drum']);
      expect(routed.map((item) => item.message.channel)).toEqual([1, 2, 3, 4, 10]);
    }
    expect(resolveSchedulerOutputChannel(15, 'single-port')).toBe(16);
    expect(resolveSchedulerOutputChannel(15, 'five-port')).toBe(16);
  });

  it('四风格多seed逐轨只发送 CC121、CC0、原声钢琴 CC64、PC/Note，并保持默认音量和通道隔离', () => {
    for (const style of STYLES) {
      for (const seed of [0, 1, 2, 4, 5, 7, 11, hashSeedToInt('w5q300')]) {
        const result = generateSong({ seed, styleHint: style, mood: 'build', targetDuration: 90 });
        expect(result.ir, `${style}/${seed}`).toBeTruthy();
        const events = sortedEvents(style, result.ir!);
        expect(events.every((event) => FORMAL_CHANNELS.has(event.channel)), `${style}/${seed} formal channels`).toBe(true);
        for (const track of result.ir!.tracks as readonly TrackIR[]) assertTrackContract(track, events, style);
      }
    }
  }, 30_000);

  it('问题种子按完整 Bank+Program 分配角色：St.FM 不进 Lead，独立乐手不重复同一音色', () => {
    const expectedLofiVoices: Record<string, { lead: [number, number]; comp: [number, number] }> = {
      eruth7: { lead: [0, 5], comp: [0, 0] },
      j4sy13: { lead: [0, 0], comp: [16, 5] },
      w5q300: { lead: [0, 0], comp: [16, 5] },
    };
    for (const style of STYLES) {
      for (const seedName of ['eruth7', 'j4sy13', 'w5q300']) {
        const result = generateSong({
          seed: hashSeedToInt(seedName),
          styleHint: style,
          mood: 'build',
          targetDuration: 90,
        });
        const lead = result.ir!.tracks.find((track) => track.role === 'lead')!;
        const comp = result.ir!.tracks.find((track) => track.role === 'comp')!;
        expect([lead.bank, lead.program], `${style}/${seedName} St.FM 不能错配到 Lead`).not.toEqual([16, 5]);
        // Jazz piano-trio/solo-piano 的两轨是同一钢琴手的旋律/和声职责；
        // POP/LOFI/RNB 才是两个独立乐手，完整音色不得重复。
        if (style !== 'jazz') {
          expect([lead.bank, lead.program], `${style}/${seedName} Lead/Comp 完整音色不能重复`)
            .not.toEqual([comp.bank, comp.program]);
        }
        if (style === 'lofi') {
          expect([lead.bank, lead.program], `${seedName} LOFI Lead 地址`).toEqual(expectedLofiVoices[seedName].lead);
          expect([comp.bank, comp.program], `${seedName} LOFI Comp 地址`).toEqual(expectedLofiVoices[seedName].comp);
        }
        for (const track of result.ir!.tracks) {
          const expectedVolume = style === 'lofi'
            ? DREAM5504_LOFI_CHANNEL_MIX[track.role].volume
            : DREAM5504_DEFAULT_CHANNEL_VOLUME;
          expect(track.mix?.volume, `${style}/${seedName}/${track.role} CC7`).toBe(expectedVolume);
        }
      }
    }
  }, 30_000);

  it('w5q300 连续生成三遍，五轨 Program/Bank 与最终 Note On 完全确定', () => {
    for (const style of STYLES) {
      const digests = Array.from({ length: 3 }, () => {
        const result = generateSong({ seed: hashSeedToInt('w5q300'), styleHint: style, mood: 'build', targetDuration: 90 });
        const events = guardedEvents(style, result.ir!);
        return JSON.stringify({
          tracks: result.ir!.tracks.map((track) => ({
            role: track.role,
            program: track.program,
            bank: track.bank,
            volume: track.mix?.volume,
            mixChanges: track.mixChanges,
          })),
          audible: events.filter((event) => event.type === 'programChange' || event.type === 'noteOn' || (event.type === 'cc' && event.data1 === 0)),
        });
      });
      expect(new Set(digests).size, style).toBe(1);
    }
  }, 30_000);
});
