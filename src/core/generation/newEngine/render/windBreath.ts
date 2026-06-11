// ============================================================
// newEngine · render · 气声管乐 lead 气口减弱(2026-06-11,用户)
// ------------------------------------------------------------
// 用户:萧/排箫等气声管乐的【长音气口】应【减弱】(呼吸点气息渐弱),不要"一个音切另一个音"戛然而止。
//   这是器配/发声的真实物理:管乐靠气推动,长音末尾气息减弱 → 自然 diminuendo;短音连奏(legato)不减。
// 机制:为 wind 家族(GM 72-79)lead 生成 CC11(表情)包络 —— 每音起点复位满气(FULL),
//   长音(≥breathMinBeats)尾部 ramp 到 SOFT(气口减弱)。lead 单音(monophonic)→ 通道级 CC11 安全。
//   SpessaSynth 实时应用 CC11(表情)→ 真实渐弱。纯函数、确定性。
// ============================================================

import { type Timebase } from '../foundation';
import type { NoteIR } from '../ir/MusicalIR';

const CC_EXPRESSION = 11;
const FULL = 112; // 满气
const SOFT = 70;  // 气口减弱到的气息底

/** GM Pipe 家族(72-79):长笛/排箫/尺八/口哨/陶笛等气声管乐(都靠气、长音气息会减弱)。 */
export function isWindFamily(program: number): boolean {
  return program >= 72 && program <= 79;
}

export interface CcEvent { atTick: number; controller: number; value: number; }

export interface WindBreathOptions {
  breathMinBeats?: number; // 多长的音才在尾部减弱(默认 1.25 拍)
  steps?: number;          // 渐弱离散步数(默认 4)
}

/**
 * 气声 lead 的 CC11 气口包络:每音起点 FULL(连奏复位满气),长音尾部 ramp FULL→SOFT(气口减弱)。
 *   短音不减(legato 连贯)。返回按 tick 升序的 CC11 事件;同 tick 去重(后者覆盖)。
 */
export function windBreathCcEvents(notes: readonly NoteIR[], timebase: Timebase, opts: WindBreathOptions = {}): CcEvent[] {
  const ppq = timebase.ppq;
  const breathMin = Math.round((opts.breathMinBeats ?? 1.25) * ppq);
  const steps = Math.max(1, opts.steps ?? 4);
  const sorted = [...notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
  const raw: CcEvent[] = [];
  for (const n of sorted) {
    const start = n.startTick as number;
    const end = start + (n.durationTicks as number);
    raw.push({ atTick: start, controller: CC_EXPRESSION, value: FULL }); // 每音起点复位满气(连奏不掉)
    const dur = end - start;
    if (dur < breathMin) continue;                       // 短音:不减弱,保 legato
    const taperLen = Math.min(Math.round(dur * 0.5), ppq); // 尾部最多 1 拍渐弱
    const taperStart = end - taperLen;
    for (let s = 1; s <= steps; s++) {
      const frac = (s - 0.5) / steps;                    // 严格落在 (taperStart, end) 内,避开 note-off tick
      const value = Math.round(FULL + (SOFT - FULL) * frac);
      raw.push({ atTick: Math.round(taperStart + taperLen * frac), controller: CC_EXPRESSION, value });
    }
  }
  // 按 tick 升序;同 tick 取后者(起点 FULL 覆盖上一音的减弱尾,保证新音满气)
  raw.sort((a, b) => a.atTick - b.atTick);
  const out: CcEvent[] = [];
  for (const e of raw) {
    if (out.length && out[out.length - 1].atTick === e.atTick) out[out.length - 1] = e;
    else out.push(e);
  }
  return out;
}
