// ============================================================
// newEngine · render · ACG Modal Counterpoint Plan
// ------------------------------------------------------------
// ACG PIANOSONG 的旋律色彩不是让每个音随机换音阶，而是在已经存在的
// lead 上，安排少量「有和声支撑、能级进解决」的局部事件。
//
// 这个模块刻意保持纯函数；renderCoordinator 在 tail-resolve 后调用它：
//   1. plan… 只从 chord timeline + lead 找到合法事件与自然留白；
//   2. apply… 只替换已选 source note 的 pitch，绝不补音；
//   3. planAndApply… 方便 render 端在 tail-resolve 后、gap repair 前调用。
//
// seed 只用于在「已经完全合法」的候选中稳定选一个位置；它永不放宽
// 和声支撑、解决或每短语预算，因此不会制造随机离调。
// ============================================================

import { midi } from '../foundation';
import type { ChordSpan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import { chordTypeIntervals } from '../knowledge/chords';

export type AcgModalColorKind =
  | 'pentatonic-filter'
  | 'Dorian-6'
  | 'harmonic-7'
  | 'Phrygian-b2';

export type AcgModalHarmonicSupport =
  | 'pentatonic-chord-tone'
  | 'dorian-major-iv'
  | 'dominant-leading-tone'
  | 'phrygian-flat-ii';

/** 一个色彩事件所归属的和声／短语范围。tick 为普通 number，避免把计划数据绑死在 IR 品牌类型上。 */
export interface AcgModalEventRange {
  spanId: string;
  startTick: number;
  endTick: number;
  phraseIndex: number;
  barIndex: number;
}

/** 色彩音必须落到既有 lead 的下一枚音；模块不凭空插入解决音。 */
export interface AcgModalResolutionTarget {
  noteIndex: number;
  startTick: number;
  pitch: number;
  pc: number;
  direction: 'up' | 'down';
  semitones: 1 | 2;
}

/**
 * 计划中的单个旋律色彩动作。
 * sourceNoteIndex 指向 plan 构建时的 lead.notes 原始下标；apply 会再次核对
 * sourceStartTick/sourcePitch，避免把旧 plan 错用到另一条旋律上。
 */
export interface AcgModalColorEvent {
  kind: AcgModalColorKind;
  harmonicSupport: AcgModalHarmonicSupport;
  range: AcgModalEventRange;
  sourceNoteIndex: number;
  sourceStartTick: number;
  sourcePitch: number;
  targetPitch: number;
  colorPc: number;
  resolution: AcgModalResolutionTarget;
}

/**
 * 已存在的、受保护的自然留白。renderCoordinator 可把这些窗口交给
 * repairAcgLeadGaps，使其不把短语的有意呼吸又自动补满。
 */
export interface AcgProtectedRestWindow {
  startTick: number;
  endTick: number;
  phraseIndex: number;
  /** 完整包含于该窗口的 bar；空数组代表仅保护半小节／局部呼吸。 */
  barIndices: readonly number[];
  source: 'natural-silence' | 'caller';
}

export interface AcgProtectedRestWindowInput {
  startTick: number;
  endTick: number;
}

export interface AcgModalCounterpointPlan {
  seed: number | string;
  phraseBars: number;
  events: readonly AcgModalColorEvent[];
  protectedRestWindows: readonly AcgProtectedRestWindow[];
  /** protectedRestWindows 中完整的 bar，便于 bar-level policy 直接消费。 */
  plannedRestBars: readonly number[];
}

export interface PlanAcgModalCounterpointInput {
  seed: number | string;
  timeline: readonly ChordSpan[];
  lead: Pick<TrackIR, 'notes'>;
  /** chordTimeline 的 startBeat/durationBeats 转换为 tick 所需的 PPQ。 */
  ppq: number;
  /** 当前 meter 下一个 bar 的 tick 数。 */
  barTicks: number;
  /** 主调中心；ACG PIANOSONG 默认以 Aeolian 小调语义解释局部色彩。 */
  keyRootPc: number;
  /** 默认 4；可传 8 以获得更长的旋律句预算。 */
  phraseBars?: number;
  /** 调用方已经确定的留白也可传入，会与自动发现的自然静默合并。 */
  protectedRestWindows?: readonly AcgProtectedRestWindowInput[];
}

export interface PlanAndApplyAcgModalCounterpointResult {
  lead: TrackIR;
  plan: AcgModalCounterpointPlan;
}

interface PlannedSpan {
  span: ChordSpan;
  timelineIndex: number;
  startTick: number;
  endTick: number;
  barIndex: number;
  phraseIndex: number;
  pcs: Set<number>;
}

interface IndexedLeadNote {
  index: number;
  note: NoteIR;
  startTick: number;
  endTick: number;
  pitch: number;
}

interface Candidate {
  kind: AcgModalColorKind;
  harmonicSupport: AcgModalHarmonicSupport;
  range: AcgModalEventRange;
  source: IndexedLeadNote;
  resolution: IndexedLeadNote;
  targetPitch: number;
  colorPc: number;
}

const DEFAULT_PHRASE_BARS = 4;
const MIN_REST_TICKS_IN_BEATS = 1;
// 自动识别的自然呼吸最多保留一小节。更长的空档由 gap repair 在前半段补回，
// 否则“留白”会退化成主题段的空床；调用方显式给出的窗口不受此上限限制。
const MAX_NATURAL_REST_TICKS_IN_BEATS = 4;
const MAX_REWRITE_SEMITONES = 3;
const MAX_RESOLUTION_SEMITONES = 2;
const CADENCE_BARS = 2;

const pcOf = (value: number): number => ((Math.round(value) % 12) + 12) % 12;
const asNumber = (value: unknown): number => value as number;
const noteStart = (note: NoteIR): number => note.startTick as number;
const noteDuration = (note: NoteIR): number => note.durationTicks as number;
const notePitch = (note: NoteIR): number => note.pitch as number;

function validPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function wholePositive(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : fallback;
}

function spanStartTick(span: ChordSpan, ppq: number): number {
  return Math.max(0, Math.round(asNumber(span.startBeat) * ppq));
}

function spanEndTick(span: ChordSpan, ppq: number): number {
  return Math.max(spanStartTick(span, ppq), Math.round((asNumber(span.startBeat) + asNumber(span.durationBeats)) * ppq));
}

function chordTypeOf(span: ChordSpan): string {
  return span.chordType ?? span.quality;
}

function chordPcs(span: ChordSpan): Set<number> {
  const root = pcOf(asNumber(span.rootPc));
  return new Set(chordTypeIntervals(chordTypeOf(span)).map((interval) => pcOf(root + interval)));
}

function buildSpans(timeline: readonly ChordSpan[], ppq: number, barTicks: number, phraseBars: number): PlannedSpan[] {
  return timeline
    .map((span, timelineIndex) => {
      const startTick = spanStartTick(span, ppq);
      return {
        span,
        timelineIndex,
        startTick,
        endTick: spanEndTick(span, ppq),
        barIndex: Math.floor(startTick / barTicks),
        phraseIndex: Math.floor(Math.floor(startTick / barTicks) / phraseBars),
        pcs: chordPcs(span),
      };
    })
    .filter((entry) => entry.endTick > entry.startTick)
    .sort((a, b) => a.startTick - b.startTick || a.timelineIndex - b.timelineIndex);
}

function indexedNotes(notes: readonly NoteIR[]): IndexedLeadNote[] {
  return notes
    .map((note, index) => ({
      index,
      note,
      startTick: noteStart(note),
      endTick: noteStart(note) + Math.max(0, noteDuration(note)),
      pitch: notePitch(note),
    }))
    .filter((note) => note.endTick > note.startTick)
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch || a.index - b.index);
}

function spanAtTick(spans: readonly PlannedSpan[], tick: number): PlannedSpan | undefined {
  return spans.find((span) => tick >= span.startTick - 1 && tick < span.endTick - 1);
}

function nextMelodyNote(notes: readonly IndexedLeadNote[], sourcePosition: number): IndexedLeadNote | undefined {
  const source = notes[sourcePosition];
  for (let index = sourcePosition + 1; index < notes.length; index++) {
    const next = notes[index];
    if (next.startTick > source.startTick + 1) return next;
  }
  return undefined;
}

function labelOf(span: ChordSpan): string {
  return [span.borrowedFrom, span.borrowedSource, span.forcedScale, span.localRoman]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
}

function hasMajorThird(span: PlannedSpan): boolean {
  return span.pcs.has(pcOf(asNumber(span.span.rootPc) + 4));
}

function isDorianMajorIv(span: PlannedSpan, keyRootPc: number, dorianSixPc: number): boolean {
  const label = labelOf(span.span);
  return span.pcs.has(dorianSixPc)
    && ((pcOf(asNumber(span.span.rootPc)) === pcOf(keyRootPc + 5) && hasMajorThird(span)) || /dorian/.test(label));
}

function isDominantLeadingToneSpan(span: PlannedSpan, keyRootPc: number, leadingTonePc: number): boolean {
  const root = pcOf(asNumber(span.span.rootPc));
  const label = labelOf(span.span);
  return span.pcs.has(leadingTonePc)
    && (span.span.effectiveFunc === 'D'
      || root === pcOf(keyRootPc + 7)
      || /(^|\s|\/)vii?\b/i.test(label));
}

function isTonicSpan(span: PlannedSpan | undefined, keyRootPc: number): boolean {
  return span !== undefined && pcOf(asNumber(span.span.rootPc)) === pcOf(keyRootPc) && span.pcs.has(pcOf(keyRootPc));
}

function isPhrygianFlatIi(span: PlannedSpan, keyRootPc: number, flatTwoPc: number): boolean {
  const root = pcOf(asNumber(span.span.rootPc));
  const label = labelOf(span.span);
  return span.pcs.has(flatTwoPc)
    && ((root === flatTwoPc && hasMajorThird(span)) || /phrygian|bii/.test(label));
}

function isInProtectedRest(note: IndexedLeadNote, windows: readonly AcgProtectedRestWindow[]): boolean {
  return windows.some((window) => note.startTick < window.endTick && note.endTick > window.startTick);
}

function eventRange(span: PlannedSpan): AcgModalEventRange {
  return {
    spanId: span.span.id,
    startTick: span.startTick,
    endTick: span.endTick,
    phraseIndex: span.phraseIndex,
    barIndex: span.barIndex,
  };
}

/** 仅选位于 next note 两半音内、且不会把既有 lead 突变过远的目标 octave。 */
function targetPitchForStepResolution(
  colorPc: number,
  sourcePitch: number,
  resolutionPitch: number,
  direction?: 'up' | 'down',
): number | undefined {
  const options: number[] = [];
  for (const delta of [-2, -1, 1, 2]) {
    // delta 是「色彩音相对解决音」：要上行解决时色彩音必须在下方，反之亦然。
    if (direction === 'up' && delta >= 0) continue;
    if (direction === 'down' && delta <= 0) continue;
    const candidate = resolutionPitch + delta;
    if (candidate < 0 || candidate > 127 || pcOf(candidate) !== colorPc) continue;
    if (Math.abs(candidate - sourcePitch) > MAX_REWRITE_SEMITONES) continue;
    options.push(candidate);
  }
  return options.sort((a, b) => Math.abs(a - sourcePitch) - Math.abs(b - sourcePitch) || Math.abs(a - resolutionPitch) - Math.abs(b - resolutionPitch))[0];
}

function supportsResolution(nextSpan: PlannedSpan | undefined, resolution: IndexedLeadNote): boolean {
  return nextSpan !== undefined && nextSpan.pcs.has(pcOf(resolution.pitch));
}

function crossesChordBoundary(sourceSpan: PlannedSpan, nextSpan: PlannedSpan | undefined, resolution: IndexedLeadNote, ppq: number): boolean {
  if (!nextSpan || nextSpan.timelineIndex === sourceSpan.timelineIndex) return false;
  return resolution.startTick >= sourceSpan.endTick - Math.round(0.10 * ppq)
    && resolution.startTick <= nextSpan.startTick + ppq;
}

function sourceNearSpanEnd(source: IndexedLeadNote, span: PlannedSpan, ppq: number): boolean {
  return source.startTick >= span.endTick - Math.min(Math.round(1.5 * ppq), Math.max(1, span.endTick - span.startTick));
}

function phraseCadenceStartBar(phraseIndex: number, phraseBars: number): number {
  return (phraseIndex + 1) * phraseBars - CADENCE_BARS;
}

function candidateFrom(
  kind: AcgModalColorKind,
  harmonicSupport: AcgModalHarmonicSupport,
  span: PlannedSpan,
  source: IndexedLeadNote,
  resolution: IndexedLeadNote,
  colorPc: number,
  targetPitch: number | undefined,
): Candidate | undefined {
  if (targetPitch === undefined || targetPitch === source.pitch) return undefined;
  const semitones = Math.abs(resolution.pitch - targetPitch);
  if (semitones < 1 || semitones > MAX_RESOLUTION_SEMITONES) return undefined;
  return {
    kind,
    harmonicSupport,
    range: eventRange(span),
    source,
    resolution,
    targetPitch,
    colorPc,
  };
}

function dorianCandidates(
  spans: readonly PlannedSpan[],
  notes: readonly IndexedLeadNote[],
  keyRootPc: number,
  ppq: number,
  windows: readonly AcgProtectedRestWindow[],
): Candidate[] {
  const colorPc = pcOf(keyRootPc + 9); // Aeolian ♭6 → Dorian ♮6
  const out: Candidate[] = [];
  for (let i = 0; i < notes.length; i++) {
    const source = notes[i];
    if (isInProtectedRest(source, windows)) continue;
    const span = spanAtTick(spans, source.startTick);
    const resolution = nextMelodyNote(notes, i);
    if (!span || !resolution || !isDorianMajorIv(span, keyRootPc, colorPc) || !sourceNearSpanEnd(source, span, ppq)) continue;
    const nextSpan = spanAtTick(spans, resolution.startTick);
    if (!supportsResolution(nextSpan, resolution) || !crossesChordBoundary(span, nextSpan, resolution, ppq)) continue;
    const target = targetPitchForStepResolution(colorPc, source.pitch, resolution.pitch);
    const candidate = candidateFrom('Dorian-6', 'dorian-major-iv', span, source, resolution, colorPc, target);
    if (candidate) out.push(candidate);
  }
  return out;
}

function harmonicMinorCandidates(
  spans: readonly PlannedSpan[],
  notes: readonly IndexedLeadNote[],
  keyRootPc: number,
  ppq: number,
  phraseBars: number,
  windows: readonly AcgProtectedRestWindow[],
): Candidate[] {
  const colorPc = pcOf(keyRootPc + 11); // V → i 的 ♮7
  const out: Candidate[] = [];
  for (let i = 0; i < notes.length; i++) {
    const source = notes[i];
    if (isInProtectedRest(source, windows)) continue;
    const span = spanAtTick(spans, source.startTick);
    const resolution = nextMelodyNote(notes, i);
    if (!span || !resolution || !isDominantLeadingToneSpan(span, keyRootPc, colorPc) || !sourceNearSpanEnd(source, span, ppq)) continue;
    if (span.barIndex < phraseCadenceStartBar(span.phraseIndex, phraseBars)) continue;
    const nextSpan = spanAtTick(spans, resolution.startTick);
    if (!isTonicSpan(nextSpan, keyRootPc) || !supportsResolution(nextSpan, resolution) || !crossesChordBoundary(span, nextSpan, resolution, ppq)) continue;
    const target = targetPitchForStepResolution(colorPc, source.pitch, resolution.pitch, 'up');
    const candidate = candidateFrom('harmonic-7', 'dominant-leading-tone', span, source, resolution, colorPc, target);
    if (candidate) out.push(candidate);
  }
  return out;
}

function phrygianCandidates(
  spans: readonly PlannedSpan[],
  notes: readonly IndexedLeadNote[],
  keyRootPc: number,
  ppq: number,
  phraseBars: number,
  windows: readonly AcgProtectedRestWindow[],
): Candidate[] {
  const colorPc = pcOf(keyRootPc + 1); // ♭II → i 的阴影
  const out: Candidate[] = [];
  for (let i = 0; i < notes.length; i++) {
    const source = notes[i];
    if (isInProtectedRest(source, windows)) continue;
    const span = spanAtTick(spans, source.startTick);
    const resolution = nextMelodyNote(notes, i);
    if (!span || !resolution || !isPhrygianFlatIi(span, keyRootPc, colorPc) || !sourceNearSpanEnd(source, span, ppq)) continue;
    if (span.barIndex < phraseCadenceStartBar(span.phraseIndex, phraseBars)) continue;
    const nextSpan = spanAtTick(spans, resolution.startTick);
    if (!isTonicSpan(nextSpan, keyRootPc) || !supportsResolution(nextSpan, resolution) || !crossesChordBoundary(span, nextSpan, resolution, ppq)) continue;
    const target = targetPitchForStepResolution(colorPc, source.pitch, resolution.pitch, 'down');
    const candidate = candidateFrom('Phrygian-b2', 'phrygian-flat-ii', span, source, resolution, colorPc, target);
    if (candidate) out.push(candidate);
  }
  return out;
}

function pentatonicCandidates(
  spans: readonly PlannedSpan[],
  notes: readonly IndexedLeadNote[],
  keyRootPc: number,
  ppq: number,
  phraseBars: number,
  windows: readonly AcgProtectedRestWindow[],
): Candidate[] {
  // Aeolian 语境中的小调五声音阶：1, ♭3, 4, 5, ♭7。
  const pentatonicPcs = [0, 3, 5, 7, 10].map((interval) => pcOf(keyRootPc + interval));
  const out: Candidate[] = [];
  for (let i = 0; i < notes.length; i++) {
    const source = notes[i];
    if (isInProtectedRest(source, windows)) continue;
    const span = spanAtTick(spans, source.startTick);
    const resolution = nextMelodyNote(notes, i);
    if (!span || !resolution || span.barIndex >= phraseCadenceStartBar(span.phraseIndex, phraseBars)) continue;
    const nextSpan = spanAtTick(spans, resolution.startTick);
    if (!supportsResolution(nextSpan, resolution) || resolution.startTick - source.startTick > Math.round(2 * ppq)) continue;
    for (const colorPc of pentatonicPcs) {
      if (!span.pcs.has(colorPc)) continue;
      const target = targetPitchForStepResolution(colorPc, source.pitch, resolution.pitch);
      const candidate = candidateFrom('pentatonic-filter', 'pentatonic-chord-tone', span, source, resolution, colorPc, target);
      if (candidate) out.push(candidate);
    }
  }
  return out;
}

/** stable [0, 1)；不使用进程态 RNG，以保证同输入完全复现。 */
function stableUnit(seed: number | string, key: string): number {
  const input = `${String(seed)}|${key}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function candidateKey(candidate: Candidate): string {
  return `${candidate.kind}|${candidate.range.phraseIndex}|${candidate.range.spanId}|${candidate.source.index}|${candidate.resolution.index}|${candidate.targetPitch}`;
}

function selectCandidate(
  candidates: readonly Candidate[],
  seed: number | string,
  phraseIndex: number,
  kind: AcgModalColorKind,
  usedNotes: ReadonlySet<number>,
): Candidate | undefined {
  return candidates
    .filter((candidate) => candidate.range.phraseIndex === phraseIndex
      && !usedNotes.has(candidate.source.index)
      && !usedNotes.has(candidate.resolution.index))
    .sort((a, b) => stableUnit(seed, candidateKey(a)) - stableUnit(seed, candidateKey(b))
      || a.source.startTick - b.source.startTick
      || a.source.index - b.source.index)[0];
}

function candidateToEvent(candidate: Candidate): AcgModalColorEvent {
  const delta = candidate.resolution.pitch - candidate.targetPitch;
  return {
    kind: candidate.kind,
    harmonicSupport: candidate.harmonicSupport,
    range: candidate.range,
    sourceNoteIndex: candidate.source.index,
    sourceStartTick: candidate.source.startTick,
    sourcePitch: candidate.source.pitch,
    targetPitch: candidate.targetPitch,
    colorPc: candidate.colorPc,
    resolution: {
      noteIndex: candidate.resolution.index,
      startTick: candidate.resolution.startTick,
      pitch: candidate.resolution.pitch,
      pc: pcOf(candidate.resolution.pitch),
      direction: delta > 0 ? 'up' : 'down',
      semitones: Math.abs(delta) as 1 | 2,
    },
  };
}

function mergeIntervals(intervals: readonly { startTick: number; endTick: number }[]): Array<{ startTick: number; endTick: number }> {
  const sorted = intervals
    .filter((interval) => Number.isFinite(interval.startTick) && Number.isFinite(interval.endTick) && interval.endTick > interval.startTick)
    .map((interval) => ({ startTick: Math.max(0, Math.round(interval.startTick)), endTick: Math.max(0, Math.round(interval.endTick)) }))
    .sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick);
  const merged: Array<{ startTick: number; endTick: number }> = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && interval.startTick <= previous.endTick) previous.endTick = Math.max(previous.endTick, interval.endTick);
    else merged.push({ ...interval });
  }
  return merged;
}

function barsCoveredBy(startTick: number, endTick: number, barTicks: number): number[] {
  const out: number[] = [];
  const first = Math.ceil(startTick / barTicks);
  const lastExclusive = Math.floor(endTick / barTicks);
  for (let bar = first; bar < lastExclusive; bar++) out.push(bar);
  return out;
}

function deriveProtectedRestWindows(
  notes: readonly IndexedLeadNote[],
  songEndTick: number,
  barTicks: number,
  ppq: number,
  phraseBars: number,
  callerWindows: readonly AcgProtectedRestWindowInput[] | undefined,
): AcgProtectedRestWindow[] {
  const windows: AcgProtectedRestWindow[] = [];
  const append = (startTick: number, endTick: number, phraseIndex: number, source: AcgProtectedRestWindow['source']): void => {
    if (endTick - startTick < Math.round(MIN_REST_TICKS_IN_BEATS * ppq)) return;
    const duplicate = windows.some((window) => Math.abs(window.startTick - startTick) <= 1 && Math.abs(window.endTick - endTick) <= 1);
    if (duplicate) return;
    windows.push({ startTick, endTick, phraseIndex, barIndices: barsCoveredBy(startTick, endTick, barTicks), source });
  };

  for (const caller of callerWindows ?? []) {
    const startTick = Math.max(0, Math.round(caller.startTick));
    const endTick = Math.min(songEndTick, Math.round(caller.endTick));
    append(startTick, endTick, Math.floor(startTick / barTicks / phraseBars), 'caller');
  }

  const sounding = mergeIntervals(notes.map((note) => ({ startTick: note.startTick, endTick: note.endTick })));
  const gaps: Array<{ startTick: number; endTick: number }> = [];
  let cursor = 0;
  for (const interval of sounding) {
    if (interval.startTick > cursor) gaps.push({ startTick: cursor, endTick: Math.min(songEndTick, interval.startTick) });
    cursor = Math.max(cursor, interval.endTick);
  }
  if (cursor < songEndTick) gaps.push({ startTick: cursor, endTick: songEndTick });

  const phraseCount = Math.max(1, Math.ceil(songEndTick / barTicks / phraseBars));
  for (let phraseIndex = 0; phraseIndex < phraseCount; phraseIndex++) {
    const phraseStart = phraseIndex * phraseBars * barTicks;
    const phraseEnd = Math.min(songEndTick, phraseStart + phraseBars * barTicks);
    // 仅保护内部自然呼吸；曲首／曲尾本就不会被 repairAcgLeadGaps 填充。
    const candidates = gaps
      .map((gap) => ({ startTick: Math.max(gap.startTick, phraseStart), endTick: Math.min(gap.endTick, phraseEnd) }))
      .filter((gap) => gap.startTick > 0 && gap.endTick < songEndTick && gap.endTick - gap.startTick >= Math.round(MIN_REST_TICKS_IN_BEATS * ppq));
    if (candidates.length === 0) continue;
    // 末半句的静默优先，才更像句尾呼吸；同位置时取较长窗口。
    candidates.sort((a, b) => {
      const aLate = a.startTick >= phraseStart + (phraseEnd - phraseStart) * 0.35 ? 1 : 0;
      const bLate = b.startTick >= phraseStart + (phraseEnd - phraseStart) * 0.35 ? 1 : 0;
      return bLate - aLate || (b.endTick - b.startTick) - (a.endTick - a.startTick) || b.startTick - a.startTick;
    });
    const chosen = candidates[0];
    // 句尾优先：超长空档只保留最后一小节作 release，其余交还给 gap repair，
    // 让 1–2 分钟的抒情片段仍有前行感。
    const cappedStart = Math.max(
      chosen.startTick,
      chosen.endTick - Math.round(MAX_NATURAL_REST_TICKS_IN_BEATS * ppq),
    );
    append(cappedStart, chosen.endTick, phraseIndex, 'natural-silence');
  }

  return windows.sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick);
}

/** 是否和已计划的留白相交；gap-repair 可用它拒绝在此区间插入补音。 */
export function overlapsAcgProtectedRest(
  startTick: number,
  endTick: number,
  windows: readonly AcgProtectedRestWindow[],
): boolean {
  const effectiveEnd = Math.max(startTick + 1, endTick);
  return windows.some((window) => startTick < window.endTick && effectiveEnd > window.startTick);
}

/**
 * 仅规划：一短语至多一个 Dorian-6 或 Phrygian-b2（后者只作句尾替代），
 * 至多一个 harmonic-7；若没有 modal event，才可有一个 pentatonic-filter。
 */
export function planAcgModalCounterpoint(input: PlanAcgModalCounterpointInput): AcgModalCounterpointPlan {
  const ppq = validPositive(input.ppq, 480);
  const barTicks = validPositive(input.barTicks, ppq * 4);
  const phraseBars = wholePositive(input.phraseBars, DEFAULT_PHRASE_BARS);
  const keyRootPc = pcOf(input.keyRootPc);
  const spans = buildSpans(input.timeline, ppq, barTicks, phraseBars);
  const notes = indexedNotes(input.lead.notes);
  const songEndTick = Math.max(
    barTicks,
    ...spans.map((span) => span.endTick),
    ...notes.map((note) => note.endTick),
  );
  const protectedRestWindows = deriveProtectedRestWindows(notes, songEndTick, barTicks, ppq, phraseBars, input.protectedRestWindows);
  const plannedRestBars = [...new Set(protectedRestWindows.flatMap((window) => window.barIndices))].sort((a, b) => a - b);

  if (spans.length === 0 || notes.length < 2) {
    return { seed: input.seed, phraseBars, events: [], protectedRestWindows, plannedRestBars };
  }

  const dorian = dorianCandidates(spans, notes, keyRootPc, ppq, protectedRestWindows);
  const harmonic = harmonicMinorCandidates(spans, notes, keyRootPc, ppq, phraseBars, protectedRestWindows);
  const phrygian = phrygianCandidates(spans, notes, keyRootPc, ppq, phraseBars, protectedRestWindows);
  const pentatonic = pentatonicCandidates(spans, notes, keyRootPc, ppq, phraseBars, protectedRestWindows);
  const phraseCount = Math.max(1, Math.ceil(songEndTick / barTicks / phraseBars));
  const events: AcgModalColorEvent[] = [];
  const usedNotes = new Set<number>();
  let lastDorianPhrase = -Infinity;

  for (let phraseIndex = 0; phraseIndex < phraseCount; phraseIndex++) {
    // 先定功能终止：Harmonic-7 与 Phrygian-b2 都是到 i 的句尾动作，不能叠在同一解决位。
    const harmonicEvent = selectCandidate(harmonic, input.seed, phraseIndex, 'harmonic-7', usedNotes);
    if (harmonicEvent) {
      events.push(candidateToEvent(harmonicEvent));
      usedNotes.add(harmonicEvent.source.index);
      usedNotes.add(harmonicEvent.resolution.index);
    }
    const phrygianEvent = harmonicEvent
      ? undefined
      : selectCandidate(phrygian, input.seed, phraseIndex, 'Phrygian-b2', usedNotes);
    if (phrygianEvent) {
      events.push(candidateToEvent(phrygianEvent));
      usedNotes.add(phrygianEvent.source.index);
      usedNotes.add(phrygianEvent.resolution.index);
    }

    // Dorian 亮色至少隔一个短语，避免每一个 IV 都被固定染色。
    const modalEvent = !phrygianEvent && phraseIndex - lastDorianPhrase >= 2
      ? selectCandidate(dorian, input.seed, phraseIndex, 'Dorian-6', usedNotes)
      : undefined;
    if (modalEvent) {
      events.push(candidateToEvent(modalEvent));
      usedNotes.add(modalEvent.source.index);
      usedNotes.add(modalEvent.resolution.index);
      lastDorianPhrase = phraseIndex;
    }

    // 五声性是底色筛选，不与同短语的 Dorian/Phrygian 叠加；可与干净的属终止并存。
    if (!modalEvent && !phrygianEvent) {
      const pentatonicEvent = selectCandidate(pentatonic, input.seed, phraseIndex, 'pentatonic-filter', usedNotes);
      if (pentatonicEvent) {
        events.push(candidateToEvent(pentatonicEvent));
        usedNotes.add(pentatonicEvent.source.index);
        usedNotes.add(pentatonicEvent.resolution.index);
      }
    }
  }

  return {
    seed: input.seed,
    phraseBars,
    events: events.sort((a, b) => a.sourceStartTick - b.sourceStartTick || a.sourceNoteIndex - b.sourceNoteIndex),
    protectedRestWindows,
    plannedRestBars,
  };
}

/**
 * 应用计划：仅改 plan 明确指定的 source note pitch；不插音、不删音，也不改变时值。
 * 因此 protectedRestWindows 在应用前后仍然是有效的 gap-repair 禁区。
 */
export function applyAcgModalCounterpointPlan(lead: TrackIR, plan: AcgModalCounterpointPlan): TrackIR {
  if (plan.events.length === 0) return lead;
  const replacements = new Map<number, AcgModalColorEvent>();
  for (const event of plan.events) {
    if (!overlapsAcgProtectedRest(event.sourceStartTick, event.sourceStartTick + 1, plan.protectedRestWindows)) {
      replacements.set(event.sourceNoteIndex, event);
    }
  }
  if (replacements.size === 0) return lead;
  const notes = lead.notes.map((note, index) => {
    const event = replacements.get(index);
    if (!event) return note;
    // 防旧 plan 接错 lead：任何一个身份字段不同都 fail closed。
    if (noteStart(note) !== event.sourceStartTick || notePitch(note) !== event.sourcePitch) return note;
    return { ...note, pitch: midi(event.targetPitch) };
  });
  return { ...lead, notes };
}

/** renderCoordinator 的便利入口：tail resolve 后调用，再把 plan 的 rest windows 交给 gap repair。 */
export function planAndApplyAcgModalCounterpoint(input: PlanAcgModalCounterpointInput & { lead: TrackIR }): PlanAndApplyAcgModalCounterpointResult {
  const plan = planAcgModalCounterpoint(input);
  return { plan, lead: applyAcgModalCounterpointPlan(input.lead, plan) };
}
