// ============================================================
// drum-pattern.ts — Impro-Visor DrumPattern 解释器
// ============================================================
//
// 原型:`/Users/mynority/vibe_coding/Impro-Visor/src/imp/style/stylePatterns/DrumPattern.java`
//
// Pattern 结构(已 sty-parser 解析成 DrumPattern):
//   drums:[
//     { drum: 'Ride_Cymbal_1', rules: ['X4', 'X8', 'X8'] },
//     { drum: 'Closed_Hi-Hat', rules: ['R4', 'X4'] },
//   ]
//
// Per drum rule DSL(只 X/R/V):
//   X4   hit at quarter
//   X8   hit at eighth
//   X4.  hit at dotted quarter
//   R4   rest
//   V90  set velocity
//
// 输入:per pattern 选好后,展开 chordBeats 内的所有 hit。
// 输出:NoteEvent[](part='drums',pitch = GM drum MIDI)
//
// 处理 drum 名解析失败(unknown drum)→ 跳过整条 drum 行,但 lint 时 console.warn。
// ============================================================

import { parseDurationBeats } from './duration-parser';
import { drumNameToMidi } from './note-utils';
import type { DrumPattern } from '../data/sty-parser';
import type { NoteEvent } from './chord-pattern';

const DEFAULT_DRUM_VELOCITY = 100;

export function applyDrumPattern(
  pattern: DrumPattern,
  startBeat: number,
  chordBeats: number,
): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const drumLine of pattern.drums) {
    const midi = drumNameToMidi(drumLine.drum);
    if (midi === null) {
      // 未知 drum 名 — 跳过
      continue;
    }
    let cursor = 0;
    let velocity = DEFAULT_DRUM_VELOCITY;
    for (const raw of drumLine.rules) {
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
        if (cursor >= chordBeats) break;
        out.push({
          pitch: midi,
          onset: startBeat + cursor,
          duration: Math.min(dur, chordBeats - cursor) * 0.4,    // drum hit 短促
          velocity,
          part: 'drums',
        });
        cursor += dur;
        continue;
      }
    }
  }
  return out;
}
