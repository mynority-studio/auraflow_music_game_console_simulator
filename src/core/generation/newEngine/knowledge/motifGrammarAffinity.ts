// ============================================================
// newEngine · knowledge · motif grammar 亲和度(redesign 三期)
// ------------------------------------------------------------
// 用户动机的节奏形状 vs 各风格 grammar 语料的节奏形状 → 排名。
// "这个动机在 RNB 语法里最自在" —— 只做节奏身份匹配(与生产链的
// rhythm-matched 展开同一把尺 melodyRhythmShapeSimilarity),不评优劣。
// 语料 profile 模块级懒缓存;纯函数、确定性。
// ============================================================

import {
  buildGrammarRhythmShapeProfile,
  buildMelodyRhythmShapeProfile,
  melodyRhythmShapeSimilarity,
  type MelodyRhythmShapeProfile,
  type RhythmShapeEvent,
} from '../render/mgRhythmShapeMatcher';
import type { AbstractMelodyToken, GrammarRule } from './melodyGrammarTypes';
import {
  acgPianoSongSlopeRulesToGrammarRules,
  jazzSlopeRulesToGrammarRules,
  lofiStableSlopeRulesToGrammarRules,
  popStableSlopeRulesToGrammarRules,
  rnbSoulSlopeRulesToGrammarRules,
} from './melodySlopeAdapter';

export type MotifAffinityStyle = 'pop' | 'jazz' | 'lofi' | 'rnb' | 'acg';
export interface MotifGrammarAffinity {
  style: MotifAffinityStyle;
  score: number; // 0..1(风格语料 top-K 邻域的平均相似度)
}

const STYLE_LABEL: Record<MotifAffinityStyle, string> = {
  pop: 'POP', jazz: 'JAZZ', lofi: 'LOFI', rnb: 'RNB', acg: 'ACG',
};
const RULES_PER_STYLE_CAP = 200; // 每风格按权重取前 N 条,足够刻画风格节奏身份
const TOP_K = 8;                 // 邻域大小:动机只需在语料里有一小片"同类"即算自在

function ruleTokens(rule: GrammarRule): AbstractMelodyToken[] {
  return rule.rhs.filter((x): x is AbstractMelodyToken => typeof x !== 'string');
}

function ruleProfile(rule: GrammarRule): MelodyRhythmShapeProfile | null {
  const tokens = ruleTokens(rule);
  const span = rule.metadata?.authoredDurationBeats
    ?? tokens.reduce((sum, t) => sum + Math.max(0, t.duration), 0);
  if (span < 0.5 || tokens.every((t) => t.duration <= 0 || t.kind === 'R')) return null;
  return buildGrammarRhythmShapeProfile(tokens, span);
}

function styleProfiles(rules: GrammarRule[]): MelodyRhythmShapeProfile[] {
  return [...rules]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, RULES_PER_STYLE_CAP)
    .map(ruleProfile)
    .filter((p): p is MelodyRhythmShapeProfile => p !== null);
}

let corpusCache: Record<MotifAffinityStyle, MelodyRhythmShapeProfile[]> | null = null;
function corpus(): Record<MotifAffinityStyle, MelodyRhythmShapeProfile[]> {
  if (!corpusCache) {
    corpusCache = {
      pop: styleProfiles(popStableSlopeRulesToGrammarRules()),
      jazz: styleProfiles(jazzSlopeRulesToGrammarRules()),
      lofi: styleProfiles(lofiStableSlopeRulesToGrammarRules()),
      rnb: styleProfiles(rnbSoulSlopeRulesToGrammarRules()),
      acg: styleProfiles(acgPianoSongSlopeRulesToGrammarRules()),
    };
  }
  return corpusCache;
}

/** 动机节奏形状对各风格语料的亲和度排名(降序)。events = motif 音符(onsetBeat/durationBeat)。 */
export function rankMotifGrammarAffinity(
  events: readonly RhythmShapeEvent[],
  spanBeats: number,
): MotifGrammarAffinity[] {
  const target = buildMelodyRhythmShapeProfile(events, 0, Math.max(1, spanBeats));
  const ranked = (Object.entries(corpus()) as Array<[MotifAffinityStyle, MelodyRhythmShapeProfile[]]>)
    .map(([style, profiles]) => {
      if (profiles.length === 0) return { style, score: 0 };
      const sims = profiles.map((p) => melodyRhythmShapeSimilarity(target, p)).sort((a, b) => b - a);
      const top = sims.slice(0, Math.min(TOP_K, sims.length));
      return { style, score: top.reduce((a, b) => a + b, 0) / top.length };
    });
  return ranked.sort((a, b) => b.score - a.score || a.style.localeCompare(b.style));
}

/** UI 一行文案:"RNB .82 · LOFI .76 · POP .71"(取前 3)。 */
export function motifGrammarAffinityLine(ranked: readonly MotifGrammarAffinity[]): string {
  return ranked.slice(0, 3)
    .map((r) => `${STYLE_LABEL[r.style]} ${r.score.toFixed(2).replace(/^0/, '')}`)
    .join(' · ');
}
