// ============================================================
// newEngine · render · MgLeadRenderer(MG strict 移植 Loop 7 — coordinator swap)
// ------------------------------------------------------------
// 生产 lead:把【我们的 HarmonicPlan】喂 MG 旋律全链(decision B:MG 旋律喂我们和弦),
// 产出单轨 lead TrackIR。外层 renderCoordinator 的多轨层(mix/ducking/density 弧)原样包住
// (decision 1:多轨保我们的)。lead 内部用 MG enriched 语法 + 单轨手感(StyleRenderer)+ shapeMelodyHarmony
// (decision C:塑形全量接收 MG)。确定性:seed 取自 RandomContext 'melody' 子流。
//
// ⚠️ repeatGroup:MG 链按【整曲】单次 RNG 扫描生成 → verse2(同和弦)旋律 ≠ verse1
//   (不再守 newEngine 旧的 verse1≡verse2 记忆点不变量)。这是 MG-faithful 行为;
//   多轨伴奏仍守 repeatGroup。若要 lead 也重复一致,是后续增强(按 repeatGroup 分组重放)。
// ============================================================

import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { BandSpec } from '../band/BandSpec';
import type { Timebase } from '../foundation';
import { midi, beats } from '../foundation';
import type { TrackIR, NoteIR } from '../ir/MusicalIR';
import { connectFastLeadNoteIR, fastLeadLegatoOptionsForStyle } from './leadArticulation';

import { harmonicPlanToMgChordDefs } from './mgChordDefAdapter';
import { buildChordPart } from './mgChordPart';
// ★ MG full-parity Phase B(2026-06-28):生产 RoadMap 真源 = 当前 MG style-aware functional RoadMap(554-brick catalog DP),
//   取代旧 parseRoadMap(无 style)。旧 parseRoadMap 留作 legacy 测试用,不再进生产。
import { parseFunctionalRoadMap } from './mgFunctionalRoadMap';
import type { RoadMap } from './mgRoadMapParser';
import { expandGrammarForBrick, expandGrammarForRoadMap } from './mgGrammarRuntime';
import { expandGrammarForBrickMatchingRhythm } from './mgRhythmShapeMatcher';
import { applyScheduledLeadSilence, applyTerminalCadence, ensureScheduledLeadEntries, reserveScheduledTokensForAuthoredSpans, scheduleBrickExpansions } from './mgTokenScheduler';
import { planAcgLeadAfterglowHolds, scheduleAcgCycleCadencePhrases } from './mgAcgCycleScheduler';
import { scheduleLofiLeadScoreTokens } from './mgLofiLeadScoreScheduler';
import type { AcgLeadPresencePlan } from './acgLeadPresencePlan';
import type { AcgPianoScorePlan } from '../arranger/acgPianoScorePlan';
import {
  acgPianoRestIntentsFromAfterglow,
  compileAcgPianoPedalScore,
  type AcgPianoPedalAttackIntent,
  type AcgPianoPedalScore,
} from '../arranger/acgPianoPedalScore';
import type { LofiPhraseInteractionPlan } from '../arranger/ArrangementPlan';
import type { LofiLeadScorePlan } from '../arranger/lofiLeadScorePlan';
import { acgDynamicsNoteKey, type AcgDynamicsTaggedTrack } from './acgDynamics';
import { fallbackTokensForBrick } from './mgAdvisor';
import { realizeTokens, type MgNoteEvent } from './mgMelodyRealizer';
import { buildGuideTonePlan } from './mgGuideTonePlanner';
import { renderStyleFeel, feelForStyle, feelFromGrooveContract, type ImprovisorStyleFeel } from './mgStyleRenderer';
import { fitMidiToProgramRange, playableRangeForRole } from '../knowledge/instruments';
import {
  shapeMelodyHarmony,
  // ★ Phase C-2(directive 3.4):post-shaper 生产链(shapeMelodyHarmony 之后的最终 lead 整形)。
  enforceMonophonicMelody, applyMelodyBoundaryVoiceLeadingContract, extendMelodyTailHolds, finalizeMelodyBoundaryVoiceLeading,
} from './mgMelodyShaper';
import {
  ENRICHED_GRAMMAR,
  JAZZ_SAX_DEXTER_GORDON_GRAMMAR,
  POP_ENRICHED_GRAMMAR,
  LOFI_ENRICHED_GRAMMAR,
  ACG_PIANOSONG_GRAMMAR,
  ACG_PIANOSONG_INTERNAL_GRAMMARS,
  acgPianoSongGrammarForContext,
  RNB_ENRICHED_GRAMMAR,
} from '../knowledge/melodyStyleGrammarProfiles';
import { makeSeededRng } from './mgRng';
import { authoredLeadSpans, type AuthoredUserMotifBrickPlan } from './userMotifBrick';
import { createUserMotifGrammarInjector } from './userMotifGrammar';
import { applyWindLeadFeel, isWindLeadProgram } from './windFeel';
import { compileLofiPhraseLead } from './lofiPhraseLeadCompiler';
import { lofiLeadGrammarForRole, type LofiLeadGrammarRole } from '../knowledge/lofiLeadGrammarBank';
import type { AbstractMelodyToken } from '../knowledge/melodyGrammarTypes';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
type MgStyle = 'POP' | 'JAZZ' | 'BLUES' | 'RNB' | 'LOFI' | 'ACG';
type LeadGrooveContract = {
  id?: string;
  style: string;
  melodySwingRatio: number;
  articulation: ImprovisorStyleFeel['articulation'];
  accentPattern: readonly number[];
  pushProbability?: number;
};

/**
 * 在旋律仍是 grammar/realizer 事件时选择最近的等音级八度。
 * 只处理超过八度的意外寄存器跳变，不改 pitch class、节奏、力度或音符数量；
 * JAZZ/BLUES 保留其有意的大跳，ACG 由独立 soprano realizer 负责。
 */
export function placeMelodyOctaveContinuously(events: readonly MgNoteEvent[], style: MgStyle): MgNoteEvent[] {
  if (style === 'JAZZ' || style === 'BLUES' || style === 'ACG') return [...events];
  const out: MgNoteEvent[] = [];
  let previousPitch: number | null = null;
  for (const event of events) {
    let pitch = event.noteNumber;
    if (previousPitch !== null && Math.abs(pitch - previousPitch) > 12) {
      const candidates: number[] = [];
      for (let octave = -4; octave <= 4; octave++) {
        const candidate = pitch + octave * 12;
        if (candidate >= 36 && candidate <= 96) candidates.push(candidate);
      }
      const closer = candidates
        .sort((a, b) => Math.abs(a - previousPitch!) - Math.abs(b - previousPitch!) || Math.abs(a - pitch) - Math.abs(b - pitch))[0];
      if (closer !== undefined && Math.abs(closer - previousPitch) <= 12) pitch = closer;
    }
    out.push(pitch === event.noteNumber ? event : { ...event, noteNumber: pitch });
    previousPitch = pitch;
  }
  return out;
}

/** band.style(任意大小写)→ MG StyleName。未知 → JAZZ(base enriched,无专属 paradigm)。 */
function toMgStyle(style: string): MgStyle {
  const s = style.toUpperCase();
  return (s === 'POP' || s === 'LOFI' || s === 'RNB' || s === 'JAZZ' || s === 'BLUES' || s === 'ACG') ? s : 'JAZZ';
}

/** Build the exact production Functional RoadMap consumed by MG lead generation. */
export function buildMgLeadRoadMap(
  plan: HarmonicPlan,
  band: BandSpec,
  timebase: Timebase,
  acgPianoScorePlan?: AcgPianoScorePlan,
  lofiLeadScorePlan?: LofiLeadScorePlan,
): RoadMap {
  if (band.style.toLowerCase() === 'acg' && acgPianoScorePlan?.roadMap) return acgPianoScorePlan.roadMap;
  if (band.style.toLowerCase() === 'lofi' && lofiLeadScorePlan?.roadMap) {
    return materializeLofiScoreRoadMap(lofiLeadScorePlan.roadMap);
  }
  const chords = harmonicPlanToMgChordDefs(plan);
  const part = buildChordPart(chords, [timebase.meter.numerator, timebase.meter.denominator]);
  const songKeyPc = ((band.key as number) % 12 + 12) % 12;
  return parseFunctionalRoadMap({ part, songKeyPc, style: toMgStyle(band.style) });
}

function isSaxLeadProgram(program?: number): boolean {
  return program !== undefined && program >= 64 && program <= 67;
}

export function leadGrammarLabelForStyle(style: string, leadProgram?: number): string {
  const s = toMgStyle(style);
  if ((s === 'JAZZ' || s === 'BLUES') && isSaxLeadProgram(leadProgram)) {
    return 'JAZZ_SAX_DEXTER_GORDON_GRAMMAR';
  }
  return s === 'ACG' ? 'ACG_PIANOSONG_GRAMMAR'
    : s === 'LOFI' ? 'LOFI_ENRICHED_GRAMMAR'
    : s === 'POP' ? 'POP_ENRICHED_GRAMMAR'
    : s === 'RNB' ? 'RNB_ENRICHED_GRAMMAR'
    : 'ENRICHED_GRAMMAR';
}

function grammarForStyle(s: MgStyle, leadProgram?: number) {
  if ((s === 'JAZZ' || s === 'BLUES') && isSaxLeadProgram(leadProgram)) {
    return JAZZ_SAX_DEXTER_GORDON_GRAMMAR;
  }
  // ACG PIANOSONG 的入口独立：长句基础 grammar + ACG return-brick scheduler 共同构成
  // 主链，而不是由后处理去补旋律空档。
  return s === 'ACG' ? ACG_PIANOSONG_GRAMMAR
    : s === 'LOFI' ? LOFI_ENRICHED_GRAMMAR
    : s === 'POP' ? POP_ENRICHED_GRAMMAR
    : s === 'RNB' ? RNB_ENRICHED_GRAMMAR
    : ENRICHED_GRAMMAR;
}

/** A score-owned rest is a grammar result, never an empty expansion fallback. */
function lofiScoreRestTokens(durationBeats: number): AbstractMelodyToken[] {
  return [{ kind: 'R', duration: Math.max(0, durationBeats) }];
}

/**
 * The bundle deliberately deep-freezes its arranger score. Grammar/runtime
 * APIs still use mutable RoadMap arrays, so detach a small snapshot here
 * rather than weakening score ownership with casts.
 */
function materializeLofiScoreRoadMap(
  source: NonNullable<LofiLeadScorePlan['roadMap']>,
): RoadMap {
  return {
    bricks: source.bricks.map((brick) => ({
      name: brick.name,
      family: brick.family,
      startBeat: brick.startBeat,
      durationBeats: brick.durationBeats,
      chordIndices: [...brick.chordIndices],
      ...(brick.keyPc === undefined ? {} : { keyPc: brick.keyPc }),
      cost: brick.cost,
    })),
    totalCost: source.totalCost,
    segments: source.segments.map((segment) => ({ ...segment })),
  };
}

function lofiGrammarRoleForScoreBrick(
  scorePlan: LofiLeadScorePlan,
  brick: RoadMap['bricks'][number],
): LofiLeadGrammarRole | undefined {
  const brickEnd = brick.startBeat + brick.durationBeats;
  const slot = scorePlan.slots
    .filter((candidate) => candidate.role !== 'rest'
      && candidate.startBeat < brickEnd - 1e-4
      && candidate.endBeat > brick.startBeat + 1e-4)
    .sort((left, right) => {
      const leftStartsHere = left.startBeat <= brick.startBeat + 1e-4 ? 0 : 1;
      const rightStartsHere = right.startBeat <= brick.startBeat + 1e-4 ? 0 : 1;
      return leftStartsHere - rightStartsHere
        || left.startBeat - right.startBeat
        || left.id.localeCompare(right.id);
    })[0];
  if (!slot) return undefined;
  switch (slot.role) {
    case 'statement-carrier': return 'statement-carrier';
    case 'answer-riff': return 'answer-riff';
    case 'return-hold': return 'return-hold';
    case 'rest': return undefined;
  }
}

function applyArrangerLeadSilence(
  events: readonly MgNoteEvent[],
  windows: readonly { startBeat: number; endBeat: number }[],
): MgNoteEvent[] {
  if (windows.length === 0) return [...events];
  return events.filter((event) => {
    if (event.part !== 'melody' || event.duration <= 0) return true;
    return !windows.some((window) =>
      event.time >= window.startBeat - 1e-6
      && event.time < window.endBeat - 1e-6);
  });
}

/** 生产 lead:HarmonicPlan → MG 全链 → lead TrackIR。
 *  ★ Loop 1(2026-06-09,strict parity):MG seed = 【song seed 直通】(makeSeededRng(songSeed)),
 *    不再经 RandomContext 的 melody 子流 int() 派生 → 与 MG oracle 同 seed 同旋律(事件级可比)。
 *    newEngine 其它模块(伴奏/人性化/器配)仍用 RandomContext 子流。 */
/** Extra ACG performance intent produced before TrackIR exists. */
export interface MgLeadPerformanceResult {
  track: TrackIR;
  /** Complete pre-NoteIR damper score shared by ACG BASS/COMP/LEAD. */
  acgPianoPedalScore?: AcgPianoPedalScore;
}

/**
 * Optional read-only audit seam. The production renderer writes a detached
 * snapshot after score-time grammar, phrase and local-harmony compilation but
 * before NoteIR exists. Nothing downstream reads this object, so enabling an
 * audit cannot change the generated score or consume another random number.
 */
export interface MgLeadDebugCapture {
  grammarEvents?: MgNoteEvent[];
}

/**
 * Production lead plus the small amount of score-time ACG performance intent
 * that cannot be represented by a lead NoteIR alone.  Existing callers that
 * need only a track should use `renderMgMelody` below.
 */
export function renderMgMelodyWithAcgPerformancePlan(
  plan: HarmonicPlan,
  band: BandSpec,
  timebase: Timebase,
  songSeed: number,
  leadProgram?: number, // ★ 2026-06-10:器配生效 lead program(单一真源);缺省回退 band.roleProgram(测试/向后兼容)
  grooveContract?: LeadGrooveContract, // ★ lead feel 真源(Phase D:全风格真消费;缺省=无 contract 时 feelForStyle 兜底)
  /** ACG only: arrangement-owned top-line rests/entries, consumed before NoteIR exists. */
  acgLeadPresencePlan?: AcgLeadPresencePlan,
  /** ACG only: post-harmony phrase score. It overlays interpretation, never RoadMap facts. */
  acgPianoScorePlan?: AcgPianoScorePlan,
  /** Optional section overrides; absent keeps the legacy one-contract song path. */
  grooveContractBySection?: Readonly<Record<string, LeadGrooveContract>>,
  /** Arranger/Instrumentation-authored writing range; only supplied by locked ensembles. */
  leadRegister?: { lowMidi: number; highMidi: number },
  /** Optional precomputed production RoadMap; motif generation passes this exact shared instance. */
  roadMapOverride?: RoadMap,
  /** User-authored ownership already fitted to the shared production RoadMap. */
  authoredUserMotifPlan?: AuthoredUserMotifBrickPlan,
  /** Tempo converts the research-backed afterglow seconds into musical beats. */
  tempoBpm?: number,
  /** LOFI only: Arranger-authored breathing windows, consumed as rest tokens. */
  leadSilenceWindows?: readonly { startBeat: number; endBeat: number }[],
  /** LOFI only: required response entries for Arranger-active bars. */
  leadEntryBeats?: readonly number[],
  /** Diagnostics only: captures the final score-time grammar layer before NoteIR. */
  debugCapture?: MgLeadDebugCapture,
  /** LOFI only: shared phrase arc, motif and ensemble-role score. */
  lofiPhraseInteractionPlan?: Readonly<LofiPhraseInteractionPlan>,
  /** LOFI only: immutable post-harmony score; bypasses legacy phrase rewriting. */
  lofiLeadScorePlan?: LofiLeadScorePlan,
): MgLeadPerformanceResult {
  const program = leadProgram ?? band.roleProgram.lead;
  const chords = harmonicPlanToMgChordDefs(plan);
  if (chords.length === 0) return {
    track: { role: 'lead', notes: [], program },
    acgPianoPedalScore: undefined,
  };

  const seed = songSeed; // MG seed = song seed 直通(strict parity)
  const style = toMgStyle(band.style);
  const isScoreOwnedLofiLead = style === 'LOFI' && lofiLeadScorePlan !== undefined;
  const songKeyPc = ((band.key as number) % 12 + 12) % 12;
  const musicKey = NOTE_NAMES[songKeyPc];
  // 模式名:modal regime 用具体教会调式(首字母大写);否则 major→Ionian / minor→Aeolian。
  const cap = (m: string) => m.charAt(0).toUpperCase() + m.slice(1);
  const musicMode = band.modalModeName ? cap(band.modalModeName) : (band.mode === 'minor' ? 'Aeolian' : 'Ionian');
  const tonalCharacter: 'tonal' | 'modal' = band.tonalityKind === 'modal' ? 'modal' : 'tonal';
  const meter: [number, number] = [timebase.meter.numerator, timebase.meter.denominator];

  // ── MG 链(镜像 generateImprovisorMelody stage 1-5 + 生产 shapeMelodyHarmony)──
  const mgRng = makeSeededRng(seed);
  const part = buildChordPart(chords, meter);
  // ★ Phase B:style-aware functional RoadMap(当前 MG 真源,554-brick catalog DP cover)。
  const roadMap = isScoreOwnedLofiLead && lofiLeadScorePlan?.roadMap
    ? materializeLofiScoreRoadMap(lofiLeadScorePlan.roadMap)
    : roadMapOverride ?? (style === 'ACG' && acgPianoScorePlan?.roadMap
      ? acgPianoScorePlan.roadMap
      : parseFunctionalRoadMap({ part, songKeyPc, style }));
  // 四期(用户裁决 §0.5):有用户 motif 时,风格语法先注入 motif 衍生规则(模进/渐变词汇),
  // 再配合节奏重掷 → 生成材料全曲反复"说"动机形状,不再只是插播引用。
  const injectUserMotifGrammar = createUserMotifGrammarInjector(authoredUserMotifPlan, style);
  const expandForRhythmIdentity = (
    grammar: Parameters<typeof expandGrammarForBrick>[0],
    brick: RoadMap['bricks'][number],
  ) => authoredUserMotifPlan
    ? expandGrammarForBrickMatchingRhythm({
      grammar: injectUserMotifGrammar(grammar),
      brick,
      rng: mgRng,
      target: authoredUserMotifPlan.rhythmShapeProfile,
      attempts: 8,
    }).tokens
    : expandGrammarForBrick(grammar, { brick, rng: mgRng });
  // ACG PIANOSONG has hidden grammar banks (intro breath / theme / lift /
  // modal color / return), selected from RoadMap context only.  They are not
  // UI styles and still use the same seeded grammar runtime and token chain.
  const perBrick = style === 'ACG'
    ? roadMap.bricks.map((brick, brickIndex) => {
      const phrase = Object.values(acgPianoScorePlan?.phraseById ?? {}).find((candidate) =>
        brick.startBeat >= candidate.startBeat - 1e-4 && brick.startBeat < candidate.endBeat - 1e-4,
      );
      const grammar = phrase
        ? ACG_PIANOSONG_INTERNAL_GRAMMARS[phrase.lead.grammarSubset]
        : acgPianoSongGrammarForContext({
          startBeat: brick.startBeat,
          durationBeats: brick.durationBeats,
          family: brick.family,
          name: brick.name,
        });
      return { brickIndex, brick, tokens: expandForRhythmIdentity(grammar, brick) };
    })
    : isScoreOwnedLofiLead
      ? roadMap.bricks.map((brick, brickIndex) => {
        if ((lofiLeadScorePlan?.events?.length ?? 0) > 0) {
          // Arranger RoadMap bricks have already resolved an existing LOFI
          // grammar texture into exact score events. Do not expand a second,
          // renderer-owned lick over that authored result.
          return {
            brickIndex,
            brick,
            tokens: lofiScoreRestTokens(brick.durationBeats),
          };
        }
        const role = lofiGrammarRoleForScoreBrick(lofiLeadScorePlan!, brick);
        const grammar = role
          ? lofiLeadGrammarForRole(role, LOFI_ENRICHED_GRAMMAR, {
            family: brick.family,
            name: brick.name,
            durationBeats: brick.durationBeats,
          })
          : undefined;
        return {
          brickIndex,
          brick,
          // An empty score bank is a deliberate release. Do not fall through
          // to fallbackTokensForBrick and resurrect an unplanned lick.
          tokens: grammar ? expandForRhythmIdentity(grammar, brick) : lofiScoreRestTokens(brick.durationBeats),
        };
      })
    : authoredUserMotifPlan
      ? roadMap.bricks.map((brick, brickIndex) => ({
        brickIndex,
        brick,
        tokens: expandForRhythmIdentity(grammarForStyle(style, program), brick),
      }))
      : expandGrammarForRoadMap(
        grammarForStyle(style, program),
        roadMap.bricks,
        mgRng,
      );
  for (let i = 0; i < perBrick.length; i++) {
    if (perBrick[i].tokens.length === 0) {
      perBrick[i].tokens = isScoreOwnedLofiLead
        ? lofiScoreRestTokens(perBrick[i].brick.durationBeats)
        : fallbackTokensForBrick(perBrick[i].brick);
    }
  }
  // ★ MG full-parity G4:ACG 走 cycle-cadence 调度(一条长句铺满和声 cycle,钢琴呼吸),非 brick-by-brick lick chain。
  const arrangerSectionBoundaries = plan.chordTimeline
    .filter((span, index, timeline) => index > 0 && span.sectionId !== timeline[index - 1].sectionId)
    .map(span => span.startBeat as number);
  const generatedSchedule = style === 'ACG'
    ? scheduleAcgCycleCadencePhrases(perBrick, part, { leadPresencePlan: acgLeadPresencePlan, pianoScorePlan: acgPianoScorePlan })
    : scheduleBrickExpansions(perBrick, {
      fitMode: style === 'POP' || style === 'RNB' ? 'family-phrase' : 'legacy-clip',
      fitGridBeats: style === 'POP' ? 0.5 : 0.25,
      phraseBoundaries: (style === 'POP' || style === 'RNB')
        ? arrangerSectionBoundaries
        : undefined,
    });
  const ownershipReserved = reserveScheduledTokensForAuthoredSpans(
    generatedSchedule,
    authoredLeadSpans(authoredUserMotifPlan),
  );
  const scoreScheduled = isScoreOwnedLofiLead
    ? scheduleLofiLeadScoreTokens(ownershipReserved, part, lofiLeadScorePlan)
    : ownershipReserved;
  // A score scheduler may create an entry fallback for an otherwise silent
  // slot. Reserve user material once more so that fallback cannot re-enter an
  // exact authored quote after it has been scheduled.
  const scoreOwnershipReserved = isScoreOwnedLofiLead
    ? reserveScheduledTokensForAuthoredSpans(scoreScheduled, authoredLeadSpans(authoredUserMotifPlan))
    : scoreScheduled;
  const silenceScheduled = isScoreOwnedLofiLead
    ? scoreOwnershipReserved
    : applyScheduledLeadSilence(
      scoreOwnershipReserved,
      leadSilenceWindows ?? [],
    );
  const entriesEnsured = isScoreOwnedLofiLead
    ? silenceScheduled
    : ensureScheduledLeadEntries(
      silenceScheduled,
      leadEntryBeats ?? [],
      timebase.meter.numerator * (4 / timebase.meter.denominator),
    );
  // ★ ending 重构:lead 终止区(上游,parity 安全)——末句 G 落点持留、末小节不起新句、liquidation。
  //   ACG(cycle-cadence 自带收束)与 score-owned LOFI(score plan 已写 outro return)豁免。
  const lastSpan = plan.chordTimeline[plan.chordTimeline.length - 1];
  const totalLeadBeats = lastSpan ? (lastSpan.startBeat as number) + (lastSpan.durationBeats as number) : 0;
  const scheduled = style === 'ACG' || isScoreOwnedLofiLead
    ? entriesEnsured
    : applyTerminalCadence(entriesEnsured, totalLeadBeats, timebase.meter.numerator * (4 / timebase.meter.denominator));
  // The lead's single-note tail is a scheduler contract, not a renderer
  // repair. It may only cross a boundary when the score says the two lower
  // hands remain silent, and it later executes only on an authorized CC64
  // lane.
  const acgAfterglowPedalHolds = style === 'ACG'
    ? planAcgLeadAfterglowHolds(scheduled, part, acgPianoScorePlan, tempoBpm)
    : [];
  const acgLeadPedalAttacks: AcgPianoPedalAttackIntent[] = style === 'ACG'
    ? [
      ...scheduled.flatMap((entry, index) => {
        const audible = entry.token.kind !== 'R'
          && entry.token.kind !== 'SlopeEnter'
          && entry.token.kind !== 'SlopeExit';
        return audible && entry.token.duration > 1e-4
          ? [{
            id: `lead:scheduled:${index}`,
            atBeat: entry.startBeat,
            durationBeats: entry.token.duration,
            role: 'lead' as const,
            voiceCount: entry.acgReturn?.dyad ? 2 : 1,
          }]
          : [];
      }),
      ...(authoredUserMotifPlan?.notes ?? []).map((note, index) => ({
        id: `lead:authored:${index}`,
        atBeat: note.onsetBeat,
        durationBeats: note.durationBeat,
        role: 'lead' as const,
        voiceCount: 1,
      })),
    ]
    : [];
  // This is the final three-hand score-time compilation point: scheduled
  // lead attacks already exist, while no NoteIR has been realized yet.
  const acgPianoPedalScore = style === 'ACG' && acgPianoScorePlan
    ? compileAcgPianoPedalScore({
      harmonic: plan,
      pianoScorePlan: acgPianoScorePlan,
      leadAttacks: acgLeadPedalAttacks,
      leadRests: acgPianoRestIntentsFromAfterglow(acgAfterglowPedalHolds),
    })
    : undefined;
  // ★ MG full-parity G2(已激活,commit 29a1805):本地音阶语境(style/key/mode)穿透 guide-tone +
  //   token realization → 候选池走 orthogonal admission(结构音 = chord contract ∩ resolved local scale)。
  //   全风格 lead 走 contract∩local scale;JAZZ/RNB 真 chord-scale 色彩音。repeat-group comp off-by-1 已证
  //   = humanize-timing 边界假象(非真不一致),repeatGroupConsistency.test 已 EDGE 钳处理。
  const localScaleContext = { style, key: musicKey, mode: musicMode };
  const authoredRegisterCenter = leadRegister
    ? Math.round(leadRegister.lowMidi + (leadRegister.highMidi - leadRegister.lowMidi) * 0.4)
    : undefined;
  // Score-owned LOFI receives the concrete playable range before pitch
  // realization. The three old NoteIR range-fold passes must therefore be
  // identity-only for this path; a structural PC is never repaired later.
  const lofiScoreRegisterRange = isScoreOwnedLofiLead
    ? (() => {
      const hard = program === undefined ? [0, 127] as const : playableRangeForRole('lead', program);
      const lowMidi = Math.max(hard[0], leadRegister?.lowMidi ?? hard[0]);
      const highMidi = Math.min(hard[1], leadRegister?.highMidi ?? hard[1]);
      return lowMidi <= highMidi
        ? { lowMidi, highMidi }
        : { lowMidi: hard[0], highMidi: hard[1] };
    })()
    : undefined;
  const rawGuideTonePlan = buildGuideTonePlan({
    chordPart: part,
    localScaleContext,
    ...(leadRegister ? {
      registerCenter: authoredRegisterCenter,
      lowMidi: leadRegister.lowMidi,
      highMidi: leadRegister.highMidi,
    } : {}),
  });
  const guideTonePlan = rawGuideTonePlan;
  let melody = realizeTokens({
    scheduledTokens: scheduled,
    chordPart: part,
    rng: mgRng,
    guideTonePlan,
    // ★ Phase 2c:ACG 保留作者旋律斜率(忠实源,乐句内不乱跳)。
    // ★ 四期:有用户 motif 时全风格保留 —— 否则 POP/RNB 的导音规划会把 motif 衍生
    //   规则的音程轮廓改写掉,只剩节奏,用户听不出"基于动机的拓展变化"。
    preserveSlopeGrammar: style === 'LOFI' || style === 'ACG' || !!authoredUserMotifPlan,
    registerCenter: style === 'ACG' ? 74 : authoredRegisterCenter, // ACG lead 是钢琴最高声部；locked ensemble 使用其作者音区中心
    lofiScoreRegisterRange,
    localScaleContext,
    preserveTokenBoundaries: isScoreOwnedLofiLead,
  });
  // ★ 旋律 timing owner = MG StyleRenderer(单一所有权,Loop A 校正):lead 在此用 MG style feel 的 swing
  //   (jazz/blues 0.67 摆动;pop/rnb/lofi 0.5 直)。renderCoordinator 末尾的 applySwing【跳过 lead】(swing.ts:22),
  //   所以不会双重摆动 —— lead 的 swing 由这里独占,伴奏(comp/bass/drum)的 swing 由 arranger feel + 全局 applySwing 负责。
  //   ⚠️ 不要把这里压成 0.5:applySwing 既跳过 lead,压直会让 jazz lead 变直而伴奏仍摆 → lead/groove 错位(2026-06-08 实测教训)。
  //   ★ protectFastRuns(2026-06-19):jazz/blues 连续 16 分 run 内的 .5 不被当八分反拍摆动(防 .5→.67 挤压 micro-IOI)。
  // ★ MG full-parity Phase D(directive 3.2,推翻 1c 零洗牌门控):所有 MG-backed 风格 lead feel 真源 =
  //   arranger 选中的 GrooveContract(melodySwingRatio/articulation/accentPattern,全风格真消费,不再仅 ACG)。
  //   缺省(无 contract,如单元测试直调)→ feelForStyle 兜底。render 只消费,不重 pick。
  //   ⚠️ 输出相对零洗牌时代会变(POP/JAZZ/LOFI/RNB lead feel 漂)= 已接受,Phase F rebaseline oracle。
  // ACG return-brick 的起止拍是和声合同的一部分。通用 StyleFeel 会把 noteOn
  // 提前到前一和弦、使原本合法的稳定音跨界变成非法悬挂；ACG 的触键/力度在
  // 上游 token velocity + coordinator 的非时值表达层完成，因此这里不改它的时间与时值。
  if (style !== 'ACG' && !isScoreOwnedLofiLead) {
    const groups: Array<{ contract: LeadGrooveContract | undefined; events: MgNoteEvent[] }> = [];
    for (const event of melody) {
      const span = plan.chordTimeline.find((candidate) =>
        event.time >= (candidate.startBeat as number) - 1e-6
        && event.time < (candidate.startBeat as number) + (candidate.durationBeats as number) - 1e-6);
      const contract = (span ? grooveContractBySection?.[span.sectionId] : undefined) ?? grooveContract;
      const current = groups[groups.length - 1];
      if (!current || current.contract !== contract) groups.push({ contract, events: [event] });
      else current.events.push(event);
    }
    melody = groups.flatMap((group) => renderStyleFeel({
      events: group.events,
      feel: group.contract
        ? feelFromGrooveContract(group.contract, timebase.meter.numerator)
        : { ...feelForStyle(style), beatsPerMeasure: timebase.meter.numerator },
      rng: mgRng,
      protectFastRuns: style === 'JAZZ' || style === 'BLUES',
    }));
  }
  // ACG 的音符内容（尤其 return-brick）在 RoadMap → scheduler → realizer 一次生成完成。
  // 不能再让通用 shaper 事后删音、加 connector 或 snap pitch，否则会破坏显式的趋近→稳定到达。
  // StyleFeel 仍是演奏层（微时值/力度），不是再作曲；其它风格保持既有 MG shaper 链。
  if (style !== 'ACG' && !isScoreOwnedLofiLead) {
    const applyLofi = style === 'LOFI';
    melody = shapeMelodyHarmony(style, melody, chords, musicKey, musicMode, tonalCharacter, applyLofi);
    melody = enforceMonophonicMelody(melody);
    melody = applyMelodyBoundaryVoiceLeadingContract(melody, chords, style, musicKey, musicMode, tonalCharacter);
    melody = extendMelodyTailHolds(melody, chords, style, musicKey, musicMode);
    melody = finalizeMelodyBoundaryVoiceLeading(melody, chords, style, musicKey, musicMode, tonalCharacter);
  }
  if (style === 'LOFI' && !isScoreOwnedLofiLead) {
    melody = compileLofiPhraseLead(
      melody,
      plan,
      lofiPhraseInteractionPlan,
      timebase.meter.numerator * (4 / timebase.meter.denominator),
    );
  }
  if (debugCapture) {
    debugCapture.grammarEvents = melody.map((event) => ({ ...event }));
  }
  if (!isScoreOwnedLofiLead) melody = placeMelodyOctaveContinuously(melody, style);
  // ★ 管乐 feel(第一层,链内 → parity 安全):乐句力度成形/呼吸/装饰爬音(GM 56-79,ACG 豁免)
  if (style !== 'ACG' && !isScoreOwnedLofiLead && isWindLeadProgram(program)) {
    melody = applyWindLeadFeel(melody);
  }
  // Generic harmony shaping may propose a connector after token scheduling.
  // Re-apply the Arranger onset admission while events are still score-time
  // MG objects; no finished NoteIR is deleted or repaired downstream.
  if (!isScoreOwnedLofiLead) melody = applyArrangerLeadSilence(melody, leadSilenceWindows ?? []);

  // ── MgNoteEvent[](beat)→ NoteIR[](tick)──
  let previousOutputPitch: number | null = null;
  const quietDyadNoteKeys: string[] = [];
  const notes: NoteIR[] = melody
    .filter((e) => e.part === 'melody' && e.duration > 0)
    .map((e) => {
      const rangeFittedPitch = !isScoreOwnedLofiLead && program !== undefined
        ? fitMidiToProgramRange(e.noteNumber, 'lead', program)
        : Math.max(0, Math.min(127, Math.round(e.noteNumber)));
      let pitch = rangeFittedPitch;
      if (!isScoreOwnedLofiLead && style !== 'JAZZ' && style !== 'BLUES' && style !== 'ACG'
          && previousOutputPitch !== null && Math.abs(pitch - previousOutputPitch) > 12) {
        const candidates = [-24, -12, 0, 12, 24]
          .map((offset) => rangeFittedPitch + offset)
          .filter((candidate) => candidate >= 0 && candidate <= 127)
          .filter((candidate) => program === undefined || fitMidiToProgramRange(candidate, 'lead', program) === candidate)
          .sort((a, b) => Math.abs(a - previousOutputPitch!) - Math.abs(b - previousOutputPitch!)
            || Math.abs(a - rangeFittedPitch) - Math.abs(b - rangeFittedPitch));
        if (candidates[0] !== undefined && Math.abs(candidates[0] - previousOutputPitch) <= 12) pitch = candidates[0];
      }
      previousOutputPitch = pitch;
      const note: NoteIR = {
        pitch: midi(pitch),
        startTick: timebase.beatToTick(beats(e.time)),
        durationTicks: timebase.beatToTick(beats(Math.max(0.01, e.duration))),
        velocity: Math.max(1, Math.min(127, Math.round(e.velocity))),
      };
      // The grammar owns the distinction between an actual return dyad and an
      // arbitrary same-onset pair. Carry only that explicit provenance to the
      // dedicated ACG touch pass, which removes it before FinalIR.
      if (style === 'ACG' && e.acgReturnVoice === 'dyad') quietDyadNoteKeys.push(acgDynamicsNoteKey(note));
      return note;
    })
    .sort((a, b) => (a.startTick as number) - (b.startTick as number) || (a.pitch as number) - (b.pitch as number));

  // ★ Loop 3(Option A strict parity,2026-06-09):撤掉旧"末音 snap 落主音"——lead = MG 真源,音高/时序/力度
  //   一律不被 newEngine 后处理改写。收尾的"回主音"是【和声】回 T(harmony.ensureAuthenticEnding 的 V7→I),
  //   不是旋律;旋律的解决/落音交回 MG shapeMelodyHarmony(applyMelodicResolutionParadigm 等,读 effectiveFunc)。

  // ACG 的句间边界、趋近和到达都已在主链明确写时值；不能再用通用 legato
  // 把一颗旧音拖过下一和弦并改变其和声身份。其它风格保持原有演奏层连音。
  const legatoNotes = style === 'ACG' || isScoreOwnedLofiLead
    ? notes
    : connectFastLeadNoteIR(notes, {
      ...fastLeadLegatoOptionsForStyle(style, timebase.ppq),
      ...((style === 'POP' || style === 'RNB') ? {
        hardBoundaryTicks: arrangerSectionBoundaries.map(boundary =>
          timebase.beatToTick(beats(boundary)) as number),
      } : {}),
    });
  const rendered: AcgDynamicsTaggedTrack = { role: 'lead', notes: legatoNotes, program };
  if (quietDyadNoteKeys.length > 0) rendered.__acgQuietDyadNoteKeys = quietDyadNoteKeys;
  return { track: rendered, acgPianoPedalScore };
}

/** Backward-compatible track-only entry point used by existing callers/tests. */
export function renderMgMelody(
  plan: HarmonicPlan,
  band: BandSpec,
  timebase: Timebase,
  songSeed: number,
  leadProgram?: number,
  grooveContract?: LeadGrooveContract,
  acgLeadPresencePlan?: AcgLeadPresencePlan,
  acgPianoScorePlan?: AcgPianoScorePlan,
  grooveContractBySection?: Readonly<Record<string, LeadGrooveContract>>,
  leadRegister?: { lowMidi: number; highMidi: number },
  roadMapOverride?: RoadMap,
  authoredUserMotifPlan?: AuthoredUserMotifBrickPlan,
  tempoBpm?: number,
  leadSilenceWindows?: readonly { startBeat: number; endBeat: number }[],
  leadEntryBeats?: readonly number[],
  debugCapture?: MgLeadDebugCapture,
  lofiPhraseInteractionPlan?: Readonly<LofiPhraseInteractionPlan>,
  lofiLeadScorePlan?: LofiLeadScorePlan,
): TrackIR {
  return renderMgMelodyWithAcgPerformancePlan(
    plan,
    band,
    timebase,
    songSeed,
    leadProgram,
    grooveContract,
    acgLeadPresencePlan,
    acgPianoScorePlan,
    grooveContractBySection,
    leadRegister,
    roadMapOverride,
    authoredUserMotifPlan,
    tempoBpm,
    leadSilenceWindows,
    leadEntryBeats,
    debugCapture,
    lofiPhraseInteractionPlan,
    lofiLeadScorePlan,
  ).track;
}
