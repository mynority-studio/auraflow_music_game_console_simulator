// ============================================================
// newEngine · render · userMotifGrammar(redesign 四期)
// ------------------------------------------------------------
// 用户裁决 §0.5:衍生材料允许模进/延展/渐变/拆分。把 motif 与其片段编码为
// grammar 规则注入当前风格语法 → 生成的 lead 全曲反复"说"动机形状:
//   节奏 = motif 的 IOI/时值(含休止);音程行进 = 每步 SlopeEnter[step±1] 窗口
//   (near-sequence:realizer 按和声现场定音高 = 模进/渐变,chooser 对
//   low==high 本就强制 ±1,精确音程在该链路不可达也不必要)。
// motif 的【出现】仍由 authored span 逐音原样负责;此处只造衍生材料。
// 变体各有不同 RHS 签名(family-only 采样按签名 cap,多签名 → 占比 ≈ K×cap);
// 节奏重掷 8 次挑最像动机的机制会进一步放大这些规则的实际命中率。
// ============================================================

import {
  makeGrammar,
  type AbstractMelodyToken,
  type Grammar,
  type GrammarRule,
} from '../knowledge/melodyGrammarTypes';
import type { AuthoredUserMotifBrickPlan } from './userMotifBrick';

export const USER_MOTIF_RULE_SOURCE = 'user-motif';
/** legacy 加权采样下的存在感(语料单条权重多为 1..11);family-only 出口被 rhsWeightCap 归一,不受此值垄断。 */
export const USER_MOTIF_RULE_WEIGHT_FULL = 40;
export const USER_MOTIF_RULE_WEIGHT_FRAGMENT = 24;
const STEP_WINDOW = 1; // 每步音程窗口 ±1 半音 = 近似模进(渐变)

interface RelNote { pitch: number; onset: number; dur: number }

function relativeNotes(plan: AuthoredUserMotifBrickPlan): RelNote[] {
  return [...plan.notes]
    .sort((a, b) => a.onsetBeat - b.onsetBeat)
    .map((n) => ({ pitch: n.pitch, onset: n.onsetBeat - plan.startBeat, dur: n.durationBeat }));
}

/** 0 起点音符序列 → token 序列:R 补间隙,首音 C 锚和弦,后续 S + 逐步 slope 窗口,收尾 SlopeExit。 */
export function motifNotesToTokens(notes: readonly RelNote[]): AbstractMelodyToken[] {
  const out: AbstractMelodyToken[] = [];
  let cursor = 0;
  notes.forEach((n, i) => {
    if (n.onset > cursor + 1e-6) {
      out.push({ kind: 'R', duration: n.onset - cursor });
      cursor = n.onset;
    }
    if (i > 0) {
      const step = n.pitch - notes[i - 1].pitch;
      out.push({ kind: 'SlopeEnter', dirMin: step - STEP_WINDOW, dirMax: step + STEP_WINDOW, duration: 0 });
    }
    const ioi = i < notes.length - 1 ? notes[i + 1].onset - n.onset : n.dur;
    const audible = Math.max(0.25, Math.min(n.dur, ioi)); // token 时间轴纯顺序:发声时值不吞下一音的 onset
    // ≥1 拍的长音用 C(和弦音锚,构造上免疫 avoid-long-exposure);短音 S 保留音阶级进感
    out.push({ kind: i === 0 || audible >= 1 - 1e-6 ? 'C' : 'S', duration: audible });
    cursor += audible;
  });
  out.push({ kind: 'SlopeExit', duration: 0 });
  return out;
}

/** motif → grammar 规则(full/head/tail/augmented 四个不同 RHS 签名的变体)。 */
export function userMotifGrammarRules(plan: AuthoredUserMotifBrickPlan): GrammarRule[] {
  const rel = relativeNotes(plan);
  if (rel.length < 2) return [];
  const half = Math.max(2, Math.ceil(rel.length / 2));
  const rezero = (xs: RelNote[]): RelNote[] => {
    const base = xs[0].onset;
    return xs.map((x) => ({ ...x, onset: x.onset - base }));
  };
  const variants: Array<{ id: string; notes: RelNote[]; weight: number }> = [
    { id: 'full', notes: rel, weight: USER_MOTIF_RULE_WEIGHT_FULL },
    ...(rel.length >= 3 ? [
      { id: 'head', notes: rel.slice(0, half), weight: USER_MOTIF_RULE_WEIGHT_FULL },
      { id: 'tail', notes: rezero(rel.slice(rel.length - half)), weight: USER_MOTIF_RULE_WEIGHT_FRAGMENT },
    ] : []),
    // head3/diminished 增加不同 RHS 签名数量:family-only 采样按签名 cap(≈2.5%/个),
    // 签名越多 motif 词汇的总占比越高(K×cap),再经节奏重掷放大
    ...(rel.length >= 4 ? [
      { id: 'head3', notes: rel.slice(0, 3), weight: USER_MOTIF_RULE_WEIGHT_FRAGMENT },
    ] : []),
    {
      id: 'diminished',
      notes: rel.map((x) => ({ pitch: x.pitch, onset: x.onset * 0.5, dur: Math.max(0.25, x.dur * 0.5) })),
      weight: USER_MOTIF_RULE_WEIGHT_FRAGMENT,
    },
    {
      id: 'augmented',
      notes: rel.map((x) => ({ pitch: x.pitch, onset: x.onset * 2, dur: x.dur * 2 })),
      weight: USER_MOTIF_RULE_WEIGHT_FRAGMENT,
    },
  ];
  return variants.map((v) => {
    const tokens = motifNotesToTokens(v.notes);
    return {
      lhs: 'Phrase',
      weight: v.weight,
      metadata: {
        sourceRuleId: `usermotif_${v.id}`,
        sourceName: USER_MOTIF_RULE_SOURCE,
        authoredDurationBeats: tokens.reduce((sum, t) => sum + t.duration, 0),
      },
      rhs: tokens,
    };
  });
}

/** 风格 Grammar → 注入 motif 规则的新 Grammar(不改原对象,保留 selectionPolicy;WeakMap 记忆化)。 */
export function createUserMotifGrammarInjector(
  plan: AuthoredUserMotifBrickPlan | undefined,
): (grammar: Grammar) => Grammar {
  if (!plan) return (grammar) => grammar;
  const rules = userMotifGrammarRules(plan);
  if (rules.length === 0) return (grammar) => grammar;
  const memo = new WeakMap<Grammar, Grammar>();
  return (grammar) => {
    const hit = memo.get(grammar);
    if (hit) return hit;
    const injected = makeGrammar(
      [...[...grammar.rulesByLhs.values()].flat(), ...rules],
      grammar.start,
      grammar.selectionPolicy,
    );
    memo.set(grammar, injected);
    return injected;
  };
}
