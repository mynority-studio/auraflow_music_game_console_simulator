// ============================================================
// motifSandbox · bridge · Q+R 产物 → Q+N MotifSongOverride(走 A · PR3 高层入口)
// ------------------------------------------------------------
// 把一次 Q+R motif weave 结果(progression + lead)整体转成 generateSongFromMotif 的注入合同:
//   harmony = 权威和声(sandboxProgressionToHarmonicPlan),lead = 权威 lead(MotifNote→MotifLeadNote,beats)。
// 这是 UI / 调用方拿到的【单一转换入口】。
// ============================================================

import type { MotifSongOverride, MotifLeadNote } from '../../newEngine/generation/generateSongFromMotif';
import { harmonicPlanToMgChordDefs } from '../../newEngine/render/mgChordDefAdapter';
import { buildChordPart } from '../../newEngine/render/mgChordPart';
import { parseFunctionalRoadMap } from '../../newEngine/render/mgFunctionalRoadMap';
import { planAuthoredUserMotifBrick } from '../../newEngine/render/userMotifBrick';
import { sandboxProgressionToHarmonicPlan } from './sandboxToHarmonicPlan';
import { analyzeUserMelodicBrick } from '../model/melodicBrickAnalyzer';
import { inferHarmonyIntent } from '../model/melodicBrickHarmonyIntent';
import { selectProgressionForMotif } from '../model/motifProgressionSelector';
import type { ProgressionCandidate } from '../model/progressionCandidateProvider';
import { realizeToSandboxChords } from '../model/motifRoadmap';
import type { SandboxTonality } from '../model/sandboxScales';
import type { MotifNote, MotifWeaverResult, SandboxStyle, ScaleMode, UserMotif } from '../model/types';

const MOTIF_LEAD_PRESENCE_FLOOR = 82;
const MOTIF_LEAD_TARGET_AVG = 92;
const MOTIF_LEAD_GAIN_THRESHOLD = 88;
const MOTIF_LEAD_MAX_GAIN = 2.5;
const MOTIF_LEAD_BOOSTED_CEILING = 118;
const DEFAULT_TARGET_BARS = 16;
const PRODUCTION_STYLE = { pop: 'POP', jazz: 'JAZZ', lofi: 'LOFI', rnb: 'RNB', acg: 'ACG' } as const;

export interface UserMotifBrickSongOverrideOptions {
  quoteBeats?: number;
  style?: SandboxStyle;
  seed?: number;
  keyPc?: number;
  mode?: ScaleMode;
  targetBars?: number;
  inputTonality?: SandboxTonality;
}

interface MotifOwnedPlan {
  harmony?: MotifSongOverride['harmony'];
  primaryFunction: ReturnType<typeof analyzeUserMelodicBrick>['primaryFunction'];
  rolePotential: ReturnType<typeof analyzeUserMelodicBrick>['rolePotential'];
}

function clampVelocity(v: number, hi = 127): number {
  return Math.max(1, Math.min(hi, Math.round(v)));
}

/** Q+R lead 音(velocity 0..1)→ 权威 lead 音(beats,velocity 1..127)。 */
export function motifNoteToLeadNote(n: MotifNote): MotifLeadNote {
  return {
    pitch: Math.round(n.midi),
    onsetBeat: n.onsetBeat,
    durationBeat: n.durationBeat,
    velocity: clampVelocity((n.velocity || 0.7) * 127),
    accent: n.accent,
    structuralToneScore: n.structuralToneScore,
  };
}

/** Q+R 整编用 lead presence:用户轻弹的 motif 进完整 pop/乐队伴奏时不能被 comp 盖住。 */
export function motifNotesToLeadNotes(notes: readonly MotifNote[]): MotifLeadNote[] {
  const raw = notes.map(motifNoteToLeadNote);
  if (!raw.length) return raw;

  const avg = raw.reduce((sum, n) => sum + n.velocity, 0) / raw.length;
  const gain = avg < MOTIF_LEAD_GAIN_THRESHOLD
    ? Math.min(MOTIF_LEAD_MAX_GAIN, MOTIF_LEAD_TARGET_AVG / Math.max(1, avg))
    : 1;

  return raw.map((n) => ({
    ...n,
    velocity: clampVelocity(
      Math.max(MOTIF_LEAD_PRESENCE_FLOOR, n.velocity * gain),
      gain > 1 ? MOTIF_LEAD_BOOSTED_CEILING : 127,
    ),
  }));
}

/** 一次 Q+R weave 结果 → Q+N 注入合同(harmony + lead 都做权威)。 */
export function buildMotifSongOverride(result: MotifWeaverResult, keyPc: number, mode: ScaleMode): MotifSongOverride {
  return {
    harmony: sandboxProgressionToHarmonicPlan(result.progression, keyPc, mode),
    lead: motifNotesToLeadNotes(result.lead),
    key: { keyPc: ((keyPc % 12) + 12) % 12, mode }, // 供 generateSongFromMotif 把 16-bar 和声 tile 满 arrangement 时重装配
  };
}

function quoteBeatsForMotif(motif: UserMotif): number {
  return motif.lengthBeats;
}

const m12 = (n: number): number => ((n % 12) + 12) % 12;

function buildMotifOwnedPlan(motif: UserMotif, opts: UserMotifBrickSongOverrideOptions, quoteBeats: number): MotifOwnedPlan {
  const keyPc = m12(opts.keyPc ?? motif.keyPc);
  const mode = opts.mode ?? motif.mode;
  const brick = analyzeUserMelodicBrick({ ...motif, keyPc, mode }, quoteBeats);
  if (!opts.style) return { primaryFunction: brick.primaryFunction, rolePotential: brick.rolePotential };
  const inputTonality = opts.inputTonality ?? motif.inputTonality;
  const seed = opts.seed ?? 0;
  const targetBars = opts.targetBars ?? DEFAULT_TARGET_BARS;
  const productionBrick = {
    notes: motifNotesToLeadNotes(motif.notes),
    quoteBeats,
    sourceMotifId: motif.id,
    primaryFunction: brick.primaryFunction,
    rolePotential: brick.rolePotential,
  };
  const evaluateProductionPlacement = (candidate: ProgressionCandidate) => {
    const realizedCandidate = realizeToSandboxChords(candidate.fittedSlots, keyPc, mode, { inputTonality, userBrick: brick, seed });
    const harmonicCandidate = sandboxProgressionToHarmonicPlan(realizedCandidate, keyPc, mode);
    const part = buildChordPart(harmonicPlanToMgChordDefs(harmonicCandidate), [4, 4]);
    const roadMap = parseFunctionalRoadMap({ part, songKeyPc: keyPc, style: PRODUCTION_STYLE[opts.style!] });
    const placement = planAuthoredUserMotifBrick({
      brick: productionBrick,
      roadMap,
      harmonicPlan: harmonicCandidate,
      totalBeats: targetBars * 4,
    });
    return placement
      ? { score: placement.placementScore * 0.2, viable: placement.harmonicSupportRatio >= 0.72 }
      : { score: -100, viable: false };
  };
  const selected = selectProgressionForMotif({
    brick,
    intent: inferHarmonyIntent(brick),
    style: opts.style,
    mode,
    keyPc,
    seed,
    targetBars,
    sectionRole: 'verse',
    inputTonality,
    requireFirstPhraseSupport: false,
    evaluateProductionPlacement,
  });
  const realizeOpts = { inputTonality, userBrick: brick, seed };
  const realized = realizeToSandboxChords(selected.slots, keyPc, mode, realizeOpts);
  return {
    harmony: sandboxProgressionToHarmonicPlan(realized, keyPc, mode),
    primaryFunction: brick.primaryFunction,
    rolePotential: brick.rolePotential,
  };
}

function normalizeOverrideOptions(motif: UserMotif, optionsOrQuoteBeats?: number | UserMotifBrickSongOverrideOptions): { quoteBeats: number; opts: UserMotifBrickSongOverrideOptions } {
  if (typeof optionsOrQuoteBeats === 'number') return { quoteBeats: optionsOrQuoteBeats, opts: { quoteBeats: optionsOrQuoteBeats } };
  const opts = optionsOrQuoteBeats ?? {};
  return { quoteBeats: opts.quoteBeats ?? quoteBeatsForMotif(motif), opts };
}

/** Q+R product path: pass the complete user motif to Q+N; production RoadMap owns placement. */
export function buildUserMotifBrickSongOverride(motif: UserMotif, optionsOrQuoteBeats?: number | UserMotifBrickSongOverrideOptions): MotifSongOverride {
  const { quoteBeats, opts } = normalizeOverrideOptions(motif, optionsOrQuoteBeats);
  const motifOwned = buildMotifOwnedPlan(motif, opts, quoteBeats);
  const keyPc = m12(opts.keyPc ?? motif.keyPc);
  const mode = opts.mode ?? motif.mode;
  return {
    ...(motifOwned.harmony ? { harmony: motifOwned.harmony, key: { keyPc, mode } } : {}),
    userBrick: {
      notes: motifNotesToLeadNotes(motif.notes),
      quoteBeats,
      sourceMotifId: motif.id,
      primaryFunction: motifOwned.primaryFunction,
      rolePotential: motifOwned.rolePotential,
    },
  };
}

/** 兼容调试 result 的便捷入口;产品 UI 优先用 buildUserMotifBrickSongOverride(motif)。 */
export function buildMotifBrickSongOverride(result: MotifWeaverResult): MotifSongOverride {
  return buildUserMotifBrickSongOverride(result.motif);
}
