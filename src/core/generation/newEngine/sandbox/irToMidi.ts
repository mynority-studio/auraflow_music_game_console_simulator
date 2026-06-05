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
}

const CC_VOLUME = 7;
const CC_PAN = 10;
const CC_REVERB = 91;
const CC_SUSTAIN = 64;

// bass=3 / comp=2 / lead=1 / pad=4 / drum=9(对齐 audio/MidiConverter 通道约定)
// ★ 混音【适中均衡】(2026-06-05):lead 不再突出,与伴奏平均坐在一起(单一方案,不分风格)。
//   CC7 推子压平 spread;comp 偏高补它较低的 velocity → lead/bass/comp 有效响度接近;pad 抬起(原太埋)。
//   有效响度 ≈ CC7 × velocity:lead vel 高(90)→ CC7 拉低;comp vel 低(~67)→ CC7 拉高 → 二者打平。
// ★ 均衡按【有效响度 = CC7 × velocity】设(2026-06-05 再平衡):测得 bass 过热(改音区后 μ90+)、
//   comp 被复音衰减拖低、pad 偏埋 → 目标把旋律层/节奏组拉到 ~同一响度带,pad 作铺底。
//   bass CC7 降(它 velocity 本就高);comp CC7 仍高(补它低 velocity,另在 renderer 抬 body);pad/drum 抬。
const ROLE_VOICE: Record<InstrumentRole, ChannelVoice> = {
  bass: { channel: 3, program: 33, volume: 84, pan: 64 },  // 中 · 降 fader(velocity 高、改音区后过热)
  comp: { channel: 2, program: 0, volume: 93, pan: 50 },   // 偏左 · −20%(用户:和弦音太厚压旋律,116→93)
  lead: { channel: 1, program: 73, volume: 82, pan: 64 },  // 中 · 旋律主线(现高于 comp/pad → 不被弦音压)
  pad: { channel: 4, program: 89, volume: 74, pan: 78 },   // 偏右 · −30%(用户:铺底太厚,106→74)
  drum: { channel: 9, program: 0, volume: 102, pan: 64 },  // 中
};

const DEFAULT_VOICE: ChannelVoice = { channel: 0, program: 0, volume: 100, pan: 64 };

// ★ 混响 = 一个【共享房间】(全局混响,ESP32 Freeverb-lite 等价)。roomWet=该房间湿度(按风格)。
//   web 模拟器用 per-channel CC91 模拟"高通等效":bass/drum(低频)少进房间=钉在前面+不浑,
//   lead 略干靠前(旋律清晰),comp/pad 进满房间(软+长=天然靠后)。深度主要来自编曲(响短=前/软长=后)。
//   ★ 设备端是一个全局混响 + high-pass + pre-delay(C 固件);此处 per-channel 值是它的等效预览。
function reverbSend(role: InstrumentRole, roomWet: number): number {
  switch (role) {
    case 'bass': return 6;                                // 高通等效:低频不进房间 → 干、钉前
    case 'drum': return Math.round(roomWet * 0.45);       // kick 低频本应被高通挡,折中
    case 'lead': return Math.round(roomWet * 0.72);       // 略干靠前(旋律清晰)
    default: return roomWet;                              // comp / pad 进共享房间
  }
}

/** 角色 → MIDI 通道(mute/solo 按通道操作)。 */
export const ROLE_CHANNEL: Record<InstrumentRole, number> = {
  bass: 3, comp: 2, lead: 1, pad: 4, drum: 9,
};

export function musicalIRToMidiEvents(ir: MusicalIR, roomWet = 50): MidiEvent[] {
  const events: MidiEvent[] = [];

  for (const track of ir.tracks) {
    const voice = ROLE_VOICE[track.role] ?? DEFAULT_VOICE;
    const program = track.program ?? voice.program; // BandEngine 选的乐器优先,缺省走角色默认
    events.push({ ticks: 0, type: 'programChange', channel: voice.channel, data1: program, data2: 0 });
    // ★ 段落音色切换:同 channel 中途换 program(同一乐手换声音 / 效果器开关)
    for (const pc of track.programChanges ?? []) {
      events.push({ ticks: pc.atTick, type: 'programChange', channel: voice.channel, data1: pc.program, data2: 0 });
    }
    // ★ CC64 延音踏板:踩下(127)→ synth 持音直到抬起(0)→ 音尾 ring(comp 融合)
    for (const ped of track.pedalEvents ?? []) {
      events.push({ ticks: ped.atTick, type: 'cc', channel: voice.channel, data1: CC_SUSTAIN, data2: ped.down ? 127 : 0 });
    }
    // ★ 混音:通道音量(CC7)+ 声像(CC10)+ 混响发送(CC91 → 共享混响房间 = 深度),发音前置好
    events.push({ ticks: 0, type: 'cc', channel: voice.channel, data1: CC_VOLUME, data2: voice.volume });
    events.push({ ticks: 0, type: 'cc', channel: voice.channel, data1: CC_PAN, data2: voice.pan });
    events.push({ ticks: 0, type: 'cc', channel: voice.channel, data1: CC_REVERB, data2: reverbSend(track.role, roomWet) });

    for (const n of track.notes) {
      events.push({ ticks: n.startTick, type: 'noteOn', channel: voice.channel, data1: n.pitch, data2: n.velocity });
      events.push({ ticks: n.startTick + n.durationTicks, type: 'noteOff', channel: voice.channel, data1: n.pitch, data2: 0 });
    }
  }

  return events;
}
