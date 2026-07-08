// ============================================================
// motifSandbox · model · 进行模板候选(directive roadmap_slot_fusion §6)—— 复用 newEngine knowledge/progressions
// ------------------------------------------------------------
// getProgressionCandidatesForMotif:据 style 取【该风格全部模板】(两调式都进 → 所有 Q+R 风格模板可达)。
//   ★ 不再用 functionRole:'verse' 硬过滤(那把 chorus/bridge/intro/ending 模板全挡掉);段落角色改成
//     打分软权重(scorer.sectionRoleFit)。opposite-mode 标 modeMatch=false 进池,scorer 降权(scored
//     fallback,不是无声惊喜)。BLUES 不进 Q+R;非 jazz 不退化到 JAZZ。只读知识层,不碰生产链。
// ============================================================

import { listProgressionPrototypes, fitProgressionToBars, type ProgressionPrototype, type ProgressionSlot, type HarmonyStyleName, type ProtoMode } from '../../newEngine/knowledge/progressions';
import type { SandboxStyle, ScaleMode } from './types';

const STYLE_MAP: Record<SandboxStyle, HarmonyStyleName> = { pop: 'POP', jazz: 'JAZZ', lofi: 'LOFI', rnb: 'RNB', acg: 'ACG' };
const MODE_MAP: Record<ScaleMode, ProtoMode> = { major: 'Major', minor: 'Minor' };

export interface ProgressionCandidate {
  prototype: ProgressionPrototype;
  fittedSlots: ProgressionSlot[]; // 已 fit 到 targetBars
  modeMatch: boolean;             // 模板调式 == 目标调式(false = 同风格反调回退,scorer 降权)
}

export interface CandidatePool {
  candidates: ProgressionCandidate[];
  styleName: HarmonyStyleName;
  modeName: ProtoMode;
}

const notBlues = (p: ProgressionPrototype): boolean => p.style !== 'BLUES';

/** 取 motif 的进行模板候选 = 该风格【全部】模板(两调式;opposite-mode 标记后降权)。BLUES 不进。 */
export function getProgressionCandidatesForMotif(args: { style: SandboxStyle; mode: ScaleMode; targetBars?: number }): CandidatePool {
  const styleName = STYLE_MAP[args.style];
  const modeName = MODE_MAP[args.mode];
  const targetBars = args.targetBars ?? 16;

  // 全部该风格模板(不按 functionRole / 单调式硬过滤 → 全可达;BLUES 是独立风格,天然不在 Q+R 五风格池里)。
  let pool = listProgressionPrototypes({ style: styleName });
  // 兜底(风格池空,不该发生)→ 同调式、排除 BLUES、非 jazz 不退到 jazz。
  if (pool.length === 0) pool = listProgressionPrototypes({ mode: modeName }).filter((p) => notBlues(p) && (styleName === 'JAZZ' || p.style !== 'JAZZ'));
  if (pool.length === 0) pool = listProgressionPrototypes({}).filter((p) => notBlues(p) && (styleName === 'JAZZ' || p.style !== 'JAZZ'));

  const candidates = pool.map((p) => ({ prototype: p, fittedSlots: fitProgressionToBars(p.slots, targetBars), modeMatch: p.mode === modeName }));
  return { candidates, styleName, modeName };
}
