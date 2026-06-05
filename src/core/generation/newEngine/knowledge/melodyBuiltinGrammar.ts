// ============================================================
// newEngine · knowledge · MelodyBuiltinGrammar(MG strict 移植 Loop 1)
// ------------------------------------------------------------
// Provenance: ../melodygenerative/src/lib/improvisor/BuiltinGrammar.ts 忠实港(逐值)。
// CLEAN-ROOM:规则由乐理第一性推导(cadence ⇒ guide-tone 落下一和弦 3;ii-V ⇒ 和弦音+色彩+approach),
// 非抄任何 GPL .grammar。覆盖 parser 识别的 brick 族。KB 合规:纯数据 + makeGrammar。
// ============================================================

import { makeGrammar, type GrammarRule } from './melodyGrammarTypes';

const C8 = (): GrammarRule['rhs'][number] => ({ kind: 'C', duration: 0.5 });
const C4 = (): GrammarRule['rhs'][number] => ({ kind: 'C', duration: 1.0 });
const G8 = (): GrammarRule['rhs'][number] => ({ kind: 'G', duration: 0.5 });
const G4 = (): GrammarRule['rhs'][number] => ({ kind: 'G', duration: 1.0 });
const L8 = (): GrammarRule['rhs'][number] => ({ kind: 'L', duration: 0.5 });
const S8 = (): GrammarRule['rhs'][number] => ({ kind: 'S', duration: 0.5 });
const S4 = (): GrammarRule['rhs'][number] => ({ kind: 'S', duration: 1.0 });
const A8 = (): GrammarRule['rhs'][number] => ({ kind: 'A', duration: 0.5 });
const R8 = (): GrammarRule['rhs'][number] => ({ kind: 'R', duration: 0.5 });
const R4 = (): GrammarRule['rhs'][number] => ({ kind: 'R', duration: 1.0 });

export const BUILTIN_RULES: GrammarRule[] = [
  // ── Start dispatches by brick family ──
  { lhs: 'Phrase', weight: 1, conditions: { brickFamily: ['Cadence'] }, rhs: ['Cadence'] },
  { lhs: 'Phrase', weight: 1, conditions: { brickFamily: ['GenDom'] }, rhs: ['DomLine'] },
  // G1-2: Launcher(ii-V indicating motion)— 暂用 DomLine;未来:专用 LauncherLine 更"指向前"。
  { lhs: 'Phrase', weight: 1, conditions: { brickFamily: ['Launcher'] }, rhs: ['DomLine'] },
  // G1-1: Dropback(I → dom7 detour back to ii)— 用 TurnaroundLine 下行模式。
  { lhs: 'Phrase', weight: 1, conditions: { brickFamily: ['Dropback'] }, rhs: ['TurnaroundLine'] },
  { lhs: 'Phrase', weight: 1, conditions: { brickFamily: ['Major-On'] }, rhs: ['MajorOnLine'] },
  { lhs: 'Phrase', weight: 1, conditions: { brickFamily: ['Minor-On'] }, rhs: ['MinorOnLine'] },
  { lhs: 'Phrase', weight: 1, conditions: { brickFamily: ['Turnaround'] }, rhs: ['TurnaroundLine'] },
  { lhs: 'Phrase', weight: 1, conditions: { brickFamily: ['Blues'] }, rhs: ['BluesLine'] },
  { lhs: 'Phrase', weight: 1, conditions: { brickFamily: ['Borrowed'] }, rhs: ['ColorLine'] },
  { lhs: 'Phrase', weight: 1, conditions: { brickFamily: ['Unknown'] }, rhs: ['NeutralLine'] },

  // ── Cadence: end on 3 of next chord(approach + chord tone landing)──
  { lhs: 'Cadence', weight: 2, rhs: [G8(), L8(), C8(), A8(), C8(), L8(), A8(), G4()] },
  { lhs: 'Cadence', weight: 1, rhs: [R8(), G8(), C8(), L8(), C8(), A8(), G4(), R4()] },
  { lhs: 'Cadence', weight: 1, rhs: [G8(), S8(), L8(), C8(), L8(), A8(), G4(), C8(), R8()] },

  // ── Dom line: tension-rich, lands on approach + chord tone ──
  { lhs: 'DomLine', weight: 2, rhs: [G8(), L8(), L8(), C8(), L8(), A8(), G8(), C8()] },
  { lhs: 'DomLine', weight: 1, rhs: [L8(), G8(), L8(), A8(), G8(), R8(), C8(), L8()] },

  // ── Major-On: stable melody emphasizing chord tones ──
  { lhs: 'MajorOnLine', weight: 2, rhs: [G8(), S8(), C8(), L8(), S8(), C8(), G4()] },
  { lhs: 'MajorOnLine', weight: 1, rhs: [G4(), L8(), S8(), C8(), S8(), C8(), R8()] },

  // ── Minor-On: minor-mode emphasis, frequent b3/b7(handled by chord type at LickGen)──
  { lhs: 'MinorOnLine', weight: 2, rhs: [G8(), L8(), C8(), S8(), C8(), S8(), G4()] },
  { lhs: 'MinorOnLine', weight: 1, rhs: [G4(), C8(), L8(), S8(), C8(), L8()] },

  // ── Turnaround: 4-bar typical, more rhythmic variety ──
  { lhs: 'TurnaroundLine', weight: 1, rhs: [C8(), C8(), L8(), S8(), 'TurnaroundLine2'] },
  { lhs: 'TurnaroundLine2', weight: 1, rhs: [C8(), L8(), A8(), C8(), C8(), S8(), L8(), C4()] },

  // ── Blues: bluesy pentatonic feel, more rest ──
  { lhs: 'BluesLine', weight: 2, rhs: [C8(), L8(), C8(), R8(), L8(), C8(), R4()] },
  { lhs: 'BluesLine', weight: 1, rhs: [R8(), C8(), L8(), C8(), L8(), C8(), C4()] },

  // ── Color line: borrowed chord — emphasize color tone ──
  { lhs: 'ColorLine', weight: 1, rhs: [L8(), G8(), L8(), C8(), L8(), G4(), R8()] },

  // ── Neutral line: safe scale-tone walk for Unknown bricks ──
  { lhs: 'NeutralLine', weight: 1, rhs: [S8(), S8(), G8(), S8(), S8(), C8(), G4()] },
  { lhs: 'NeutralLine', weight: 1, rhs: [G4(), S4(), S4(), G4()] },
];

export const BUILTIN_GRAMMAR = makeGrammar(BUILTIN_RULES, 'Phrase');
