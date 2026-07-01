// ============================================================
// newEngine · render · ACG lead 音域上浮(port MG tuckAcgMelodyLandings 的【register-lift】部分)
// ------------------------------------------------------------
// MG tuckAcgMelodyLandings(musicEngine.ts:7134-7181)对 ACG 旋律做两件事:
//   (a) 音域上浮:低于 A4(69)的旋律音逐八度上移进 soprano [69, MELODY_HIGH=86] —— 电影钢琴的"亮/浮"高位歌唱。
//   (b) 落点重定位 + 瘦身(相对 comp 琶音 apex 重排/删邻音、锁时值)。
// 本文件只 port (a)。(b) = 旋律重塑(近"替换生成",且会改 coverage/gap)→ 按用户边界"不先替换 ACG topline
//   旋律生成"暂 hold,待耳朵复核后再定。只改 lead pitch(八度),不动 start/dur/velocity/数量。
// ============================================================

import { midi } from '../foundation';
import type { TrackIR, NoteIR } from '../ir/MusicalIR';

const MELODY_HIGH = 86; // MG MELODY_RANGE.HIGH

/** 忠实 MG:while (pitch < 69 && pitch+12 <= 86) pitch += 12。低音逐八度上移进 soprano。 */
function liftNote(n: NoteIR): NoteIR {
  let p = n.pitch as number;
  while (p < 69 && p + 12 <= MELODY_HIGH) p += 12;
  return p === (n.pitch as number) ? n : { ...n, pitch: midi(p) };
}

/** ACG lead 音域上浮(只 ACG、只 lead、只改 pitch 八度)。 */
export function tuckAcgLeadRegister(track: TrackIR): TrackIR {
  const notes = track.notes.map(liftNote);
  return notes.some((n, i) => n !== track.notes[i]) ? { ...track, notes } : track;
}
