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
import type { SpaceProfile } from '../newEngine/knowledge/gmMixProfile';

/** Q+N 5 角色(内部 lineup/IR 轨标识;旧 Vocal 暂禁)。 */
export type QnRole = 'lead' | 'comp' | 'bass' | 'drum' | 'pad';

// ============================================================
// ★ Band Selection 新语义(qn_takeover_followup §3/§4):选「参与乐手/职能」,不选 GM 音色。
//   音色仍由 Q+N 器配层按 style/seed/音色世界规则随机决定(participant 只限 lineup/role/family)。
// ============================================================

/** 参与乐手/职能(产品 Band Selection 暴露这些;非 GM 音色)。
 *  ★ 2026-07-07 GM25 民谣木吉他进入运行包与主动器配池 → guitarist 可兑现;
 *    keyboardist 只承担 lead/comp(pad 非键盘族),synthPlayer 只承担 pad(=合成氛围)。 */
export type BandParticipantRole =
  | 'keyboardist'   // 键盘手 → lead/comp 中的键盘职责
  | 'guitarist'     // 吉他手 → lead/comp 中的吉他职责
  | 'bassist'       // 贝斯手 → bass
  | 'drummer'       // 鼓手   → drum
  | 'synthPlayer'   // 合成/氛围乐手 → pad
  | 'leadPlayer';   // 主奏乐手 → 旋律主奏(不限家族)

/** 参与三态:auto=Q+N 默认(未表态) / selected=明确加入(白名单) / disabled=明确排除。
 *  ★ 别把「缺/auto」误解为「disabled」—— 全 auto = Q+N 默认完整乐队。 */
export type BandParticipantState = 'auto' | 'selected' | 'disabled';

export interface BandParticipantSelection {
  role: BandParticipantRole;
  state: BandParticipantState;
  musicianId?: string;       // 可选:具体乐手卡(不携带 GM program)
}

export interface MusicGenerationRequest {
  seed: number;
  styleHint: string;
  mood: string;
  targetDuration: number;   // 秒
  // key/mode 不属于产品入参:Q+N 在链路最开始按 seed/style 抽取,UI 只读展示 uiSnapshot.key/tonality。
  bandParticipants?: BandParticipantSelection[]; // ★ 参与乐手/职能(不含 GM 音色;音色仍器配层定)
}

// —— UI 结构化投影 ——
export interface UiSection { id: string; role: string; functionTag?: string; bars: number; startBeat: number; endBeat: number; }
export interface UiChord { roman: string; label: string; rootPc: number; quality: string; startBeat: number; durationBeats: number; sectionId: string; }
export interface UiGestureExpression {
  kind: string;
  family: string;
  continuity: string;
  articulationScope: string;
  triggerPolicy: string;
  phrasePolicy: string;
  evidenceRefs: string[];
  articulation: string;
  noteShape: string;
  velocityCurve: string;
  pedalPolicy: string;
  rudimentPolicy: string;
  hiHatPolicy: string;
  breathModel: string;
  ccControllers: number[];
  bassTechniques?: string[];
  gateRatio?: number;
  maxConnectBeats?: number;
  overlapBeats?: number;
}
// roster 行:职能 + Q+N 实际随机音色(只读,不可手选)+ participant 归属 + 是否自动补位。
export interface UiPlayer {
  role: QnRole;
  program: number;            // Q+N 器配层实际选中的 GM program(只读显示)
  bank?: number;              // 可选 GM128 variation bank(Dream GMBK5X128 用 CC0)
  instrumentName: string;     // 该 program 的乐器名(只读)
  family: string;
  state: BandParticipantState; // auto / selected / disabled(来自 participant)
  participant?: BandParticipantRole; // 承担该 role 的乐手职能
  autoFilled?: boolean;       // ★ §4.4:用户选择未覆盖 → Q+N 自动补位(UI 标明)
  gesture?: UiGestureExpression; // ★ 器配层下发的演奏手势/表情计划(只读审计)
}
export interface UiTrack { role: QnRole; channel: number; program: number; bank?: number; instrumentName: string; noteCount: number; }

export interface UiGrooveContract {
  id: string;
  name: string;
  grid: string;
  melodySwingRatio: number;
  melodyStrongPocketMs: [number, number];
  melodyWeakPocketMs: [number, number];
  accentPattern: number[];
}

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
  grooveContract?: UiGrooveContract; // Q+T/监控只读消费:lead melody swing + pocket
  grooveContractBySection?: Record<string, UiGrooveContract>;
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
  /** 器配层已定的 song space(instrumentalPlanner 用 lineup-based hasPad + style + timbreWorld 一次算定，
   *  golden 锁=设备 out->space)。硬件共享 FX 空间下发直取它，免 AudioEngine 用 IR-based hasPad 重推导偏离设备。 */
  spaceProfile?: SpaceProfile;
}
