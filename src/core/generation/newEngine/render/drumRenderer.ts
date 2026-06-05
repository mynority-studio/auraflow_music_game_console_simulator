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
  textureSchedule?: TextureSchedule; // ★ 跟纹理 pocket:halftime/sparse 段换鼓型(对拍/同律动)
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
  const spanAtBeat = (beat: number): ChordSpan | undefined =>
    plan.chordTimeline.find((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats);
  const kitForBar = (b0: number): DrumHit[] => {
    if (!sched) return pattern;
    const span = spanAtBeat(b0);
    const tc = span ? sched[span.id] : undefined;
    if (!tc) return pattern;
    const pocket = texturePocket(tc);
    return pocket === 'halftime' ? HALFTIME_KIT : pocket === 'sparse' ? SPARSE_KIT : pattern;
  };

  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * beatsPerBar;
    kitForBar(b0).forEach((hit, idx) => {
      // 确定性人性化:逐小节/逐 hit 的 ±3 力度抖动(无 rng)
      const jitter = (((bar * 31 + idx * 17) % 7) - 3);
      push(hit.drum, b0 + hit.beat, hit.vel + jitter);
    });
    if (fillBars.has(bar)) {
      // 段落转折 fill:末拍 16 分 snare roll
      push(DRUM.SNARE, b0 + beatsPerBar - 1 + 0.5, 92);
      push(DRUM.SNARE, b0 + beatsPerBar - 1 + 0.75, 104);
      push(DRUM.OHAT, b0 + beatsPerBar - 0.5, 80);
    }
  }

  return { role: 'drum', notes };
}
