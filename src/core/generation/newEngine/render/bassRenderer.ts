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
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { pcToMidiInRange, pcDistance } from '../knowledge/pitchPlacement';
import { resolveBassAnchorPc } from '../knowledge/basslineRules';
import { chordTypeIntervals } from '../knowledge/chords';
import { renderTextureBassHits } from './textureRenderer';
import type { TextureSchedule } from './textureSchedule';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const BASS_LOW = 36;
const BASS_HIGH = 50;

/** 朝 targetPc 方向(dir=-1 下 / +1 上)找最近的【在阶】音(≤2 半音);无 → undefined。 */
function scaleStepToward(targetPc: number, scalePcs: readonly number[], dir: 1 | -1): number | undefined {
  for (const d of [1, 2]) {
    const c = mod12(targetPc + dir * d);
    if (scalePcs.includes(c)) return c;
  }
  return undefined;
}

export function renderBass(plan: HarmonicPlan, timebase: Timebase, style: string, textureSchedule?: TextureSchedule): TrackIR {
  const notes: NoteIR[] = [];
  const spans = plan.chordTimeline;
  const beatsPerBar = beatsPerBarOf(timebase.meter);

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
    const start = span.startBeat as number;
    const nBeats = Math.max(1, Math.round(span.durationBeats as number));

    // ★ Loop 7:bass anchor 按 bassRole(转位 3rd/5th/7th / pedal 持续);默认/未设 = root。
    const intervals = [...chordTypeIntervals(span.chordType ?? span.quality)];
    const anchorPc = resolveBassAnchorPc(span.bassRole, span.rootPc as number, intervals, span.bassPedalPc as number | undefined);

    // pedal:整 span 持续 pedal pc(不 walking/交替;故意低音,不 snap)
    if (span.bassRole === 'pedal') {
      notes.push({
        pitch: pcToMidiInRange(anchorPc, BASS_LOW, BASS_HIGH),
        startTick: timebase.beatToTick(beats(start)),
        durationTicks: timebase.beatToTick(beats(span.durationBeats as number)),
        velocity: 84,
      });
      continue;
    }

    // ★ 纹理段(纹理全权):bass 走纹理的 bass 节奏(与 comp 同 textureCase = 对拍/复调),
    //   音高用 bassRole anchor(root)/ 五度 / 三度;旁路 per-style walking。
    const tc = textureSchedule?.[span.id];
    if (tc) {
      const rootPc = span.rootPc as number;
      const thirdPc = mod12(rootPc + (intervals[1] ?? 4));
      const fifthPc = mod12(rootPc + (intervals[2] ?? 7));
      const voicePc = (v: 'root' | 'fifth' | 'tenth') => (v === 'fifth' ? fifthPc : v === 'tenth' ? thirdPc : anchorPc);
      for (const h of renderTextureBassHits(tc, span.durationBeats as number)) {
        const vel = Math.max(1, Math.min(108, Math.round((h.vel * 0.85 + 0.2) * 127)));
        push(voicePc(h.voice), span, start + h.tRel, h.dur, vel);
      }
      continue;
    }

    const nextRoot = i + 1 < spans.length ? (spans[i + 1].rootPc as number) : undefined;
    const root = anchorPc; // 转位:downbeat 用 bass anchor(slash / 下行 bass)
    const tones = plan.stableToneMap[span.id]; // [root,3,5,(7)]
    const fifth = tones.length > 2 ? (tones[2] as number) : root;

    if (style === 'jazz') {
      // ★ walking bass 末拍接入【解决到位】:tension 引入必须解决到下一重音(下一和弦根)。
      //   解决法多样(确定性按 span 序轮换):半音(弱拍/在阶)· 音阶级进 · 留白 · 环绕。
      //   关键修:强拍绝不漏裸半音外音(原 bug — 奇数拍长 span 末拍落强拍)。
      const scalePcs = (plan.chordScaleMap[span.id] ?? []) as readonly number[];
      const seq: (number | null)[] = [];
      for (let b = 0; b < nBeats; b++) seq.push(b === 0 ? root : (tones[b % tones.length] as number));
      if (nextRoot !== undefined && nBeats >= 2) {
        const lastPos = (start + nBeats - 1) % beatsPerBar;
        const lastStrong = lastPos === 0 || lastPos === Math.floor(beatsPerBar / 2);
        const chromatic = mod12(nextRoot - 1);
        const method = i % 3;
        if (!lastStrong || scalePcs.includes(chromatic)) {
          // 弱拍 或 半音在阶 → 半音引入(下一个音解决);method2 + 有空间 → 环绕(上邻音+下半音)
          if (method === 2 && nBeats >= 3) {
            seq[nBeats - 2] = scaleStepToward(nextRoot, scalePcs, 1) ?? mod12(nextRoot + 2); // 环绕:上邻音
            seq[nBeats - 1] = chromatic; // 下半音(落弱拍)
          } else {
            seq[nBeats - 1] = chromatic;
          }
        } else {
          // 强拍 + 半音外音 → 必须音乐性解决:音阶级进 或 留白(绝不裸半音落强拍)
          const ss = scaleStepToward(nextRoot, scalePcs, -1);
          seq[nBeats - 1] = method === 1 || ss === undefined ? null : ss;
        }
      }
      for (let b = 0; b < nBeats; b++) { const pcv = seq[b]; if (pcv !== null) push(pcv, span, start + b, 1, 88); }
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
