// ============================================================
// meter.ts — Time signature / meter context
// ============================================================
//
// Phase 6.1 拆分自 mg-engine/musicTheory.ts(原 L283-374)。
//
// Architectural principle:meter is metadata. All time positions in
// engine live in quarter-note "beats"(continuous float). A meter
// literal like '6/8' is converted to `beatsPerMeasure` in quarter-note
// units so engine arithmetic continues without time-base changes —
// only bar boundary and strong-beat positions shift.
// ============================================================

export type MeterLiteral = string | [number, number];

export interface MeterContext {
  /** `[upper, lower]` — e.g. [4,4] / [6,8] / [3,4] / [5,4]. */
  meter: [number, number];
  /** Display string — e.g. '4/4'. */
  literal: string;
  /**
   * Beats per measure in QUARTER-NOTE units(匹配 engine `time` field)。
   * 4/4 → 4;3/4 → 3;6/8 → 3(6 eighths = 3 quarters);12/8 → 6;5/4 → 5。
   */
  beatsPerMeasure: number;
  /**
   * Strong-beat positions(quarter-note units)。
   * 4/4 → [0, 2];3/4 → [0];6/8 → [0, 1.5];12/8 → [0, 1.5, 3, 4.5];5/4 → [0, 3]。
   */
  strongBeats: number[];
  /** lower=8 AND upper divisible by 3 AND upper>=6 — 6/8 / 9/8 / 12/8. */
  isCompound: boolean;
  /** Simple duple / triple / quadruple — 2/4 / 3/4 / 4/4. */
  isSimple: boolean;
  /** 5/4 / 7/8 等 — neither simple nor compound. */
  isIrregular: boolean;
}

/**
 * Parse time-signature literal into [upper, lower]。接受 string '4/4' 或
 * tuple [4, 4]。malformed → null。
 */
export function parseTimeSignature(literal: MeterLiteral): [number, number] | null {
  if (Array.isArray(literal)) {
    const [u, l] = literal;
    if (typeof u === 'number' && typeof l === 'number' && u > 0 && l > 0) {
      return [u, l];
    }
    return null;
  }
  const m = /^(\d+)\/(\d+)$/.exec(literal.trim());
  if (!m) return null;
  const u = parseInt(m[1], 10), l = parseInt(m[2], 10);
  if (u <= 0 || l <= 0) return null;
  return [u, l];
}

/**
 * Build MeterContext。unparseable → 4/4 default(engine 不需 nullcheck)。
 */
export function getMeterContext(literal: MeterLiteral): MeterContext {
  const parsed = parseTimeSignature(literal) ?? [4, 4];
  const [upper, lower] = parsed;
  // Quarter-note beats per measure:upper × (4 / lower)
  const beatsPerMeasure = upper * (4 / lower);

  const isCompound = lower === 8 && upper >= 6 && upper % 3 === 0;
  const isSimple = !isCompound && [2, 3, 4].includes(upper) && (lower === 4 || lower === 2);
  const isIrregular = !isCompound && !isSimple;

  let strongBeats: number[];
  if (isCompound) {
    const groups = upper / 3;
    strongBeats = Array.from({ length: groups }, (_, i) => i * 1.5);
  } else if (isSimple) {
    strongBeats = upper === 4 ? [0, 2] : [0];
  } else {
    const beatUnit = 4 / lower;
    if (upper === 5) strongBeats = [0, 3 * beatUnit];
    else if (upper === 7) strongBeats = [0, 4 * beatUnit];
    else strongBeats = [0];
  }

  return {
    meter: parsed,
    literal: `${upper}/${lower}`,
    beatsPerMeasure,
    strongBeats,
    isCompound,
    isSimple,
    isIrregular,
  };
}
