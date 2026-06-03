// ============================================================
// newEngine · render · Motif / Realization 模型
// ------------------------------------------------------------
// 架构定稿 Part 2.7 / 铁律11:Motif = 纯抽象身份(rhythmCell > contour > scaleDegree),
// 【无 pitch / 无调 / 无音区】。具体音高一律进 MotifRealization / AnchorPitch。
// ============================================================

import type { Beats, Midi } from '../foundation';
import type { MotifBindingId, MotifId } from '../arranger/ArrangementPlan';

export type MotifCandidateId = string;
export type Segment = 'head' | 'tail';
export type SkeletonSource = 'grammar' | 'guidetone' | 'hybrid';

export interface RhythmCell {
  durations: Beats[]; // 节奏 cell(身份最硬)
}

export interface ContourGesture {
  directions: number[]; // -1 / 0 / +1 逐音轮廓
}

export interface NoteSlot {
  slotId: number;
  timeOffset: Beats;
  duration: Beats;
  scaleDegree: number;        // 抽象身份(无 pitch)
  lockWeight: number;         // 从 segment + 节奏位派生,可显式覆盖
  segment: Segment;
  functionalTarget?: string;  // tail 用:open/half/authentic/climax
}

export interface Motif {
  id: MotifId;
  source: SkeletonSource;
  rhythmCell: RhythmCell;
  contourGesture: ContourGesture;
  noteSlots: NoteSlot[];
}

export interface AnchorPitch {
  pitch: Midi;
  beatSlot: number;
  segment: Segment;
  lockWeight: number;
}

// 某 binding 处把抽象 Motif 实化的具体音高(调/音区/八度都在这,不污染 Motif)
export interface MotifRealization {
  bindingId: MotifBindingId;
  motifId: MotifId;
  pitches: AnchorPitch[];
}
