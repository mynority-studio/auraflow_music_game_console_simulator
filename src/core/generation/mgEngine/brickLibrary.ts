// ==========================================
// brickLibrary.ts — Brick pattern dictionary (Impro-Visor RoadMap style).
//
// Brick = 和声语义槽位. 每条 BrickPattern 描述一段 chord progression
// 的功能类型 (Cadence / Approach / Turnaround / ...) + roman-numeral
// 序列 + 成本权重. RoadMap parser 拿这本字典在 ChordDef[] 上跑 CYK
// 动态规划,把 chord 序列切成 Block[],每 Block 携带一个 brick 名.
//
// 然后 lick selector 按当前 Block 的 brickName 软匹配 IMPROVISOR_LICKS
// (匹配 weight 1.0,Q-fragment fallback 0.5,其他 0.1) 抽 lick 渲染.
//
// 关键设计:
//   - Pattern 用 roman 数字 (大小写区分 major/minor: I/IV/V vs i/iv/v),
//     兼容 secondary dominant (V/X) + tritone sub (subV/X) + 平行借用
//     (bIII/bVI/bVII)
//   - cost = 字典作者预设的"标签倾向性":越低越优先 (Impro-Visor 习惯).
//     Cadence/Dropback 这种基本结构 cost 低,Plain-X 这种 fallback cost 高.
//   - mode 标签控制大调 / 小调 / 任意场景适用,跟我们引擎的 globalMode 联动.
// ==========================================

export type BrickType =
  | 'Cadence'
  | 'Approach'
  | 'Dropback'
  | 'Turnaround'
  | 'Opening'
  | 'Pullback'
  | 'Deceptive-Cadence'
  | 'CESH'
  | 'Plain';  // single-chord fallback

export interface BrickPattern {
  name: string;
  /** Roman-numeral sequence the pattern matches. Each token is a single
   *  chord function. Lowercase = minor quality, uppercase = major.
   *  V/X = secondary dominant of X; subV/X = tritone sub of V/X.
   *  Wildcard '*' matches any chord. */
  pattern: string[];
  type: BrickType;
  /** When 'major' / 'minor': only match when song's globalMode is that
   *  family. 'any': match in any mode. */
  mode: 'major' | 'minor' | 'any';
  /** Lower = more preferred when CYK has multiple decompositions. */
  cost: number;
  /** Used for Impro-Visor-style brick label matching against
   *  IMPROVISOR_LICKS.brickType. Multiple brick patterns can share the
   *  same lickBrick (e.g. both 'Sad-Cadence' and 'Major-Cadence' map
   *  to 'Cadence' family). */
  lickBrick: string;
}

// ─────────────────────────────────────────────────────────────────────
// Dictionary entries
// ─────────────────────────────────────────────────────────────────────

export const BRICK_LIBRARY: BrickPattern[] = [
  // ── Cadence family (ii-V-I, V-I) ──────────────────────────────
  { name: 'Sad-Cadence',
    pattern: ['ii', 'V', 'i'],     // minor ii-V-i
    type: 'Cadence', mode: 'minor', cost: 25, lickBrick: 'Sad-Cadence' },
  { name: 'Sad-Cadence-short',
    pattern: ['V', 'i'],
    type: 'Cadence', mode: 'minor', cost: 28, lickBrick: 'Sad-Cadence' },
  { name: 'Major-Cadence',
    pattern: ['ii', 'V', 'I'],     // major ii-V-I
    type: 'Cadence', mode: 'major', cost: 25, lickBrick: 'Straight-Cadence' },
  { name: 'Straight-Cadence',
    pattern: ['V', 'I'],           // simple V-I major
    type: 'Cadence', mode: 'major', cost: 28, lickBrick: 'Straight-Cadence' },
  { name: 'Surprise-Major-Cadence',
    pattern: ['ii', 'V', 'I'],     // tagged for surprise resolution variant
    type: 'Cadence', mode: 'major', cost: 26, lickBrick: 'Surprise-Major-Cadence' },

  // ── Deceptive cadence (V → vi / bVI) ───────────────────────────
  { name: 'Deceptive-vi',
    pattern: ['V', 'vi'],
    type: 'Deceptive-Cadence', mode: 'major', cost: 60, lickBrick: 'Straight-Cadence' },
  { name: 'Deceptive-bVI',
    pattern: ['V', 'bVI'],
    type: 'Deceptive-Cadence', mode: 'any', cost: 60, lickBrick: 'Straight-Cadence' },

  // ── Turnaround / Dropback (I-vi-ii-V family) ───────────────────
  { name: 'Dropback',
    pattern: ['I', 'vi', 'ii', 'V'],
    type: 'Dropback', mode: 'major', cost: 30, lickBrick: 'Dropback' },
  { name: 'Dropback-minor',
    pattern: ['i', 'VI', 'ii', 'V'],
    type: 'Dropback', mode: 'minor', cost: 30, lickBrick: 'Dropback' },
  { name: 'Turnaround-I-IV-V',
    pattern: ['I', 'IV', 'V'],
    type: 'Turnaround', mode: 'major', cost: 35, lickBrick: 'Dropback' },
  { name: 'Turnaround-I-vi-IV-V',
    pattern: ['I', 'vi', 'IV', 'V'],
    type: 'Turnaround', mode: 'major', cost: 30, lickBrick: 'Dropback' },

  // ── Approach (ii-V leading into target) ────────────────────────
  { name: 'Approach',
    pattern: ['ii', 'V'],
    type: 'Approach', mode: 'any', cost: 45, lickBrick: 'Straight-Approach' },
  { name: 'Approach-minor',
    pattern: ['ii', 'V'],
    type: 'Approach', mode: 'minor', cost: 45, lickBrick: 'Rainy-Cadence' },

  // ── Local 251 (secondary ii-V into X) ──────────────────────────
  // V/X-target combos. We don't enumerate every X — pattern uses '*'
  // to match the resolution target (any chord).
  { name: 'Local-251-to-ii',
    pattern: ['vi', 'V/ii', 'ii'],   // ii-V into ii: e.g. Em7-A7-Dm7
    type: 'Approach', mode: 'major', cost: 40, lickBrick: 'Rainy-Cadence' },
  { name: 'Secondary-V',
    pattern: ['V/*', '*'],            // any V/X → X — secondary dominant resolution
    type: 'Approach', mode: 'any', cost: 38, lickBrick: 'Dominant-Cycle-Cadence' },
  { name: 'Tritone-Sub',
    pattern: ['subV/*', '*'],         // any subV/X → X — chromatic surprise V
    type: 'Approach', mode: 'any', cost: 38, lickBrick: 'Surprise-Major-Cadence' },

  // ── Pullback (V→bVII→V→I evasion-to-modal-cadence) ─────────────
  { name: 'Pullback',
    pattern: ['V', 'bVII', 'i'],
    type: 'Pullback', mode: 'minor', cost: 45, lickBrick: 'Rainy-Cadence' },

  // ── CESH (Descending-Minor-CESH = i / i+7 / i+M6 / i+b6) ───────
  { name: 'Descending-Minor-CESH',
    pattern: ['i', 'i', 'i', 'i'],   // static i with chromatic line
    type: 'CESH', mode: 'minor', cost: 10, lickBrick: 'Descending-Minor-CESH' },

  // ── Opening (phrase start, usually I or i) ─────────────────────
  // POT (Pre-On-Tonic) = phrase-start material that leads INTO a tonic.
  { name: 'Opening-Major',
    pattern: ['I'],
    type: 'Opening', mode: 'major', cost: 25, lickBrick: 'POT' },
  { name: 'Opening-Minor',
    pattern: ['i'],
    type: 'Opening', mode: 'minor', cost: 25, lickBrick: 'Sad-Launcher' },

  // ── Slow-Launcher (atmospheric 2-bar tonic establishment) ──────
  // 2-bar static tonic = long opening / interlude. Cost 22 (cheaper
  // than Opening-X + Plain-tonic = 1025), so CYK prefers this when
  // 2 consecutive tonic bars appear. The Slow-Launcher licks (17 in
  // library) are RichPerry/Lovano atmospheric phrases authored for
  // long-static-tonic context — equally musical at song start or
  // mid-song quiet section.
  { name: 'Slow-Launcher-Major',
    pattern: ['I', 'I'],
    type: 'Opening', mode: 'major', cost: 22, lickBrick: 'Slow-Launcher' },
  { name: 'Slow-Launcher-Minor',
    pattern: ['i', 'i'],
    type: 'Opening', mode: 'minor', cost: 22, lickBrick: 'Slow-Launcher' },

  // ── Reverse-Dominant-Cycle-2-Steps (V/V → V → I/i) ─────────────
  // 3-bar backward dominant chain ending in tonic. e.g. D7 → G7 → C
  // (major) or D7 → G7 → Cm (minor). 23 Lovano/Perry licks in library
  // authored for this exact chain. Cost 32 beats Secondary-V (38) +
  // Plain-Dom (1000) + Plain-tonic (1000) = 2038 for the same 3 bars,
  // AND beats Secondary-V (38) + Sad-Cadence-short cadence (25) when
  // CYK considers the alternative groupings.
  { name: 'Rev-Dom-Cycle-2-Steps-Major',
    pattern: ['V/V', 'V', 'I'],
    type: 'Approach', mode: 'major', cost: 32, lickBrick: 'Reverse-Dominant-Cycle-2-Steps' },
  { name: 'Rev-Dom-Cycle-2-Steps-Minor',
    pattern: ['V/V', 'V', 'i'],
    type: 'Approach', mode: 'minor', cost: 32, lickBrick: 'Reverse-Dominant-Cycle-2-Steps' },

  // ── Plain-X (single-chord fallback when nothing matches) ───────
  // Cost is HIGH (1000) so CYK only falls here when no real brick
  // covers the chord. Mirrors Impro-Visor CHORD_COST=1000.
  // lickBrick mapping reflects each chord's harmonic function — the
  // brick names come from Impro-Visor's grammar files:
  //   Plain-Pred (ii)  → Nowhere-Approach (non-cadential ii content)
  //   Plain-Dom  (V)   → Dominant-Cycle (V-chord melodic content)
  //   Plain-tonic (i/I) → Minor-On / POT (static-tonic material)
  //   IV / vi / bVII etc. → Q-fragment (no brick equivalent in source)
  { name: 'Plain-Tonic',  pattern: ['I'],    type: 'Plain', mode: 'major', cost: 1000, lickBrick: 'POT' },
  { name: 'Plain-tonic',  pattern: ['i'],    type: 'Plain', mode: 'minor', cost: 1000, lickBrick: 'Minor-On' },
  { name: 'Plain-Pred',   pattern: ['ii'],   type: 'Plain', mode: 'any',   cost: 1000, lickBrick: 'Nowhere-Approach' },
  { name: 'Plain-Sub',    pattern: ['IV'],   type: 'Plain', mode: 'major', cost: 1000, lickBrick: 'Q-fragment' },
  { name: 'Plain-sub',    pattern: ['iv'],   type: 'Plain', mode: 'minor', cost: 1000, lickBrick: 'Q-fragment' },
  { name: 'Plain-Dom',    pattern: ['V'],    type: 'Plain', mode: 'any',   cost: 1000, lickBrick: 'Dominant-Cycle' },
  { name: 'Plain-Sub6',   pattern: ['vi'],   type: 'Plain', mode: 'major', cost: 1000, lickBrick: 'Q-fragment' },
  { name: 'Plain-bVII',   pattern: ['bVII'], type: 'Plain', mode: 'any',   cost: 1000, lickBrick: 'Q-fragment' },
  { name: 'Plain-bVI',    pattern: ['bVI'],  type: 'Plain', mode: 'any',   cost: 1000, lickBrick: 'Q-fragment' },
  { name: 'Plain-bIII',   pattern: ['bIII'], type: 'Plain', mode: 'any',   cost: 1000, lickBrick: 'Q-fragment' },
  { name: 'Plain-Wild',   pattern: ['*'],    type: 'Plain', mode: 'any',   cost: 1200, lickBrick: 'Q-fragment' },
];

// ─────────────────────────────────────────────────────────────────────
// Roman-numeral normalization
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract the "function token" from a chord's roman string, stripping
 * extensions / accidentals but keeping inversions / borrowed source
 * markers we want to match on.
 *
 * Examples:
 *   'Imaj7'       → 'I'
 *   'iim7'        → 'ii'
 *   'V7'          → 'V'
 *   'V7/ii'       → 'V/ii'
 *   'subV7/V'     → 'subV/V'
 *   'bVII7'       → 'bVII'
 *   'bIIImaj7'    → 'bIII'
 *   'iv'          → 'iv'
 */
export function normalizeRomanToken(roman: string): string {
  // Strip slash-chord bass marker (V/ii vs V/E — V/X format kept,
  // bass-pitch-as-slash like 'Cmaj7/E' would never reach here since
  // chord.roman uses roman numerals not pitch names).
  let s = roman.trim();
  // Sub-V (tritone substitution) — keep 'subV' prefix
  if (s.startsWith('subV/')) {
    const target = s.slice(5).split(/[^a-zA-Z#b]/)[0];
    return `subV/${target}`;
  }
  // Secondary dominant — keep 'V/X' format
  if (s.includes('/') && s.startsWith('V')) {
    const [_head, tail] = s.split('/');
    const target = tail.split(/[^a-zA-Z#b]/)[0];
    return `V/${target}`;
  }
  // Pull leading accidentals (b / #) into prefix
  let prefix = '';
  while (s[0] === 'b' || s[0] === '#') { prefix += s[0]; s = s.slice(1); }
  // Pull the roman numeral itself
  const m = s.match(/^[IVivx]+/);
  if (!m) return prefix + s;  // give up — return original-ish
  return prefix + m[0];
}

// ─────────────────────────────────────────────────────────────────────
// Pattern matching
// ─────────────────────────────────────────────────────────────────────

/**
 * Match a brick pattern against a roman-numeral token sequence.
 * Returns true if every position pairs up (wildcard '*' matches any,
 * 'V/*' matches any 'V/X', 'subV/*' matches any 'subV/X').
 */
export function matchesBrickPattern(
  pattern: readonly string[],
  tokens: readonly string[],
): boolean {
  if (pattern.length !== tokens.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    const t = tokens[i];
    if (p === '*') continue;
    if (p === 'V/*') {
      if (!t.startsWith('V/')) return false;
      continue;
    }
    if (p === 'subV/*') {
      if (!t.startsWith('subV/')) return false;
      continue;
    }
    if (p === t) continue;
    return false;
  }
  return true;
}

/**
 * Find all bricks whose pattern matches the token slice and the given
 * mode. Returns sorted by ascending cost (cheapest = most preferred).
 */
export function findMatchingBricks(
  tokens: readonly string[],
  mode: 'major' | 'minor',
): BrickPattern[] {
  const matches: BrickPattern[] = [];
  for (const brick of BRICK_LIBRARY) {
    if (brick.mode !== 'any' && brick.mode !== mode) continue;
    if (matchesBrickPattern(brick.pattern, tokens)) matches.push(brick);
  }
  matches.sort((a, b) => a.cost - b.cost);
  return matches;
}
