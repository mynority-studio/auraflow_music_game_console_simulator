// ============================================================
// newEngine · generation · generateSongFromMotif(走 A 并行入口)
// ------------------------------------------------------------
// Q+R / motif 输入喂进 Q+N 成曲生产链:Q+N 负责 arranger / instrumentation / bass / comp / pad /
//   drum / mix / render / audit/retry。legacy 路径仍支持权威 harmony/lead override;产品 Q+R 播放走
//   userBrick:生产 Functional RoadMap 先分配 authored ownership,MG/Q+N 只生成其余 lead 区间。
// ★ 边界:① 不改 generateSong(默认链字节不变,这是【并行】入口)② override 缺省 → 行为 == generateSong
//   ③ HarmonicPlan/lead override 走两个【additive 注入点】(generateSong 端镜像 + renderSongFull 端可选参数);
//   ④ retry 碰不到 override(harmonic 深冻、lead 不在 voicingSafer 范围)。
// 合同(MotifSongOverride)= MotifHarmonyOverride(harmony)+ MotifLeadOverride(lead)+ UserMotifBrick(userBrick);
//   三者均可选。缺省时行为与 generateSong 一致。
// ============================================================

import { beats, midi, createRandomContext, createTimebase, type Timebase } from '../foundation';
import { buildBandSpec, withBandMode, type GenerationRequest } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement, assemble, type ResolvedChord } from '../harmony/harmonyEngine';
import { renderSongFull } from '../render/renderCoordinator';
import type { UserMotifBrick } from '../render/userMotifBrick';
import { deriveMusicIntentPlan } from '../arranger/deriveMusicIntentPlan';
import type { HarmonicPlan, ChordSpan, HarmonicFunction } from '../harmony/HarmonicPlan';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import type { DiatonicMode } from '../knowledge/scales';
import type { PitchClass } from '../foundation';
import type { TrackIR, NoteIR } from '../ir/MusicalIR';
import { DEFAULT_BUDGET, type RetryBudget } from './RetryPolicy';
import { buildRetryLocator } from './retryMapping';
import { buildAcgPianoScoreForBundle, buildJazzFiveFourScoreForBundle, runGenerationControl, type GenerationResult, type RenderFn, type SongBundle } from './GenerationController';
import { sanitizeLeadNoteIR } from '../render/leadSanitizer';
import { swingFrac } from '../render/swing';
import { isInProtectedFastRun } from '../render/leadGridTiming';

/** 权威 lead 音(beats 制,timebase-无关):Q+R 把 MotifNote[] 映射成它,generateSongFromMotif 用 Q+N
 *  timebase 转 tick。pitch 0..127、velocity 1..127、时间用拍。 */
export interface MotifLeadNote {
  pitch: number;
  onsetBeat: number;
  durationBeat: number;
  velocity: number;
  accent?: number;
  structuralToneScore?: number;
}

/** Motif 注入合同。缺省 → 退回 Q+N 默认生成(== generateSong)。 */
export interface MotifSongOverride {
  /** MotifHarmonyOverride:整曲权威和声(Q+R selectedProgression/RoadMap → HarmonicPlan)。下游 bass/comp/pad/drum/lead 自动跟随。 */
  harmony?: HarmonicPlan;
  /** MotifLeadOverride:整曲权威 lead(Q+R motif slot weaver,beats 制),内部转 TrackIR 跳过 renderMgMelody。 */
  lead?: readonly MotifLeadNote[];
    /** User motif source; production Functional RoadMap fits it into one authored melodic brick. */
  userBrick?: UserMotifBrick;
  /** harmony 的调中心(把 16-bar sandbox 和声 tile 满 arrangement 长度后重装配用)。 */
  key?: { keyPc: number; mode: DiatonicMode };
}

const beatN = (b: unknown): number => b as unknown as number;

/** 某拍落在 arrangement 哪个段落，并返回该段的绝对结束拍。 */
function sectionSlotAtBeat(
  arrangement: ArrangementPlan,
  beat: number,
  beatsPerBar: number,
): { id: string; endBeat: number } {
  let acc = 0;
  for (const section of arrangement.sections) {
    const endBeat = acc + section.bars * beatsPerBar;
    if (beat < endBeat - 1e-6) return { id: section.id, endBeat };
    acc = endBeat;
  }
  return { id: arrangement.sections[arrangement.sections.length - 1].id, endBeat: acc };
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
  let sourceRemaining = src.length > 0 ? beatN(src[0].durationBeats) : 0;
  while (beat < totalBeats - 1e-6 && resolved.length < 4096) {
    const k = i % src.length;
    const span = src[k];
    if (sourceRemaining <= 1e-6) sourceRemaining = beatN(span.durationBeats);
    if (sourceRemaining <= 1e-6) { i++; continue; }
    const section = sectionSlotAtBeat(arrangement, beat, beatsPerBar);
    // 和弦可以跨 source tile，但不能跨 Arranger 段界；跨界时把同一和弦拆成两个 span，
    // 并在下一段续完余量，避免 role gate 读到错误的段落归属。
    const dur = Math.min(sourceRemaining, totalBeats - beat, section.endBeat - beat);
    const func = span.effectiveFunc ?? harmony.chordFunctionTimeline[k] ?? 'T';
    const rc = chordSpanToResolved(span, section.id, func);
    rc.durationBeats = dur;
    resolved.push(rc);
    beat += dur;
    sourceRemaining -= dur;
    if (sourceRemaining <= 1e-6) {
      i++;
      sourceRemaining = beat < totalBeats - 1e-6
        ? beatN(src[i % src.length].durationBeats)
        : 0;
    }
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

/** ★ 走 A 专属预摆动:override lead 是 sandbox 的【直拍网格 motif】;而 generateSong 默认 lead 来自 MG
 *  StyleRenderer(已自带单轨 swing,故 renderCoordinator 的全局 applySwing 跳过 lead)。若直接把直拍 motif 喂进
 *  去,整编里【旋律不摆动、压在摇摆的 comp/bass/drum 上】= 丢 jazz 感(试听层 buildLeadNotes 摆了、整编没摆,
 *  两者听感分叉的主因)。这里把 override lead 按 arrangement.feel.swingRatio 预摆动(对齐三轨同一摆动时间线),
 *  并保护快速 16 分/三连 run 笔直(jazz_16th_run_grid_owner)。预摆动后全局 applySwing 仍跳过 lead = 单次摆动、
 *  不双摆。只改 onset:不动 pitch/数量/时值(legato 仍在 timing 之后跑)。直拍风格(ratio≤0.5)原样返回。 */
function swingMotifLead(notes: readonly MotifLeadNote[], swingRatio: number, beatsPerBar: number): MotifLeadNote[] {
  if (swingRatio <= 0.5 + 1e-6) return [...notes];
  const sorted = [...notes].sort((a, b) => a.onsetBeat - b.onsetBeat);
  const events = sorted.map((n) => ({ time: n.onsetBeat, duration: n.durationBeat }));
  return sorted.map((n, i) => {
    if (isInProtectedFastRun(events, i, beatsPerBar)) return n; // 快速 run 内 onset 不摆(否则挤成 micro-IOI)
    const whole = Math.floor(n.onsetBeat);
    return { ...n, onsetBeat: whole + swingFrac(n.onsetBeat - whole, swingRatio) };
  });
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
  // ★ tick 域单声部清洗(directive Phase 4):走 A lead 进 Q+N 前消除同 pitch overlap(否则 noteOff 撞掉 noteOn)
  return { role: 'lead', notes: sanitizeLeadNoteIR(irNotes) };
}

/** Motif 并行入口:Q+R 产物注入 Q+N 成曲生产链。override 缺省时行为与 generateSong 完全一致。 */
/** ★ 共享 motif bundle(qn_main_engine_takeover §4.3):暴露 override 注入后的全部中间结构 + overrideLeadTrack/userBrick,
 *  供 generateSongFromMotif + 生产 service 的 motif uiSnapshot 复用(不复制平行生成逻辑)。 */
export interface MotifSongBundle { bundle: SongBundle; overrideLeadTrack?: TrackIR; userBrick?: UserMotifBrick; lenient: boolean; }

export function buildMotifSongBundle(request: GenerationRequest, override: MotifSongOverride = {}): MotifSongBundle {
  const seedRng = createRandomContext(request.seed);
  const motifResolvedRequest: GenerationRequest = override.key
    ? {
      ...request,
      key: (((override.key.keyPc % 12) + 12) % 12) as PitchClass,
      mode: override.key.mode,
    }
    : request;
  const requestedBand = buildBandSpec(motifResolvedRequest);
  const arrangement = buildArrangementPlan(requestedBand, {
    rng: seedRng,
    mood: motifResolvedRequest.mood,
    targetDuration: motifResolvedRequest.targetDuration,
    jazzArchetypeId: motifResolvedRequest.jazzArchetypeId,
  });
  const authoredMode = arrangement.resolvedArchetype?.tonalityMode;
  const band = motifResolvedRequest.mode === undefined && authoredMode
    ? withBandMode(requestedBand, authoredMode)
    : requestedBand;
  const beatsPerBar = arrangement.meter.numerator;
  const totalBeats = arrangement.sections.reduce((n, s) => n + s.bars * beatsPerBar, 0);
  // 注入点 A:和声权威 = sandbox 提供则【tile 满 arrangement + 逐 span 改段落】再用;否则 Q+N 默认。
  const harmonic = override.harmony && override.key
    ? fitHarmonyToArrangement(override.harmony, override.key, arrangement, beatsPerBar)
    : (override.harmony ?? buildHarmonicPlanFromArrangement(band, arrangement, seedRng));
  const instrumentation = buildInstrumentationPlan(band, arrangement, seedRng.substream('timbre'), harmonic, seedRng.substream('acgPianoVoice'));
  const acgPianoScorePlan = buildAcgPianoScoreForBundle({ band, arrangement, harmonic, instrumentation, seed: seedRng.seed });
  const jazzFiveFourScorePlan = buildJazzFiveFourScoreForBundle({
    band, arrangement, harmonic, instrumentation, seed: seedRng.seed,
  });
  const timebase = createTimebase({
    meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator },
    tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }],
  });
  // legacy 注入点 B:权威 lead(beats)→ tile 满曲长 →【预摆动】→ TrackIR(本 timebase),经 renderSongFull 透传。
  // 产品 Q+R 播放不走这里,而走 override.userBrick:render 先做 RoadMap ownership,MG/Q+N 不生成 owned span。
  const fittedLead = override.lead && override.lead.length ? fitLeadToBeats(override.lead, totalBeats) : undefined;
  const swungLead = fittedLead ? swingMotifLead(fittedLead, arrangement.feel.swingRatio, beatsPerBar) : undefined;
  const overrideLeadTrack = swungLead && swungLead.length ? motifLeadToTrackIR(swungLead, timebase) : undefined;
  const lenient = Boolean(override.harmony || (override.lead && override.lead.length));
  return { bundle: { band, arrangement, harmonic, instrumentation, acgPianoScorePlan, jazzFiveFourScorePlan, timebase, seedRng }, overrideLeadTrack, userBrick: override.userBrick, lenient };
}

/** motif bundle → FinalIR(render + 控制环)。供 generateSongFromMotif + service 复用(避免重复 build bundle)。 */
export function generateSongFromMotifBundle(mb: MotifSongBundle, budget: RetryBudget = DEFAULT_BUDGET): GenerationResult {
  const { bundle, overrideLeadTrack, userBrick, lenient } = mb;
  const { band, arrangement, harmonic, instrumentation, acgPianoScorePlan, jazzFiveFourScorePlan, timebase, seedRng } = bundle;
  const intentPlan = deriveMusicIntentPlan(band.style, arrangement); // ★ Phase 2:上游派生 intent(bass enforce)传入
  const render: RenderFn = (retry) =>
    renderSongFull(band, arrangement, harmonic, instrumentation, timebase, retry?.rng ?? seedRng,
      retry && { voicingSafer: retry.voicingSafer }, overrideLeadTrack, intentPlan, userBrick, acgPianoScorePlan, jazzFiveFourScorePlan);
  const locator = buildRetryLocator(harmonic, timebase);
  // 有 override 时:和声是用户权威 → 非 lead error 可降为 warning。若用户还直接提供整条
  // lead，则保留它原样和其 audit，不交给渲染层作事后音高修正；无 override 仍与 generateSong
  // 同样严格。fatal 永远阻断。
  return runGenerationControl(render, seedRng, budget, locator, lenient, Boolean(overrideLeadTrack));
}

export function generateSongFromMotif(
  request: GenerationRequest,
  override: MotifSongOverride = {},
  budget: RetryBudget = DEFAULT_BUDGET,
): GenerationResult {
  return generateSongFromMotifBundle(buildMotifSongBundle(request, override), budget);
}
