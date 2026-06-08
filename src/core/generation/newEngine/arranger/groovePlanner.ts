// ============================================================
// newEngine · arranger · GroovePlanner(2026-06-08)
// ------------------------------------------------------------
// 用户定:GROOVE(鼓的节奏性格)归 Arranger 下发(它握 section 结构 + functionTag + energy)。
//   按 style × functionTag(无则 role)选 GrooveKind,repeatGroup 一致(同 functionTag → 同 groove)。
//   器配层据此从 KB 词汇匹配具体 drum pattern;swing 走 feel.swingRatio,不进 groove。
// ============================================================

import type { GrooveKind } from '../knowledge/grooves';
import type { Section, SectionId } from './ArrangementPlan';

// 风格基底 groove(content 段 story/loop/head 用):pop 稳 backbeat / rnb·lofi 慵懒 / jazz swing 直拍。
const STYLE_BASE: Record<string, GrooveKind> = { pop: 'straight', rnb: 'laidback', lofi: 'laidback', jazz: 'straight', default: 'straight' };

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
