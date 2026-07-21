// ============================================================
// newEngine · render · Swing(feel.swingRatio 落地)
// ------------------------------------------------------------
// 架构定稿 Part 2.3 feel:把 swingRatio 真正 warp 到 tick。
// 时间扭曲(piecewise-linear):pair 内 frac∈[0,0.5]→[0,ratio],
// [0.5,1]→[ratio,1]。pair 可为一拍(八分 swing)或半拍(十六分 swing)。
// `authored` 源已直接写好 triplet/Dilla 位置，不再重复 warp。
// ============================================================

import { ticks } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';
import type { GrooveScorePlan } from '../arranger/ArrangementPlan';
import {
  rhythmSwingSourceForContract,
  type GrooveGrid,
  type GrooveRhythmSwingSource,
  type GrooveSwingCurve,
} from '../knowledge/grooveContracts';
import { tempoAwareJazzSwingRatio } from '../knowledge/drumPerformanceKnowledge';

export interface RhythmSwingContract {
  grid: GrooveGrid;
  compSwingRatio: number;
  rhythmSwingSource?: GrooveRhythmSwingSource;
  swingCurve?: GrooveSwingCurve;
}

export function swingFrac(frac: number, ratio: number): number {
  if (frac <= 0.5) return frac * (ratio / 0.5);
  return ratio + (frac - 0.5) * ((1 - ratio) / 0.5);
}

export function swingBeat(
  beat: number,
  ratio: number,
  source: GrooveRhythmSwingSource = 'straight-eighths',
): number {
  if (source === 'authored' || Math.abs(ratio - 0.5) < 1e-6) return beat;
  const pairBeats = source === 'straight-sixteenths' ? 0.5 : 1;
  const pair = Math.floor(beat / pairBeats);
  const pairStart = pair * pairBeats;
  const frac = (beat - pairStart) / pairBeats;
  return pairStart + swingFrac(frac, ratio) * pairBeats;
}

/** 对全部音轨 onset 做一种明确 source-grid 的 swing warp。 */
export function applySwing(
  tracks: TrackIR[],
  ppq: number,
  swingRatio: number,
  source: GrooveRhythmSwingSource = 'straight-eighths',
): TrackIR[] {
  if (source === 'authored' || Math.abs(swingRatio - 0.5) < 1e-6) return tracks;
  return tracks.map((t) => {
    if (t.role === 'lead') return t; // ★ Loop 9:lead = MG StyleRenderer 已上单轨 swing,跳过全局 swing(避免 jazz 双 swing)
    if (t.role === 'pad') return t;  // ★ pad = sustain 铺底层:跳过 swing(长音 onset 不应被 swing 移位,保连续平铺)
    return {
      role: t.role,
      notes: t.notes.map((n) => {
        const beat = (n.startTick as number) / ppq;
        const swung = swingBeat(beat, swingRatio, source);
        return { ...n, startTick: ticks(Math.round(swung * ppq)) };
      }),
    };
  });
}

/**
 * Production path: each absolute bar consumes its section GrooveContract.
 * This keeps future section-level groove changes on one clock and prevents
 * an authored rhythmic source from being interpreted as straight eighths.
 */
export function applySwingBySection(
  tracks: TrackIR[],
  ppq: number,
  beatsPerBar: number,
  fallback: Readonly<RhythmSwingContract>,
  bySection: Readonly<Record<string, Readonly<RhythmSwingContract>>>,
  scorePlan: Readonly<GrooveScorePlan>,
  tempoBpm = 120,
): TrackIR[] {
  const contractByBar = new Map<number, Readonly<RhythmSwingContract>>();
  for (const sectionScore of Object.values(scorePlan.bySection)) {
    const contract = bySection[sectionScore.sectionId] ?? fallback;
    for (const bar of sectionScore.bars) {
      contractByBar.set(bar.absoluteBar, contract);
    }
  }
  const barTicks = ppq * beatsPerBar;
  return tracks.map((track) => {
    if (track.role === 'lead' || track.role === 'pad') return track;
    return {
      ...track,
      notes: track.notes.map((note) => {
        const tick = note.startTick as number;
        const absoluteBar = Math.max(0, Math.floor(tick / barTicks));
        const contract = contractByBar.get(absoluteBar) ?? fallback;
        const source = rhythmSwingSourceForContract(contract);
        const swingRatio = contract.swingCurve === 'jazz-tempo'
          ? tempoAwareJazzSwingRatio(contract.compSwingRatio, tempoBpm)
          : contract.compSwingRatio;
        const beat = tick / ppq;
        const swung = swingBeat(beat, swingRatio, source);
        const startTick = Math.round(swung * ppq);
        return startTick === tick ? note : { ...note, startTick: ticks(startTick) };
      }),
    };
  });
}
