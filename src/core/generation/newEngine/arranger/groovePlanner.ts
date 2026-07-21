// ============================================================
// newEngine · arranger · GroovePlanner(2026-06-08)
// ------------------------------------------------------------
// 用户定:GROOVE(鼓的节奏性格)归 Arranger 下发(它握 section 结构 + functionTag + energy)。
//   按 style × functionTag(无则 role)选 GrooveKind,repeatGroup 一致(同 functionTag → 同 groove)。
//   器配层据此从 KB 词汇匹配具体 drum pattern;swing 走 feel.swingRatio,不进 groove。
// ============================================================

import type { GrooveKind } from '../knowledge/grooves';
import type { Section, SectionId, Feel } from './ArrangementPlan';
import type { RandomContext, Rng } from '../foundation/randomContext';
import { grooveContractsForStyle, pickGrooveContract, type GrooveContract, type GrooveDrumIntent, type GrooveStyleName } from '../knowledge/grooveContracts';

// 风格基底 groove(content 段 story/loop/head 用):pop 稳 backbeat / rnb·lofi 慵懒 / jazz swing 直拍。
const STYLE_BASE: Record<string, GrooveKind> = { pop: 'straight', rnb: 'laidback', lofi: 'laidback', jazz: 'straight', default: 'straight' };

// simulator 小写 style → MG 大写 GrooveStyleName(未知 → POP,grooveContractsForStyle 也回退 POP)。
const STYLE_TO_GROOVE: Record<string, GrooveStyleName> = { pop: 'POP', jazz: 'JAZZ', lofi: 'LOFI', rnb: 'RNB', blues: 'BLUES', acg: 'ACG' };
function grooveStyleOf(style: string): GrooveStyleName { return STYLE_TO_GROOVE[style.toLowerCase()] ?? 'POP'; }

function isLyricalMood(mood?: string): boolean {
  if (!mood) return false;
  const s = mood.toLowerCase();
  if (/\b(drive|hype|hard|dance|edm|fast|upbeat|energetic)\b/.test(s)) return false;
  return /\b(ballad|lyric|calm|soft|sad|melanchol|emotional|emo|gentle|warm|tender|slow|smooth|chill|dream|romantic)\b/.test(s);
}

function weightedPickContract(pool: readonly GrooveContract[], rng: Rng): GrooveContract {
  const total = pool.reduce((sum, c) => sum + Math.max(0, c.weight), 0);
  if (total <= 0) return pool[0];
  let roll = rng.next() * total;
  for (const c of pool) {
    roll -= Math.max(0, c.weight);
    if (roll <= 0) return c;
  }
  return pool[pool.length - 1];
}

function fallbackDrumIntentForStyle(style: string): GrooveDrumIntent {
  const s = style.toLowerCase();
  if (s === 'jazz' || s === 'blues') return {
    kitProgram: 40, timekeeperFamily: 'jazz-swing-ride', liftFamily: 'jazz-bebop-comping', pickupFamily: 'jazz-swing-ride', breakdownFamily: 'jazz-brush-ballad',
    fillFamilies: { light: 'jazz-triplet-setup', strong: 'jazz-triplet-setup', pickup: 'jazz-triplet-setup' }, landing: 'kick-ride', kickFollow: 'pulse', snareFollow: 'comping',
  };
  if (s === 'lofi') return {
    kitProgram: 25, timekeeperFamily: 'tr808-lofi-boombap', liftFamily: 'tr808-lofi-boombap', pickupFamily: 'tr808-lofi-boombap', breakdownFamily: 'tr808-lofi-minimal',
    fillFamilies: { light: 'lofi-one-shot', strong: 'lofi-one-shot', pickup: 'lofi-one-shot' }, landing: 'kick', kickFollow: 'bass', snareFollow: 'backbeat',
  };
  if (s === 'rnb') return {
    kitProgram: 25, timekeeperFamily: 'tr808-rnb-pocket', liftFamily: 'tr808-rnb-pocket', pickupFamily: 'tr808-rnb-pocket', breakdownFamily: 'tr808-rnb-pocket',
    fillFamilies: { light: 'rnb-pocket-turn', strong: 'rnb-pocket-turn', pickup: 'rnb-pocket-turn' }, landing: 'kick', kickFollow: 'bass', snareFollow: 'backbeat',
  };
  if (s === 'acg') return {
    kitProgram: 8, timekeeperFamily: 'ballad-halftime', liftFamily: 'jpop-driving-8ths', pickupFamily: 'pop-backbeat', breakdownFamily: 'ballad-halftime',
    fillFamilies: { light: 'pop-snare-pickup', strong: 'pop-tom-build', pickup: 'pop-tom-build' }, landing: 'kick-crash', kickFollow: 'pulse', snareFollow: 'backbeat',
  };
  return {
    kitProgram: 8, timekeeperFamily: 'pop-backbeat', liftFamily: 'pop-backbeat', pickupFamily: 'pop-backbeat', breakdownFamily: 'ballad-halftime',
    fillFamilies: { light: 'pop-snare-pickup', strong: 'pop-tom-build', pickup: 'pop-tom-build' }, landing: 'kick-crash', kickFollow: 'bass', snareFollow: 'backbeat',
  };
}

function pickGrooveContractForMood(gs: GrooveStyleName, rng: Rng, mood?: string): GrooveContract {
  if (gs === 'POP' && isLyricalMood(mood)) {
    const ballad = grooveContractsForStyle(gs).filter((c) =>
      c.id === 'pop_ballad_halftime' || c.density === 'sparse' || c.articulation === 'ballad');
    if (ballad.length > 0) return weightedPickContract(ballad, rng);
  }
  return pickGrooveContract(gs, rng);
}

/** ★ legacy-compatible contract(兜底):BLUES(archived)/ 无 rng 时用 —— swing=feel.swingRatio、pocket 全 0、
 *  velocityHumanize 0 → render 消费后输出=该 style 的 feel 基线(不漂)。
 *  ⚠️ Phase D 起【不再是非 ACG 主路径】:全 MG-backed 风格走真 pool(见 planGrooveContract),此函数仅兜底。 */
function legacyContractForStyle(style: string, feel: Feel): GrooveContract {
  const gs = grooveStyleOf(style);
  const grid = feel.kind === 'swing' ? 'swing' : feel.kind === 'shuffle' ? 'shuffle' : 'straight';
  return {
    id: `legacy_${style.toLowerCase()}`, name: `legacy ${gs}`, style: gs, weight: 1, grid, density: 'medium',
    rhythmProfile: gs === 'JAZZ' || gs === 'BLUES' ? 'jazz-swing' : gs === 'RNB' ? 'rnb-sixteenth' : gs === 'LOFI' ? 'lofi-pocket' : gs === 'ACG' ? 'rubato-four' : 'pop-straight',
    compSwingRatio: feel.swingRatio, melodySwingRatio: feel.swingRatio,
    bassPocketMs: [0, 0], chordPocketMs: [0, 0], melodyStrongPocketMs: [0, 0], melodyWeakPocketMs: [0, 0],
    velocityHumanize: 0, accentPattern: [1.0, 0.85, 0.95, 0.85], articulation: 'legato',
    drum: fallbackDrumIntentForStyle(style),
  };
}

/** ★ 选 GrooveContract(Phase D):全 MG-backed 风格(POP/JAZZ/RNB/LOFI/ACG)→ 真 pool 加权(独立
 *  `grooveContract` 子流,确定性);BLUES/无 rng → legacy 派生兜底。section-level 暂全曲同 contract(段级变化留后续)。 */
export function planGrooveContract(
  sections: readonly Section[], style: string, feel: Feel, rng?: RandomContext, mood?: string,
): { song: GrooveContract; bySection: Record<SectionId, GrooveContract> } {
  // ★ MG full-parity Phase D(directive 3.2,推翻零洗牌):所有 MG-backed 风格(POP/JAZZ/RNB/LOFI/ACG)
  //   都从真 pool 选 GrooveContract(独立 grooveContract 子流,确定性)。BLUES(archived)/ 无 rng → legacy 派生兜底。
  //   render 只消费选中的 contract(pocket 由 applyGroovePocket 消费;feel 由 mgLeadRenderer 消费),不重 pick。
  const gs = grooveStyleOf(style);
  const isMgBacked = gs === 'POP' || gs === 'JAZZ' || gs === 'RNB' || gs === 'LOFI' || gs === 'ACG';
  const song = isMgBacked && rng ? pickGrooveContractForMood(gs, rng.substream('grooveContract'), mood) : legacyContractForStyle(style, feel);
  const bySection: Record<SectionId, GrooveContract> = {};
  for (const s of sections) bySection[s.id] = song;
  return { song, bySection };
}

/** 每段 GrooveKind:framing/收尾 → sparse;hook/solo → driving;build → straight;content → 风格基底。 */
export function planGroove(sections: readonly Section[], style: string, mood?: string): Record<SectionId, GrooveKind> {
  const styleKey = style.toLowerCase();
  const base = STYLE_BASE[styleKey] ?? 'straight';
  const popLyrical = styleKey === 'pop' && isLyricalMood(mood);
  const out: Record<SectionId, GrooveKind> = {};
  for (const s of sections) {
    const tag = s.functionTag;
    let g: GrooveKind;
    if (popLyrical && (tag === 'story' || tag === 'setup' || tag === 'breakdown' || tag === 'outro' || tag === 'tag')) g = 'sparse';
    else if (popLyrical && tag === 'hook') g = 'straight';
    else if (tag === 'setup' || tag === 'breakdown' || tag === 'outro' || tag === 'tag') g = 'sparse';
    else if (tag === 'hook' || tag === 'solo') g = 'driving';
    else if (tag === 'build') g = 'straight';
    else if (tag) g = base;          // story / loop / head → 风格基底
    else g = s.role === 'intro' || s.role === 'outro' ? 'sparse' : s.role === 'chorus' ? 'driving' : base; // 无 functionTag → 按 role
    out[s.id] = g;
  }
  return out;
}
