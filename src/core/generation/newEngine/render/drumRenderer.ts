// ============================================================
// newEngine · render · DrumRenderer
// ------------------------------------------------------------
// per-style groove(pop backbeat / lofi 半拍 / jazz swing ride)+ 力度人性化(确定性抖动,
// 逐小节不同)+ 段落转折 fill。drum 是打击通道(audio→ch9),不入和声判据。
// 无 rng:抖动用 (bar,hit) 确定性派生 → 保确定性。
// ============================================================

import { beats, midi, ticks, type Timebase } from '../foundation';
import { DRUM, drumPattern, type DrumHit } from '../knowledge/grooves';
import { texturePocket } from './textureRenderer';
import type { TextureSchedule } from './textureSchedule';
import type { DrumPerformanceContract } from '../arranger/ArrangementPlan';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

export interface DrumOptions {
  style?: string;
  tempoBpm?: number;
  fillBars?: Set<number>;        // 该小节末尾加 fill(段落转折)
  bigFillBars?: ReadonlySet<number>; // ★ lead-in 边界:更密 16 分 roll 推进(跃升段前末小节)
  textureSchedule?: TextureSchedule; // ★ 跟纹理 pocket:halftime/sparse 段换鼓型(对拍/同律动)
  patternBySection?: Record<string, readonly DrumHit[]>; // ★ groove 下发(主权威):器配按段匹配的鼓型,逐段换
  performanceBySection?: Readonly<Record<string, Readonly<DrumPerformanceContract>>>; // ★ Arranger 鼓手演奏合同:entry/fill/guard
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
  performance?: Readonly<DrumPerformanceContract>,
): DrumHit[] {
  if (style.toLowerCase() === 'jazz') {
    if (!performance || performance.snarePolicy !== 'jazz-comping' || performance.complexity < 2 || performance.role !== 'lift' || performance.phraseVariation < 2) return [];
    return barInSection % 2 === 1
      ? [{ drum: DRUM.SNARE, beat: 1.5, vel: 42 }, { drum: DRUM.SNARE, beat: 3.5, vel: 44 }]
      : [];
  }
  if (performance?.foregroundGuard === 'strict' && performance.role !== 'lift') return [];
  if (performance && performance.phraseVariation <= 0) return [];
  const out: DrumHit[] = [];
  const phrase = barInSection % 4;
  // 鬼军鼓:奇数小节在 backbeat 前的"a"(0.75/2.75)加 ghost(35-45,研究:a-before-2/4 的 bounce)
  if ((!performance || performance.phraseVariation >= 2) && barInSection % 2 === 1) { out.push({ drum: DRUM.SNARE, beat: 0.75, vel: 36 }, { drum: DRUM.SNARE, beat: 2.75, vel: 40 }); }
  // 开镲 lift:每 4 小节第 3 小节 1.5 开镲(呼吸/抬起)
  if ((!performance || performance.phraseVariation >= 2) && phrase === 2) out.push({ drum: DRUM.OHAT, beat: 1.5, vel: 52 });
  // 4 小节乐句末轻 tom turnaround(段界另有真 fill → 此处跳过避免叠加)
  if ((!performance || performance.phraseVariation >= 3) && phrase === 3 && !isFillBar && performance?.tomPolicy !== 'none') out.push({ drum: DRUM.SNARE, beat: 3.25, vel: 44 }, { drum: DRUM.TOM_MID, beat: 3.5, vel: 66 });
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

export function renderDrums(
  plan: HarmonicPlan,
  timebase: Timebase,
  beatsPerBar: number,
  opts: DrumOptions = {},
): TrackIR {
  const pattern = drumPattern(opts.style ?? 'default');
  const fillBars = opts.fillBars ?? new Set<number>();
  const tempoBpm = opts.tempoBpm ?? 120;
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
  const pushHit = (hit: DrumHit, beat: number, vel: number, performance?: Readonly<DrumPerformanceContract>) =>
    push(hit.drum, beat, vel, 0.25, timingOffsetTicks(hit, performance, timebase.ppq, tempoBpm));

  const sched = opts.textureSchedule;
  const bySection = opts.patternBySection;
  const performanceBySection = opts.performanceBySection;
  const spanAtBeat = (beat: number): ChordSpan | undefined =>
    plan.chordTimeline.find((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats);
  const performanceForBar = (bar: number): Readonly<DrumPerformanceContract> | undefined => {
    const span = spanAtBeat(bar * beatsPerBar);
    return span ? performanceBySection?.[span.sectionId] : undefined;
  };
  const kitForBar = (b0: number): readonly DrumHit[] => {
    const span = spanAtBeat(b0);
    // ★ groove 下发 = 鼓节奏【主权威】:器配按段匹配的鼓型逐段换(取代单一 pattern)。
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
    const fill = fillBars.has(bar);
    const performance = performanceForBar(bar);
    const kit = applyDensityCeiling(applyEntryMode(kitForBar(b0), performance, barInSection[bar]), performance);
    kit.forEach((hit, idx) => {
      pushHit(hit, b0 + hit.beat, humanizeVel(hit, bar, idx, barInSection[bar], performance), performance);
    });
    // ★ per-bar 装饰(去死板):鬼音/开镲/turnaround,段内小节位决定 → 相邻小节不复读。sparse 段不叠(留白)。
    if (!fill && !isSparseKit(b0, performance)) {
      for (const e of embellishBar(barInSection[bar], style, fill, performance)) pushHit(e, b0 + e.beat, e.vel, performance);
    }
    // ★ crash 落点:fill 推进后的【新段下拍】= 经典"fill→crash";非 jazz/非 sparse。
    const prevPerformance = bar > 0 ? performanceForBar(bar - 1) : undefined;
    if (sectionStart[bar] && fillBars.has(bar - 1) && style !== 'jazz' && !isSparseKit(b0, performance) && cymbalAllowed(prevPerformance)) {
      push(DRUM.CRASH, b0, 96, 1.0);
    }
    if (fill) {
      pushFill(push, b0, beatsPerBar, fillPolicyFor(performance, opts.bigFillBars?.has(bar) ?? false), performance);
    }
  }

  return { role: 'drum', notes };
}
