// ============================================================
// newEngine · ir · MusicalIR / TrackIR / NoteIR(最终乐谱)
// ------------------------------------------------------------
// 架构定稿 Part 2.9。NoteIR 无 intentional 字段(合法性靠预消解,不开后门)。
// 交付前 deepFreeze;timebase 共享时间底座(Function leaf 保可调用)。
// ============================================================

import { deepFreeze, type DeepReadonly, type Midi, type Ticks } from '../foundation';
import type { Timebase } from '../foundation';

export type InstrumentRole = 'bass' | 'comp' | 'pad' | 'lead' | 'drum';

export interface NoteIR {
  pitch: Midi;
  startTick: Ticks;
  durationTicks: Ticks;
  velocity: number;
}

/** ★ ESP32 混音(CC7/10/91/93 + 可选 CC11);器配层产、irToMidi 读。IR 自带,irToMidi 不查 InstrumentationPlan。 */
export interface TrackMix {
  volume: number;      // CC7
  pan: number;         // CC10
  reverb: number;      // CC91
  chorus: number;      // CC93
  expression?: number; // CC11(静态,可选)
}

export interface TrackIR {
  role: InstrumentRole;
  notes: NoteIR[];
  program?: number; // GM 乐器号(初始/tick0;BandEngine 选);irToMidi 读它发声,缺省走角色默认音色
  programChanges?: { atTick: Ticks; program: number }[]; // ★ 段落音色切换(同 channel,中途 programChange)
  pedalEvents?: { atTick: Ticks; down: boolean }[];      // ★ CC64 延音踏板(comp 每和弦踩,音尾 ring)
  mix?: TrackMix;                                          // ★ tick0 混音(随生效 program 定)
  mixChanges?: { atTick: Ticks; mix: TrackMix }[];         // ★ 段落程序切换处的混音刷新(与 programChanges 同 tick)
  ccEvents?: { atTick: Ticks; controller: number; value: number }[]; // ★ 通用 CC 自动化(气声 lead 气口减弱=CC11 包络)
}

export interface MusicalIRData {
  tracks: TrackIR[];
  timebase: Timebase;
  durationTicks: Ticks;
}

export type MusicalIR = DeepReadonly<MusicalIRData>;

export function freezeMusicalIR(data: MusicalIRData): MusicalIR {
  return deepFreeze(data);
}
