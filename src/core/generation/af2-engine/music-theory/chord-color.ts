// ============================================================
// chord-color.ts — Resolution targets / global contract
// ============================================================
// Phase 6.1 拆分自 mg-engine/musicTheory.ts。
// Sources: getResolutionTargets (L3412-3460) + computeGlobalContract (L3938-4024)。
// CHORD_COLOR_DICTIONARY 见 chord-types.ts(避免循环依赖)。
// ============================================================

import { CHORD_TYPES } from './chord-types';
import { INTERVAL_AESTHETICS } from './tendency';

export function getResolutionTargets(intervalSemitones: number): number[] {
  const pc = ((intervalSemitones % 12) + 12) % 12;
  const rule = INTERVAL_AESTHETICS[pc];
  return rule?.expectedResolutions ?? [];
}

// ------------------------------------------------------------------
// Divisi 2.0 — Harmonic state machine middleware.
//
// Stage 3 of the engine pipeline emits a chord with an upper-voicing
// shell + a real bass MIDI. The bass anchor doesn't always match the
// upper chord's root (voice-leading smoothing or style-driven bass
// rules can move the bass freely), so the actual sounding chord is
// often a slash voicing — Cmaj7/E, Cmaj7/G, F/G, etc. The melody and
// texture engines can't keep treating these like root-position triads
// without producing low-frequency clashes (Smart Omit) or missing
// the suspended-dominant magnetism (Composite virtual extensions).
//
// evaluateTensionState is the pure middleware: takes the upper root,
// the upper-shell pc set, the actual bassPc, the original TSD function
// label, and the song's global key root. Returns one of four tension
// states plus an effective TSD function override and an optional list
// of virtual extension intervals (in SEMITONES from the bass) that
// downstream magnetism is allowed to land on.
//
//   Solid       — bass = root. Standard root-position chord.
//   Flowing     — bass = chord 3rd (major or minor). First inversion;
//                 texture should Smart-Omit the 3rd from chord stabs
//                 to avoid low-freq doubling, and cadence Tier B
//                 should NOT force a 1/3/5 landing (let it flow).
//   Preparation — bass = chord 5th. Second inversion (cadential 6/4);
//                 inject dominant tension by overriding func to D.
//   Composite   — bass is OUTSIDE the upper-shell (real slash chord
//                 like F/G or Bb/C). Functional identity may be
//                 overridden (suspended dominant → D, pedal-on-key
//                 → T, upper-structure → D), and virtual extensions
//                 expose color tones for melody magnetism.
// ------------------------------------------------------------------

// HarmonicState 字符串值的学术对应:
//   'Solid'          — 根位 (root position)
//   'FirstInversion' — 一转位, 3 in bass. 旧名 'Flowing'.
//                      Sources: Schenker; Aldwell-Schachter "Harmony & Voice Leading".
//   'Cadential64'    — 二转位/终止四六, 5 in bass, 强制 D-function.
//                      旧名 'Preparation'. Sources: Rameau 1722;
//                      Caplin 1998 "Classical Form" (cadential dominant).
//   'SlashChord'     — bass 在 upper-shell 之外 (F/G, D/C, pedal).
//                      旧名 'Composite'. Sources: Russell 1953 LCC;
//                      Levine 1995 ch.4 (upper-structure / pedal).
// ------------------------------------------------------------------

export function computeGlobalContract(chordType: string, chordRootPc: number): { intervals: number[]; pcs: Set<number> } {
  const literal = CHORD_TYPES[chordType] || CHORD_TYPES['maj'];
  const intervals: number[] = [...literal];
  const isHalfDim = chordType === 'm7b5' || chordType === 'm9b5';
  const isMin = !isHalfDim && (chordType === 'min'
      || (chordType.startsWith('m') && !chordType.startsWith('maj') && chordType !== 'maj'));
  const isDim = chordType === 'dim' || chordType === 'dim7';
  const isDom = !isMin && !isDim && !isHalfDim
      && (chordType === '7' || chordType === 'dom7' || chordType === '9' || chordType.startsWith('7'));
  const isMaj = !isMin && !isDim && !isHalfDim && !isDom && chordType !== 'aug';
  // Admissible color set (jazz convention — chord quality 决定哪些
  // tensions 是"声音内的色彩"):
  //   maj 家族: + 9 + 13 + #11 (Lydian color)
  //   min 家族: + 9 + 11 + 13 + b7 (m7 implied) + b6 (Aeolian mode 借用)
  //   dom 家族: + 9 + 13 + b9 + #9 + #11 + b13 (altered tensions — 老师
  //              "ALT 和弦不就是 b9/b13?" 哲学; jazz V chord 上 alt
  //              tension 皆合法).
  //   halfDim (m7b5): + 11 + b6 (Locrian — m7b5 的母调).
  //   dim / aug: 保留窄.
  if (isMaj) {
      if (!intervals.includes(14)) intervals.push(14);   // 9
      if (!intervals.includes(9))  intervals.push(9);    // 13 (mod-12)
      if (!intervals.includes(18)) intervals.push(18);   // #11 (Lydian)
  }
  if (isMin) {
      if (!intervals.includes(14)) intervals.push(14);   // 9
      if (!intervals.includes(17)) intervals.push(17);   // 11
      if (!intervals.includes(9))  intervals.push(9);    // 13 (mod-12)
      if (!intervals.includes(10)) intervals.push(10);   // b7 (m7 implied)
      // b6 (= pc 8) 抛弃 — 按物理法则跟 chord 5 形成小九度碰撞 (avoid).
      // 之前为 Aeolian mode 借用加宽到 admissible 是妥协, 物理法则下纠正:
      // b6 在小和弦上是 avoid, 仅 modal context + Aeolian/Phrygian/Locrian
      // 等特征音名单内才豁免 (走 MODAL_CHARACTERISTIC_NOTES 路径).
  }
  if (isDom) {
      if (!intervals.includes(14)) intervals.push(14);   // 9
      if (!intervals.includes(21)) intervals.push(21);   // 13
      // Altered tensions — 老师 ALT 哲学.
      if (!intervals.includes(13)) intervals.push(13);   // b9
      if (!intervals.includes(15)) intervals.push(15);   // #9
      if (!intervals.includes(18)) intervals.push(18);   // #11
      if (!intervals.includes(20)) intervals.push(20);   // b13
  }
  if (isHalfDim) {
      if (!intervals.includes(17)) intervals.push(17);   // 11 (Locrian)
      if (!intervals.includes(20)) intervals.push(20);   // b13 (= Locrian b6)
  }
  const rootPc = ((chordRootPc % 12) + 12) % 12;
  const pcs = new Set(intervals.map((i) => (((rootPc + i) % 12) + 12) % 12));
  return { intervals, pcs };
}

// ------------------------------------------------------------------
// Cadence resolution (Definition 4: dynamic context-aware cadence).
//
// Phrase ends are punctuation marks. Different harmonic functions at
// the cadence position carry different expectations:
//
//   Tier A — Global End on T (剧终绝对回归)
//     Final bar of the song landing on a tonic-function chord.
//     Force the listener home to the GLOBAL key tonic (or 3rd of the
//     key, also stable). Period.
//
//   Tier B — Phrase End on T (句号 / 归宿落地)
//     Authentic / deceptive cadence — the harmonic story has come
//     home. The melody yields to the chord's literal 1/3/5 (no upper
//     extensions). Even if mid-bar magnetism would have allowed a 9 /
//     11 / 13 landing, the cadential moment demands plain backbone.
//
//   Tier C — Phrase End on D or S (问号 / 省略号)
//     Half cadence (V at phrase end) or open S landing — the story is
//     unfinished. Tension is structural, not a defect. If the melody's
//     current pitch is already inside the chord's extended contract,
//     leave it alone (preserve the suspension); if not, snap softly to
//     the contract (extensions allowed).
//
//   none
//     Not a phrase-end position. No cadence resolution applies; magnet
//     and other corrections handle the note normally.
//
// Style-level note: characteristic notes (Blues b3 / b7, Jazz #11, etc)
// are NOT part of cadence candidates. Style flavor lives in passing
// tones and non-cadence color magnetism; cadence is purely chord-driven.
// ------------------------------------------------------------------

