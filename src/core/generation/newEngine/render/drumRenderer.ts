// ============================================================
// newEngine · render · DrumRenderer
// ------------------------------------------------------------
// per-style groove(pop backbeat / lofi 半拍 / jazz swing ride)+ 力度人性化(确定性抖动,
// 逐小节不同)+ 段落转折 fill。drum 是打击通道(audio→ch9),不入和声判据。
// 无 rng:抖动用 (bar,hit) 确定性派生 → 保确定性。
// ============================================================

import { beats, midi, ticks, type Timebase } from '../foundation';
import { DRUM, drumPattern, type DrumHit } from '../knowledge/grooves';
import type { GrooveDrumFillVoice } from '../knowledge/drumFillVocabulary';
import { texturePocket } from './textureRenderer';
import type { TextureSchedule } from './textureSchedule';
import type {
  DrumPerformanceContract,
  GrooveBarScore,
  GrooveBoundaryScore,
  GrooveDrumInteractionScore,
  GrooveScorePlan,
} from '../arranger/ArrangementPlan';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import { drumFeelProfile } from '../knowledge/drumPerformanceKnowledge';
import { realizeDrumPerformanceTrack } from './drumPerformanceRealizer';

export interface DrumFollowSource {
  notes: readonly NoteIR[];
  activeSectionIds?: ReadonlySet<string>;
}

export interface DrumOptions {
  style?: string;
  tempoBpm?: number;
  fillBars?: Set<number>;        // 该小节末尾加 fill(段落转折)
  bigFillBars?: ReadonlySet<number>; // ★ lead-in 边界:更密 16 分 roll 推进(跃升段前末小节)
  textureSchedule?: TextureSchedule; // ★ 跟纹理 pocket:halftime/sparse 段换鼓型(对拍/同律动)
  patternBySection?: Record<string, readonly DrumHit[]>; // ★ groove 下发(主权威):器配按段匹配的鼓型,逐段换
  patternBySectionBar?: Readonly<Record<string, readonly (readonly DrumHit[])[]>>; // Arranger bar score 的器配投影
  performanceBySection?: Readonly<Record<string, Readonly<DrumPerformanceContract>>>; // ★ Arranger 鼓手演奏合同:entry/fill/guard
  grooveScorePlan?: Readonly<GrooveScorePlan>;
  /** Production defers realization until final cross-track follow notes exist. */
  deferPerformanceRealization?: boolean;
  /** Concrete rhythm-section onsets used only through Arranger-authored follow directives. */
  followSources?: Partial<Record<'bass' | 'comp' | 'lead', DrumFollowSource>>;
}

// ★ 纹理 pocket 鼓型(跟 bass/comp 的纹理走):half-time = 慢一倍重拍;sparse = 留白。
const HALFTIME_KIT: DrumHit[] = [
  { drum: DRUM.KICK, beat: 0, vel: 104 }, { drum: DRUM.SNARE, beat: 2, vel: 98 }, { drum: DRUM.KICK, beat: 2.5, vel: 76 },
  { drum: DRUM.CHAT, beat: 0, vel: 50 }, { drum: DRUM.CHAT, beat: 1, vel: 42 }, { drum: DRUM.CHAT, beat: 2, vel: 50 }, { drum: DRUM.CHAT, beat: 3, vel: 42 },
];
const SPARSE_KIT: DrumHit[] = [
  { drum: DRUM.KICK, beat: 0, vel: 90 }, { drum: DRUM.SNARE, beat: 2, vel: 78 }, { drum: DRUM.CHAT, beat: 1, vel: 38 }, { drum: DRUM.CHAT, beat: 3, vel: 38 },
];

function clampVel(v: number): number {
  return Math.max(1, Math.min(127, Math.round(v)));
}

const RIDE_DRUMS = new Set<number>([DRUM.RIDE, DRUM.RIDE_BELL, DRUM.PHAT]);
const CYMBAL_DRUMS = new Set<number>([DRUM.CHAT, DRUM.OHAT, DRUM.PHAT, DRUM.SHAKER, DRUM.TAMB, DRUM.RIDE, DRUM.RIDE_BELL]);
const TOM_DRUMS = new Set<number>([DRUM.TOM_LO, DRUM.TOM_MID, DRUM.TOM_HI]);
const SNARE_DRUMS = new Set<number>([DRUM.SNARE, DRUM.SIDESTICK, DRUM.CLAP]);
const PRIMARY_SNARE_DRUMS = new Set<number>([DRUM.SNARE, DRUM.SIDESTICK]);

function isSoftBalladPerformance(performance: Readonly<DrumPerformanceContract> | undefined): boolean {
  return performance?.patternFamily === 'ballad-halftime' || performance?.feelProfileId === 'pop-ballad-soft';
}

interface FollowCandidate {
  beat: number;
  velocity: number;
  startTick: number;
}

function nearBeat(a: number, b: number, epsilon = 0.07): boolean {
  return Math.abs(a - b) <= epsilon;
}

function canonicalSourceBeat(beat: number, score: Readonly<GrooveBarScore>): number {
  const unit = score.subdivision === 'sixteenth' ? 0.25 : score.subdivision === 'triplet' ? 1 / 3 : 0.5;
  const snapped = Math.round(beat / unit) * unit;
  const normalized = Math.abs(beat - snapped) <= 0.08 ? snapped : beat;
  return Math.round(normalized * 1000) / 1000;
}

function sourceCandidatesForBar(
  source: DrumFollowSource | undefined,
  barStartBeat: number,
  beatsPerBar: number,
  score: Readonly<GrooveBarScore>,
  ppq: number,
): FollowCandidate[] {
  if (!source || (source.activeSectionIds && !source.activeSectionIds.has(score.sectionId))) return [];
  const byBeat = new Map<number, FollowCandidate>();
  for (const note of source.notes) {
    const relative = (note.startTick as number) / ppq - barStartBeat;
    if (relative < -0.06 || relative >= beatsPerBar - 0.02) continue;
    const beat = canonicalSourceBeat(Math.max(0, relative), score);
    const key = Math.round(beat * 1000);
    const current = byBeat.get(key);
    if (!current || note.velocity > current.velocity) {
      byBeat.set(key, { beat, velocity: note.velocity, startTick: note.startTick as number });
    }
  }
  return [...byBeat.values()].sort((a, b) => a.beat - b.beat);
}

function beatStrength(score: Readonly<GrooveBarScore>, beat: number): number {
  const index = Math.max(0, Math.min(score.beatStrength.length - 1, Math.floor(beat)));
  return score.beatStrength[index] ?? 1;
}

function pickResponses(
  candidates: readonly FollowCandidate[],
  limit: number,
  score: Readonly<GrooveBarScore>,
  avoidBeats: readonly number[],
  preferOffbeats: boolean,
): FollowCandidate[] {
  if (limit <= 0) return [];
  const ranked = candidates
    .filter((candidate) => !avoidBeats.some((beat) => nearBeat(candidate.beat, beat, 0.12)))
    .map((candidate) => {
      const offbeat = Math.abs(candidate.beat - Math.round(candidate.beat)) > 0.09;
      const scoreValue = candidate.velocity * 0.45
        + beatStrength(score, candidate.beat) * 22
        + (preferOffbeats === offbeat ? 12 : 0)
        + (candidate.beat === 0 ? 18 : 0);
      return { candidate, scoreValue };
    })
    .sort((a, b) => b.scoreValue - a.scoreValue || a.candidate.beat - b.candidate.beat);
  const selected: FollowCandidate[] = [];
  for (const item of ranked) {
    if (selected.length >= limit) break;
    if (selected.some((candidate) => Math.abs(candidate.beat - item.candidate.beat) < 0.24)) continue;
    selected.push(item.candidate);
  }
  return selected.sort((a, b) => a.beat - b.beat);
}

function ensureSnareAnchors(
  hits: readonly DrumHit[],
  interaction: Readonly<GrooveDrumInteractionScore>,
  performance: Readonly<DrumPerformanceContract> | undefined,
): DrumHit[] {
  const out = hits.map((hit) => ({ ...hit }));
  const drum = performance?.snarePolicy === 'rim' ? DRUM.SIDESTICK : DRUM.SNARE;
  const softBallad = isSoftBalladPerformance(performance);
  const velocity = performance?.snarePolicy === 'rim'
    ? softBallad ? 54 + (performance?.intensity ?? 1) * 4 : 70 + (performance?.intensity ?? 1) * 3
    : 82 + (performance?.intensity ?? 1) * 5;
  for (const beat of interaction.structuralSnareBeats) {
    const existing = out.find((hit) => PRIMARY_SNARE_DRUMS.has(hit.drum) && nearBeat(hit.beat, beat));
    if (existing) {
      existing.beat = beat;
      if (performance?.snarePolicy === 'rim') {
        existing.drum = DRUM.SIDESTICK;
        existing.vel = Math.min(Math.max(existing.vel, velocity), softBallad ? 66 : 78);
      } else {
        existing.vel = Math.max(existing.vel, velocity);
      }
    } else {
      out.push({ drum, beat, vel: velocity });
    }
  }
  return out;
}

function applyKickFollow(
  hits: readonly DrumHit[],
  interaction: Readonly<GrooveDrumInteractionScore>,
  sourceCandidates: readonly FollowCandidate[],
  score: Readonly<GrooveBarScore>,
  performance: Readonly<DrumPerformanceContract> | undefined,
): DrumHit[] {
  const intensity = performance?.intensity ?? 1;
  const softBallad = isSoftBalladPerformance(performance);
  const sourceResponses = interaction.kickFollow === 'bass'
    ? pickResponses(sourceCandidates, interaction.kickResponseLimit, score, interaction.structuralKickBeats, true)
    : [];
  const targets = new Map<number, number>();
  const pulseVelocity = performance?.patternFamily.startsWith('jazz')
    ? 40 + intensity * 4
    : softBallad
      ? 66 + intensity * 5
    : 86 + intensity * 6;
  for (const beat of interaction.structuralKickBeats) targets.set(Math.round(beat * 1000), pulseVelocity);
  for (const candidate of sourceResponses) {
    const syncopated = Math.abs(candidate.beat - Math.round(candidate.beat)) > 0.09;
    const velocity = Math.max(66, Math.min(108,
      Math.round(58 + candidate.velocity * 0.38 + intensity * 4 - (syncopated ? 5 : 0))));
    const key = Math.round(candidate.beat * 1000);
    targets.set(key, Math.max(targets.get(key) ?? 0, velocity));
  }

  // If the followed player is absent, keep the selected KB pattern and only
  // enforce structural anchors. When source notes exist, the kick line is
  // reconciled to the bounded source set instead of copying every bass note.
  const reconcile = interaction.kickFollow === 'bass' && sourceResponses.length > 0;
  const used = new Set<number>();
  const out: DrumHit[] = [];
  for (const hit of hits) {
    if (hit.drum !== DRUM.KICK) {
      out.push({ ...hit });
      continue;
    }
    const target = [...targets.entries()].find(([key]) => nearBeat(hit.beat, key / 1000));
    if (!target) {
      if (!reconcile) out.push({ ...hit });
      continue;
    }
    const [key, velocity] = target;
    if (used.has(key)) continue;
    used.add(key);
    out.push({ ...hit, beat: key / 1000, vel: softBallad ? Math.min(Math.max(hit.vel, velocity), 86) : Math.max(hit.vel, velocity) });
  }
  for (const [key, velocity] of targets) {
    if (!used.has(key)) out.push({ drum: DRUM.KICK, beat: key / 1000, vel: velocity });
  }
  return out;
}

function applySnareFollow(
  hits: readonly DrumHit[],
  interaction: Readonly<GrooveDrumInteractionScore>,
  sourceCandidates: readonly FollowCandidate[],
  score: Readonly<GrooveBarScore>,
  performance: Readonly<DrumPerformanceContract> | undefined,
): DrumHit[] {
  const anchored = ensureSnareAnchors(hits, interaction, performance);
  if (interaction.snareFollow === 'backbeat' || sourceCandidates.length === 0) return anchored;
  const responses = pickResponses(
    sourceCandidates.filter((candidate) => candidate.beat >= 0.25),
    interaction.snareResponseLimit,
    score,
    interaction.structuralSnareBeats,
    true,
  );
  const drum = performance?.snarePolicy === 'rim' ? DRUM.SIDESTICK : DRUM.SNARE;
  for (const candidate of responses) {
    const existing = anchored.find((hit) => SNARE_DRUMS.has(hit.drum) && nearBeat(hit.beat, candidate.beat));
    const velocity = interaction.snareFollow === 'lead-accents'
      ? Math.max(54, Math.min(78, Math.round(candidate.velocity * 0.72)))
      : Math.max(38, Math.min(58, Math.round(candidate.velocity * 0.58)));
    if (existing) {
      existing.beat = candidate.beat;
      existing.vel = Math.max(existing.vel, velocity);
    } else {
      anchored.push({ drum, beat: candidate.beat, vel: velocity });
    }
  }
  return anchored;
}

function applyDrumInteraction(
  hits: readonly DrumHit[],
  score: Readonly<GrooveBarScore> | undefined,
  performance: Readonly<DrumPerformanceContract> | undefined,
  followSources: DrumOptions['followSources'],
  barStartBeat: number,
  beatsPerBar: number,
  ppq: number,
): readonly DrumHit[] {
  const interaction = score?.drumInteraction;
  if (!score || !interaction) return hits;
  const bass = sourceCandidatesForBar(followSources?.bass, barStartBeat, beatsPerBar, score, ppq);
  const snareSource = interaction.snareFollow === 'comping' ? followSources?.comp : followSources?.lead;
  const snare = sourceCandidatesForBar(snareSource, barStartBeat, beatsPerBar, score, ppq);
  const withKick = applyKickFollow(hits, interaction, bass, score, performance);
  return applySnareFollow(withKick, interaction, snare, score, performance);
}

function applyEntryMode(
  hits: readonly DrumHit[],
  performance: Readonly<DrumPerformanceContract> | undefined,
  barInSection: number,
): readonly DrumHit[] {
  if (!performance) return hits;
  if (performance.role === 'silent' || performance.entryMode === 'none' || performance.entryMode === 'dropout') return [];
  if (barInSection > 0 || performance.entryMode === 'full') return hits;
  if (performance.entryMode === 'hat-only') return hits.filter((h) => CYMBAL_DRUMS.has(h.drum));
  if (performance.entryMode === 'ride-only') return hits.filter((h) => RIDE_DRUMS.has(h.drum));
  if (performance.entryMode === 'kick-only') return hits.filter((h) => h.drum === DRUM.KICK);
  if (performance.entryMode === 'kick-hat') return hits.filter((h) => h.drum === DRUM.KICK || CYMBAL_DRUMS.has(h.drum));
  return hits;
}

function densityScore(hit: DrumHit, idx: number, performance: Readonly<DrumPerformanceContract>): number {
  let score = hit.vel * 0.2 - idx * 0.01;
  if (hit.drum === DRUM.KICK) score += 80;
  else if (hit.drum === DRUM.SNARE || hit.drum === DRUM.SIDESTICK || hit.drum === DRUM.CLAP) score += 74;
  else if (performance.hatPolicy === 'ride' && RIDE_DRUMS.has(hit.drum)) score += 68;
  else if (CYMBAL_DRUMS.has(hit.drum) && hit.beat % 1 === 0) score += 48;
  else if (CYMBAL_DRUMS.has(hit.drum)) score += 34;
  else if (TOM_DRUMS.has(hit.drum)) score += 18;
  return score;
}

function applyDensityCeiling(
  hits: readonly DrumHit[],
  performance: Readonly<DrumPerformanceContract> | undefined,
): readonly DrumHit[] {
  if (!performance) return hits;
  const maxHits = Math.max(4, Math.round(6 + performance.densityCeiling * 18));
  if (hits.length <= maxHits) return hits;
  return hits
    .map((hit, idx) => ({ hit, idx, score: densityScore(hit, idx, performance) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxHits)
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.hit);
}

// ★ 去死板(2026-06-09,联网研究 humanize):per-bar 装饰层 —— 段内小节位决定鬼音/开镲/turnaround,
//   使相邻小节不复读(非随机:bar-in-section 派生,确定性)。jazz ride 本就密 → 不叠 backbeat 鬼音。
function embellishBar(
  barInSection: number,
  style: string,
  isFillBar: boolean,
  score?: Readonly<GrooveBarScore>,
  performance?: Readonly<DrumPerformanceContract>,
): DrumHit[] {
  if (isFillBar || performance?.phraseVariation === 0) return [];
  const profile = performance ? drumFeelProfile(performance.feelProfileId) : undefined;
  const phraseRole = score?.role;
  const ghostAllowed = phraseRole
    ? profile?.phrase.ghostRoles.includes(phraseRole) ?? false
    : barInSection % 2 === 1;
  const openHatAllowed = phraseRole
    ? profile?.phrase.openHatRoles.includes(phraseRole) ?? false
    : barInSection % 4 === 2;
  const turnaroundAllowed = phraseRole
    ? phraseRole === 'turnaround' && (profile?.phrase.allowInternalTurnaround ?? true)
    : barInSection % 4 === 3;
  const triplet = score?.subdivision === 'triplet';
  const ghostPickup = triplet ? 2 / 3 : 0.75;
  const liftOffbeat = triplet ? 1 + 2 / 3 : 1.5;
  const turnFirst = triplet ? 3 + 1 / 3 : 3.25;
  const turnLast = triplet ? 3 + 2 / 3 : 3.5;

  if (style.toLowerCase() === 'jazz') {
    if (!performance || performance.snarePolicy !== 'jazz-comping' || performance.complexity < 2
      || performance.phraseVariation < 2 || !ghostAllowed) return [];
    if (phraseRole === 'turnaround') {
      return [{ drum: DRUM.SNARE, beat: 1.5, vel: 40 }, { drum: DRUM.TOM_MID, beat: 3 + 1 / 3, vel: 62 }];
    }
    return [{ drum: DRUM.SNARE, beat: 1.5, vel: 42 }, { drum: DRUM.SNARE, beat: 3.5, vel: 44 }];
  }
  const out: DrumHit[] = [];
  // Strict foreground guard still permits quiet ghost responses, but blocks
  // attention-grabbing cymbal lifts and internal tom turns.
  if ((!performance || performance.phraseVariation >= 2) && ghostAllowed) {
    out.push({ drum: DRUM.SNARE, beat: ghostPickup, vel: 36 }, { drum: DRUM.SNARE, beat: 2 + ghostPickup, vel: 40 });
  }
  if ((!performance || performance.phraseVariation >= 2) && openHatAllowed
    && performance?.foregroundGuard !== 'strict') {
    out.push({ drum: DRUM.OHAT, beat: liftOffbeat, vel: 52 });
  }
  if ((!performance || performance.phraseVariation >= 3) && turnaroundAllowed
    && performance?.tomPolicy !== 'none' && performance?.foregroundGuard !== 'strict') {
    out.push({ drum: DRUM.SNARE, beat: turnFirst, vel: 44 }, { drum: DRUM.TOM_MID, beat: turnLast, vel: 66 });
  }
  return out;
}

// ★ 力度人性化:hat/shaker 在小节内做 8 分 swell(正拍略强、反拍略弱)+ 乐句内起伏 + 逐小节确定性抖动(±4)。
//   研究:别均匀随机 —— 每击都有"为什么更响/更轻"的音乐理由(此处=拍位 + 乐句位)。
function humanizeVel(
  hit: DrumHit,
  bar: number,
  idx: number,
  barInSection: number,
  performance?: Readonly<DrumPerformanceContract>,
): number {
  let v = hit.vel;
  if (hit.drum === DRUM.CHAT || hit.drum === DRUM.SHAKER) {
    v += (hit.beat % 1 === 0 ? 2 : -2);          // 正拍↑/反拍↓(8 分摆动感)
    v += ((barInSection % 4) - 1.5) * 2;          // 乐句内 swell(75→85→75 意象)
  }
  if (performance) {
    v *= [0.78, 0.9, 1, 1.08][performance.intensity] ?? 1;
    if (performance.velocityProfile === 'ghosted' && (hit.drum === DRUM.SNARE || hit.drum === DRUM.SIDESTICK) && hit.vel < 60) v *= 0.85;
    if (performance.velocityProfile === 'crescendo') v += (barInSection % 4) * 2;
    if (performance.foregroundGuard === 'strict' && (TOM_DRUMS.has(hit.drum) || hit.drum === DRUM.CRASH)) v -= 12;
  }
  v += (((bar * 31 + idx * 17) % 9) - 4);         // 逐小节/逐击确定性抖动 ±4
  return v;
}

function scoreVelocity(velocity: number, hit: DrumHit, score: Readonly<GrooveBarScore> | undefined): number {
  if (!score) return velocity;
  const beatIndex = Math.max(0, Math.min(score.beatStrength.length - 1, Math.floor(hit.beat)));
  const beatFactor = score.beatStrength[beatIndex] ?? 1;
  const subdivisionCount = score.subdivisionAccent.length;
  const fraction = ((hit.beat % 1) + 1) % 1;
  const subdivisionIndex = Math.round(fraction * subdivisionCount) % subdivisionCount;
  const subdivision = score.subdivisionAccent[subdivisionIndex] ?? 1;
  // Existing KB hit velocities already carry voice accents. The shared score
  // shapes them gently instead of flattening that orchestration.
  const subdivisionFactor = 0.75 + subdivision * 0.25;
  const energyFactor = score.energy === undefined ? 1 : 0.94 + Math.max(0, Math.min(1, score.energy)) * 0.08;
  const trajectoryFactor = score.trajectory === 'rising' ? 1.025
    : score.trajectory === 'arrival' ? 1.055
      : score.trajectory === 'peak' ? 1.04
        : score.trajectory === 'falling' ? 0.97
          : 1;
  const phraseInteractionFactor = score.lofiPhraseInteraction?.velocityScaleByRole.drum ?? 1;
  return clampVel(velocity * beatFactor * subdivisionFactor * score.phraseAccent
    * energyFactor * trajectoryFactor * phraseInteractionFactor);
}

function fillPolicyFor(
  performance: Readonly<DrumPerformanceContract> | undefined,
  bigRequested: boolean,
): DrumPerformanceContract['fillPolicy'] {
  if (performance) return performance.fillPolicy;
  return bigRequested ? 'big' : 'turnaround';
}

function cymbalAllowed(performance: Readonly<DrumPerformanceContract> | undefined): boolean {
  return !performance || (performance.cymbalPolicy !== 'none' && performance.fillPolicy !== 'none');
}

function scaledTicks(v: number, ppq: number): number {
  return Math.round(v * (ppq / 480));
}

function msToTicks(ms: number, ppq: number, tempoBpm: number): number {
  return Math.round(ms * ppq * tempoBpm / 60000);
}

function clampMove(offset: number, performance: Readonly<DrumPerformanceContract>, ppq: number): number {
  const max = Math.max(0, scaledTicks(performance.maxMoveTicks, ppq));
  return Math.max(-max, Math.min(max, offset));
}

function timingOffsetTicks(
  hit: DrumHit,
  performance: Readonly<DrumPerformanceContract> | undefined,
  ppq: number,
  tempoBpm: number,
): number {
  if (!performance) return 0;
  if (hit.beat === 0) return 0; // 段/小节锚点不漂。
  const feel = msToTicks(performance.feelOffsetMs, ppq, tempoBpm);
  const frac = ((hit.beat % 1) + 1) % 1;
  const offbeat = Math.abs(frac - 0.5) < 0.08 || Math.abs(frac - 0.25) < 0.08 || Math.abs(frac - 0.75) < 0.08;
  let offset = 0;
  if (performance.timingProfile === 'dilla-late') {
    if (SNARE_DRUMS.has(hit.drum)) offset = feel;
    else if (hit.drum === DRUM.KICK && offbeat) offset = -Math.round(feel * 0.45);
    else if (CYMBAL_DRUMS.has(hit.drum) && offbeat) offset = Math.round(feel * 0.55);
  } else if (performance.timingProfile === 'behind-snare') {
    if (SNARE_DRUMS.has(hit.drum)) offset = feel;
    else if (CYMBAL_DRUMS.has(hit.drum) && offbeat) offset = Math.round(feel * 0.35);
  } else if (performance.timingProfile === 'tight') {
    if (CYMBAL_DRUMS.has(hit.drum) && offbeat && performance.humanizeAmount > 1) offset = Math.round(feel * 0.25);
  }
  return clampMove(offset, performance, ppq);
}

function pushFill(
  push: (drum: number, beat: number, vel: number, dur?: number) => void,
  b0: number,
  beatsPerBar: number,
  policy: DrumPerformanceContract['fillPolicy'],
  performance?: Readonly<DrumPerformanceContract>,
): void {
  if (policy === 'none') return;
  const amount = performance?.fillAmount ?? (policy === 'light' ? 1 : policy === 'turnaround' ? 2 : 3);
  const complexity = performance?.fillComplexity ?? amount;
  if (amount <= 0) return;
  if (isSoftBalladPerformance(performance)) {
    push(DRUM.SIDESTICK, b0 + beatsPerBar - 0.75, 42);
    if (amount >= 2 || complexity >= 2) push(DRUM.SIDESTICK, b0 + beatsPerBar - 0.25, 50);
    return;
  }
  if (policy === 'light') {
    if (complexity >= 2) push(DRUM.SNARE, b0 + beatsPerBar - 1.25, 54);
    push(DRUM.SNARE, b0 + beatsPerBar - 0.75, 72);
    push(DRUM.OHAT, b0 + beatsPerBar - 0.5, 68);
    return;
  }
  if (policy === 'big') {
    push(DRUM.SNARE, b0 + beatsPerBar - 2 + 0.5, 84);
    push(DRUM.TOM_HI, b0 + beatsPerBar - 2 + 0.75, 90);
    push(DRUM.SNARE, b0 + beatsPerBar - 1 + 0.0, 96);
    push(DRUM.TOM_MID, b0 + beatsPerBar - 1 + 0.25, 102);
    push(DRUM.SNARE, b0 + beatsPerBar - 1 + 0.5, 108);
    push(DRUM.TOM_LO, b0 + beatsPerBar - 1 + 0.75, 116);
    if (complexity >= 3) push(DRUM.SNARE, b0 + beatsPerBar - 0.25, 100);
    push(DRUM.OHAT, b0 + beatsPerBar - 0.5, 90);
    return;
  }
  if (complexity >= 2) push(DRUM.SNARE, b0 + beatsPerBar - 1.5, 68);
  push(DRUM.SNARE, b0 + beatsPerBar - 1 + 0.25, 80);
  push(DRUM.SNARE, b0 + beatsPerBar - 1 + 0.5, 96);
  push(DRUM.TOM_MID, b0 + beatsPerBar - 1 + 0.75, 110);
  push(DRUM.OHAT, b0 + beatsPerBar - 0.5, 80);
}

function pushGrooveFill(
  push: (drum: number, beat: number, vel: number, dur?: number) => void,
  b0: number,
  beatsPerBar: number,
  boundary: Readonly<GrooveBoundaryScore>,
  performance?: Readonly<DrumPerformanceContract>,
): void {
  const end = b0 + beatsPerBar;
  const start = end - Math.min(beatsPerBar, Math.max(0.25, boundary.durationBeats));
  const at = (drum: number, beat: number, velocity: number) => {
    if (beat >= start - 1e-6 && beat < end - 1e-6) push(drum, beat, velocity);
  };
  const strong = boundary.intensity >= 2;
  const softBallad = isSoftBalladPerformance(performance);
  const snareDrum = performance?.snarePolicy === 'rim' || softBallad ? DRUM.SIDESTICK : DRUM.SNARE;

  if (boundary.drumFillFamily === 'pop-snare-pickup') {
    if (softBallad) {
      at(DRUM.SIDESTICK, end - 0.75, 42);
      if (boundary.intensity >= 2) at(DRUM.SIDESTICK, end - 0.25, 50);
      return;
    }
    at(DRUM.SNARE, end - 0.75, 68);
    at(DRUM.SNARE, end - 0.5, 82);
    at(DRUM.OHAT, end - 0.25, 74);
    return;
  }
  if (boundary.drumFillFamily === 'pop-tom-build') {
    if (softBallad || performance?.tomPolicy === 'none') {
      at(snareDrum, end - 0.75, softBallad ? 44 : 62);
      at(snareDrum, end - 0.25, softBallad ? 52 : 72);
      return;
    }
    if (strong) {
      at(DRUM.SNARE, end - 1.5, 78);
      at(DRUM.TOM_HI, end - 1.25, 86);
      at(DRUM.SNARE, end - 1, 92);
      at(DRUM.TOM_MID, end - 0.75, 98);
    }
    at(DRUM.SNARE, end - 0.5, strong ? 104 : 82);
    at(DRUM.TOM_LO, end - 0.25, strong ? 112 : 94);
    return;
  }
  if (boundary.drumFillFamily === 'motown-tom-bridge') {
    at(DRUM.TOM_HI, end - 1.5, 86);
    at(DRUM.SNARE, end - 1, 88);
    at(DRUM.SNARE, end - 0.75, 94);
    at(DRUM.TOM_LO, end - 0.5, 102);
    return;
  }
  if (boundary.drumFillFamily === 'rnb-pocket-turn') {
    at(DRUM.SIDESTICK, end - 0.75, 46);
    at(DRUM.SNARE, end - 0.5, 58);
    at(DRUM.KICK, end - 0.25, 82);
    return;
  }
  if (boundary.drumFillFamily === 'rnb-gospel-triplet') {
    at(DRUM.SNARE, end - 1, 72);
    at(DRUM.SNARE, end - 2 / 3, 86);
    at(DRUM.TOM_MID, end - 1 / 3, 102);
    return;
  }
  if (boundary.drumFillFamily === 'trap-snare-roll') {
    let index = 0;
    for (let beat = start; beat < end - 1e-6; beat += 0.25) {
      at(DRUM.SNARE, beat, 54 + index * 6);
      index += 1;
    }
    return;
  }
  if (boundary.drumFillFamily === 'jazz-bossa-cross-stick') {
    at(DRUM.SIDESTICK, end - 0.75, 50);
    at(DRUM.SIDESTICK, end - 0.25, 62);
    return;
  }
  // Jazz swing: triplet-grid accents move from snare to tom while preserving
  // the same subdivision as the ride pattern.
  at(DRUM.SNARE, end - 1.67, 48);
  at(DRUM.SNARE, end - 1.33, 60);
  at(DRUM.TOM_MID, end - 1, 70);
  at(DRUM.TOM_LO, end - 0.33, 84);
}

const DRUM_BY_FILL_VOICE: Readonly<Record<GrooveDrumFillVoice, number>> = {
  kick: DRUM.KICK,
  snare: DRUM.SNARE,
  'tom-high': DRUM.TOM_HI,
  'tom-mid': DRUM.TOM_MID,
  'tom-low': DRUM.TOM_LO,
};

function scoredGrooveFillHits(
  beatsPerBar: number,
  boundary: Readonly<GrooveBoundaryScore>,
  performance?: Readonly<DrumPerformanceContract>,
): DrumHit[] {
  if (isSoftBalladPerformance(performance)) return [];
  const score = boundary.fillScore;
  if (!score) return [];
  return score.hits
    .filter((hit) => hit.offsetBeatsFromEnd >= -boundary.durationBeats - 1e-6 && hit.offsetBeatsFromEnd < -1e-6)
    .map((hit) => ({
      drum: DRUM_BY_FILL_VOICE[hit.voice],
      beat: beatsPerBar + hit.offsetBeatsFromEnd,
      vel: hit.velocity,
    }));
}

function pushLanding(
  pushUnique: (drum: number, beat: number, vel: number, dur?: number) => void,
  beat: number,
  boundary: Readonly<GrooveBoundaryScore>,
  performance?: Readonly<DrumPerformanceContract>,
): void {
  const softBallad = isSoftBalladPerformance(performance);
  const kickVelocity = softBallad ? (boundary.intensity >= 3 ? 84 : 74) : boundary.intensity >= 3 ? 112 : 96;
  if (boundary.landing === 'kick' || boundary.landing === 'kick-crash' || boundary.landing === 'kick-ride') {
    pushUnique(DRUM.KICK, beat, kickVelocity, 0.5);
  }
  if (boundary.landing === 'kick-crash' && !softBallad && cymbalAllowed(performance)) pushUnique(DRUM.CRASH, beat, boundary.intensity >= 3 ? 108 : 94, 1);
  if (boundary.landing === 'ride' || boundary.landing === 'kick-ride') pushUnique(DRUM.RIDE, beat, boundary.intensity >= 3 ? 88 : 76, 0.75);
}

function maskBaseForBoundary(
  hits: readonly DrumHit[],
  beatsPerBar: number,
  boundary: Readonly<GrooveBoundaryScore> | undefined,
): readonly DrumHit[] {
  if (!boundary || boundary.baseMask === 'keep') return hits;
  if (boundary.baseMask === 'replace-bar') return [];
  const fillStart = beatsPerBar - Math.min(beatsPerBar, Math.max(0.25, boundary.durationBeats));
  return hits.filter((hit) => hit.beat < fillStart - 1e-6);
}

export function renderDrums(
  plan: HarmonicPlan,
  timebase: Timebase,
  beatsPerBar: number,
  opts: DrumOptions = {},
): TrackIR {
  const pattern = drumPattern(opts.style ?? 'default');
  const fillBars = opts.fillBars ?? new Set<number>();
  const tempoBpm = opts.tempoBpm ?? 120;
  const performanceBySection = opts.performanceBySection;
  const useUnifiedPerformance = !!opts.grooveScorePlan && !!performanceBySection;
  const notes: NoteIR[] = [];

  let totalBeats = 0;
  for (const span of plan.chordTimeline) {
    totalBeats = Math.max(totalBeats, span.startBeat + span.durationBeats);
  }
  const bars = Math.max(1, Math.round(totalBeats / beatsPerBar));

  const push = (drum: number, beat: number, vel: number, dur = 0.25, timingOffset = 0) => {
    const start = Math.max(0, (timebase.beatToTick(beats(beat)) as number) + timingOffset);
    notes.push({
      pitch: midi(drum),
      startTick: ticks(start),
      durationTicks: timebase.beatToTick(beats(dur)),
      velocity: clampVel(vel),
    });
  };
  const pushUnique = (drum: number, beat: number, vel: number, dur = 0.25) => {
    const start = timebase.beatToTick(beats(beat)) as number;
    if (notes.some((note) => (note.pitch as number) === drum && (note.startTick as number) === start)) return;
    push(drum, beat, vel, dur);
  };
  const pushHit = (hit: DrumHit, beat: number, vel: number, performance?: Readonly<DrumPerformanceContract>) =>
    push(hit.drum, beat, vel, 0.25,
      useUnifiedPerformance ? 0 : timingOffsetTicks(hit, performance, timebase.ppq, tempoBpm));

  const sched = opts.textureSchedule;
  const bySection = opts.patternBySection;
  const bySectionBar = opts.patternBySectionBar;
  const scoreByAbsoluteBar = new Map<number, Readonly<GrooveBarScore>>();
  for (const section of Object.values(opts.grooveScorePlan?.bySection ?? {})) {
    for (const bar of section.bars) scoreByAbsoluteBar.set(bar.absoluteBar, bar);
  }
  const boundaryBySourceBar = new Map<number, Readonly<GrooveBoundaryScore>>();
  const boundaryByLandingBar = new Map<number, Readonly<GrooveBoundaryScore>>();
  for (const boundary of opts.grooveScorePlan?.boundaries ?? []) {
    boundaryBySourceBar.set(boundary.sourceBar, boundary);
    boundaryByLandingBar.set(boundary.landingBar, boundary);
  }
  const spanAtBeat = (beat: number): ChordSpan | undefined =>
    plan.chordTimeline.find((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats);
  const performanceForBar = (bar: number): Readonly<DrumPerformanceContract> | undefined => {
    const span = spanAtBeat(bar * beatsPerBar);
    return span ? performanceBySection?.[span.sectionId] : undefined;
  };
  const kitForBar = (b0: number, barInSectionIndex: number): readonly DrumHit[] => {
    const span = spanAtBeat(b0);
    // ★ groove 下发 = 鼓节奏【主权威】:器配按段匹配的鼓型逐段换(取代单一 pattern)。
    if (bySectionBar && span) {
      const p = bySectionBar[span.sectionId]?.[barInSectionIndex];
      if (p) return p;
    }
    if (bySection && span) {
      const p = bySection[span.sectionId];
      if (p) return p;
    }
    // texturePocket 退成【次要兜底】(只在没显式 groove 下发的段):halftime/sparse 纹理换鼓型。
    if (!sched) return pattern;
    const tc = span ? sched[span.id] : undefined;
    if (!tc) return pattern;
    const pocket = texturePocket(tc);
    return pocket === 'halftime' ? HALFTIME_KIT : pocket === 'sparse' ? SPARSE_KIT : pattern;
  };

  // ★ 段内小节位(去死板用):逐 bar 算 sectionId → barInSection + isSectionStart(派生自 chordTimeline)。
  const sectionStart: boolean[] = [];
  const barInSection: number[] = [];
  let prevSec: string | undefined;
  let inSec = 0;
  for (let bar = 0; bar < bars; bar++) {
    const sec = spanAtBeat(bar * beatsPerBar)?.sectionId;
    const isStart = sec !== prevSec;
    if (isStart) inSec = 0; else inSec += 1;
    sectionStart.push(isStart && bar > 0); // 曲首 bar0 不算"段切入"
    barInSection.push(inSec);
    prevSec = sec;
  }
  const style = (opts.style ?? 'default').toLowerCase();
  const isSparseKit = (b0: number, performance?: Readonly<DrumPerformanceContract>): boolean => {
    if (performance && performance.densityCeiling <= 0.3) return true;
    const sp = spanAtBeat(b0);
    const tc = sp && sched ? sched[sp.id] : undefined;
    return !!tc && texturePocket(tc) === 'sparse';
  };

  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * beatsPerBar;
    const boundary = boundaryBySourceBar.get(bar);
    const legacyFill = !boundary && fillBars.has(bar);
    const fill = !!boundary || legacyFill;
    const score = scoreByAbsoluteBar.get(bar);
    const performance = performanceForBar(bar);
    const interacted = applyDrumInteraction(
      kitForBar(b0, barInSection[bar]),
      score,
      performance,
      opts.followSources,
      b0,
      beatsPerBar,
      timebase.ppq,
    );
    const entered = applyEntryMode(interacted, performance, barInSection[bar]);
    const kit = applyDensityCeiling(maskBaseForBoundary(entered, beatsPerBar, boundary), performance);
    kit.forEach((hit, idx) => {
      const velocity = scoreVelocity(humanizeVel(hit, bar, idx, barInSection[bar], performance), hit, score);
      pushHit(hit, b0 + hit.beat, velocity, performance);
    });
    // ★ per-bar 装饰(去死板):鬼音/开镲/turnaround,段内小节位决定 → 相邻小节不复读。sparse 段不叠(留白)。
    if (!fill && !isSparseKit(b0, performance)) {
      embellishBar(barInSection[bar], style, fill, score, performance).forEach((hit, index) => {
        const velocity = scoreVelocity(
          humanizeVel(hit, bar, kit.length + index, barInSection[bar], performance),
          hit,
          score,
        );
        pushHit(hit, b0 + hit.beat, velocity, performance);
      });
    }
    const landing = boundaryByLandingBar.get(bar);
    if (landing && performance?.role !== 'silent' && performance?.entryMode !== 'none') {
      pushLanding(pushUnique, b0, landing, performanceForBar(landing.sourceBar) ?? performance);
    }
    // ★ crash 落点:fill 推进后的【新段下拍】= 经典"fill→crash";非 jazz/非 sparse。
    const prevPerformance = bar > 0 ? performanceForBar(bar - 1) : undefined;
    if (!opts.grooveScorePlan && sectionStart[bar] && fillBars.has(bar - 1) && style !== 'jazz' && !isSparseKit(b0, performance) && cymbalAllowed(prevPerformance)) {
      push(DRUM.CRASH, b0, 96, 1.0);
    }
    if (boundary) {
      const scoredFill = scoredGrooveFillHits(beatsPerBar, boundary, performance);
      if (scoredFill.length > 0) {
        scoredFill.forEach((hit, index) => {
          const velocity = scoreVelocity(
            humanizeVel(hit, bar, kit.length + index, barInSection[bar], performance),
            hit,
            score,
          );
          pushHit(hit, b0 + hit.beat, velocity, performance);
        });
      } else if (boundary.drumFillFamily !== 'lofi-one-shot') {
        pushGrooveFill(push, b0, beatsPerBar, boundary, performance);
      }
    } else if (legacyFill) {
      pushFill(push, b0, beatsPerBar, fillPolicyFor(performance, opts.bigFillBars?.has(bar) ?? false), performance);
    }
  }

  const track: TrackIR = { role: 'drum', notes };
  if (!useUnifiedPerformance || opts.deferPerformanceRealization) return track;
  return realizeDrumPerformanceTrack(track, {
    timebase,
    beatsPerBar,
    tempoBpm,
    grooveScorePlan: opts.grooveScorePlan!,
    performanceBySection: performanceBySection!,
  });
}

export interface FinalDrumFollowOptions {
  beatsPerBar: number;
  ppq: number;
  grooveScorePlan: Readonly<GrooveScorePlan>;
  performanceBySection?: Readonly<Record<string, Readonly<DrumPerformanceContract>>>;
  followSources: NonNullable<DrumOptions['followSources']>;
  activeDrumSectionIds?: ReadonlySet<string>;
}

function responseAllowedByEntry(
  drum: number,
  score: Readonly<GrooveBarScore>,
  performance: Readonly<DrumPerformanceContract> | undefined,
): boolean {
  if (!performance) return true;
  if (performance.role === 'silent' || performance.entryMode === 'none' || performance.entryMode === 'dropout') return false;
  if (score.barInSection > 0 || performance.entryMode === 'full') return true;
  if (performance.entryMode === 'hat-only' || performance.entryMode === 'ride-only') return false;
  if (performance.entryMode === 'kick-only' || performance.entryMode === 'kick-hat') return drum === DRUM.KICK;
  return true;
}

function dedupeDrumNotes(notes: readonly NoteIR[]): NoteIR[] {
  const byKey = new Map<string, NoteIR>();
  for (const note of notes) {
    const key = `${note.pitch as number}:${note.startTick as number}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, note);
      continue;
    }
    byKey.set(key, {
      ...current,
      durationTicks: ticks(Math.max(current.durationTicks as number, note.durationTicks as number)),
      velocity: Math.max(current.velocity, note.velocity),
    });
  }
  return [...byKey.values()].sort((a, b) =>
    (a.startTick as number) - (b.startTick as number)
    || (a.pitch as number) - (b.pitch as number));
}

/**
 * Production reconciliation pass. It runs after all source-track timing and
 * presence transforms, so a response cannot follow a note that was later
 * gated away or shifted to another pocket position.
 */
export function applyFinalDrumFollow(
  tracks: TrackIR[],
  options: FinalDrumFollowOptions,
): TrackIR[] {
  const drumIndex = tracks.findIndex((track) => track.role === 'drum');
  if (drumIndex < 0) return tracks;
  let notes = [...tracks[drumIndex].notes];
  const { beatsPerBar, ppq } = options;
  const barTicks = beatsPerBar * ppq;
  const responseToleranceTicks = Math.max(1, Math.round(ppq * 0.08));
  const boundaryBySourceBar = new Map<number, Readonly<GrooveBoundaryScore>>();
  for (const boundary of options.grooveScorePlan.boundaries) boundaryBySourceBar.set(boundary.sourceBar, boundary);
  const bars = Object.values(options.grooveScorePlan.bySection)
    .flatMap((section) => section.bars)
    .sort((a, b) => a.absoluteBar - b.absoluteBar);

  const upsertResponse = (
    pitch: number,
    candidate: FollowCandidate,
    velocity: number,
    score: Readonly<GrooveBarScore>,
  ): void => {
    const performance = options.performanceBySection?.[score.sectionId];
    if (!responseAllowedByEntry(pitch, score, performance)) return;
    const targetStartTick = nearBeat(candidate.beat, 0, 0.001)
      ? score.absoluteBar * barTicks
      : candidate.startTick;
    const existingIndex = notes.findIndex((note) =>
      (note.pitch as number) === pitch
      && Math.abs((note.startTick as number) - targetStartTick) <= responseToleranceTicks);
    const durationTicks = ticks(Math.max(1, Math.round(ppq * 0.22)));
    if (existingIndex >= 0) {
      const existing = notes[existingIndex];
      notes[existingIndex] = {
        ...existing,
        startTick: ticks(Math.max(0, targetStartTick)),
        velocity: Math.max(existing.velocity, velocity),
      };
      return;
    }
    notes.push({
      pitch: midi(pitch),
      startTick: ticks(Math.max(0, targetStartTick)),
      durationTicks,
      velocity,
    });
  };

  for (const score of bars) {
    if (options.activeDrumSectionIds && !options.activeDrumSectionIds.has(score.sectionId)) continue;
    const interaction = score.drumInteraction;
    if (!interaction) continue;
    const performance = options.performanceBySection?.[score.sectionId];
    const barStartBeat = score.absoluteBar * beatsPerBar;
    const barStartTick = score.absoluteBar * barTicks;
    const boundary = boundaryBySourceBar.get(score.absoluteBar);
    const responseEndBeat = boundary && boundary.baseMask !== 'keep'
      ? beatsPerBar - Math.min(beatsPerBar, Math.max(0.25, boundary.durationBeats))
      : beatsPerBar;

    const bassCandidates = sourceCandidatesForBar(
      options.followSources.bass,
      barStartBeat,
      beatsPerBar,
      score,
      ppq,
    ).filter((candidate) => candidate.beat < responseEndBeat - 1e-6);
    const kickResponses = interaction.kickFollow === 'bass'
      ? pickResponses(bassCandidates, interaction.kickResponseLimit, score, interaction.structuralKickBeats, true)
      : [];
    if (kickResponses.length > 0) {
      // Match the old interaction semantics: once real bass responses exist,
      // non-structural base-pattern kicks yield to them. Scored fill kicks live
      // beyond responseEndBeat and remain untouched.
      notes = notes.filter((note) => {
        if ((note.pitch as number) !== DRUM.KICK) return true;
        const tick = note.startTick as number;
        if (tick < barStartTick - responseToleranceTicks || tick >= barStartTick + barTicks + responseToleranceTicks) return true;
        const relativeBeat = (tick - barStartTick) / ppq;
        if (relativeBeat >= responseEndBeat - 0.08) return true;
        return interaction.structuralKickBeats.some((beat) => Math.abs(relativeBeat - beat) <= 0.14);
      });
      for (const candidate of kickResponses) {
        const syncopated = Math.abs(candidate.beat - Math.round(candidate.beat)) > 0.09;
        const rawVelocity = Math.max(66, Math.min(108,
          Math.round(58 + candidate.velocity * 0.38 + (performance?.intensity ?? 1) * 4 - (syncopated ? 5 : 0))));
        const hit = { drum: DRUM.KICK, beat: candidate.beat, vel: rawVelocity };
        upsertResponse(DRUM.KICK, candidate, scoreVelocity(rawVelocity, hit, score), score);
      }
    }

    const snareSource = interaction.snareFollow === 'comping'
      ? options.followSources.comp
      : options.followSources.lead;
    const snareCandidates = sourceCandidatesForBar(
      snareSource,
      barStartBeat,
      beatsPerBar,
      score,
      ppq,
    ).filter((candidate) => candidate.beat >= 0.25 && candidate.beat < responseEndBeat - 1e-6);
    if (interaction.snareFollow !== 'backbeat') {
      const responses = pickResponses(
        snareCandidates,
        interaction.snareResponseLimit,
        score,
        interaction.structuralSnareBeats,
        true,
      );
      const drum = performance?.snarePolicy === 'rim' ? DRUM.SIDESTICK : DRUM.SNARE;
      for (const candidate of responses) {
        const rawVelocity = interaction.snareFollow === 'lead-accents'
          ? Math.max(54, Math.min(78, Math.round(candidate.velocity * 0.72)))
          : Math.max(38, Math.min(58, Math.round(candidate.velocity * 0.58)));
        const hit = { drum, beat: candidate.beat, vel: rawVelocity };
        upsertResponse(drum, candidate, scoreVelocity(rawVelocity, hit, score), score);
      }
    }
  }

  const out = [...tracks];
  out[drumIndex] = { ...out[drumIndex], notes: dedupeDrumNotes(notes) };
  return out;
}
