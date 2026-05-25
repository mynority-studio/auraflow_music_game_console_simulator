// ============================================================
// HandPartitioner — 钢琴 LH/RH 双手分手 plugin
// ============================================================
//
// Phase 2 of Impro-Visor 移植(2026-05-25)。
// 原型:`/Users/mynority/vibe_coding/Impro-Visor/src/imp/voicing/HandManager.java`
//      + VoicingGenerator.java 的 LH/RH 分簇逻辑。
//
// 算法本质:
//   把 voicing pcs 按 chord vocab priority 拆成 LH 簇(2-3 pc,priority 高的:
//   root/3/7 — bass-side support)+ RH 簇(3-4 pc,剩下的:9/13/color — top-side
//   color)。各簇调 placeVoicingMidi 到对应 MIDI range(LH 36-55 / RH 56-84)。
//
// 与 Impro-Visor 差异:
//   - Impro-Visor 用 weighted random 采样(Math.random 每次新种子)→ 违反 D-5
//     PRNG 协议。
//   - AF2 这里全 'zero' PRNG,用 hash gate(chord.idx + seedHash)决定 numLH/numRH。
//   - Impro-Visor 复杂的 "previous voicing boost / half-step away multiplier"
//     在 AF2 由 placeVoicingMidi 自身 voice-leading cost 已经覆盖。
//
// 启用策略:
//   - Phase 2 默认 OFF(per-mgStyle config = false)— 不破坏现有 4 mgStyle 听感
//   - 后续 mgStyle 单独启用,验证听感
//   - 启用时:Composer 主循环走 partitionHands path,填 ChordDef.lhMidi/rhMidi
//     + notesMidi 同步合并 LH+RH 升序
//
// PRNG 协议:'zero' — 不消耗主 stream
// ============================================================

import { placeVoicingMidi } from '../../music-theory/voicing';
import { getChordVocab } from '../../music-theory/chord-vocab';
import type { ComposerPluginMeta } from './types';

export interface HandPartitionConfig {
  /** LH 最少音数(典型 2) */
  lhMinNotes: number;
  /** LH 最多音数(典型 3) */
  lhMaxNotes: number;
  /** RH 最少音数(典型 3) */
  rhMinNotes: number;
  /** RH 最多音数(典型 4) */
  rhMaxNotes: number;
  /** LH MIDI 区间下界(典型 36 = C2) */
  lhRangeLow: number;
  /** LH MIDI 区间上界(典型 55 = G3,需 >= bassMidi + 4 半音 gap) */
  lhRangeHigh: number;
  /** RH MIDI 区间下界(典型 56 = G#3) */
  rhRangeLow: number;
  /** RH MIDI 区间上界(典型 84 = C6) */
  rhRangeHigh: number;
  /** 最少 pcs 才启用分手(< 此值回退单簇) */
  minTotalNotes: number;
}

/** AF2 默认 HandPartitionConfig — Impro-Visor Closed-High.fv 推荐值改编 */
export const DEFAULT_HAND_CONFIG: HandPartitionConfig = {
  lhMinNotes: 2,
  lhMaxNotes: 3,
  rhMinNotes: 3,
  rhMaxNotes: 4,
  lhRangeLow: 38,       // D2 — 给 bass(C2-G3 BASS_RANGE)留 gap
  lhRangeHigh: 57,      // A3
  rhRangeLow: 58,       // Bb3
  rhRangeHigh: 84,      // C6
  minTotalNotes: 4,     // 少于 4 个 pc 不分手(triad-only 不值得分)
};

export const HandPartitioner: ComposerPluginMeta = {
  name: 'HandPartitioner',
  version: 'v0.1',
  prngConsumption: 'zero',
  description:
    'Phase 2 Impro-Visor 移植:钢琴 voicing 拆 LH/RH 双手簇(zero PRNG hash gate)',
};

// ============================================================
// CORE:partitionHands
// ============================================================
/**
 * 把 voicing pcs 拆成 LH/RH MIDI 双簇。
 *
 * @param pcs            assembleVoicing 输出的完整 voicing pcs(已按 voicing-mode 处理)
 * @param chordType      chord type(用于 placeVoicingMidi 内部 register hint + vocab 查 priority)
 * @param chordRootPc    chord root pc 0-11(用于 placeVoicingMidi)
 * @param bassMidi       bass MIDI(为 LH placement gap 算 cost,LH 不能撞 bass)
 * @param prevLhMidi     上一 chord 的 LH MIDI(voice leading)
 * @param prevRhMidi     上一 chord 的 RH MIDI
 * @param seedHash       deterministic hash(chord.idx | section.startBeat 等),决定 numLH/numRH
 * @param config         HandPartitionConfig(默认 DEFAULT_HAND_CONFIG)
 *
 * @returns 如果 pcs.length < minTotalNotes,返回 null(caller 回退单簇)。
 *          否则返回 { lhMidi, rhMidi }(各自升序)。
 */
export function partitionHands(
  pcs: number[],
  chordType: string,
  chordRootPc: number,
  bassMidi: number,
  prevLhMidi: number[],
  prevRhMidi: number[],
  seedHash: number,
  config: HandPartitionConfig = DEFAULT_HAND_CONFIG,
): { lhMidi: number[]; rhMidi: number[] } | null {
  if (pcs.length < config.minTotalNotes) return null;

  // 1. 决定 numLH(hash gate,zero PRNG)
  const lhSpan = config.lhMaxNotes - config.lhMinNotes + 1;
  const numLH = config.lhMinNotes + ((seedHash >>> 4) & 0xff) % lhSpan;

  // 2. 决定 numRH(剩下的 pcs,clamp 到 [rhMin, rhMax])
  let numRH = pcs.length - numLH;
  numRH = Math.max(config.rhMinNotes, Math.min(config.rhMaxNotes, numRH));

  // 3. 按 chord vocab priority 排序 pcs
  //    priority 高的(typical: root/3/7)进 LH(bass-side support)
  //    priority 低的(typical: 9/13/color)进 RH(top-side color)
  const vocab = getChordVocab(chordType);
  const pcsByPriority = [...pcs].sort((a, b) => {
    const aIdx = vocab.priority.indexOf(((a % 12) + 12) % 12);
    const bIdx = vocab.priority.indexOf(((b % 12) + 12) % 12);
    // priority 数组中找不到 = 排末尾
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  const lhPcs = pcsByPriority.slice(0, numLH);
  let rhPcs = pcsByPriority.slice(numLH);

  // 4. 如果 RH pcs 少于 numRH(typical: triad+9 = 4 pc,numLH=3 → rh=1 < numRH=3),
  //    从 lhPcs 取最重要的(priority 0/1)填到 rh(高八度)— 等效 voiceAll
  if (rhPcs.length < numRH) {
    const fillCount = numRH - rhPcs.length;
    rhPcs = [...rhPcs, ...lhPcs.slice(0, fillCount)];
  }

  // 5. LH placement — 用 LH range
  const lhMidi = placeVoicingMidi(
    lhPcs,
    prevLhMidi,
    bassMidi,
    chordType,
    chordRootPc,
    { low: config.lhRangeLow, high: config.lhRangeHigh },
  );

  // 6. RH placement — 用 RH range,以 LH top 为伪 bass(避免 RH 越界往下撞 LH)
  const rhPseudoBass = lhMidi.length > 0
    ? Math.max(lhMidi[lhMidi.length - 1] ?? bassMidi, bassMidi)
    : bassMidi;
  const rhMidi = placeVoicingMidi(
    rhPcs,
    prevRhMidi,
    rhPseudoBass,
    chordType,
    chordRootPc,
    { low: config.rhRangeLow, high: config.rhRangeHigh },
  );

  return { lhMidi, rhMidi };
}

/**
 * 合并 LH + RH MIDI 成单一升序数组(给 notesMidi 兼容旧 consumer 用)。
 */
export function mergeHands(lhMidi: number[], rhMidi: number[]): number[] {
  return [...lhMidi, ...rhMidi].sort((a, b) => a - b);
}
