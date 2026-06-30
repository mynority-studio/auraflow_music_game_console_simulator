// ============================================================
// audio · 正式 MusicalIR → MidiEvent adapter(Q+N 主链路·单一实现)
// ------------------------------------------------------------
// Q+N 升格为主引擎(qn_main_engine_takeover §2/§4.1):MusicalIR 是正式音频合同,
//   此文件是【唯一】IR→MIDI 转换实现。sandbox/irToMidi.ts 从此处 re-export(不再维护两份)。
// MusicalIR 的 tick 已是 PPQ=480(Timebase 默认),与 globalMidiScheduler.ppq 一致 → 直传。
// 角色 → MIDI 通道 + GM program 映射。纯函数(仅 type-only import),无音频副作用,可测。
// ============================================================

import type { MidiEvent } from './MidiScheduler';
import type { InstrumentRole, MusicalIR, TrackMix } from '../generation/newEngine/ir/MusicalIR';

interface ChannelVoice {
  channel: number;
  program: number;
  volume: number; // CC7 通道音量(混音分层:lead 焦点最响 → pad 铺底最弱)
  pan: number;    // CC10 声像(64=正中;comp/pad 左右展开 = 宽度)
}

const CC_VOLUME = 7;
const CC_PAN = 10;
const CC_REVERB = 91;
const CC_CHORUS = 93;     // ★ ESP32 混音:合唱/宽度(电钢/pad 厚度)
const CC_EXPRESSION = 11; // ★ ESP32 混音:表情(静态,可选)
const CC_SUSTAIN = 64;

// bass=3 / comp=2 / lead=1 / pad=4 / drum=9(对齐 audio/MidiConverter 通道约定)
// ★ 混音【适中均衡】(2026-06-05):lead 不再突出,与伴奏平均坐在一起(单一方案,不分风格)。
//   CC7 推子压平 spread;comp 偏高补它较低的 velocity → lead/bass/comp 有效响度接近;pad 抬起(原太埋)。
//   有效响度 ≈ CC7 × velocity:lead vel 高(90)→ CC7 拉低;comp vel 低(~67)→ CC7 拉高 → 二者打平。
const ROLE_VOICE: Record<InstrumentRole, ChannelVoice> = {
  bass: { channel: 3, program: 33, volume: 61, pan: 64 },  // 中 · 与 comp【有效响度齐平】
  comp: { channel: 2, program: 0, volume: 93, pan: 50 },   // 偏左 · 有效响度基准
  lead: { channel: 1, program: 73, volume: 74, pan: 64 },  // 中 · 旋律主线
  pad: { channel: 4, program: 89, volume: 96, pan: 78 },   // 偏右 · 铺底
  drum: { channel: 9, program: 0, volume: 102, pan: 64 },  // 中(GM 鼓通道)
};

const DEFAULT_VOICE: ChannelVoice = { channel: 0, program: 0, volume: 100, pan: 64 };

// ★ 混响 = 一个【共享房间】(全局混响,ESP32 Freeverb-lite 等价)。roomWet=该房间湿度(按风格)。
//   web 模拟器用 per-channel CC91 模拟"高通等效":bass/drum(低频)少进房间=钉在前面+不浑,
//   lead 略干靠前(旋律清晰),comp/pad 进满房间(软+长=天然靠后)。
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

const clampCC = (v: number): number => Math.max(0, Math.min(127, Math.round(v)));

// ★ ESP32 混音:在某 tick 把一组 mix CC 写齐(CC7/10/91/93 + 可选 CC11)。器配层产的 TrackMix 优先,
//   缺省回退角色默认(CC7/10 走 voice,CC91 走 reverbSend,CC93=0)。programChange 之后、noteOn 之前发好。
function pushMixCC(events: MidiEvent[], channel: number, tick: number, role: InstrumentRole, mix: TrackMix | undefined, voice: ChannelVoice, roomWet: number): void {
  const volume = mix ? clampCC(mix.volume) : voice.volume;
  const pan = mix ? clampCC(mix.pan) : voice.pan;
  const reverb = mix ? clampCC(mix.reverb) : reverbSend(role, roomWet);
  const chorus = mix ? clampCC(mix.chorus) : 0;
  events.push({ ticks: tick, type: 'cc', channel, data1: CC_VOLUME, data2: volume });
  events.push({ ticks: tick, type: 'cc', channel, data1: CC_PAN, data2: pan });
  events.push({ ticks: tick, type: 'cc', channel, data1: CC_REVERB, data2: reverb });
  events.push({ ticks: tick, type: 'cc', channel, data1: CC_CHORUS, data2: chorus });
  if (mix && mix.expression !== undefined) events.push({ ticks: tick, type: 'cc', channel, data1: CC_EXPRESSION, data2: clampCC(mix.expression) });
}

/** MusicalIR → 排序好的 MidiEvent[](喂 globalMidiScheduler.loadTrack)。保 programChanges/pedal/mix/mixChanges/ccEvents。 */
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
    // ★ 混音(ESP32):tick0 写齐 CC7/10/91/93(+可选 CC11);随后每个段落混音刷新点再写齐一组(稀疏)。
    pushMixCC(events, voice.channel, 0, track.role, track.mix, voice, roomWet);
    for (const mc of track.mixChanges ?? []) {
      pushMixCC(events, voice.channel, mc.atTick, track.role, mc.mix, voice, roomWet);
    }
    // ★ 通用 CC 自动化(气声 lead 气口减弱=CC11 包络);在 notes 之前 push → 同 tick CC 先于 noteOn
    for (const cc of track.ccEvents ?? []) {
      events.push({ ticks: cc.atTick, type: 'cc', channel: voice.channel, data1: cc.controller, data2: clampCC(cc.value) });
    }

    for (const n of track.notes) {
      events.push({ ticks: n.startTick, type: 'noteOn', channel: voice.channel, data1: n.pitch, data2: n.velocity });
      events.push({ ticks: n.startTick + n.durationTicks, type: 'noteOff', channel: voice.channel, data1: n.pitch, data2: 0 });
    }
  }

  return events;
}

// ★ 共享房间湿度(按风格);从旧 sandbox/mixProfile 提到正式层(AudioEngine 计算 roomWet 用)。
const ROOM_WET: Record<string, number> = {
  lofi: 72, pop: 52, rnb: 55, jazz: 30, blues: 28, modal: 60, acg: 40,
};
/** 风格 → 共享房间 CC91 湿度(0..127);未知风格回退 48(中等房间)。 */
export function roomWetFor(style: string): number {
  return ROOM_WET[(style ?? '').toLowerCase()] ?? 48;
}
