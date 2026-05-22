// ============================================================
// audit.ts — Harmonic perception + melody audit
// ============================================================
// Phase 6.1 拆分自 mg-engine/musicTheory.ts。
// Sources: ChordScaleAudit + auditChordScaleConformance + AuditChordLike +
// AuditEventLike + PerceptionDrift + BarPerception + HarmonicPerceptionAudit +
// auditHarmonicPerception (L650-895) + MelodyAuditSummary + auditMelody +
// 私有 audit interfaces (L3086-3216)。
// ============================================================

import { CHORD_TYPES } from './chord-types';
import { SCALE_TYPES, scalePcsForMode, chordScaleFor } from './scale';
import { ChordDetection, detectChord } from './chord-detection';
import type { MeterContext } from './meter';
import type { NoteFunctionRole } from './voicing';
import { getChordVoicingAesthetics } from './voicing';

/**
 * Audit: what fraction of a melody's pcs fit the chord's recommended
 * scale. Returns { scale, inScale, outOfScale, conformance }.
 *
 *   conformance = 1.0  完全在 scale 内
 *   conformance = 0.8  允许少量 chromatic / blue notes
 *   conformance < 0.5  跑调
 */
export interface ChordScaleAudit {
  scale: string;
  inScale: number;
  outOfScale: number;
  conformance: number;  // 0..1
}

export function auditChordScaleConformance(
  melodyPcs: Set<number> | number[],
  chordRootPc: number,
  keyTonicPc: number,
  keyMode: string,
  chordType?: string,
): ChordScaleAudit {
  const scale = chordScaleFor(chordRootPc, keyTonicPc, keyMode, chordType);
  const scalePcs = scalePcsForMode(chordRootPc, scale);
  const pcs = Array.isArray(melodyPcs)
    ? new Set(melodyPcs.map(p => ((p % 12) + 12) % 12))
    : melodyPcs;
  let inScale = 0, outOfScale = 0;
  for (const pc of pcs) {
    if (scalePcs.has(pc)) inScale++;
    else outOfScale++;
  }
  const total = inScale + outOfScale;
  return {
    scale,
    inScale,
    outOfScale,
    conformance: total > 0 ? inScale / total : 1,
  };
}

// ------------------------------------------------------------------
// Harmonic Perception Audit — 闭环审计:把每 bar sounding pcs
// (bass + comping + 结构位旋律)合起来反推 detectChord,跟 declared
// chord 对照,看耳朵实际听到的跟我们声明的一致吗。
//
// 这是 chord-detect 的最高价值用例 — 不是"用户输入解析",而是
// "engine self-mirror"。每首歌都能自动 surface:
//   - 旋律意外加了 9/13 → 'extension-added' (健康的 divisi)
//   - 旋律加了 chromatic 色彩 → 'extension-added' 或 'mismatch'
//   - 旋律踩 avoid note 在强拍 → 'mismatch' / 'no-match'
//   - voicing 没传达 declared chord type → 'extension-removed'
//   - bass 让 chord 听感变了根音 → 'polychord' / 'inversion-shift'
// ------------------------------------------------------------------

/** 最小型的 chord 描述(给 audit 用,避免循环依赖 musicEngine) */
export interface AuditChordLike {
  rootMidi: number;
  bassMidi: number;
  type: string;
  duration: number;
  notes: string[];  // MIDI note strings (e.g. ['C4','E4','G4'])
}

/** 最小型的 event 描述 */
export interface AuditEventLike {
  time: number;
  duration: number;
  noteNumber: number;
  part: 'melody' | 'chord' | 'bass';
}

export type PerceptionDrift =
  | 'exact'             // declared == perceived (chord-type + root)
  | 'extension-added'   // perceived 是 declared 的真超集(旋律加了色彩)
  | 'extension-removed' // perceived 是 declared 的真子集(declared 的色彩没真听到)
  | 'inversion-shift'   // 同 type 同 root,但听感变了 bass
  | 'polychord'         // perceived root 跟 declared root 不一致(产生新 chord)
  | 'mismatch'          // 既非超集也非子集,完全不一致
  | 'no-match';         // detectChord 没找到任何匹配(chord-type 字典里没此 chroma)

export interface BarPerception {
  barIdx: number;
  declared: { type: string; rootPc: number; bassPc: number };
  perceived: ChordDetection | null;
  drift: PerceptionDrift;
  soundingPcs: number[];  // 反向审计时合并的 pcs(展开 Set 给 JSON)
}

export interface HarmonicPerceptionAudit {
  byBar: BarPerception[];
  summary: {
    total: number;
    exactCount: number;
    extensionAddedCount: number;
    extensionRemovedCount: number;
    inversionShiftCount: number;
    polychordCount: number;
    mismatchCount: number;
    noMatchCount: number;
    /** exact + extension-added 算 "健康"(因为 divisi 加色彩属意图)。 */
    healthyPct: number;
  };
}

// 提取 note string 的 pc(e.g. 'C4' → 0, 'F#5' → 6)。
// 我们其他地方有 noteToMidi 但其参数解析格式有自己 quirks。这里独立
// 实现以避免 audit 误用。
function noteStringToPc(noteStr: string): number {
  const m = /^([A-Ga-g])([#b♯♭]?)(\d+)$/.exec(noteStr.trim());
  if (!m) return 0;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] ?? 0;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : (m[2] === 'b' || m[2] === '♭' ? -1 : 0);
  return (((base + acc) % 12) + 12) % 12;
}

function intervalSetMod12(chordType: string): Set<number> {
  const ivs = CHORD_TYPES[chordType] ?? [0, 4, 7];
  return new Set(ivs.map(iv => (((iv % 12) + 12) % 12)));
}

function classifyDrift(
  declaredType: string,
  declaredRootPc: number,
  declaredBassPc: number,
  perceived: ChordDetection | null,
): PerceptionDrift {
  if (!perceived) return 'no-match';

  if (perceived.tonicPc === declaredRootPc) {
    if (perceived.name === declaredType) return 'exact';
    // 同 root,不同 chord type — 看 interval set 关系
    const decIvs = intervalSetMod12(declaredType);
    const perIvs = intervalSetMod12(perceived.name);
    let decSubsetOfPer = true; for (const i of decIvs) if (!perIvs.has(i)) { decSubsetOfPer = false; break; }
    let perSubsetOfDec = true; for (const i of perIvs) if (!decIvs.has(i)) { perSubsetOfDec = false; break; }
    if (decSubsetOfPer && !perSubsetOfDec) return 'extension-added';
    if (perSubsetOfDec && !decSubsetOfPer) return 'extension-removed';
    return 'mismatch';
  }
  // 不同 root — 区分真转位 vs polychord:
  //   真转位:declared bass 在 perceived chord 的 interval 集合内
  //          (e.g. Cmaj7/E — bass=E 是 Cmaj7 的 3rd)
  //   polychord:declared bass 在 perceived chord 之外
  //          (e.g. Cmaj7/F — bass=F 不在 Cmaj7 里 → polychord)
  const perIvs = intervalSetMod12(perceived.name);
  const bassRelToPerTonic = (((declaredBassPc - perceived.tonicPc) % 12) + 12) % 12;
  if (perIvs.has(bassRelToPerTonic)) return 'inversion-shift';
  return 'polychord';
}

export function auditHarmonicPerception(
  chords: AuditChordLike[],
  events: AuditEventLike[],
  meterContext: MeterContext,
): HarmonicPerceptionAudit {
  const byBar: BarPerception[] = [];
  const strongs = meterContext.strongBeats;
  let tStart = 0;
  for (let bi = 0; bi < chords.length; bi++) {
    const c = chords[bi];
    const barDur = c.duration;
    const declaredRootPc = (((c.rootMidi % 12) + 12) % 12);
    const declaredBassPc = (((c.bassMidi % 12) + 12) % 12);

    // 集合所有这个 bar 在响的 pcs
    const sounding = new Set<number>();
    sounding.add(declaredBassPc);
    for (const n of c.notes) sounding.add(noteStringToPc(n));

    // 旋律 — 加结构位(强拍或长音 ≥ 1 beat)
    const melHere = events.filter(
      e => e.part === 'melody' && e.time >= tStart && e.time < tStart + barDur,
    );
    for (const m of melHere) {
      const local = m.time - tStart;
      const beatInBar = (((local % meterContext.beatsPerMeasure) + meterContext.beatsPerMeasure) % meterContext.beatsPerMeasure);
      const isStrong = strongs.some(sb => Math.abs(beatInBar - sb) < 0.05);
      const isLong = m.duration >= 1.0;
      if (isStrong || isLong) {
        sounding.add((((m.noteNumber % 12) + 12) % 12));
      }
    }

    const detections = detectChord(sounding, {
      bassPc: declaredBassPc,
      assumePerfectFifth: true,
    });
    const top = detections[0] ?? null;
    const drift = classifyDrift(c.type, declaredRootPc, declaredBassPc, top);

    byBar.push({
      barIdx: bi,
      declared: { type: c.type, rootPc: declaredRootPc, bassPc: declaredBassPc },
      perceived: top,
      drift,
      soundingPcs: Array.from(sounding).sort((a, b) => a - b),
    });
    tStart += barDur;
  }

  const total = byBar.length;
  const cnt = (d: PerceptionDrift) => byBar.filter(b => b.drift === d).length;
  const exactCount = cnt('exact');
  const extensionAddedCount = cnt('extension-added');
  const extensionRemovedCount = cnt('extension-removed');
  const inversionShiftCount = cnt('inversion-shift');
  const polychordCount = cnt('polychord');
  const mismatchCount = cnt('mismatch');
  const noMatchCount = cnt('no-match');
  const healthy = exactCount + extensionAddedCount;
  return {
    byBar,
    summary: {
      total,
      exactCount,
      extensionAddedCount,
      extensionRemovedCount,
      inversionShiftCount,
      polychordCount,
      mismatchCount,
      noMatchCount,
      healthyPct: total === 0 ? 0 : healthy / total,
    },
  };
}

// ------------------------------------------------------------------
// detectChord — given a set of sounding pitch classes, reverse-derive
// which chord type(s) match. Used as a self-audit oracle: pipe the
// combined comping + melody pcs through this, compare against the
// declared chord — drift between the two reveals emergent harmonic
// behavior (intentional polychord, modal interchange, unintended
// extensions).
//
// Algorithm borrowed from tonal `@tonaljs/chord-detect` (MIT,
// bitmask + 12 rotations). Adapted to our Set<number> + CHORD_TYPES.
// 12-bit chroma string convention: chroma[i] = '1' if pc i present.
// MSB-first ordering compatible with tonal — bit 0 of the int form
// corresponds to chroma[11] (pc B / M7).
//
// `assumePerfectFifth` (default true) accepts rootless voicings:
// jazz left-hand frequently drops the 5, so {3, 6, 10, 14} should
// still detect as Dom7-family by implying the 5. Only kicks in for
// candidates that have 3 + 5 + 7 in the dictionary entry.
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// Melody audit reporter.
//
// Pure analysis pass — does not mutate input. Walks the generated
// melody events and reports each note's role against the active chord
// (chord-tone / available-tension / avoid-note / altered-tension) plus
// summary counts split by origin tag (motif / develop / return).
//
// Read by the App diagnostics panel and the snapshot fixture.
// Sacred motif notes show up in the report but are not corrected by
// the engine elsewhere — the audit only describes; it does not act.
// ------------------------------------------------------------------

interface AuditChordWindow {
  startBeat: number;
  endBeat: number;
  rootPc: number;
  type: string;
}

interface MelodyEventLike {
  noteNumber: number;
  time: number;
  part: 'melody' | 'chord' | 'bass';
  origin?: 'motif' | 'develop' | 'return';
}

interface ChordLike {
  rootMidi: number;
  type: string;
  duration: number;
}

export interface MelodyAuditSummary {
  total: number;
  byRole: Partial<Record<NoteFunctionRole, number>>;
  avgTensionByOrigin: { motif: number; develop: number; return: number };
  countByOrigin: { motif: number; develop: number; return: number; untagged: number };
  avoidNotesOnMotif: number;     // sacred — reported but unfixable by engine
  avoidNotesOnDevelop: number;   // candidate for engine correction in iter 3
  avoidNotesOnReturn: number;    // unexpected — return targets a chord tone
}

export function auditMelody(events: MelodyEventLike[], chords: ChordLike[]): MelodyAuditSummary {
  // Chord windows: each chord plays for `duration` beats starting at the
  // accumulated offset.
  const windows: AuditChordWindow[] = [];
  let acc = 0;
  for (const ch of chords) {
    windows.push({
      startBeat: acc,
      endBeat: acc + ch.duration,
      rootPc: ((ch.rootMidi % 12) + 12) % 12,
      type: ch.type,
    });
    acc += ch.duration;
  }

  const findWindow = (t: number): AuditChordWindow | undefined => {
    for (const w of windows) {
      if (t >= w.startBeat && t < w.endBeat) return w;
    }
    // Past the last chord (e.g. very last note tail) → snap to last window.
    return windows[windows.length - 1];
  };

  const summary: MelodyAuditSummary = {
    total: 0,
    byRole: {},
    avgTensionByOrigin: { motif: 0, develop: 0, return: 0 },
    countByOrigin: { motif: 0, develop: 0, return: 0, untagged: 0 },
    avoidNotesOnMotif: 0,
    avoidNotesOnDevelop: 0,
    avoidNotesOnReturn: 0,
  };

  const tensionSums = { motif: 0, develop: 0, return: 0 };

  for (const ev of events) {
    if (ev.part !== 'melody') continue;
    const w = findWindow(ev.time);
    if (!w) continue;
    const interval = ((ev.noteNumber - w.rootPc) % 12 + 12) % 12;
    const aestheticTable = getChordVoicingAesthetics(w.type);
    const aesthetic = aestheticTable[interval];
    if (!aesthetic) continue;

    summary.total++;
    summary.byRole[aesthetic.role] = (summary.byRole[aesthetic.role] ?? 0) + 1;

    const origin = ev.origin;
    if (origin === 'motif') { summary.countByOrigin.motif++; tensionSums.motif += aesthetic.tensionLevel; }
    else if (origin === 'develop') { summary.countByOrigin.develop++; tensionSums.develop += aesthetic.tensionLevel; }
    else if (origin === 'return') { summary.countByOrigin.return++; tensionSums.return += aesthetic.tensionLevel; }
    else summary.countByOrigin.untagged++;

    if (aesthetic.role === 'AVOID_NOTE') {
      if (origin === 'motif') summary.avoidNotesOnMotif++;
      else if (origin === 'develop') summary.avoidNotesOnDevelop++;
      else if (origin === 'return') summary.avoidNotesOnReturn++;
    }
  }

  // Average tension per origin (rounded to 3 decimals so snapshot diff
  // stays readable).
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  summary.avgTensionByOrigin = {
    motif: summary.countByOrigin.motif > 0 ? round3(tensionSums.motif / summary.countByOrigin.motif) : 0,
    develop: summary.countByOrigin.develop > 0 ? round3(tensionSums.develop / summary.countByOrigin.develop) : 0,
    return: summary.countByOrigin.return > 0 ? round3(tensionSums.return / summary.countByOrigin.return) : 0,
  };

  return summary;
}

// ------------------------------------------------------------------
// Chord-quality classifier and per-mode legality lookup.
//
// classifyEngineChordType maps the engine's chord-type strings
// ('maj7', 'm7', 'dom7', 'm7b5', ...) onto a coarse quality enum.
// CHORD_COLOR_DICTIONARY entries are parsed once at module load into
// MODE_DEGREE_QUALITY[mode][scaleDegree] = quality, letting
// decorateChordType filter style-driven candidates to those the
// chosen mode allows on that scale degree.
//
// The engine and dictionary use different vocabularies — engine type
// strings are explicit ('maj7', 'm7'), dictionary entries are
// Berklee-style ('Imaj7', 'V-7', 'bIII+maj7'). Both sides classify
// into ChordQuality and compare there.
// ------------------------------------------------------------------

