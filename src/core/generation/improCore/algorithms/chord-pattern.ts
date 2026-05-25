// ============================================================
// chord-pattern.ts — Impro-Visor ChordPattern 解释器
// ============================================================
//
// 原型:`/Users/mynority/vibe_coding/Impro-Visor/src/imp/style/stylePatterns/ChordPattern.java`
//
// Rule DSL:
//   X4    strike(用 voicing 击)at quarter note
//   X8    strike at eighth note
//   X4+8  strike at dotted quarter(tied)
//   R8    rest(silence)8 分
//   V90   set velocity 90 / 127(后续 strike 用此 velocity)
//   X4.   dotted quarter strike(1.5 beat)
//   (X 3 8) scale degree strike(罕用,本版不支持单度 pick — strike 全 voicing)
//
// 输入:
//   rules:string[]  — token 数组(['X4', 'R8', 'V90', 'X8'])
//   voicing:number[] — LH ∪ RH 合并升序(VoicingGenerator 输出)
//   startBeat:本 chord 起拍
//   chordBeats:本 chord 占多少拍
//
// 输出:NoteEvent[] — 每 strike emit 全 voicing 同 onset notes
//
// Strike 时如果 voicing 内有 LH+RH 双簇,加 micro strum(< 18ms 总跨度,
// 跟 AF2 MicroTimingHumanizer 一致避 fake crescendo)。
// ============================================================

import { parseDurationBeats } from './duration-parser';

export interface NoteEvent {
  pitch: number;
  onset: number;
  duration: number;
  velocity: number;     // 0-127
  part: 'accomp' | 'bass' | 'drums';
}

const DEFAULT_VELOCITY = 90;
const STRUM_TOTAL_MAX_BEATS = 0.018;    // ~9ms@120BPM(同 AF2 cap)
const MICRO_DELAY_BEATS = 0.008;

export function applyChordPattern(
  rules: string[],
  voicing: number[],          // 完整 voicing(LH+RH 合并升序)
  startBeat: number,
  chordBeats: number,
): NoteEvent[] {
  const out: NoteEvent[] = [];
  if (voicing.length === 0) return out;

  let cursor = 0;
  let velocity = DEFAULT_VELOCITY;
  for (const raw of rules) {
    if (!raw) continue;
    const ch = raw[0];

    if (ch === 'V') {
      const v = parseInt(raw.slice(1), 10);
      if (!isNaN(v)) velocity = Math.max(0, Math.min(127, v));
      continue;
    }
    if (ch === 'R') {
      cursor += parseDurationBeats(raw.slice(1));
      continue;
    }
    if (ch === 'X') {
      const dur = parseDurationBeats(raw.slice(1));
      if (dur <= 0) continue;
      if (cursor >= chordBeats) break;  // 越界跳出
      const onset = startBeat + cursor;
      const dropDur = Math.min(dur, chordBeats - cursor) * 0.95;
      emitStrike(out, voicing, onset, dropDur, velocity);
      cursor += dur;
      continue;
    }
    // 其他 token(罕用 如 (X 3 8))暂不支持,跳过
  }
  return out;
}

function emitStrike(
  out: NoteEvent[],
  voicing: number[],
  onset: number,
  duration: number,
  velocity: number,
): void {
  const n = voicing.length;
  // strum 跨度 cap(防 fake crescendo,跟 AF2 MicroTimingHumanizer 一致)
  const naiveTotal = (n - 1) * MICRO_DELAY_BEATS;
  const stepDelay = naiveTotal > STRUM_TOTAL_MAX_BEATS
    ? STRUM_TOTAL_MAX_BEATS / Math.max(1, n - 1)
    : MICRO_DELAY_BEATS;
  for (let i = 0; i < n; i++) {
    out.push({
      pitch: voicing[i]!,
      onset: onset + i * stepDelay,
      duration,
      velocity,
      part: 'accomp',
    });
  }
}
