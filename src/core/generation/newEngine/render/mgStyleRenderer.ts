// ============================================================
// newEngine · render · MgStyleRenderer(MG strict 移植 Loop 5)
// Provenance: ../melodygenerative/src/lib/improvisor/StyleRenderer.ts 忠实港(cp + 改 import)。
// 纯 time/velocity feel 层(swing/accent/push/articulation);PITCH 永不改。NoteEvent=本地 MgNoteEvent。
// ⚠️ 这是手感层;Loop 7 决定生产用 MG feel 还是我们手感(用户决策2),此处只 port + parity。
// ============================================================

// StyleRenderer.ts — Pure timing/feel layer.
//
// Inputs: NoteEvent[] from LickGen (pitch already final), + ImprovisorStyleFeel.
// Output: NoteEvent[] with swing/push/articulation applied. PITCH IS
// NEVER MODIFIED HERE — only time and velocity.
//
// Per spec §8:
//   - swingRatio: 0.5 = straight, 0.67 = jazz swing eighth, 0.75 shuffle
//   - compSwingRatio: separate swing for comp (not used here — LickGen
//     output is melody only; comp handling lives in the texture system)
//   - pushProbability: each strong-beat note has this probability of being
//     anticipated by an eighth note
//   - accentPattern: per-strong-beat velocity bonus
//   - articulation: 'legato' / 'short' / 'bebop' / 'ballad' — affects
//     duration scaling

import type { MgNoteEvent as NoteEvent } from './mgMelodyRealizer';
import { shouldSwingAsEighthOffbeat } from './leadGridTiming';

export interface ImprovisorStyleFeel {
  /** 0.5 = straight, 0.67 = swung (jazz default), 0.75 = shuffle */
  swingRatio?: number;
  /** Separate comp swing — placeholder for future comp routing */
  compSwingRatio?: number;
  /** 0..1 — probability of anticipating a strong-beat note by 1/2 beat */
  pushProbability?: number;
  /** Per-strong-beat velocity bias (positions 0..3 in a 4/4 bar) */
  accentPattern?: number[];
  /** Articulation profile — scales duration */
  articulation?: 'legato' | 'short' | 'bebop' | 'ballad';
  /** Beats per measure (for accent + push calculations). Default 4. */
  beatsPerMeasure?: number;
}

const DEFAULT_FEEL: Required<ImprovisorStyleFeel> = {
  swingRatio: 0.5,        // straight by default
  compSwingRatio: 0.5,
  pushProbability: 0,
  accentPattern: [1.0, 0.85, 0.95, 0.85],
  articulation: 'legato',
  beatsPerMeasure: 4,
};

const ARTICULATION_DURATION_SCALE: Record<Required<ImprovisorStyleFeel>['articulation'], number> = {
  legato: 1.0,
  short: 0.5,
  bebop: 0.85,
  ballad: 1.1,
};

export interface RenderArgs {
  events: NoteEvent[];
  feel: ImprovisorStyleFeel;
  /** Optional RNG for push decisions; if omitted, push fires deterministically
   *  based on event index. */
  rng?: () => number;
  /** ★ 快速线条网格保护(CODEX 2026-06-19):true → 连续 16 分 run 内的 .5 onset 不被当八分反拍摆动
   *  (避免 .5→.67 与 .75 挤成 micro-IOI)。默认 false = 旧严格行为(保 MG oracle parity)。生产 jazz/blues 传 true。 */
  protectFastRuns?: boolean;
}

/** Render style feel onto a melody event list. Returns a NEW array. */
export function renderStyleFeel(args: RenderArgs): NoteEvent[] {
  const feel = { ...DEFAULT_FEEL, ...args.feel };
  const rng = args.rng ?? makeIndexRng(args.events.length);
  const out: NoteEvent[] = [];
  for (let i = 0; i < args.events.length; i++) {
    const e = args.events[i];
    let time = e.time;
    let duration = e.duration;
    let velocity = e.velocity;

    // 1. Swing — shift the offbeat eighth (frac == 0.5) to swingRatio
    //    AND reshape adjacent durations so the resulting "long-short"
    //    pattern actually fills the beat without a silence gap.
    //
    // Strict semantics:
    //   - offbeat moves: 0.5 → swingRatio (e.g. 0.67)
    //   - prev note's duration extends from 0.5 to swingRatio to fill
    //     the new gap. WITHOUT this, the prev note ends at 0.5 but the
    //     next event doesn't start until 0.67 — there's 0.17 beat of
    //     silence (audible "swing gap"). Real swing has no gap; it has
    //     long-short.
    //   - this offbeat's own duration shortens from 0.5 to (1-swingRatio)
    //     so its end still hits the next downbeat (beat 1.0).
    //
    // Triplet positions (~0.333, 0.667) are LEFT UNCHANGED — per spec,
    // triplet-authored licks shouldn't be re-swung.
    if (feel.articulation !== 'ballad') {
      const beatInMeasure = ((time % feel.beatsPerMeasure) + feel.beatsPerMeasure) % feel.beatsPerMeasure;
      const beatFrac = beatInMeasure - Math.floor(beatInMeasure);
      // ★ 网格所有者(2026-06-19):protectFastRuns 时用 context-aware 门 —— 16 分 run 内的 .5 不摆动;
      //   否则保旧严格行为(任意 .5 反拍摆动,MG oracle parity)。
      const swingThisOffbeat = args.protectFastRuns
        ? shouldSwingAsEighthOffbeat(args.events, i, feel.swingRatio, feel.beatsPerMeasure)
        : (Math.abs(beatFrac - 0.5) < 0.05 && feel.swingRatio !== 0.5);
      if (swingThisOffbeat) {
        const offset = feel.swingRatio - 0.5;
        time = time + offset;
        // Shorten this offbeat to maintain beat-1 alignment for the
        // next downbeat (so 8th note total still = 1 beat).
        duration = Math.max(0.01, duration - offset);
        // Extend the PREVIOUS emitted event's duration to close the gap
        // (only when prev was an immediate predecessor on this beat).
        if (out.length > 0) {
          const prev = out[out.length - 1];
          const prevEnd = prev.time + prev.duration;
          // prev ended right where the OLD offbeat (now-swung) would
          // have begun (within 0.05 tolerance). Extend prev's duration
          // to the swung onset so the long-short feels seamless.
          if (Math.abs(prevEnd - (time - offset)) < 0.05) {
            prev.duration = time - prev.time;
          }
        }
      }
    }

    // 2. Accent — bias velocity by position within measure
    const beatInMeasure2 = ((time % feel.beatsPerMeasure) + feel.beatsPerMeasure) % feel.beatsPerMeasure;
    const beatIdx = Math.round(beatInMeasure2);
    const onIntegerBeat = Math.abs(beatInMeasure2 - beatIdx) < 0.05;
    if (onIntegerBeat && beatIdx < feel.accentPattern.length) {
      velocity = Math.min(127, Math.round(velocity * feel.accentPattern[beatIdx]));
    }

    // 3. Push — anticipate a strong-beat note by 1/2 beat
    if (feel.pushProbability > 0 && onIntegerBeat && beatIdx === 0) {
      if (rng() < feel.pushProbability) {
        time = Math.max(0, time - 0.5);
      }
    }

    // 4. Articulation — duration scale
    duration = duration * ARTICULATION_DURATION_SCALE[feel.articulation];

    out.push({ ...e, time, duration, velocity });
  }
  return out;
}

function makeIndexRng(maxIdx: number): () => number {
  let i = 0;
  return () => {
    // Deterministic mock — uniform-ish distribution by index hash
    const x = Math.sin((i++) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
}

/** Convenience: style-name → feel preset. Project-original. */
export function feelForStyle(styleName: string): ImprovisorStyleFeel {
  const s = styleName.toUpperCase();
  if (s === 'JAZZ') return { swingRatio: 0.67, articulation: 'bebop', accentPattern: [1.0, 0.85, 1.05, 0.85] };
  if (s === 'BLUES') return { swingRatio: 0.67, articulation: 'bebop', accentPattern: [1.0, 0.9, 1.05, 0.9] };
  if (s === 'POP') return { swingRatio: 0.5, articulation: 'legato', accentPattern: [1.0, 0.9, 1.0, 0.9] };
  if (s === 'RNB') return { swingRatio: 0.5, articulation: 'legato', accentPattern: [1.0, 0.92, 1.0, 0.92] };
  // ★ MG 升级 Phase 2c:ACG 电影钢琴 = 直拍(0.5)+ ballad 连奏 + 轻弱拍(cantabile)。
  //   注:ACG 生产链的 lead swing 真源 = ACG GrooveContract.melodySwingRatio(见 1c 门控);此为无 contract 的兜底。
  if (s === 'ACG') return { swingRatio: 0.5, articulation: 'ballad', accentPattern: [1.0, 0.9, 0.96, 0.88] };
  return {};  // straight 8th defaults
}

// ★ MG 升级 Phase 1c:GrooveContract → lead 的 ImprovisorStyleFeel 桥。
//   lead 的 swing 真源 = contract.melodySwingRatio(与 comp/bass 的 compSwingRatio 分开)。
//   GrooveArticulation 与 ImprovisorStyleFeel.articulation 值域全同 → 直传。
//   ⚠️ 仅 ACG(新 pool)走此桥;非 ACG 仍走 feelForStyle(style)→ 零洗牌(见 mgLeadRenderer 门控)。
export function feelFromGrooveContract(c: { melodySwingRatio: number; articulation: ImprovisorStyleFeel['articulation']; accentPattern: readonly number[] }): ImprovisorStyleFeel {
  return { swingRatio: c.melodySwingRatio, articulation: c.articulation, accentPattern: [...c.accentPattern] };
}
