// ============================================================
// bass-pattern.ts — Impro-Visor BassPattern 解释器
// ============================================================
//
// 原型:`/Users/mynority/vibe_coding/Impro-Visor/src/imp/style/stylePatterns/BassPattern.java`
//
// Rule DSL(单声部 bass walking):
//   B4     bass note(chord root)at quarter
//   S4     scale tone(diatonic to chord scale)
//   C4     chord tone(spell 内任意)
//   A8     approach tone(±1 半音 leading to next)
//   1-12   interval above root(数字代表 semitone interval)
//   R8     rest
//   V90    set velocity
//   B4+8   bass note tied dotted quarter
//   U / D  up / down direction modifier(前缀,改下一 note 方向偏好)
//   =4     hold previous(沿用上一 note)
//
// 输入:
//   rules:string[]                — token 数组
//   chordRoot:0-11                — 本 chord root pc
//   chordSpell:number[]           — chord tone pcs(spell)
//   chordColor:number[]           — color tone pcs(approach 候选)
//   scalePcs:number[]             — diatonic scale pcs(给 S 选音)
//   nextChordRoot:0-11 | null     — 下一 chord root(给 A approach 选目标)
//   prevBassMidi:number           — 上一 bass MIDI(voice leading 锚点)
//   bassLowMidi / bassHighMidi    — 物理音域
//   startBeat / chordBeats
//   rng:Random
//
// 输出:NoteEvent[](part='bass')
// ============================================================

import type { Random } from '../../af2-engine/utils/Random';
import { parseDurationBeats } from './duration-parser';
import { placeBassMidi } from './note-utils';
import type { NoteEvent } from './chord-pattern';

const DEFAULT_VELOCITY = 95;

export function applyBassPattern(
  rules: string[],
  chordRoot: number,
  chordSpell: number[],
  chordColor: number[],
  scalePcs: number[],
  nextChordRoot: number | null,
  prevBassMidi: number,
  bassLowMidi: number,
  bassHighMidi: number,
  startBeat: number,
  chordBeats: number,
  rng: Random,
): NoteEvent[] {
  const out: NoteEvent[] = [];
  let cursor = 0;
  let velocity = DEFAULT_VELOCITY;
  let directionBias = 0;        // -1=down / 0=any / +1=up(U/D 修饰)
  let prevPc = chordRoot;
  let prevMidi = prevBassMidi;

  for (let ti = 0; ti < rules.length; ti++) {
    const raw = rules[ti]!;
    if (!raw) continue;
    const ch = raw[0]!;

    if (ch === 'V') {
      const v = parseInt(raw.slice(1), 10);
      if (!isNaN(v)) velocity = Math.max(0, Math.min(127, v));
      continue;
    }
    if (ch === 'U') { directionBias = +1; continue; }
    if (ch === 'D') { directionBias = -1; continue; }
    if (ch === '=') {
      // hold previous(同 prev pitch + dur)
      const dur = parseDurationBeats(raw.slice(1));
      if (dur > 0 && cursor < chordBeats) {
        out.push({
          pitch: prevMidi,
          onset: startBeat + cursor,
          duration: Math.min(dur, chordBeats - cursor) * 0.95,
          velocity,
          part: 'bass',
        });
        cursor += dur;
      }
      continue;
    }
    if (ch === 'R') {
      cursor += parseDurationBeats(raw.slice(1));
      continue;
    }

    // 决定 pc + 解析 duration
    let pc: number;
    let durStr: string;
    if (ch === 'B') {
      pc = chordRoot;
      durStr = raw.slice(1);
    } else if (ch === 'C') {
      pc = pickFrom(chordSpell, prevPc, directionBias, rng);
      durStr = raw.slice(1);
    } else if (ch === 'S') {
      const pool = scalePcs.length > 0 ? scalePcs : chordSpell;
      pc = pickFrom(pool, prevPc, directionBias, rng);
      durStr = raw.slice(1);
    } else if (ch === 'A') {
      pc = pickApproachPc(nextChordRoot, prevPc, directionBias, chordColor);
      durStr = raw.slice(1);
    } else if (ch >= '0' && ch <= '9') {
      // 数字 interval(B 的同义,offset above root)
      // 'B5' = root+5 是常见,但格式 ambiguous;此处 fallback root
      pc = chordRoot;
      durStr = raw;
    } else {
      continue;
    }

    const dur = parseDurationBeats(durStr);
    if (dur <= 0 || cursor >= chordBeats) {
      directionBias = 0;
      continue;
    }
    const midi = placeBassMidi(pc, prevMidi, bassLowMidi, bassHighMidi);
    out.push({
      pitch: midi,
      onset: startBeat + cursor,
      duration: Math.min(dur, chordBeats - cursor) * 0.95,
      velocity,
      part: 'bass',
    });
    prevPc = pc;
    prevMidi = midi;
    cursor += dur;
    directionBias = 0;          // U/D 用完即 reset
  }
  return out;
}

/**
 * 从 pool 内选一个 pc(不重复 prev,方向偏好 bias)。
 * pool 为空 → 返 prev。
 */
function pickFrom(pool: number[], prevPc: number, _bias: number, rng: Random): number {
  if (pool.length === 0) return prevPc;
  // 简化:weighted random — 排除 prev(若有其他选)
  const candidates = pool.filter(pc => pc !== prevPc);
  const useFrom = candidates.length > 0 ? candidates : pool;
  return useFrom[Math.floor(rng.next() * useFrom.length)]!;
}

/**
 * 选 approach pc — ±1 半音 leading to next chord root。
 * nextRoot 为 null → fallback prev pc。
 */
function pickApproachPc(
  nextRoot: number | null,
  prevPc: number,
  bias: number,
  _chordColor: number[],
): number {
  if (nextRoot === null) return prevPc;
  if (bias > 0) return ((nextRoot - 1) + 12) % 12;   // approach from below
  if (bias < 0) return (nextRoot + 1) % 12;          // approach from above
  // 自动选(prev 离哪边近就反方向)
  const below = ((nextRoot - 1) + 12) % 12;
  const above = (nextRoot + 1) % 12;
  return Math.abs(prevPc - below) <= Math.abs(prevPc - above) ? below : above;
}
