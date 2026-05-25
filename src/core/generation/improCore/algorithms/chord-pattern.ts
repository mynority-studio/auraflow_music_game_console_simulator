// ============================================================
// chord-pattern.ts — Impro-Visor ChordPattern 解释器(+ ImproCore 扩展)
// ============================================================
//
// 原型:`/Users/mynority/vibe_coding/Impro-Visor/src/imp/style/stylePatterns/ChordPattern.java`
//
// Rule DSL(原 Impro-Visor):
//   X4    strike(用 voicing 击)at quarter note
//   X8    strike at eighth note
//   X4+8  strike at dotted quarter(tied)
//   R8    rest(silence)8 分
//   V90   set velocity 90 / 127(后续 strike 用此 velocity)
//   X4.   dotted quarter strike(1.5 beat)
//
// ImproCore 扩展 token(2026-05-25 加 — 解决"全柱式"听感):
//   U4    arp Up — voicing 升序逐音 emit,每音占 dur/N
//   D4    arp Down — voicing 降序逐音 emit
//   B4    Broken pair — voicing 拆中点,先 lower 簇 strike → halfDur 后 upper 簇 strike
//
// 输入:
//   rules:string[]  — token 数组(['X4', 'R8', 'V90', 'U8', 'B4'])
//   voicing:number[] — LH ∪ RH 合并升序(VoicingGenerator 输出)
//   startBeat:本 chord 起拍
//   chordBeats:本 chord 占多少拍
//
// 输出:NoteEvent[]
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
    if (ch === 'U' || ch === 'D') {
      // arp Up / Down — 逐音 emit,每音占 dur/N
      const dur = parseDurationBeats(raw.slice(1));
      if (dur <= 0) continue;
      if (cursor >= chordBeats) break;
      const onset = startBeat + cursor;
      const dropDur = Math.min(dur, chordBeats - cursor);
      const seq = ch === 'U' ? voicing : voicing.slice().reverse();
      emitArp(out, seq, onset, dropDur, velocity);
      cursor += dur;
      continue;
    }
    if (ch === 'B') {
      // Broken pair — voicing 拆中点,先 lower 簇 strike → halfDur 后 upper 簇 strike
      const dur = parseDurationBeats(raw.slice(1));
      if (dur <= 0) continue;
      if (cursor >= chordBeats) break;
      const onset = startBeat + cursor;
      const dropDur = Math.min(dur, chordBeats - cursor);
      emitBrokenPair(out, voicing, onset, dropDur, velocity);
      cursor += dur;
      continue;
    }
    // 其他 token(罕用 如 (X 3 8))暂不支持,跳过
  }
  return out;
}

/**
 * Arp 逐音 emit — 每音占 dur/N(N=voicing.length),音持续 stepDur*0.9。
 */
function emitArp(
  out: NoteEvent[],
  seq: number[],
  onset: number,
  duration: number,
  velocity: number,
): void {
  const n = seq.length;
  if (n === 0) return;
  const stepDur = duration / n;
  for (let i = 0; i < n; i++) {
    out.push({
      pitch: seq[i]!,
      onset: onset + i * stepDur,
      duration: stepDur * 0.9,
      velocity,
      part: 'accomp',
    });
  }
}

/**
 * Broken pair — voicing 升序拆中点:lower 半 strike @ onset / upper 半 strike @ onset + halfDur。
 * 每簇内部仍 micro-strum(< 18ms cap)。
 */
function emitBrokenPair(
  out: NoteEvent[],
  voicing: number[],
  onset: number,
  duration: number,
  velocity: number,
): void {
  if (voicing.length === 0) return;
  const halfDur = duration / 2;
  const mid = Math.ceil(voicing.length / 2);
  const lower = voicing.slice(0, mid);
  const upper = voicing.slice(mid);
  emitStrike(out, lower, onset, halfDur * 0.9, velocity);
  if (upper.length > 0) {
    emitStrike(out, upper, onset + halfDur, halfDur * 0.9, velocity);
  }
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
