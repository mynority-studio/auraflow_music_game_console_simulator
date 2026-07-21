// ============================================================
// newEngine · harmony · HarmonicPlan 契约(🔒 深不可变)
// ------------------------------------------------------------
// 架构定稿 Part 2.4 / 附录 B2-B3:
//   - 结构化 RomanChord(不裸 string)
//   - *Map 用 Record(禁裸 Map)→ deepFreeze 才锁得住
//   - HarmonicPlan = DeepReadonly<HarmonicPlanData>;交付前 deepFreeze
// 进 render 后不可变,承重整条权威链(铁律1/3)。
// ============================================================

import { deepFreeze, type Beats, type DeepReadonly, type PitchClass } from '../foundation';
import type { ChordQuality } from '../knowledge/chords';
import type { TensionTable } from '../knowledge/tensionModel';
import type { BorrowedSource, BassRole, TonicizationPlacement } from '../knowledge/progressions';

export type ChordSpanId = string;
export type SectionId = string;
export type HarmonicFunction = 'T' | 'S' | 'D';

export interface RomanChord {
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  accidental: 'bb' | 'b' | 'natural' | '#' | 'x';
  quality: ChordQuality;
  secondaryTarget?: RomanChord; // V7/V 的 "/V"
  inversion?: 0 | 1 | 2 | 3;
}

export interface ChordSpan {
  id: ChordSpanId;
  roman: RomanChord;
  rootPc: PitchClass;
  quality: ChordQuality;           // 窄品质(兼容;tension/chordScale 现读它)
  startBeat: Beats;
  durationBeats: Beats;
  sectionId: SectionId;
  // —— 和声迁移 Loop 2:prototype 携带的【定义层】字段(可选,deepFreeze 机制不变)——
  //   chordType 为权威宽类型(Loop 6 起 tension/chordScale 优先读它);其余为 borrow/离调/bass intent。
  chordType?: string;              // 宽和弦类型(maj9/m9/13sus4/7b13…),对应 ChordTypeId
  borrowedSource?: BorrowedSource; // secondary_dominant / modal_interchange / backdoor_dominant …
  mustResolve?: boolean;
  forcedScale?: string;            // ScaleTypeId 串(V/X 用 Mixolydian / Phrygian Dominant…)
  localTonalCenterPc?: PitchClass; // 临时主音(离调);默认=调中心
  bassRole?: BassRole;             // 转位 intent(render 消费:3rd/5th/7th 转位、pedal 持续低音)
  bassPedalPc?: PitchClass;        // bassRole='pedal' 时的持续低音 pc
  bassPc?: PitchClass;             // 作者显式 slash-bass 的绝对 pc（由 slot.bassOffset 相对 section key 实化）
  tonicizationPlacement?: TonicizationPlacement;
  // —— Gap A 全字段透传(2026-06-10):作者/计划层语义标签【从 slot/planner 携带,不在 render 二次推导】——
  //   borrowedFrom = 原始借用/调式来源标签(KB 作者写的 'soft V/vi'/'Dorian IV (raised 6)'/'V/ii' 精确保留;
  //   无作者标签时由 harmony 层据 BorrowInfo/borrowedSource/forcedScale 推导,仍在 harmony 不在 render)。
  borrowedFrom?: string;
  effectiveFunc?: HarmonicFunction; // 功能(slot 作者值优先,否则 harmony func)
  analysisKeyPc?: PitchClass;       // 该和弦分析所在调中心(离调=localTonalCenter,否则段/主调)
  localRoman?: string;              // 离调区内的局部 roman
  widePianoVoicing?: readonly number[]; // 宽钢琴 voicing(若 voicing 层附着;本架构通常 render 算,passthrough-if-present)
}

export interface BorrowInfo {
  from: 'parallel-minor' | 'parallel-major';
  label: string; // 如 'iv' / 'bVII'
}

export interface ModulationInfo {
  fromKey: PitchClass;
  toKey: PitchClass;   // 该段落实际调中心
  semitones: number;   // 相对主调的升降(+1 半音 / +2 全音 …)
  label: string;       // 如 'up-semitone' / 'up-tone'
}

export interface HarmonicPlanData {
  romanProgression: RomanChord[];
  chordTimeline: ChordSpan[];
  chordFunctionTimeline: HarmonicFunction[];
  chordScaleMap: Record<ChordSpanId, PitchClass[]>;
  tensionMap: Record<ChordSpanId, TensionTable>;
  stableToneMap: Record<ChordSpanId, PitchClass[]>;
  colorToneMap: Record<ChordSpanId, PitchClass[]>;
  avoidNoteMap: Record<ChordSpanId, PitchClass[]>;
  borrowedChordMap: Record<ChordSpanId, BorrowInfo>; // 仅借和弦 span 在此
  modulationMap: Record<SectionId, ModulationInfo>;  // 仅转调段落在此(空=全曲单一调中心)
}

export type HarmonicPlan = DeepReadonly<HarmonicPlanData>;

/** 交付:递归冻结 → 进 render 后双重不可变(编译期 + 运行期)。 */
export function freezeHarmonicPlan(data: HarmonicPlanData): HarmonicPlan {
  return deepFreeze(data);
}
