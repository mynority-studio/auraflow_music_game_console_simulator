// ============================================================
// newEngine · arranger · GroovePlanner(2026-06-08)
// ------------------------------------------------------------
// 用户定:GROOVE(鼓的节奏性格)归 Arranger 下发(它握 section 结构 + functionTag + energy)。
//   按 style × functionTag(无则 role)选 GrooveKind,repeatGroup 一致(同 functionTag → 同 groove)。
//   器配层据此从 KB 词汇匹配具体 drum pattern;swing 走 feel.swingRatio,不进 groove。
// ============================================================

import type { GrooveKind } from '../knowledge/grooves';
import type { Section, SectionId, Feel } from './ArrangementPlan';
import type { RandomContext } from '../foundation/randomContext';
import { pickGrooveContract, type GrooveContract, type GrooveStyleName } from '../knowledge/grooveContracts';

// 风格基底 groove(content 段 story/loop/head 用):pop 稳 backbeat / rnb·lofi 慵懒 / jazz swing 直拍。
const STYLE_BASE: Record<string, GrooveKind> = { pop: 'straight', rnb: 'laidback', lofi: 'laidback', jazz: 'straight', default: 'straight' };

// simulator 小写 style → MG 大写 GrooveStyleName(未知 → POP,grooveContractsForStyle 也回退 POP)。
const STYLE_TO_GROOVE: Record<string, GrooveStyleName> = { pop: 'POP', jazz: 'JAZZ', lofi: 'LOFI', rnb: 'RNB', blues: 'BLUES', acg: 'ACG' };
function grooveStyleOf(style: string): GrooveStyleName { return STYLE_TO_GROOVE[style.toLowerCase()] ?? 'POP'; }

/** ★ MG 升级零洗牌(§7.2):非 ACG 风格【派生 legacy-compatible contract】—— swing=现 feel.swingRatio、
 *  pocket 全 0、velocityHumanize 0 → render 消费后输出与现状一致(旧歌/旧测试不漂)。 */
function legacyContractForStyle(style: string, feel: Feel): GrooveContract {
  const gs = grooveStyleOf(style);
  const grid = feel.kind === 'swing' ? 'swing' : feel.kind === 'shuffle' ? 'shuffle' : 'straight';
  return {
    id: `legacy_${style.toLowerCase()}`, name: `legacy ${gs}`, style: gs, weight: 1, grid, density: 'medium',
    compSwingRatio: feel.swingRatio, melodySwingRatio: feel.swingRatio,
    bassPocketMs: [0, 0], chordPocketMs: [0, 0], melodyStrongPocketMs: [0, 0], melodyWeakPocketMs: [0, 0],
    velocityHumanize: 0, accentPattern: [1.0, 0.85, 0.95, 0.85], articulation: 'legato',
  };
}

/** ★ 选/派生 GrooveContract(§7.2 零洗牌):ACG → 新 pool 加权(独立 `grooveContract` 子流,不扰主流);
 *  非 ACG → legacy 派生(无 rng)。section-level 暂全曲同 contract(段级变化留后续)。 */
export function planGrooveContract(
  sections: readonly Section[], style: string, feel: Feel, rng?: RandomContext,
): { song: GrooveContract; bySection: Record<SectionId, GrooveContract> } {
  // ★ MG full-parity Phase D(directive 3.2,推翻零洗牌):所有 MG-backed 风格(POP/JAZZ/RNB/LOFI/ACG)
  //   都从真 pool 选 GrooveContract(独立 grooveContract 子流,确定性)。BLUES(archived)/ 无 rng → legacy 派生兜底。
  //   render 只消费选中的 contract(pocket 由 applyGroovePocket 消费;feel 由 mgLeadRenderer 消费),不重 pick。
  const gs = grooveStyleOf(style);
  const isMgBacked = gs === 'POP' || gs === 'JAZZ' || gs === 'RNB' || gs === 'LOFI' || gs === 'ACG';
  const song = isMgBacked && rng ? pickGrooveContract(gs, rng.substream('grooveContract')) : legacyContractForStyle(style, feel);
  const bySection: Record<SectionId, GrooveContract> = {};
  for (const s of sections) bySection[s.id] = song;
  return { song, bySection };
}

/** 每段 GrooveKind:framing/收尾 → sparse;hook/solo → driving;build → straight;content → 风格基底。 */
export function planGroove(sections: readonly Section[], style: string): Record<SectionId, GrooveKind> {
  const base = STYLE_BASE[style.toLowerCase()] ?? 'straight';
  const out: Record<SectionId, GrooveKind> = {};
  for (const s of sections) {
    const tag = s.functionTag;
    let g: GrooveKind;
    if (tag === 'setup' || tag === 'breakdown' || tag === 'outro' || tag === 'tag') g = 'sparse';
    else if (tag === 'hook' || tag === 'solo') g = 'driving';
    else if (tag === 'build') g = 'straight';
    else if (tag) g = base;          // story / loop / head → 风格基底
    else g = s.role === 'intro' || s.role === 'outro' ? 'sparse' : s.role === 'chorus' ? 'driving' : base; // 无 functionTag → 按 role
    out[s.id] = g;
  }
  return out;
}
