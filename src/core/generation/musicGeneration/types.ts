// ============================================================
// musicGeneration · types(Q+N 主链路服务层合同;qn_main_engine_takeover §4.2/§4.3)
// ------------------------------------------------------------
// 服务层是【产品 ↔ Q+N】的唯一边界:产品给 MusicGenerationRequest,拿 MusicGenerationResult。
//   - MusicalIR 是正式音频合同(AudioEngine.playMusicGeneration 直接播)。
//   - uiSnapshot 是【结构化】UI 投影(从 band/arrangement/harmonic/instrumentation/IR 构造,
//     不解析 trace 文本)→ PipelineMonitor/AuraJam/LedMatrix 读它。
//   - Q+N 核心【不得】反向 import 本层。
// ============================================================

import type { MusicalIR } from '../newEngine/ir/MusicalIR';

/** Q+N 5 角色(产品 Band Selection 暴露这 5 个;旧 Vocal 暂禁)。 */
export type QnRole = 'lead' | 'comp' | 'bass' | 'drum' | 'pad';

/** Band Selection 三态(§8.4):auto=Q+N 默认 / selected=用户指定 program / disabled=用户关闭(不出声)。
 *  ★ 关键:别把「缺 selection」误解为「disabled」—— 缺=auto。 */
export type QnRoleSelection =
  | { kind: 'auto' }
  | { kind: 'selected'; program: number; musicianId?: string }
  | { kind: 'disabled' };

export type QnBandSelection = Partial<Record<QnRole, QnRoleSelection>>;
/** 角色 → GM program 覆盖(0..127);影响最终 TrackIR.program。 */
export type QnGmOverrides = Partial<Record<QnRole, number>>;

export interface MusicGenerationRequest {
  seed: number;
  styleHint: string;
  mood: string;
  targetDuration: number;   // 秒
  key?: string;             // UI 字符串('C'|'Db'|…);服务转 PitchClass
  mode?: string;            // 'major'|'minor'|教会调式
  bandSelection?: QnBandSelection;
  gmOverrides?: QnGmOverrides;
}

// —— UI 结构化投影 ——
export interface UiSection { id: string; role: string; functionTag?: string; bars: number; startBeat: number; }
export interface UiChord { roman: string; label: string; rootPc: number; quality: string; startBeat: number; durationBeats: number; sectionId: string; }
export interface UiPlayer { role: QnRole; program: number; instrumentName: string; family: string; state: 'auto' | 'selected' | 'disabled'; }
export interface UiTrack { role: QnRole; channel: number; program: number; instrumentName: string; noteCount: number; }

export interface MusicGenerationUiSnapshot {
  seed: number;
  styleHint: string;
  key: string;                       // 显示字符串
  tonality: string;                  // 'major'|'minor'|modal mode 名
  bpm: number;
  timeSignature: [number, number];
  sections: UiSection[];
  chords: UiChord[];
  roster: UiPlayer[];                // ensemble/roster/palette
  tracks: UiTrack[];                 // 实际 IR 轨(channel/program/noteCount)— 给 Jam/可视化
  world: string;                     // timbre world
  spaceProfile: string;
}

export interface MusicGenerationResult {
  status: 'ok' | 'failed';
  ir: MusicalIR | null;              // 正式音频合同(failed 时 null)
  bpm: number;
  seed: number;
  styleHint: string;
  report?: unknown;
  attempts?: number;
  uiSnapshot: MusicGenerationUiSnapshot;
}
