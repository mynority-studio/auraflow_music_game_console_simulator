// ============================================================
// newEngine · knowledge · MelodyBrickDictionary(MG strict 移植 Loop 1)
// ------------------------------------------------------------
// Provenance: ../melodygenerative/src/lib/improvisor/BrickDictionary.ts 忠实港(逐值)。
// 唯一改动:MG 的 `import type { ChordBlock } from './ChordPart'` 换成本文件内联的
//   窄接口 BrickChordBlock(只含 stepMatches 实际读取的 rootPc + type),保 KB 零 import。
// KB 合规:纯数据(BRICK_PATTERNS)+ 纯函数(chordTypeQuality / stepMatches),无 NoteIR / RNG / 音符生成。
// ============================================================
//
// A "brick" is a harmonic pattern that names a musical idea — a ii-V
// motion, a Major-On opening, a turnaround. The parser matches chord
// sequences against these patterns; matched spans become BrickMatch
// entries that grammar rules can condition on (different rules fire
// for different brick contexts).
//
// Patterns describe chord SEQUENCES via roman-style steps + qualities,
// independent of song key. Matching is key-relative: an ii-V-I in C
// (Dm7-G7-Cmaj7) and in Bb (Cm7-F7-Bbmaj7) both match the same brick.
//
// First-version coverage per spec (tmp/11.md §3):
//   Major-On, Minor-On, GenDom, ii-V, ii-V-I, I-vi-IV-V,
//   blues I/IV/V, borrowed iv, secondary dominant.

/** 窄视图:brick 匹配只需和弦的根音 pc + 类型后缀。port 自 MG ChordBlock 的子集
 *  (MG ChordBlock 另含 index/root/bassPc/durationBeats/startBeat/endBeat/functionHint/
 *  localKeyPc/forcedScale —— stepMatches 不读,故内联只保这两个字段以免引入 ChordPart 依赖)。 */
export interface BrickChordBlock {
  /** Root pitch class (0-11) */
  rootPc: number;
  /** Chord type suffix (e.g., "maj7", "m7", "7alt", "sus4", "9sus4") */
  type: string;
}

export type BrickFamily =
  | 'Major-On'
  | 'Minor-On'
  | 'GenDom'
  | 'GenII'
  | 'GenVI'
  | 'Cadence'
  | 'Launcher'   // G1-2: IV brick-type. ii-V or pre-cadence motion that
                 // POINTS TOWARD a target but hasn't landed yet.
                 // IV's "Straight Launcher" (Dm7-G7 going elsewhere),
                 // "Sad Launcher" (Em7b5-A7 → Dm). Cost ~25 in IV.
                 // Distinct from Cadence (which IS the landing).
  | 'Turnaround'
  | 'Dropback'   // IV brick-type. "Start on I, drop back to ii via dom7
                 // detour." 6 IV variants (simple/iii-VI-var/tritone/
                 // chromatic/TINGLe/main). Cost 30 in IV table (between
                 // Cadence:25 and Approach:45).
  | 'Blues'
  | 'Borrowed'
  | 'Unknown';

/** One step in a brick pattern: relative degree from the local key root
 *  + the chord-quality categories permitted at that step. */
export interface BrickStep {
  /** Semitones from local key root (0=I, 2=ii, 4=iii, 5=IV, 7=V, 9=vi, 11=vii) */
  rootDegreePc: number;
  /** Permitted chord-quality categories at this step */
  qualities: BrickQuality[];
  /** ★ Phase B(functional RoadMap):可选 slash-bass 要求(相对和弦根)。RoadMap 用它防 IV slash-chord
   *  brick 误配其不带 slash 的同名和弦。 */
  slashBassDegreePc?: number;
}

export type BrickQuality =
  | 'major'      // maj / maj7 / 6 / maj9 / add9 / 6/9 / maj13
  | 'minor'      // m / m7 / m9 / m11 / m13 / madd9 / m6/9 / mMaj7
  | 'dominant'   // 7 / 9 / 11 / 13 / 7sus4 / 9sus4 / altered / b9 / b13 / etc.
  | 'halfDim'    // m7b5 / m9b5
  | 'diminished' // dim / dim7
  | 'augmented'  // aug / +7
  | 'sus'        // sus2 / sus4 (no 3rd)
  | 'stableMinor' // m / madd9 / m6 / m6/9 / mMaj7 / mMaj9 ONLY — the
                  //  jazz "stable minor tonic" set. Excludes m7 (which
                  //  by default functions as a ii, not a tonic).
                  //  Used by ii-V-i to require a real resolution chord.
  | 'any';       // wildcard

/** A brick pattern: name + family + ordered steps. */
export interface BrickPattern {
  name: string;
  family: BrickFamily;
  steps: BrickStep[];
  /** Base cost — lower = more preferred when overlapping patterns match. */
  baseCost: number;
  /** Optional declared duration ratios for each step (e.g., [2, 1] = first
   *  step is twice as long as second). When provided, BrickParser scales
   *  the duration penalty so an actual chord-block sequence whose ratios
   *  diverge from this declaration pays a sharper cost — per IV
   *  BinaryProduction.java's `durationScales` check (cost × 100 when
   *  proportions don't match). Default: all 1s (equal-duration steps). */
  stepDurations?: number[];
  /** When true, the pattern accepts ANY duration ratio across its steps
   *  (skip duration scaling penalty entirely). Models IV's `*` wildcard
   *  duration in My.dictionary (e.g., Dropback(simple) is `(chord C *)
   *  (chord A7 1)` — tonic can be held any length). */
  arbitraryDurations?: boolean;
  /** ★ Phase B(functional RoadMap):压缩 one-bar 功能 cell 的 total-span 守卫(roman 骨架同长式 cadence,
   *  但旋律 grammar 须短得多)。 */
  minTotalBeats?: number;
  maxTotalBeats?: number;
  /** ★ Phase B:和弦 span 显式处于 tonicization 区时,parser 可在 local center 下重读同 brick;
   *  此时 signature 须信 materialized steps 而非 brick 的 global applied-dominant override。 */
  forceInferredSignature?: boolean;
}

/** Classify a chord type into a BrickQuality category. */
export function chordTypeQuality(chordType: string): BrickQuality {
  const t = chordType.toLowerCase();
  // Order matters — check most specific patterns first.
  // Note: sus is checked AFTER 7sus/9sus/13sus etc. — those are
  // dominant-flavored sus chords (sus replaces the 3rd but keeps the
  // b7), so they function as DOMINANT for harmonic analysis. Only
  // pure sus2 / sus4 / msus / etc. (no 7) stay as 'sus'.
  if (t === 'm7b5' || t === 'm9b5' || t.includes('m7b5')) return 'halfDim';
  if (t === 'dim' || t === 'dim7' || t.startsWith('dim')) return 'diminished';
  if (t === 'aug' || t.includes('aug') || t.startsWith('+')) return 'augmented';
  // Dominant-flavored sus (7sus4 / 9sus4 / 13sus4 / m7sus4 / 7susb9 etc.):
  // sus replaces the 3rd but the b7 still drives a V → I pull. Should
  // be classified as 'dominant' so GenDom + ii-V's V step both match.
  if (/sus/.test(t) && /[79]|13|11/.test(t)) return 'dominant';
  if (t === 'sus2' || t === 'sus4' || t.endsWith('sus2') || t.endsWith('sus4')) return 'sus';
  if (t.startsWith('maj') || t === '6' || t === '6/9' || t === 'add9') return 'major';
  if (t === 'min' || t === 'm' || t === 'madd9' || (t.startsWith('m') && !t.startsWith('maj'))) return 'minor';
  if (t === '5' || t === 'quartal') return 'any';
  // Anything dominant-shaped (7, 9, 11, 13, alt, b9, #11, etc.)
  return 'dominant';
}

/** True when the chord type is a stable minor tonic (real resolution
 *  chord), not just a m7 which functions ambiguously as ii. */
function isStableMinorTonic(chordType: string): boolean {
  const t = chordType.toLowerCase();
  if (t === 'm' || t === 'min' || t === 'madd9') return true;
  if (t === 'm6' || t === 'm6/9') return true;
  if (t.startsWith('mmaj')) return true;  // mMaj7, mMaj9
  return false;
}

/** Check whether a step matches a chord block under a hypothesized key root. */
export function stepMatches(step: BrickStep, block: BrickChordBlock, keyRootPc: number): boolean {
  const expectedRootPc = (keyRootPc + step.rootDegreePc) % 12;
  if (block.rootPc !== expectedRootPc) return false;
  const q = chordTypeQuality(block.type);
  if (step.qualities.includes('any')) return true;
  if (step.qualities.includes(q)) return true;
  // 'stableMinor' is a stricter subset of 'minor' — only fires when
  // the chord type is a real minor-tonic resolution chord, not m7.
  if (step.qualities.includes('stableMinor') && q === 'minor' && isStableMinorTonic(block.type)) return true;
  return false;
}

/** Built-in brick pattern dictionary. Each pattern is key-relative;
 *  the parser tries all 12 possible key roots when matching. */
export const BRICK_PATTERNS: BrickPattern[] = [
  // ── Major-On: I-IV / I-V / Imaj7-IV-Imaj7 etc. ──
  { name: 'Major-On', family: 'Major-On', baseCost: 1.0, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
  ]},
  { name: 'I-IV', family: 'Major-On', baseCost: 0.9, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 5, qualities: ['major'] },
  ]},
  { name: 'I-V', family: 'Major-On', baseCost: 0.9, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 7, qualities: ['dominant', 'major', 'sus'] },
  ]},
  // ── Minor-On ──
  { name: 'Minor-On', family: 'Minor-On', baseCost: 1.0, steps: [
    { rootDegreePc: 0, qualities: ['minor', 'halfDim'] },
  ]},
  { name: 'i-iv', family: 'Minor-On', baseCost: 0.9, steps: [
    { rootDegreePc: 0, qualities: ['minor'] },
    { rootDegreePc: 5, qualities: ['minor'] },
  ]},
  // ── ii-V (any flavor of dominant on V) ──
  // G1-2: ii-V is a Launcher (pointing to landing), not GenDom (standalone
  // dom). When followed by I/i, ii-V-I / ii-V-i Cadence patterns win
  // (they cover more ground at lower cost). When standalone, ii-V matches
  // here as Launcher.
  { name: 'ii-V', family: 'Launcher', baseCost: 0.7, steps: [
    { rootDegreePc: 2, qualities: ['minor', 'halfDim'] },
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] },
  ]},
  // ── ii-V-I (full cadence, major target) ──
  { name: 'ii-V-I', family: 'Cadence', baseCost: 0.5, steps: [
    { rootDegreePc: 2, qualities: ['minor', 'halfDim'] },
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] },
    { rootDegreePc: 0, qualities: ['major'] },
  ]},
  // ── ii-V-i (minor cadence) ──
  // Target requires a STABLE minor tonic (m / madd9 / m6 / m6/9 / mMaj7 /
  // mMaj9 etc.). Plain m7 as target is REJECTED here because m7 functions
  // ambiguously — most often it's a ii chord, not a tonic. This avoids
  // the failure mode where "Em7 A7 Dm7 G7" gets greedy-grabbed as
  // "ii-V-i in D minor + leftover G7" instead of the correct "ii-V to D
  // then ii-V to C" interpretation.
  { name: 'ii-V-i', family: 'Cadence', baseCost: 0.5, steps: [
    { rootDegreePc: 2, qualities: ['minor', 'halfDim'] },
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] },
    { rootDegreePc: 0, qualities: ['stableMinor'] },
  ]},
  // ── I-vi-IV-V (50s pop / doo-wop turnaround) ──
  { name: 'I-vi-IV-V', family: 'Turnaround', baseCost: 0.6, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 9, qualities: ['minor'] },
    { rootDegreePc: 5, qualities: ['major'] },
    { rootDegreePc: 7, qualities: ['dominant', 'major', 'sus'] },
  ]},
  // ── i-bVI-bIII-bVII (modal pop vamp, Aeolian) ──
  { name: 'i-bVI-bIII-bVII', family: 'Turnaround', baseCost: 0.7, steps: [
    { rootDegreePc: 0, qualities: ['minor'] },
    { rootDegreePc: 8, qualities: ['major'] },
    { rootDegreePc: 3, qualities: ['major'] },
    { rootDegreePc: 10, qualities: ['major', 'dominant'] },
  ]},
  // ── Archived blues markers ──
  // BLUES is no longer an active product style. Keep these patterns as a
  // last-resort label for legacy diagnostics, but make them more expensive
  // than Major-On / GenDom so ordinary tonal I / IV / V chords do not steal
  // the melody grammar away from style-appropriate slope templates.
  { name: 'Blues-I', family: 'Blues', baseCost: 6.0, steps: [
    { rootDegreePc: 0, qualities: ['dominant', 'major'] },
  ]},
  { name: 'Blues-IV', family: 'Blues', baseCost: 6.0, steps: [
    { rootDegreePc: 5, qualities: ['dominant', 'major'] },
  ]},
  { name: 'Blues-V', family: 'Blues', baseCost: 6.0, steps: [
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] },
  ]},
  { name: 'I-IV-I (blues opening)', family: 'Blues', baseCost: 6.0, steps: [
    { rootDegreePc: 0, qualities: ['dominant', 'major'] },
    { rootDegreePc: 5, qualities: ['dominant', 'major'] },
    { rootDegreePc: 0, qualities: ['dominant', 'major'] },
  ]},
  // ── Borrowed iv (major mode, iv chord from parallel minor) ──
  { name: 'Borrowed-iv', family: 'Borrowed', baseCost: 0.7, steps: [
    { rootDegreePc: 5, qualities: ['minor'] },  // matches iv when local key is major
  ]},
  // ── Secondary dominant V/X (any dom whose root is P5 above next chord) ──
  // Handled as 2-chord pattern: V/X → X
  { name: 'V-of-ii', family: 'GenDom', baseCost: 0.6, steps: [
    { rootDegreePc: 9, qualities: ['dominant'] },   // A7 in C = V/ii
    { rootDegreePc: 2, qualities: ['minor'] },      // Dm
  ]},
  { name: 'V-of-V', family: 'GenDom', baseCost: 0.6, steps: [
    { rootDegreePc: 2, qualities: ['dominant'] },   // D7 in C = V/V
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] },  // G7
  ]},
  { name: 'V-of-vi', family: 'GenDom', baseCost: 0.6, steps: [
    { rootDegreePc: 4, qualities: ['dominant'] },   // E7 in C = V/vi
    { rootDegreePc: 9, qualities: ['minor'] },      // Am
  ]},
  // ── GenDom (any standalone dom chord) ──
  { name: 'GenDom', family: 'GenDom', baseCost: 1.1, steps: [
    { rootDegreePc: 0, qualities: ['dominant'] },
  ]},

  // ── Deceptive cadence: V → vi ──
  { name: 'Deceptive-Cadence', family: 'Cadence', baseCost: 0.7, steps: [
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] },
    { rootDegreePc: 9, qualities: ['minor'] },
  ]},
  // ── Plagal cadence: IV → I ──
  // IV `vocab/My.dictionary` calls this "Amen-Cadence" (Major Cadence;
  // `(brick TonicOrDom F 1) (chord C 1)` = IV → I). L1 oracle confirms:
  // F-C in C key labelled as "Amen Cadence". We keep "Plagal-Cadence"
  // as the more universally-recognized music-theory name.
  { name: 'Plagal-Cadence', family: 'Cadence', baseCost: 0.7, steps: [
    { rootDegreePc: 5, qualities: ['major', 'minor'] },
    { rootDegreePc: 0, qualities: ['major'] },
  ]},
  // G1-3: Authentic cadence V→I (the "missing simple V→I" — we previously
  // only had ii-V-I composite). Accepts V as dom7 / sus / plain major
  // triad — pop / folk often plays V as a triad without 7th and it still
  // functions as authentic-cadence preparation.
  { name: 'Authentic-Cadence-V-I', family: 'Cadence', baseCost: 0.65, steps: [
    { rootDegreePc: 7, qualities: ['dominant', 'sus', 'major'] },
    { rootDegreePc: 0, qualities: ['major'] },
  ]},
  // G1-3: Mixolydian-borrowed cadence bVII→I (Bb7/Bbmaj → C in C key).
  // Common in rock, modal jazz, fusion. Distinct from backdoor ii-V (iv-bVII7-I)
  // because there's no iv chord preceding.
  { name: 'Cadence-bVII-I', family: 'Cadence', baseCost: 0.7, steps: [
    { rootDegreePc: 10, qualities: ['dominant', 'major'] },
    { rootDegreePc: 0, qualities: ['major'] },
  ]},
  // G1-3: Modal-minor plagal iv-I (Fm→C in C key — borrowed from parallel
  // minor). Distinct from major Plagal-Cadence in quality.
  { name: 'Plagal-Cadence-iv-I-modal', family: 'Cadence', baseCost: 0.7, steps: [
    { rootDegreePc: 5, qualities: ['minor'] },
    { rootDegreePc: 0, qualities: ['major'] },
  ]},
  // ── Half cadence: ? → V (signaled by V landing) — too generic alone;
  //    instead represent the COMMON half-cadence ii → V (already covered
  //    by ii-V); IV → V deserves its own pattern.
  { name: 'IV-V', family: 'GenDom', baseCost: 0.75, steps: [
    { rootDegreePc: 5, qualities: ['major'] },
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] },
  ]},
  // ── Backdoor ii-V: iv-min7 → bVII7 → I (resolves down by P5 to I) ──
  { name: 'Backdoor-ii-V-I', family: 'Cadence', baseCost: 0.55, steps: [
    { rootDegreePc: 5, qualities: ['minor'] },            // iv
    { rootDegreePc: 10, qualities: ['dominant', 'sus'] }, // bVII7
    { rootDegreePc: 0, qualities: ['major'] },             // I
  ]},
  // ── Tritone substitute resolving to I: subV/I → I (e.g. Db7 → Cmaj) ──
  { name: 'subV-I', family: 'Cadence', baseCost: 0.6, steps: [
    { rootDegreePc: 1, qualities: ['dominant'] },   // Db7 in C
    { rootDegreePc: 0, qualities: ['major'] },
  ]},
  // ── Tritone substitute resolving to i (minor target) ──
  { name: 'subV-i', family: 'Cadence', baseCost: 0.65, steps: [
    { rootDegreePc: 1, qualities: ['dominant'] },
    { rootDegreePc: 0, qualities: ['stableMinor'] },
  ]},
  // ── V-of-IV (I7 → IV common in blues / pop bridges) ──
  { name: 'V-of-IV', family: 'GenDom', baseCost: 0.6, steps: [
    { rootDegreePc: 0, qualities: ['dominant'] },   // C7 in C = V/IV
    { rootDegreePc: 5, qualities: ['major'] },      // F
  ]},
  // ── V-of-iii (B7 → Em in C) ──
  { name: 'V-of-iii', family: 'GenDom', baseCost: 0.65, steps: [
    { rootDegreePc: 11, qualities: ['dominant'] },
    { rootDegreePc: 4, qualities: ['minor'] },
  ]},
  // ── Tritone substitute targeting any common target ──
  { name: 'subV-of-V', family: 'GenDom', baseCost: 0.65, steps: [
    { rootDegreePc: 8, qualities: ['dominant'] },   // Ab7 → G7 (subV/V in C)
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] },
  ]},
  { name: 'subV-of-ii', family: 'GenDom', baseCost: 0.65, steps: [
    { rootDegreePc: 3, qualities: ['dominant'] },   // Eb7 → Dm7
    { rootDegreePc: 2, qualities: ['minor'] },
  ]},
  // ── Long-ii-V variants (declared 2:1 step duration — used when actual
  //    durations are lopsided so the equal-step ii-V doesn't fit as cleanly) ──
  // G1-2: Long-variant ii-V also Launcher
  { name: 'Long-ii-V', family: 'Launcher', baseCost: 0.75, stepDurations: [2, 1], steps: [
    { rootDegreePc: 2, qualities: ['minor', 'halfDim'] },
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] },
  ]},
  { name: 'ii-Long-V', family: 'Launcher', baseCost: 0.75, stepDurations: [1, 2], steps: [
    { rootDegreePc: 2, qualities: ['minor', 'halfDim'] },
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] },
  ]},
  // ── Borrowed-mode patterns (modal interchange) ──
  // bVII as standalone (Mixolydian borrow on major key)
  { name: 'Borrowed-bVII', family: 'Borrowed', baseCost: 0.7, steps: [
    { rootDegreePc: 10, qualities: ['major', 'dominant'] },
  ]},
  // bIII (Aeolian borrow)
  { name: 'Borrowed-bIII', family: 'Borrowed', baseCost: 0.7, steps: [
    { rootDegreePc: 3, qualities: ['major'] },
  ]},
  // bVI (Aeolian borrow)
  { name: 'Borrowed-bVI', family: 'Borrowed', baseCost: 0.7, steps: [
    { rootDegreePc: 8, qualities: ['major'] },
  ]},
  // i (Picardy / modal interchange — minor i in major-key context)
  { name: 'Borrowed-i', family: 'Borrowed', baseCost: 0.75, steps: [
    { rootDegreePc: 0, qualities: ['minor'] },
  ]},
  // ── Extra turnarounds ──
  // iii-vi-ii-V (1930s/40s standard turnaround). REQUIRE minor on vi
  // step — if vi is dominant (e.g., A7 in C major), it's a V/ii
  // secondary dominant, not a turnaround vi. Letting 'dominant' match
  // here greedy-grabs Em7-A7-Dm7-G7 as iii-vi-ii-V when the musically
  // correct reading is two ii-V's (ii-V to Dm, then ii-V to C).
  { name: 'iii-vi-ii-V', family: 'Turnaround', baseCost: 0.65, steps: [
    { rootDegreePc: 4, qualities: ['minor'] },
    { rootDegreePc: 9, qualities: ['minor'] },
    { rootDegreePc: 2, qualities: ['minor', 'halfDim'] },
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] },
  ]},
  // vi-ii-V-I (alternate cycle) — same: require minor on vi
  { name: 'vi-ii-V-I', family: 'Cadence', baseCost: 0.55, steps: [
    { rootDegreePc: 9, qualities: ['minor'] },
    { rootDegreePc: 2, qualities: ['minor', 'halfDim'] },
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] },
    { rootDegreePc: 0, qualities: ['major'] },
  ]},
  // I-V-vi-IV (modern pop "axis")
  { name: 'I-V-vi-IV', family: 'Turnaround', baseCost: 0.55, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 7, qualities: ['dominant', 'major', 'sus'] },
    { rootDegreePc: 9, qualities: ['minor'] },
    { rootDegreePc: 5, qualities: ['major'] },
  ]},
  // i-VI-III-VII (minor "axis", parallel of pop axis)
  { name: 'i-VI-III-VII', family: 'Turnaround', baseCost: 0.6, steps: [
    { rootDegreePc: 0, qualities: ['minor'] },
    { rootDegreePc: 8, qualities: ['major'] },
    { rootDegreePc: 3, qualities: ['major'] },
    { rootDegreePc: 10, qualities: ['major', 'dominant'] },
  ]},

  // ── Dropback patterns (G1-1) ─────────────────────────────────────
  // IV `vocab/My.dictionary` defines 6 Dropback variants. Semantics:
  // "starting on tonic I, drop back via dom7 detour to set up the
  // next ii-V". Common in jazz standards (Bird, There Is No Greater
  // Love, etc.). Distinct from Cadence (which lands on I).
  //
  // All Dropback patterns have IV's `(chord C *)` wildcard tonic — any
  // duration ratio accepted. arbitraryDurations: true skips the duration
  // scaling penalty.
  //
  // Dropback(simple): C → A7  (I + V/ii)
  { name: 'Dropback-simple', family: 'Dropback', baseCost: 0.7, arbitraryDurations: true, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 9, qualities: ['dominant'] },
  ]},
  // Dropback(iii-VI-var): C → Em7 → A7  (I + iii + V/ii)
  { name: 'Dropback-iii-VI', family: 'Dropback', baseCost: 0.55, arbitraryDurations: true, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 4, qualities: ['minor'] },
    { rootDegreePc: 9, qualities: ['dominant'] },
  ]},
  // Dropback(tritone): C → Bb7 → A7  (I + bVII7 + V/ii — tritone-sub
  // of the iii substitute)
  { name: 'Dropback-tritone', family: 'Dropback', baseCost: 0.55, arbitraryDurations: true, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 10, qualities: ['dominant'] },
    { rootDegreePc: 9, qualities: ['dominant'] },
  ]},
  // Dropback(chromatic): C → B7 → Bb7 → A7  (chromatic dom7 descent)
  { name: 'Dropback-chromatic', family: 'Dropback', baseCost: 0.5, arbitraryDurations: true, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 11, qualities: ['dominant'] },
    { rootDegreePc: 10, qualities: ['dominant'] },
    { rootDegreePc: 9, qualities: ['dominant'] },
  ]},
  // Dropback(var 2): C → Dm7 → ii-V to D (= Em7-A7)
  { name: 'Dropback-I-ii-iii', family: 'Dropback', baseCost: 0.7, arbitraryDurations: true, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 2, qualities: ['minor'] },
    { rootDegreePc: 4, qualities: ['minor'] },
  ]},
  // Dropback(var 3): I + sub-brick + Am7  approximated as I + ii + vi
  { name: 'Dropback-I-ii-vi', family: 'Dropback', baseCost: 0.7, arbitraryDurations: true, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 2, qualities: ['minor'] },
    { rootDegreePc: 9, qualities: ['minor'] },
  ]},
  // I → vi (doo-wop "drop"). IV uses composite brick "On + Dropback"
  // for this (L1 fixture C-Am7 — read PostProcessor substitution); we
  // model directly with a Dropback pattern. Musically: tonic dropping
  // to relative minor without secondary-dominant detour.
  { name: 'Dropback-I-vi', family: 'Dropback', baseCost: 0.7, arbitraryDurations: true, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 9, qualities: ['minor'] },
  ]},

  // ── G1-4: Dominant Cycle / Reverse Dominant Cycle ─────────────────
  // IV's analytical framework for blues + jazz dominant motion. Per
  // `My.dictionary`:
  //   Dominant-Cycle-2-Steps (Approach, key=C): D7 + G7 (root P4 up
  //     = P5 down — "going toward I").
  //   Reverse-Dominant-Cycle-2-Steps (Dropback, key=G): G7 + D7 (root
  //     P5 up — "away from I").
  // L1 oracle proves 12-bar blues in C decomposes into 7 cycles
  // (4 Reverse + 2 Dominant + 1 mixed). Without these, we matched
  // Blues-I/IV/V piecewise (still works but loses IV's analytical view).
  //
  // Dominant-Cycle-2-Steps: 2 dom7 chords with root motion +5 semis (P4 up)
  { name: 'Dominant-Cycle-2-Steps', family: 'GenDom', baseCost: 0.65, steps: [
    { rootDegreePc: 0, qualities: ['dominant'] },
    { rootDegreePc: 5, qualities: ['dominant'] },
  ]},
  // Reverse-Dominant-Cycle-2-Steps: 2 dom7 chords with root motion +7 (P5 up)
  // IV classifies as Dropback family (motion AWAY from tonic resolution).
  { name: 'Reverse-Dominant-Cycle-2-Steps', family: 'Dropback', baseCost: 0.6, steps: [
    { rootDegreePc: 0, qualities: ['dominant'] },
    { rootDegreePc: 7, qualities: ['dominant'] },
  ]},
  // 3-step cycles for longer cadences (Bird-style descents)
  { name: 'Dominant-Cycle-3-Steps', family: 'GenDom', baseCost: 0.6, steps: [
    { rootDegreePc: 0, qualities: ['dominant'] },
    { rootDegreePc: 5, qualities: ['dominant'] },
    { rootDegreePc: 10, qualities: ['dominant'] },  // 5+5 mod 12
  ]},
  { name: 'Reverse-Dominant-Cycle-3-Steps', family: 'Dropback', baseCost: 0.55, steps: [
    { rootDegreePc: 0, qualities: ['dominant'] },
    { rootDegreePc: 7, qualities: ['dominant'] },
    { rootDegreePc: 2, qualities: ['dominant'] },  // 7+7 = 14 mod 12 = 2
  ]},

  // ── G1-5: Bulk move from IV `vocab/My.dictionary` ────────────────
  // High-value bricks selected from IV's 560 defbricks — only those
  // whose body is pure (chord X N) without sub-brick references.
  // Patterns with `(brick SubName N)` need recursion not implemented
  // here; they remain in IV's library for the deferred Markov-chain
  // architecture (see docs/Q-State-Markov-Audit.md).

  // Chromatically descending dom7s (Bird, Coltrane signature)
  // 3-step: A7-Ab7-G7 in C (vi7 → b6 7 → V7)
  { name: 'Chromatic-Desc-Doms-3', family: 'GenDom', baseCost: 0.6, steps: [
    { rootDegreePc: 9, qualities: ['dominant'] },
    { rootDegreePc: 8, qualities: ['dominant'] },
    { rootDegreePc: 7, qualities: ['dominant'] },
  ]},
  // 4-step: Bb7-A7-Ab7-G7
  { name: 'Chromatic-Desc-Doms-4', family: 'GenDom', baseCost: 0.55, steps: [
    { rootDegreePc: 10, qualities: ['dominant'] },
    { rootDegreePc: 9, qualities: ['dominant'] },
    { rootDegreePc: 8, qualities: ['dominant'] },
    { rootDegreePc: 7, qualities: ['dominant'] },
  ]},

  // Cyclic Approach: ii of ii / V of ii / ii / V
  // Dm7-D7-Gm7-G7 in C (treats ii via secondary dominant)
  { name: 'Cyclic-Approach-2', family: 'GenDom', baseCost: 0.55, steps: [
    { rootDegreePc: 2, qualities: ['minor'] },
    { rootDegreePc: 2, qualities: ['dominant'] },
    { rootDegreePc: 7, qualities: ['minor'] },
    { rootDegreePc: 7, qualities: ['dominant'] },
  ]},

  // Diatonic walks (Major key)
  // Ascending I-ii-iii (1-2-4 in semis)
  { name: 'Diatonic-I-ii-iii', family: 'Major-On', baseCost: 0.65, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 2, qualities: ['minor'] },
    { rootDegreePc: 4, qualities: ['minor'] },
  ]},
  // Ascending ii-iii-IV
  { name: 'Diatonic-ii-iii-IV', family: 'Cadence', baseCost: 0.55, steps: [
    { rootDegreePc: 2, qualities: ['minor'] },
    { rootDegreePc: 4, qualities: ['minor'] },
    { rootDegreePc: 5, qualities: ['major'] },
  ]},
  // Ascending ii-iii-IV-V (extends previous with V7)
  { name: 'Diatonic-ii-iii-IV-V', family: 'Cadence', baseCost: 0.5, steps: [
    { rootDegreePc: 2, qualities: ['minor'] },
    { rootDegreePc: 4, qualities: ['minor'] },
    { rootDegreePc: 5, qualities: ['major'] },
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] },
  ]},
  // I-ii-iii-IV cadence (4-step diatonic walk)
  { name: 'Diatonic-I-ii-iii-IV', family: 'Cadence', baseCost: 0.55, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 2, qualities: ['minor'] },
    { rootDegreePc: 4, qualities: ['minor'] },
    { rootDegreePc: 5, qualities: ['major'] },
  ]},
  // I-ii-iii-ii (returning approach)
  { name: 'Diatonic-I-ii-iii-ii', family: 'GenDom', baseCost: 0.65, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 2, qualities: ['minor'] },
    { rootDegreePc: 4, qualities: ['minor'] },
    { rootDegreePc: 2, qualities: ['minor'] },
  ]},
  // Descending I-IV-iii-ii
  { name: 'Diatonic-I-IV-iii-ii', family: 'GenDom', baseCost: 0.6, steps: [
    { rootDegreePc: 0, qualities: ['major'] },
    { rootDegreePc: 5, qualities: ['major'] },
    { rootDegreePc: 4, qualities: ['minor'] },
    { rootDegreePc: 2, qualities: ['minor'] },
  ]},
  // Round-trip ii-iii-IV-iii-ii (Body & Soul style passing)
  { name: 'Diatonic-ii-iii-IV-iii-ii', family: 'GenDom', baseCost: 0.6, steps: [
    { rootDegreePc: 2, qualities: ['minor'] },
    { rootDegreePc: 4, qualities: ['minor'] },
    { rootDegreePc: 5, qualities: ['major'] },
    { rootDegreePc: 4, qualities: ['minor'] },
    { rootDegreePc: 2, qualities: ['minor'] },
  ]},

  // II-n-Back: Dm7 → D#dim → C/E (passing dim into first-inv I)
  // Distinctive standards-tune cadence. Without bass detection we treat
  // last chord as C major; the diminished passing tone IS the lift.
  { name: 'II-n-Back', family: 'Cadence', baseCost: 0.65, steps: [
    { rootDegreePc: 2, qualities: ['minor'] },
    { rootDegreePc: 3, qualities: ['diminished'] },
    { rootDegreePc: 0, qualities: ['major'] },
  ]},

  // ── Coltrane Cadence (Giant Steps motion) ────────────────────────
  // Coltrane's signature: ii-V cycling through 3 keys related by M3.
  // Full pattern is "Dm7 + Perfect-Cadence(Ab) + Perfect-Cadence(E) +
  // Perfect-Cadence(C)" — we encode the 7-chord head sequence directly.
  // Dm7 Db7 Gb (=F#) E7 A B7 E ?  hm — actually Perfect-Cadence(Ab) = Eb7 + Ab.
  // Sequence: Dm7 + Eb7 + Ab + B7 + E + G7 + C
  // Simplified: capture the descending-major-3rd key motion (Ab E C tonics)
  { name: 'Coltrane-Cycle-head', family: 'Cadence', baseCost: 0.4, steps: [
    { rootDegreePc: 2, qualities: ['minor'] },          // Dm7
    { rootDegreePc: 3, qualities: ['dominant'] },       // Eb7
    { rootDegreePc: 8, qualities: ['major'] },          // Ab
    { rootDegreePc: 11, qualities: ['dominant'] },      // B7
    { rootDegreePc: 4, qualities: ['major'] },          // E
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] }, // G7
    { rootDegreePc: 0, qualities: ['major'] },          // C
  ]},

  // ── G1-5 batch 2 — more chord-only patterns ──────────────────────

  // Yardbird-Approach (Bird's signature ii-V to bVI):
  // IV def: (chord Fm7 1) (chord Bb7 1) in C → ii-V going to Eb
  { name: 'Yardbird-Approach', family: 'GenDom', baseCost: 0.7, steps: [
    { rootDegreePc: 5, qualities: ['minor'] },           // Fm7 = ii of Eb
    { rootDegreePc: 10, qualities: ['dominant', 'sus'] }, // Bb7 = V of Eb
  ]},

  // Dizzy-Approach (minor target): Dm7b5 + Db7 → halfdim ii + subV
  { name: 'Dizzy-Approach-minor', family: 'GenDom', baseCost: 0.65, steps: [
    { rootDegreePc: 2, qualities: ['halfDim'] },
    { rootDegreePc: 1, qualities: ['dominant'] },        // subV/I = Db7
  ]},

  // Nowhere-Approach: Ab7 → GenDom (any dom on tonic root, often G7)
  // Bird's "going nowhere" via b6 dominant. Roman: bVI7-V7.
  { name: 'Nowhere-Approach', family: 'GenDom', baseCost: 0.65, steps: [
    { rootDegreePc: 8, qualities: ['dominant'] },        // Ab7
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] }, // G7
  ]},

  // Minor-Perfect-Cadence: minor ii-V-i — what IV uses as a sub-brick
  // pulled to top level here so we don't need recursion.
  // Dm7b5 + G7b9 + Cm — halfdim ii + altered V + min tonic
  { name: 'Minor-Perfect-Cadence', family: 'Cadence', baseCost: 0.55, steps: [
    { rootDegreePc: 2, qualities: ['halfDim'] },
    { rootDegreePc: 7, qualities: ['dominant'] },
    { rootDegreePc: 0, qualities: ['stableMinor', 'minor'] },
  ]},

  // Chromatic minor descending — common modern jazz device:
  // Cm7 → Bm7 → Bbm7 (3 chords descending chromatically)
  { name: 'Chromatic-Minor-Desc-3', family: 'GenDom', baseCost: 0.6, steps: [
    { rootDegreePc: 0, qualities: ['minor'] },
    { rootDegreePc: 11, qualities: ['minor'] },
    { rootDegreePc: 10, qualities: ['minor'] },
  ]},
  // 4-step: Cm7 Bm7 Bbm7 Am7
  { name: 'Chromatic-Minor-Desc-4', family: 'GenDom', baseCost: 0.55, steps: [
    { rootDegreePc: 0, qualities: ['minor'] },
    { rootDegreePc: 11, qualities: ['minor'] },
    { rootDegreePc: 10, qualities: ['minor'] },
    { rootDegreePc: 9, qualities: ['minor'] },
  ]},

  // i-iv-V (minor mode authentic cadence with iv-V leading to i)
  { name: 'Minor-i-iv-V', family: 'Cadence', baseCost: 0.6, steps: [
    { rootDegreePc: 0, qualities: ['minor'] },
    { rootDegreePc: 5, qualities: ['minor'] },
    { rootDegreePc: 7, qualities: ['dominant', 'sus'] },
  ]},

  // i-V (minor authentic, 2-chord)
  { name: 'Minor-i-V', family: 'Cadence', baseCost: 0.7, steps: [
    { rootDegreePc: 7, qualities: ['dominant'] },
    { rootDegreePc: 0, qualities: ['minor'] },
  ]},
];
