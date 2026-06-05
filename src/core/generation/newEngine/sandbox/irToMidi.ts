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
  pan: number;    // CC10 声像(64=正中;comp/pad 左右展开 = 宽度)
  reverb: number; // CC91 混响【发送量】→ 同一个共享混响房间 = 深度(前干后湿)
}

const CC_VOLUME = 7;
const CC_PAN = 10;
const CC_REVERB = 91;

// bass=3 / comp=2 / lead=1 / pad=4 / drum=9(对齐 audio/MidiConverter 通道约定)
// 混音(5.4):音量 lead120 > bass112 > comp108 > drum100 > pad72;声像 comp 偏左 / pad 偏右(宽度)。
// ★ 混响 = 共享混响母线(DAW aux-send 思路:各轨发不同量到【同一个房间】= 融合,多轨不变)。
//   前干后湿(深度):bass 近干(低频忌混响)/ drum 紧(打击)/ lead 靠前少混响(不糊旋律)/
//   comp 坐进房间 / pad 洗到背景(铺底胶水)。
const ROLE_VOICE: Record<InstrumentRole, ChannelVoice> = {
  bass: { channel: 3, program: 33, volume: 112, pan: 64, reverb: 8 },  // 近干(低频清晰)
  comp: { channel: 2, program: 0, volume: 108, pan: 50, reverb: 62 },  // 坐进房间
  lead: { channel: 1, program: 73, volume: 120, pan: 64, reverb: 40 }, // 靠前(少混响,保旋律清晰)
  pad: { channel: 4, program: 89, volume: 72, pan: 78, reverb: 90 },   // 洗到背景(铺底胶水,最湿)
  drum: { channel: 9, program: 0, volume: 100, pan: 64, reverb: 18 },  // 紧(打击保冲)
};

const DEFAULT_VOICE: ChannelVoice = { channel: 0, program: 0, volume: 100, pan: 64, reverb: 50 };

/** 角色 → MIDI 通道(mute/solo 按通道操作)。 */
export const ROLE_CHANNEL: Record<InstrumentRole, number> = {
  bass: 3, comp: 2, lead: 1, pad: 4, drum: 9,
};

export function musicalIRToMidiEvents(ir: MusicalIR): MidiEvent[] {
  const events: MidiEvent[] = [];

  for (const track of ir.tracks) {
    const voice = ROLE_VOICE[track.role] ?? DEFAULT_VOICE;
    const program = track.program ?? voice.program; // BandEngine 选的乐器优先,缺省走角色默认
    events.push({ ticks: 0, type: 'programChange', channel: voice.channel, data1: program, data2: 0 });
    // ★ 段落音色切换:同 channel 中途换 program(同一乐手换声音 / 效果器开关)
    for (const pc of track.programChanges ?? []) {
      events.push({ ticks: pc.atTick, type: 'programChange', channel: voice.channel, data1: pc.program, data2: 0 });
    }
    // ★ 混音:通道音量(CC7)+ 声像(CC10)+ 混响发送(CC91 → 共享混响房间 = 深度),发音前置好
    events.push({ ticks: 0, type: 'cc', channel: voice.channel, data1: CC_VOLUME, data2: voice.volume });
    events.push({ ticks: 0, type: 'cc', channel: voice.channel, data1: CC_PAN, data2: voice.pan });
    events.push({ ticks: 0, type: 'cc', channel: voice.channel, data1: CC_REVERB, data2: voice.reverb });

    for (const n of track.notes) {
      events.push({ ticks: n.startTick, type: 'noteOn', channel: voice.channel, data1: n.pitch, data2: n.velocity });
      events.push({ ticks: n.startTick + n.durationTicks, type: 'noteOff', channel: voice.channel, data1: n.pitch, data2: 0 });
    }
  }

  return events;
}
