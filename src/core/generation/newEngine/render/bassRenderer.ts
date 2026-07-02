// ============================================================
// newEngine · render · BassRenderer(per-style 行进)
// ------------------------------------------------------------
// 架构定稿 Part 8.2:bass 独立渲染。取代"只根音":
//   jazz = walking(逐拍:根→和弦音→半音接入下个和弦根)
//   pop  = 根-五交替(逐拍)
//   lofi/default = 根音持续(lofi 末拍补五度)
// ★ 音区 [E1,G3]=[28,55],重心 C2–G2:八度由 placeBassMidi 按【声部进行 + 软重心井】定
//   (取代旧 36+音级 单八度死锁;根音可下探 E1–B1 拿低端,line 平滑不乱跳)。贴和弦音/导音。无 rng → 确定性。
// ============================================================

import { beats, midi, mod12, type Timebase } from '../foundation';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { placeBassMidi, pcDistance } from '../knowledge/pitchPlacement';
import { resolveBassAnchorPc } from '../knowledge/basslineRules';
import { chordTypeIntervals } from '../knowledge/chords';
import { renderTextureBassHits } from './textureRenderer';
import type { TextureSchedule } from './textureSchedule';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const BASS_LOW = 28;  // E1(给低端,roots 可下探)
const BASS_HIGH = 55; // G3(walking/上行空间)
const BASS_HOME = 40; // E2:line 起点锚(无 prev 时的虚拟前音 → 首音落重心)

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

  // 声部进行:跨 span 串 prevMidi → 八度选择平滑(line 不乱跳、重心落 C2–G2、根音可下探 E1–B1)。
  let prevMidi = BASS_HOME;
  const push = (pc: number, span: ChordSpan, beat: number, dur: number, vel: number) => {
    const m = placeBassMidi(safe(pc, span), prevMidi, BASS_LOW, BASS_HIGH);
    prevMidi = m as number;
    notes.push({
      pitch: m,
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
      const m = placeBassMidi(anchorPc, prevMidi, BASS_LOW, BASS_HIGH);
      prevMidi = m as number;
      notes.push({
        pitch: m,
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
      // ★ ACG(MG generateBarPattern port):texture bass 携带实际 midi(保八度)→ 直接落;其它风格仍 voice→pc→place。
      const acgCtx = { rootPc, chordType: (span.chordType ?? span.quality) as string };
      for (const h of renderTextureBassHits(tc, span.durationBeats as number, acgCtx)) {
        const vel = Math.max(1, Math.min(108, Math.round((h.vel * 0.85 + 0.2) * 127)));
        if (typeof h.midi === 'number') {
          const m = Math.max(BASS_LOW, Math.min(BASS_HIGH, Math.round(h.midi)));
          prevMidi = m;
          notes.push({ pitch: midi(m), startTick: timebase.beatToTick(beats(start + h.tRel)), durationTicks: timebase.beatToTick(beats(h.dur)), velocity: vel });
        } else {
          push(voicePc(h.voice), span, start + h.tRel, h.dur, vel);
        }
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
