// ============================================================
// newEngine · render · BassRenderer(per-style 行进)
// ------------------------------------------------------------
// 架构定稿 Part 8.2:bass 独立渲染。取代"只根音":
//   jazz = walking(逐拍:根→和弦音→半音接入下个和弦根)
//   pop  = 根-五交替(逐拍)
//   lofi/default = 根音持续(lofi 末拍补五度)
// 全落 bass 音区 [36,50],贴和弦音/导音。无 rng → 确定性。
// ============================================================

import { beats, mod12, type Timebase } from '../foundation';
import { pcToMidiInRange, pcDistance } from '../knowledge/pitchPlacement';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const BASS_LOW = 36;
const BASS_HIGH = 50;

export function renderBass(plan: HarmonicPlan, timebase: Timebase, style: string): TrackIR {
  const notes: NoteIR[] = [];
  const spans = plan.chordTimeline;

  // bass 也 chord-aware:落 avoid 就近 snap 到该和弦 stable tone(walking 半音接入在某些调里会撞 avoid,
  //   逐拍≥1 拍会被 Auditor 拦 → 这里预消解,和 melody safePc 同策略)。
  const safe = (pc: number, span: ChordSpan): number => {
    const avoid = (plan.avoidNoteMap[span.id] ?? []) as readonly number[];
    if (!avoid.includes(pc)) return pc;
    const stable = (plan.stableToneMap[span.id] ?? []) as readonly number[];
    if (stable.length === 0) return pc;
    return [...stable].sort((a, b) => pcDistance(a, pc) - pcDistance(b, pc))[0];
  };

  const push = (pc: number, span: ChordSpan, beat: number, dur: number, vel: number) => {
    notes.push({
      pitch: pcToMidiInRange(safe(pc, span), BASS_LOW, BASS_HIGH),
      startTick: timebase.beatToTick(beats(beat)),
      durationTicks: timebase.beatToTick(beats(dur)),
      velocity: vel,
    });
  };

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const nextRoot = i + 1 < spans.length ? (spans[i + 1].rootPc as number) : undefined;
    const root = span.rootPc as number;
    const tones = plan.stableToneMap[span.id]; // [root,3,5,(7)]
    const fifth = tones.length > 2 ? (tones[2] as number) : root;
    const start = span.startBeat as number;
    const nBeats = Math.max(1, Math.round(span.durationBeats as number));

    if (style === 'jazz') {
      for (let b = 0; b < nBeats; b++) {
        let pc: number;
        if (b === 0) pc = root;
        else if (b === nBeats - 1 && nextRoot !== undefined) pc = mod12(nextRoot - 1); // 半音下行接入
        else pc = tones[b % tones.length] as number;
        push(pc, span, start + b, 1, 88);
      }
    } else if (style === 'pop') {
      for (let b = 0; b < nBeats; b++) {
        const onDown = b % 2 === 0;
        push(onDown ? root : fifth, span, start + b, 1, onDown ? 94 : 78);
      }
    } else {
      push(root, span, start, span.durationBeats as number, 90); // 根音持续
      if (style === 'lofi' && nBeats >= 2) push(fifth, span, start + nBeats - 1, 1, 68);
    }
  }

  return { role: 'bass', notes };
}
