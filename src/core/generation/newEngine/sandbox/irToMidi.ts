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
  volume: number; // CC7 通道音量(混音分层:lead 焦点最响 → pad 铺底最弱)
  pan: number;    // CC10 声像(64=正中;comp/pad 左右展开,bass/lead/drum 居中)
}

const CC_VOLUME = 7;
const CC_PAN = 10;

// bass=3 / comp=2 / lead=1 / pad=4 / drum=9(对齐 audio/MidiConverter 通道约定)
// 混音(5.4):相对音量分层 lead120 > bass112 > drum100 > comp90 > pad68;
//           声像 comp 偏左 / pad 偏右(展宽立体声场),节奏-旋律骨干(bass/lead/drum)居中。
const ROLE_VOICE: Record<InstrumentRole, ChannelVoice> = {
  bass: { channel: 3, program: 33, volume: 112, pan: 64 }, // Finger Bass · 中
  comp: { channel: 2, program: 0, volume: 90, pan: 50 },   // Acoustic Piano · 偏左
  lead: { channel: 1, program: 73, volume: 120, pan: 64 }, // Flute · 中 · 焦点最响
  pad: { channel: 4, program: 89, volume: 68, pan: 78 },   // Warm Pad · 偏右 · 铺底最弱
  drum: { channel: 9, program: 0, volume: 100, pan: 64 },  // Standard Kit · 中
};

const DEFAULT_VOICE: ChannelVoice = { channel: 0, program: 0, volume: 100, pan: 64 };

export function musicalIRToMidiEvents(ir: MusicalIR): MidiEvent[] {
  const events: MidiEvent[] = [];

  for (const track of ir.tracks) {
    const voice = ROLE_VOICE[track.role] ?? DEFAULT_VOICE;
    events.push({ ticks: 0, type: 'programChange', channel: voice.channel, data1: voice.program, data2: 0 });
    // ★ 混音:通道音量(CC7)+ 声像(CC10),在发音前置好
    events.push({ ticks: 0, type: 'cc', channel: voice.channel, data1: CC_VOLUME, data2: voice.volume });
    events.push({ ticks: 0, type: 'cc', channel: voice.channel, data1: CC_PAN, data2: voice.pan });

    for (const n of track.notes) {
      events.push({ ticks: n.startTick, type: 'noteOn', channel: voice.channel, data1: n.pitch, data2: n.velocity });
      events.push({ ticks: n.startTick + n.durationTicks, type: 'noteOff', channel: voice.channel, data1: n.pitch, data2: 0 });
    }
  }

  return events;
}
