// ============================================================
// motifSandbox · model · 进行模板候选(directive §8)—— 复用 newEngine knowledge/progressions
// ------------------------------------------------------------
// getProgressionCandidatesForMotif:据 style/mode 从 newEngine 进行模板库取候选,fit 到 16 bar。
//   非 jazz 不退化到 JAZZ。只读知识层,不碰生产链。
// ============================================================

import { listProgressionPrototypes, fitProgressionToBars, type ProgressionPrototype, type ProgressionSlot, type HarmonyStyleName, type ProtoMode } from '../../newEngine/knowledge/progressions';
import type { SandboxStyle, ScaleMode } from './types';

const STYLE_MAP: Record<SandboxStyle, HarmonyStyleName> = { pop: 'POP', lofi: 'LOFI', rnb: 'RNB', jazz: 'JAZZ' };
const MODE_MAP: Record<ScaleMode, ProtoMode> = { major: 'Major', minor: 'Minor' };

export interface ProgressionCandidate {
  prototype: ProgressionPrototype;
  fittedSlots: ProgressionSlot[]; // 已 fit 到 targetBars
}

export interface CandidatePool {
  candidates: ProgressionCandidate[];
  styleName: HarmonyStyleName;
  modeName: ProtoMode;
}

/** 取 motif 的进行模板候选(verse 优先;逐级放宽但【非 jazz 不退到 jazz】)。 */
export function getProgressionCandidatesForMotif(args: { style: SandboxStyle; mode: ScaleMode; targetBars?: number }): CandidatePool {
  const styleName = STYLE_MAP[args.style];
  const modeName = MODE_MAP[args.mode];
  const targetBars = args.targetBars ?? 16;

  let pool = listProgressionPrototypes({ style: styleName, mode: modeName, functionRole: 'verse' });
  if (pool.length === 0) pool = listProgressionPrototypes({ style: styleName, mode: modeName });
  if (pool.length === 0) pool = listProgressionPrototypes({ style: styleName });
  if (pool.length === 0) pool = listProgressionPrototypes({ mode: modeName }).filter((p) => styleName === 'JAZZ' || p.style !== 'JAZZ'); // 非 jazz 不退到 jazz
  if (pool.length === 0) pool = listProgressionPrototypes({}).filter((p) => styleName === 'JAZZ' || p.style !== 'JAZZ');

  const candidates = pool.map((p) => ({ prototype: p, fittedSlots: fitProgressionToBars(p.slots, targetBars) }));
  return { candidates, styleName, modeName };
}
