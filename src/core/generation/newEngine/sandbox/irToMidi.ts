// ============================================================
// newEngine · sandbox · IR → MidiEvent(纯转换,可测,不碰音频运行时)
// ------------------------------------------------------------
// MusicalIR 的 tick 已是 PPQ=480(Timebase 默认),与 globalMidiScheduler.ppq 一致 → 直传。
// 角色 → MIDI 通道 + GM program 映射。仅 type-only 引用 MidiEvent,无音频副作用。
// ============================================================

import type { MidiEvent } from '../../../audio/MidiScheduler';
import type { InstrumentRole, MusicalIR } from '../ir/MusicalIR';

interface ChannelVoice {
  channel: number;
  program: number;
}

// bass=3 / comp=2 / lead=1 / pad=4 / drum=9(对齐 audio/MidiConverter 通道约定)
const ROLE_VOICE: Record<InstrumentRole, ChannelVoice> = {
  bass: { channel: 3, program: 33 }, // Finger Bass
  comp: { channel: 2, program: 0 },  // Acoustic Piano
  lead: { channel: 1, program: 73 }, // Flute
  pad: { channel: 4, program: 89 },  // Warm Pad
  drum: { channel: 9, program: 0 },  // Standard Kit
};

export function musicalIRToMidiEvents(ir: MusicalIR): MidiEvent[] {
  const events: MidiEvent[] = [];

  for (const track of ir.tracks) {
    const voice = ROLE_VOICE[track.role] ?? { channel: 0, program: 0 };
    events.push({ ticks: 0, type: 'programChange', channel: voice.channel, data1: voice.program, data2: 0 });

    for (const n of track.notes) {
      events.push({ ticks: n.startTick, type: 'noteOn', channel: voice.channel, data1: n.pitch, data2: n.velocity });
      events.push({ ticks: n.startTick + n.durationTicks, type: 'noteOff', channel: voice.channel, data1: n.pitch, data2: 0 });
    }
  }

  return events;
}
