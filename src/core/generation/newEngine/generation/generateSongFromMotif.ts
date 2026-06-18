// ============================================================
// newEngine · generation · generateSongFromMotif(走 A 并行入口)
// ------------------------------------------------------------
// Q+R sandbox 的【权威 lead + 权威和声】喂进 Q+N 成曲生产链:Q+N 负责 arranger / instrumentation /
//   bass / comp / pad / drum / mix / render / audit/retry,但【和声】用 sandbox 的 HarmonicPlan、
//   【lead】用 sandbox 的 TrackIR(跳过 renderMgMelody)。
// ★ 边界:① 不改 generateSong(默认链字节不变,这是【并行】入口)② override 缺省 → 行为 == generateSong
//   ③ HarmonicPlan/lead override 走两个【additive 注入点】(generateSong 端镜像 + renderSongFull 端可选参数);
//   ④ retry 碰不到 override(harmonic 深冻、lead 不在 voicingSafer 范围)。
// 合同(MotifSongOverride)= MotifHarmonyOverride(harmony)+ MotifLeadOverride(lead);两者均可选。
//   PR1 scaffold:转换器(sandbox→HarmonicPlan / sandbox→lead TrackIR)留后续 PR,本入口先把【接缝】立住。
// ============================================================

import { beats, midi, createRandomContext, createTimebase, type Timebase } from '../foundation';
import { buildBandSpec, type GenerationRequest } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement, assemble, type ResolvedChord } from '../harmony/harmonyEngine';
import { renderSongFull } from '../render/renderCoordinator';
import type { HarmonicPlan, ChordSpan, HarmonicFunction } from '../harmony/HarmonicPlan';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import type { DiatonicMode } from '../knowledge/scales';
import type { PitchClass } from '../foundation';
import type { TrackIR, NoteIR } from '../ir/MusicalIR';
import { DEFAULT_BUDGET, type RetryBudget } from './RetryPolicy';
import { buildRetryLocator } from './retryMapping';
import { runGenerationControl, type GenerationResult, type RenderFn } from './GenerationController';

/** 权威 lead 音(beats 制,timebase-无关):Q+R 把 MotifNote[] 映射成它,generateSongFromMotif 用 Q+N
 *  timebase 转 tick。pitch 0..127、velocity 1..127、时间用拍。 */
export interface MotifLeadNote {
  pitch: number;
  onsetBeat: number;
  durationBeat: number;
  velocity: number;
}

/** 走 A 注入合同:sandbox 权威和声 + 权威 lead。两者均可选;缺省 → 退回 Q+N 默认生成(== generateSong)。 */
export interface MotifSongOverride {
  /** MotifHarmonyOverride:整曲权威和声(Q+R selectedProgression/RoadMap → HarmonicPlan)。下游 bass/comp/pad/drum/lead 自动跟随。 */
  harmony?: HarmonicPlan;
  /** MotifLeadOverride:整曲权威 lead(Q+R motif slot weaver,beats 制),内部转 TrackIR 跳过 renderMgMelody。 */
  lead?: readonly MotifLeadNote[];
  /** harmony 的调中心(把 16-bar sandbox 和声 tile 满 arrangement 长度后重装配用)。 */
  key?: { keyPc: number; mode: DiatonicMode };
}

const beatN = (b: unknown): number => b as unknown as number;

/** 某拍落在 arrangement 哪个段落(逐段累加 bars×beatsPerBar)。 */
function sectionIdAtBeat(arrangement: ArrangementPlan, beat: number, beatsPerBar: number): string {
  let acc = 0;
  for (const s of arrangement.sections) { const span = s.bars * beatsPerBar; if (beat < acc + span - 1e-6) return s.id; acc += span; }
  return arrangement.sections[arrangement.sections.length - 1].id;
}

/** ChordSpan → ResolvedChord(全字段透传;sectionId 改成 arrangement 段落)。 */
function chordSpanToResolved(span: ChordSpan, sectionId: string, func: HarmonicFunction): ResolvedChord {
  return {
    roman: span.roman, rootPc: span.rootPc, quality: span.quality, durationBeats: beatN(span.durationBeats),
    sectionId, func,
    chordType: span.chordType, borrowedSource: span.borrowedSource, mustResolve: span.mustResolve,
    forcedScale: span.forcedScale, localTonalCenterPc: span.localTonalCenterPc, bassRole: span.bassRole,
    bassPedalPc: span.bassPedalPc, tonicizationPlacement: span.tonicizationPlacement, borrowedFrom: span.borrowedFrom,
    effectiveFunc: span.effectiveFunc, analysisKeyPc: span.analysisKeyPc, localRoman: span.localRoman, widePianoVoicing: span.widePianoVoicing,
  };
}

/** 把 16-bar sandbox 和声【tile 满整个 arrangement 长度】+ 逐 span 改成对应段落 → 重装配。
 *  这样 bass/comp/pad/drum(按段落 gate)在全曲每段都吃得到和声,不再空轨/错位。 */
function fitHarmonyToArrangement(harmony: HarmonicPlan, key: { keyPc: number; mode: DiatonicMode }, arrangement: ArrangementPlan, beatsPerBar: number): HarmonicPlan {
  const totalBeats = arrangement.sections.reduce((n, s) => n + s.bars * beatsPerBar, 0);
  const src = harmony.chordTimeline;
  const resolved: ResolvedChord[] = [];
  let beat = 0, i = 0;
  while (beat < totalBeats - 1e-6 && resolved.length < 4096) {
    const k = i % src.length;
    const span = src[k];
    const dur = Math.min(beatN(span.durationBeats), totalBeats - beat); // 末尾截到曲尾
    const func = span.effectiveFunc ?? harmony.chordFunctionTimeline[k] ?? 'T';
    const rc = chordSpanToResolved(span, sectionIdAtBeat(arrangement, beat, beatsPerBar), func);
    rc.durationBeats = dur;
    resolved.push(rc);
    beat += dur;
    i++;
  }
  return assemble(resolved, (((key.keyPc % 12) + 12) % 12) as PitchClass, key.mode);
}

/** 把 16-bar sandbox lead 【tile 满整个曲长】(motif weave 自包含 → 像 verse 重复;末尾截齐)。 */
function fitLeadToBeats(lead: readonly MotifLeadNote[], totalBeats: number): MotifLeadNote[] {
  if (!lead.length) return [];
  const motifBeats = Math.max(...lead.map((n) => n.onsetBeat + n.durationBeat));
  if (motifBeats <= 1e-6) return [...lead];
  const out: MotifLeadNote[] = [];
  for (let base = 0; base < totalBeats - 1e-6; base += motifBeats) {
    for (const n of lead) {
      const on = base + n.onsetBeat;
      if (on >= totalBeats - 1e-6) continue;
      out.push({ ...n, onsetBeat: on, durationBeat: Math.min(n.durationBeat, totalBeats - on) });
    }
  }
  return out;
}

/** 权威 lead(beats)→ lead TrackIR(用 Q+N timebase 转 tick;钳音高/力度;onset 排序)。 */
function motifLeadToTrackIR(notes: readonly MotifLeadNote[], timebase: Timebase): TrackIR {
  const irNotes: NoteIR[] = [...notes]
    .filter((n) => n.durationBeat > 0)
    .sort((a, b) => a.onsetBeat - b.onsetBeat)
    .map((n) => ({
      pitch: midi(Math.max(0, Math.min(127, Math.round(n.pitch)))),
      startTick: timebase.beatToTick(beats(n.onsetBeat)),
      durationTicks: timebase.beatToTick(beats(Math.max(0.05, n.durationBeat))),
      velocity: Math.max(1, Math.min(127, Math.round(n.velocity))),
    }));
  return { role: 'lead', notes: irNotes };
}

/** 走 A 并行入口:Q+R 产物注入 Q+N 成曲生产链。override 缺省时行为与 generateSong 完全一致。 */
export function generateSongFromMotif(
  request: GenerationRequest,
  override: MotifSongOverride = {},
  budget: RetryBudget = DEFAULT_BUDGET,
): GenerationResult {
  const seedRng = createRandomContext(request.seed);
  const band = buildBandSpec(request);
  const arrangement = buildArrangementPlan(band, { rng: seedRng });
  const beatsPerBar = arrangement.meter.numerator;
  const totalBeats = arrangement.sections.reduce((n, s) => n + s.bars * beatsPerBar, 0);
  // 注入点 A:和声权威 = sandbox 提供则【tile 满 arrangement + 逐 span 改段落】再用;否则 Q+N 默认。
  const harmonic = override.harmony && override.key
    ? fitHarmonyToArrangement(override.harmony, override.key, arrangement, beatsPerBar)
    : (override.harmony ?? buildHarmonicPlanFromArrangement(band, arrangement, seedRng));
  const instrumentation = buildInstrumentationPlan(band, arrangement, seedRng.substream('timbre'), harmonic);
  const timebase = createTimebase({
    meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator },
    tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }],
  });

  // 注入点 B:权威 lead(beats)→ tile 满曲长 → TrackIR(本 timebase),经 renderSongFull 末参数透传(缺省 → MG 链)。
  const fittedLead = override.lead && override.lead.length ? fitLeadToBeats(override.lead, totalBeats) : undefined;
  const overrideLeadTrack = fittedLead && fittedLead.length ? motifLeadToTrackIR(fittedLead, timebase) : undefined;
  const render: RenderFn = (retry) =>
    renderSongFull(band, arrangement, harmonic, instrumentation, timebase, retry?.rng ?? seedRng,
      retry && { voicingSafer: retry.voicingSafer }, overrideLeadTrack);

  const locator = buildRetryLocator(harmonic, timebase);
  // 有 override 时:和声/lead 是用户权威,Q+N 尽力渲染 → 非 lead 的 error(pad/comp avoid 暴露等)降为 warning,
  //   只 fatal 阻断(否则 retry 改不动 pad/bass → 永远 failed)。无 override → 与 generateSong 同(严格)。
  const lenient = Boolean(override.harmony || (override.lead && override.lead.length));
  return runGenerationControl(render, seedRng, budget, locator, lenient);
}
