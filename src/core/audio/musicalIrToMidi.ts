// ============================================================
// audio · 正式 MusicalIR → MidiEvent adapter(Q+N 主链路·单一实现)
// ------------------------------------------------------------
// Q+N 升格为主引擎(qn_main_engine_takeover §2/§4.1):MusicalIR 是正式音频合同,
//   此文件是【唯一】IR→MIDI 转换实现。sandbox/irToMidi.ts 从此处 re-export(不再维护两份)。
// MusicalIR 的 tick 已是 PPQ=480(Timebase 默认),与 globalMidiScheduler.ppq 一致 → 直传。
// 角色 → MIDI 通道 + GM program 映射。纯函数(仅 type-only import),无音频副作用,可测。
// ============================================================

import type { MidiEvent } from './MidiScheduler';
import type { InstrumentRole, MusicalIR } from '../generation/newEngine/ir/MusicalIR';
import { isAcousticPianoVoice, mapProgramToDream5504 } from '../sound/GMBK5X128Voices';

interface ChannelVoice {
  channel: number;
  program: number;
}

const CC_BANK_MSB = 0;
const CC_VOLUME = 7;
const CC_PAN = 10;
const CC_REVERB_SEND = 91;
const CC_CHORUS_SEND = 93;
const CC_SUSTAIN = 64;
const CC_RESET_ALL_CONTROLLERS = 121;

// bass=3 / comp=2 / lead=1 / pad=4 / drum=9(本文件即 Q+N 唯一通道约定真源)
// Every generated channel returns to the documented board defaults with
// CC121. Volume/expression remain at CC7=100 and CC11=127; authored dynamics
// reach the board through note velocity only. Piano sustain is still musical
// articulation rather than a bus gain setting.
const ROLE_VOICE: Record<InstrumentRole, ChannelVoice> = {
  bass: { channel: 3, program: 33 },
  comp: { channel: 2, program: 0 },
  lead: { channel: 1, program: 0 },
  pad: { channel: 4, program: 89 },
  drum: { channel: 9, program: 0 },
};

const DEFAULT_VOICE: ChannelVoice = { channel: 0, program: 0 };

/** 角色 → MIDI 通道(mute/solo 按通道操作)。 */
export const ROLE_CHANNEL: Record<InstrumentRole, number> = {
  bass: 3, comp: 2, lead: 1, pad: 4, drum: 9,
};

const clampCC = (v: number): number => Math.max(0, Math.min(127, Math.round(v)));

function pushProgramChange(events: MidiEvent[], tick: number, channel: number, role: InstrumentRole, program: number, bank?: number): void {
  if (role !== 'drum' && bank !== undefined) {
    const clampedBank = clampCC(bank);
    events.push({ ticks: tick, type: 'cc', channel, data1: CC_BANK_MSB, data2: clampedBank });
  }
  events.push({ ticks: tick, type: 'programChange', channel, data1: program, data2: 0 });
}

/** Start every generated channel from Firm5504's documented controller defaults. */
function pushDream5504DefaultControllerState(events: MidiEvent[], channel: number): void {
  events.push({ ticks: 0, type: 'cc', channel, data1: CC_RESET_ALL_CONTROLLERS, data2: 0 });
}

function pushLofiMix(
  events: MidiEvent[],
  tick: number,
  channel: number,
  mix: NonNullable<MusicalIR['tracks'][number]['mix']>,
): void {
  events.push(
    { ticks: tick, type: 'cc', channel, data1: CC_VOLUME, data2: clampCC(mix.volume), outputPolicy: 'lofi-channel-mix' },
    { ticks: tick, type: 'cc', channel, data1: CC_PAN, data2: clampCC(mix.pan), outputPolicy: 'lofi-channel-mix' },
    { ticks: tick, type: 'cc', channel, data1: CC_REVERB_SEND, data2: clampCC(mix.reverb), outputPolicy: 'lofi-channel-mix' },
    { ticks: tick, type: 'cc', channel, data1: CC_CHORUS_SEND, data2: clampCC(mix.chorus), outputPolicy: 'lofi-channel-mix' },
  );
}

interface ProgramAddress {
  bank: number;
  program: number;
}

function programAddressAtTick(track: MusicalIR['tracks'][number], fallback: number, tick: number): ProgramAddress {
  let bank = track.bank ?? 0;
  let program = track.program ?? fallback;
  for (const change of track.programChanges ?? []) {
    if ((change.atTick as number) > tick) break;
    bank = change.bank ?? bank;
    program = change.program;
  }
  return { bank, program };
}

/**
 * MusicalIR → Dream 5504 events. Every channel starts with CC121 so Firm5504
 * restores its documented defaults (including CC7=100 and CC11=127).
 * Generated playback writes channel-mix CC only for the explicit LOFI
 * hardware profile. Only acoustic piano sustain (CC64) is projected as a
 * musical articulation.
 */
export function musicalIRToMidiEvents(ir: MusicalIR, roomWet = 50, style?: string): MidiEvent[] {
  void roomWet;
  const events: MidiEvent[] = [];
  const consumeLofiMix = (style ?? '').toLowerCase() === 'lofi';

  for (const track of ir.tracks) {
    const voice = ROLE_VOICE[track.role] ?? DEFAULT_VOICE;
    // The score owns its program, while the mapper needs the style entitlement
    // to keep an ACG piano left hand from falling back to a true bass timbre.
    const program = mapProgramToDream5504(track.program ?? voice.program, track.role, style);
    pushDream5504DefaultControllerState(events, voice.channel);
    pushProgramChange(events, 0, voice.channel, track.role, program, track.bank);
    if (consumeLofiMix && track.mix) pushLofiMix(events, 0, voice.channel, track.mix);
    // ★ 段落音色切换:同 channel 中途换 program(同一乐手换声音 / 效果器开关)
    for (const pc of track.programChanges ?? []) {
      const tick = pc.atTick as number;
      const before = programAddressAtTick(track, voice.program, tick - 1);
      const after = programAddressAtTick(track, voice.program, tick);
      // A piano damper belongs to the outgoing voice. Release it before a
      // handoff so a later non-piano Program Change cannot inherit sustain.
      if (isAcousticPianoVoice(before.bank, before.program) && !isAcousticPianoVoice(after.bank, after.program)) {
        events.push({ ticks: tick, type: 'cc', channel: voice.channel, data1: CC_SUSTAIN, data2: 0 });
      }
      pushProgramChange(events, pc.atTick, voice.channel, track.role, mapProgramToDream5504(pc.program, track.role, style), pc.bank);
    }
    if (consumeLofiMix) {
      for (const change of track.mixChanges ?? []) {
        pushLofiMix(events, Math.max(0, Math.round(change.atTick as number)), voice.channel, change.mix);
      }
    }
    for (const pedal of track.pedalEvents ?? []) {
      const tick = Math.max(0, Math.round(pedal.atTick as number));
      const address = programAddressAtTick(track, voice.program, tick);
      if (!isAcousticPianoVoice(address.bank, address.program)) continue;
      events.push({ ticks: tick, type: 'cc', channel: voice.channel, data1: CC_SUSTAIN, data2: pedal.down ? 127 : 0 });
    }
    for (const n of track.notes) {
      events.push({ ticks: n.startTick, type: 'noteOn', channel: voice.channel, data1: n.pitch, data2: n.velocity });
      events.push({ ticks: n.startTick + n.durationTicks, type: 'noteOff', channel: voice.channel, data1: n.pitch, data2: 0 });
    }
  }

  // Several authored sources can request the same release at a program
  // boundary. Hardware sees one state transition, so keep the MIDI stream
  // deterministic and free of duplicate controller writes.
  const seenControllers = new Set<string>();
  return events.filter((event) => {
    if (event.type !== 'cc') return true;
    const key = `${event.ticks}:${event.channel}:${event.data1}:${event.data2}`;
    if (seenControllers.has(key)) return false;
    seenControllers.add(key);
    return true;
  });
}

// Retained as a compatibility API for callers. Raw-default output ignores it.
const ROOM_WET: Record<string, number> = {
  lofi: 0, pop: 0, rnb: 0, jazz: 0, blues: 28, modal: 60, acg: 40,
};
/** 兼容湿度元数据；raw-default 输出不会据此发送 CC91。 */
export function roomWetFor(style: string): number {
  return ROOM_WET[(style ?? '').toLowerCase()] ?? 48;
}
