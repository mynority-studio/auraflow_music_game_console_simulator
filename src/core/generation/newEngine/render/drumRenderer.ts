// ============================================================
// newEngine · render · DrumRenderer
// ------------------------------------------------------------
// per-style groove(pop backbeat / lofi 半拍 / jazz swing ride)+ 力度人性化(确定性抖动,
// 逐小节不同)+ 段落转折 fill。drum 是打击通道(audio→ch9),不入和声判据。
// 无 rng:抖动用 (bar,hit) 确定性派生 → 保确定性。
// ============================================================

import { beats, midi, type Timebase } from '../foundation';
import { DRUM, drumPattern, type DrumHit } from '../knowledge/grooves';
import { texturePocket } from './textureRenderer';
import type { TextureSchedule } from './textureSchedule';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

export interface DrumOptions {
  style?: string;
  fillBars?: Set<number>;        // 该小节末尾加 fill(段落转折)
  bigFillBars?: ReadonlySet<number>; // ★ lead-in 边界:更密 16 分 roll 推进(跃升段前末小节)
  textureSchedule?: TextureSchedule; // ★ 跟纹理 pocket:halftime/sparse 段换鼓型(对拍/同律动)
  patternBySection?: Record<string, readonly DrumHit[]>; // ★ groove 下发(主权威):器配按段匹配的鼓型,逐段换
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

// ★ 去死板(2026-06-09,联网研究 humanize):per-bar 装饰层 —— 段内小节位决定鬼音/开镲/turnaround,
//   使相邻小节不复读(非随机:bar-in-section 派生,确定性)。jazz ride 本就密 → 不叠 backbeat 鬼音。
function embellishBar(barInSection: number, style: string, isFillBar: boolean): DrumHit[] {
  if (style.toLowerCase() === 'jazz') return [];
  const out: DrumHit[] = [];
  const phrase = barInSection % 4;
  // 鬼军鼓:奇数小节在 backbeat 前的"a"(0.75/2.75)加 ghost(35-45,研究:a-before-2/4 的 bounce)
  if (barInSection % 2 === 1) { out.push({ drum: DRUM.SNARE, beat: 0.75, vel: 36 }, { drum: DRUM.SNARE, beat: 2.75, vel: 40 }); }
  // 开镲 lift:每 4 小节第 3 小节 1.5 开镲(呼吸/抬起)
  if (phrase === 2) out.push({ drum: DRUM.OHAT, beat: 1.5, vel: 52 });
  // 4 小节乐句末轻 tom turnaround(段界另有真 fill → 此处跳过避免叠加)
  if (phrase === 3 && !isFillBar) out.push({ drum: DRUM.SNARE, beat: 3.25, vel: 44 }, { drum: DRUM.TOM_MID, beat: 3.5, vel: 66 });
  return out;
}

// ★ 力度人性化:hat/shaker 在小节内做 8 分 swell(正拍略强、反拍略弱)+ 乐句内起伏 + 逐小节确定性抖动(±4)。
//   研究:别均匀随机 —— 每击都有"为什么更响/更轻"的音乐理由(此处=拍位 + 乐句位)。
function humanizeVel(hit: DrumHit, bar: number, idx: number, barInSection: number): number {
  let v = hit.vel;
  if (hit.drum === DRUM.CHAT || hit.drum === DRUM.SHAKER) {
    v += (hit.beat % 1 === 0 ? 2 : -2);          // 正拍↑/反拍↓(8 分摆动感)
    v += ((barInSection % 4) - 1.5) * 2;          // 乐句内 swell(75→85→75 意象)
  }
  v += (((bar * 31 + idx * 17) % 9) - 4);         // 逐小节/逐击确定性抖动 ±4
  return v;
}

export function renderDrums(
  plan: HarmonicPlan,
  timebase: Timebase,
  beatsPerBar: number,
  opts: DrumOptions = {},
): TrackIR {
  const pattern = drumPattern(opts.style ?? 'default');
  const fillBars = opts.fillBars ?? new Set<number>();
  const notes: NoteIR[] = [];

  let totalBeats = 0;
  for (const span of plan.chordTimeline) {
    totalBeats = Math.max(totalBeats, span.startBeat + span.durationBeats);
  }
  const bars = Math.max(1, Math.round(totalBeats / beatsPerBar));

  const push = (drum: number, beat: number, vel: number, dur = 0.25) => {
    notes.push({
      pitch: midi(drum),
      startTick: timebase.beatToTick(beats(beat)),
      durationTicks: timebase.beatToTick(beats(dur)),
      velocity: clampVel(vel),
    });
  };

  const sched = opts.textureSchedule;
  const bySection = opts.patternBySection;
  const spanAtBeat = (beat: number): ChordSpan | undefined =>
    plan.chordTimeline.find((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats);
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
  const isSparseKit = (b0: number): boolean => { const sp = spanAtBeat(b0); const tc = sp && sched ? sched[sp.id] : undefined; return !!tc && texturePocket(tc) === 'sparse'; };

  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * beatsPerBar;
    const fill = fillBars.has(bar);
    kitForBar(b0).forEach((hit, idx) => {
      push(hit.drum, b0 + hit.beat, humanizeVel(hit, bar, idx, barInSection[bar]));
    });
    // ★ per-bar 装饰(去死板):鬼音/开镲/turnaround,段内小节位决定 → 相邻小节不复读。sparse 段不叠(留白)。
    if (!fill && !isSparseKit(b0)) {
      for (const e of embellishBar(barInSection[bar], style, fill)) push(e.drum, b0 + e.beat, e.vel);
    }
    // ★ crash 落点:fill 推进后的【新段下拍】= 经典"fill→crash";非 jazz/非 sparse。
    if (sectionStart[bar] && fillBars.has(bar - 1) && style !== 'jazz' && !isSparseKit(b0)) {
      push(DRUM.CRASH, b0, 96, 1.0);
    }
    if (fill) {
      if (opts.bigFillBars?.has(bar)) {
        // ★ lead-in 更密 16 分 tom/snare roll(末两拍 crescendo 85→115)→ 推进下一段下拍
        push(DRUM.SNARE, b0 + beatsPerBar - 2 + 0.5, 84);
        push(DRUM.TOM_HI, b0 + beatsPerBar - 2 + 0.75, 90);
        push(DRUM.SNARE, b0 + beatsPerBar - 1 + 0.0, 96);
        push(DRUM.TOM_MID, b0 + beatsPerBar - 1 + 0.25, 102);
        push(DRUM.SNARE, b0 + beatsPerBar - 1 + 0.5, 108);
        push(DRUM.TOM_LO, b0 + beatsPerBar - 1 + 0.75, 116);
        push(DRUM.OHAT, b0 + beatsPerBar - 0.5, 90);
      } else {
        // 段落转折 fill:末拍 16 分 snare+tom roll(build 92→112)
        push(DRUM.SNARE, b0 + beatsPerBar - 1 + 0.25, 80);
        push(DRUM.SNARE, b0 + beatsPerBar - 1 + 0.5, 96);
        push(DRUM.TOM_MID, b0 + beatsPerBar - 1 + 0.75, 110);
        push(DRUM.OHAT, b0 + beatsPerBar - 0.5, 80);
      }
    }
  }

  return { role: 'drum', notes };
}
