// ============================================================
// newEngine · knowledge · ACG Return Grammar
// ------------------------------------------------------------
// ACG PIANOSONG 专用的「留白后返场」知识层。它不生成音高、时间或
// NoteIR；主链 RoadMap 在识别到 R → audible 的出口后，带着当前 T/S/D
// 功能、R 的实际长度和可用 token 预算，在此表中选择一个原子手势。
//
// 设计原则：返场不是事后补空白，而是 grammar 中携带的
// approach/pickup → 明确稳定 arrival。实际 pitch 由下游依据
// arrival.stableRoles + harmonicScope 解析；D 的落点指定到下一和弦，
// 以避免只在属功能上悬置而没有归宿。
// ============================================================

import type { TSD_Func } from './dynamicTsdDictionary';
import type {
  AbstractMelodyToken,
  AcgBorrowedColorIntent,
  AcgDyadIntent,
  AcgGrammarTokenIntent,
  AcgHarmonicScope,
  AcgStableRole,
} from './melodyGrammarTypes';

/** 与 harmony/effectiveFunc 保持同源的功能标签。 */
export type AcgReturnFunction = TSD_Func;

/**
 * stable-single：一个有支点的到达音；
 * sigh：一枚邻音向稳定音的小叹息；
 * lift-riff：2–3 枚 pickup 加最后到达的微型上行/回归句。
 */
export type AcgReturnGestureKind = 'stable-single' | 'sigh' | 'lift-riff';

/** 到达音相对目标和弦的稳定角色。 */
export type AcgReturnStableRole = AcgStableRole;

/** D 功能可以把到达推至下一和弦；T/S 只在当前和弦内稳定。 */
export type AcgReturnHarmonicScope = AcgHarmonicScope;

/**
 * 这些是对现有 AbstractMelodyToken 的语义标注，而不是新的 renderer token。
 * `approach` 必须按 arrival 解析为不超过 1–2 半音（或可验证的级进）。
 */
export type AcgReturnTokenRole = 'pickup' | 'approach' | 'arrival';
export type AcgReturnTokenKind = 'S' | 'L' | 'A' | 'G';

export interface AcgReturnApproachConstraint {
  /** 相对最后 arrival 的移动方向。 */
  direction: 'up' | 'down';
  /** ACG 留白返场不允许大跳硬落；最多半音/全音趋近。 */
  maxSemitones: 1 | 2;
}

interface AcgReturnTokenSpecBase {
  durationBeats: number;
}

/** Pickup is a diatonic/local-color lead-in only. It cannot carry borrowed
 * color or a dyad sidecar. */
export type AcgReturnPickupTokenSpec = AcgReturnTokenSpecBase & {
  role: 'pickup';
  tokenKind: 'S' | 'L';
  approach?: never;
  colorIntent?: never;
  dyad?: never;
};

/** Borrowed color belongs exclusively to an A terminal that immediately
 * resolves into the arrival below. */
export type AcgReturnApproachTokenSpec = AcgReturnTokenSpecBase & {
  role: 'approach';
  tokenKind: 'A';
  /** 仅 approach token 需要；pitch planner 必须遵守它。 */
  approach: AcgReturnApproachConstraint;
  /**
   * 只允许挂在能立刻解决的 approach 上的局部借用／调式色彩。
   * 真实和声不支撑时，realizer 不能把它硬塞成离调长音。
   */
  colorIntent?: AcgBorrowedColorIntent;
  dyad?: never;
};

/** A dyad is born with the stable arrival terminal, never added beside a
 * pickup/approach by the renderer. */
export type AcgReturnArrivalTokenSpec = AcgReturnTokenSpecBase & {
  role: 'arrival';
  tokenKind: 'G';
  approach?: never;
  colorIntent?: never;
  /**
   * 只允许挂在 arrival 上的上声部双音。partner 也必须服从 arrival
   * 的 stableRoles + harmonicScope，绝不是成品阶段额外加和声音。
   */
  dyad?: AcgDyadIntent;
};

/** Discriminated return-token contract. It makes color/dyad ownership
 * statically impossible to put on the wrong grammar atom. */
export type AcgReturnTokenSpec =
  | AcgReturnPickupTokenSpec
  | AcgReturnApproachTokenSpec
  | AcgReturnArrivalTokenSpec;

export interface AcgReturnArrival {
  harmonicScope: AcgReturnHarmonicScope;
  /** 下游从这里和实际 chord contract 的交集挑明确 targetPc。 */
  stableRoles: readonly AcgReturnStableRole[];
}

export interface AcgReturnRestRequirement {
  /** 前一个 R 必须至少这么长，才值得发展为独立小手势。 */
  minBeats: number;
  /** 更长的空白应留给下一 phrase，而非用 filler 强行填满。 */
  maxBeats: number;
}

export interface AcgReturnTokenBudget {
  minAudibleTokens: number;
  maxAudibleTokens: number;
  minDurationBeats: number;
  maxDurationBeats: number;
}

/**
 * 一个 RoadMap 可携带的返场 brick。它只描述「该怎么回」：
 * - function/precedingRest 决定它能否被选；
 * - tokens 给出抽象 grammar terminal 的顺序；
 * - arrival 给出必须解决到的和声稳定点。
 */
export interface AcgReturnBrick {
  id: string;
  function: AcgReturnFunction;
  kind: AcgReturnGestureKind;
  weight: number;
  precedingRest: AcgReturnRestRequirement;
  tokenBudget: AcgReturnTokenBudget;
  tokens: readonly AcgReturnTokenSpec[];
  arrival: AcgReturnArrival;
}

const T_CURRENT: AcgReturnArrival = {
  harmonicScope: 'current-chord',
  stableRoles: ['root', 'third', 'fifth'],
};

const S_CURRENT: AcgReturnArrival = {
  harmonicScope: 'current-chord',
  stableRoles: ['third', 'fifth', 'seventh'],
};

const D_NEXT: AcgReturnArrival = {
  harmonicScope: 'next-chord',
  stableRoles: ['root', 'third', 'fifth'],
};

const STABLE_BUDGET: AcgReturnTokenBudget = {
  minAudibleTokens: 1,
  maxAudibleTokens: 1,
  minDurationBeats: 0.75,
  maxDurationBeats: 1.5,
};

const SIGH_BUDGET: AcgReturnTokenBudget = {
  minAudibleTokens: 2,
  maxAudibleTokens: 2,
  minDurationBeats: 1.0,
  maxDurationBeats: 2.0,
};

const LIFT_THREE_BUDGET: AcgReturnTokenBudget = {
  minAudibleTokens: 3,
  maxAudibleTokens: 3,
  minDurationBeats: 1.25,
  maxDurationBeats: 2.0,
};

const LIFT_FOUR_BUDGET: AcgReturnTokenBudget = {
  minAudibleTokens: 4,
  maxAudibleTokens: 4,
  minDurationBeats: 1.5,
  maxDurationBeats: 2.25,
};

const SINGLE_REST: AcgReturnRestRequirement = { minBeats: 0.75, maxBeats: 4 };
const SIGH_REST: AcgReturnRestRequirement = { minBeats: 1, maxBeats: 3.5 };
const LIFT_REST: AcgReturnRestRequirement = { minBeats: 1.25, maxBeats: 3 };

const T_CANTABILE_DYAD: AcgDyadIntent = {
  voicing: 'below-topline',
  partnerRoles: ['root', 'third', 'fifth'],
  preferredIntervals: [3, 4, 7, 8, 9],
};

const S_CANTABILE_DYAD: AcgDyadIntent = {
  voicing: 'below-topline',
  partnerRoles: ['third', 'fifth', 'seventh'],
  preferredIntervals: [3, 4, 5, 7, 8, 9],
};

const D_CANTABILE_DYAD: AcgDyadIntent = {
  voicing: 'below-topline',
  partnerRoles: ['root', 'third', 'fifth'],
  preferredIntervals: [3, 4, 7, 8, 9],
};

/**
 * ACG PIANOSONG return-brick catalog.
 *
 * 顺序是一个短句的显式语义顺序；不是给 post-process 的修补提示。
 * 选择器应只对 RoadMap 已标记的 R → audible 出口调用本表。
 */
export const ACG_RETURN_BRICKS: readonly AcgReturnBrick[] = [
  {
    id: 'acg-return-t-stable-single',
    function: 'T',
    kind: 'stable-single',
    weight: 1.1,
    precedingRest: SINGLE_REST,
    tokenBudget: STABLE_BUDGET,
    tokens: [{ role: 'arrival', tokenKind: 'G', durationBeats: 1 }],
    arrival: T_CURRENT,
  },
  {
    id: 'acg-return-t-sigh',
    function: 'T',
    kind: 'sigh',
    weight: 1.55,
    precedingRest: SIGH_REST,
    tokenBudget: SIGH_BUDGET,
    tokens: [
      // ♭II/Phrygian 色彩只可从上方级进回到稳定 T；没有对应借用和声时
      // 下游会保留同样的 short approach 语义而不强行离调。
      { role: 'approach', tokenKind: 'A', durationBeats: 0.5, approach: { direction: 'down', maxSemitones: 2 }, colorIntent: 'phrygianb2' },
      { role: 'arrival', tokenKind: 'G', durationBeats: 1, dyad: T_CANTABILE_DYAD },
    ],
    arrival: T_CURRENT,
  },
  {
    id: 'acg-return-t-lift-riff',
    function: 'T',
    kind: 'lift-riff',
    weight: 0.9,
    precedingRest: LIFT_REST,
    tokenBudget: LIFT_THREE_BUDGET,
    tokens: [
      { role: 'pickup', tokenKind: 'S', durationBeats: 0.25 },
      { role: 'approach', tokenKind: 'A', durationBeats: 0.25, approach: { direction: 'up', maxSemitones: 2 } },
      // The compact tonic lift is the preferred post-breath mini-riff. Its
      // last note is a grammar-owned dyad, not a later same-onset ornament.
      { role: 'arrival', tokenKind: 'G', durationBeats: 0.75, dyad: T_CANTABILE_DYAD },
    ],
    arrival: T_CURRENT,
  },
  {
    id: 'acg-return-s-stable-single',
    function: 'S',
    kind: 'stable-single',
    weight: 0.9,
    precedingRest: SINGLE_REST,
    tokenBudget: STABLE_BUDGET,
    tokens: [{ role: 'arrival', tokenKind: 'G', durationBeats: 0.75 }],
    arrival: S_CURRENT,
  },
  {
    id: 'acg-return-s-sigh',
    function: 'S',
    kind: 'sigh',
    weight: 1.25,
    precedingRest: SIGH_REST,
    tokenBudget: SIGH_BUDGET,
    tokens: [
      { role: 'approach', tokenKind: 'A', durationBeats: 0.5, approach: { direction: 'down', maxSemitones: 2 } },
      { role: 'arrival', tokenKind: 'G', durationBeats: 0.75 },
    ],
    arrival: S_CURRENT,
  },
  {
    id: 'acg-return-s-lift-riff',
    function: 'S',
    kind: 'lift-riff',
    weight: 0.8,
    precedingRest: LIFT_REST,
    tokenBudget: LIFT_FOUR_BUDGET,
    tokens: [
      { role: 'pickup', tokenKind: 'S', durationBeats: 0.25 },
      { role: 'pickup', tokenKind: 'S', durationBeats: 0.25 },
      // Dorian 6 → 5：只在 S 的局部 Dorian/major-IV 支撑成立时实化。
      { role: 'approach', tokenKind: 'A', durationBeats: 0.25, approach: { direction: 'down', maxSemitones: 2 }, colorIntent: 'dorian6' },
      { role: 'arrival', tokenKind: 'G', durationBeats: 0.75, dyad: S_CANTABILE_DYAD },
    ],
    arrival: S_CURRENT,
  },
  {
    id: 'acg-return-d-stable-single',
    function: 'D',
    kind: 'stable-single',
    weight: 0.75,
    precedingRest: SINGLE_REST,
    tokenBudget: STABLE_BUDGET,
    tokens: [{ role: 'arrival', tokenKind: 'G', durationBeats: 1 }],
    arrival: D_NEXT,
  },
  {
    id: 'acg-return-d-sigh',
    function: 'D',
    kind: 'sigh',
    weight: 1.45,
    precedingRest: SIGH_REST,
    tokenBudget: SIGH_BUDGET,
    tokens: [
      // V 的导音只作为一拍内的 ♮7→1 借用色彩，目标由 next-chord 合同锁定。
      { role: 'approach', tokenKind: 'A', durationBeats: 0.5, approach: { direction: 'up', maxSemitones: 1 }, colorIntent: 'harmonic7' },
      { role: 'arrival', tokenKind: 'G', durationBeats: 1, dyad: D_CANTABILE_DYAD },
    ],
    arrival: D_NEXT,
  },
  {
    id: 'acg-return-d-lift-riff',
    function: 'D',
    kind: 'lift-riff',
    weight: 0.85,
    precedingRest: LIFT_REST,
    tokenBudget: LIFT_FOUR_BUDGET,
    tokens: [
      { role: 'pickup', tokenKind: 'L', durationBeats: 0.25 },
      { role: 'pickup', tokenKind: 'S', durationBeats: 0.25 },
      { role: 'approach', tokenKind: 'A', durationBeats: 0.25, approach: { direction: 'up', maxSemitones: 1 }, colorIntent: 'harmonic7' },
      { role: 'arrival', tokenKind: 'G', durationBeats: 0.75, dyad: D_CANTABILE_DYAD },
    ],
    arrival: D_NEXT,
  },
];

export interface AcgReturnBrickQuery {
  function: AcgReturnFunction;
  /** RoadMap 中实际的连续 R 时长。 */
  precedingRestBeats: number;
  /** 当前 brick/剩余节拍能容纳的 audible token 上限。 */
  maxAudibleTokens?: number;
}

/**
 * 纯过滤：由主链依照 RoadMap 身份和已有 R token 调用；没有 RNG、没有音高选择、没有后处理。
 */
export function getAcgReturnBrickCandidates(query: AcgReturnBrickQuery): readonly AcgReturnBrick[] {
  if (!Number.isFinite(query.precedingRestBeats) || query.precedingRestBeats <= 0) return [];
  const maxTokens = query.maxAudibleTokens ?? Number.POSITIVE_INFINITY;
  return ACG_RETURN_BRICKS.filter((brick) =>
    brick.function === query.function
    && query.precedingRestBeats >= brick.precedingRest.minBeats
    && query.precedingRestBeats <= brick.precedingRest.maxBeats
    && brick.tokenBudget.maxAudibleTokens <= maxTokens,
  );
}

/**
 * 供 grammar runtime/scheduler 注入既有 terminal 时使用。
 * 返回新数组，保留 arrival/approach 语义给调用方单独随 RoadMap metadata 下发。
 */
export function acgReturnTokenToAbstractToken(
  spec: AcgReturnTokenSpec,
  arrival: AcgReturnArrival,
): AbstractMelodyToken {
  const acg: AcgGrammarTokenIntent | undefined = spec.role === 'arrival'
    ? {
      harmonicScope: arrival.harmonicScope,
      stableRoles: [...arrival.stableRoles],
      ...(spec.dyad ? { dyad: spec.dyad } : {}),
    }
    // Borrowed color is meaningful only on the immediately resolving
    // approach atom. Do not let an accidentally annotated pickup manufacture
    // a color sidecar later in the scheduler.
    : spec.role === 'approach' && spec.colorIntent
      ? { colorIntent: spec.colorIntent }
      : undefined;
  return {
    kind: spec.tokenKind,
    duration: spec.durationBeats,
    ...(acg ? { acg } : {}),
  } as AbstractMelodyToken;
}

export function acgReturnBrickTokens(brick: AcgReturnBrick): AbstractMelodyToken[] {
  return brick.tokens.map((spec) => acgReturnTokenToAbstractToken(spec, brick.arrival));
}
