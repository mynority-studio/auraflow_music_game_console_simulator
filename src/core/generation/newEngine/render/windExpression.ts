// ============================================================
// newEngine · render · 管乐 CC11 包络(第二层,晚期只读 pass)
// ------------------------------------------------------------
// 只读最终 lead 音符 → 发 ccEvents(不碰音符 = parity 无涉):
//   1) 起音包络:每音起点 CC11 = 平台-18,~0.3 拍内爬回平台("缓缓起来");
//   2) 长音强弱弧(≥1.5 拍):55% 处鼓到平台+8,90% 处收到平台-6(messa di voce);
//   3) 基线 = controllerPlan 的段落平台(两条 CC11 流不打架:包络围绕平台起伏)。
// 事件率纪律:短音(<0.25 拍)不发包络;相邻等值去重;Dream 5504 低速率友好。
// ============================================================

import type { NoteIR } from '../ir/MusicalIR';

export interface WindCcEvent { atTick: number; controller: number; value: number }

const clamp = (v: number): number => Math.max(20, Math.min(120, Math.round(v)));

export function buildWindLeadCc11Envelopes(
  notes: readonly NoteIR[],
  plateauEvents: readonly { atTick: number; value: number }[],
  ppq: number,
): WindCcEvent[] {
  if (notes.length === 0) return [];
  const plateaus = [...plateauEvents].sort((a, b) => a.atTick - b.atTick);
  const plateauAt = (tick: number): number => {
    let value = 85;
    for (const e of plateaus) { if (e.atTick <= tick) value = e.value; else break; }
    return value;
  };
  const out: WindCcEvent[] = [];
  const sorted = [...notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
  for (const n of sorted) {
    const st = n.startTick as number;
    const dur = n.durationTicks as number;
    if (dur < ppq * 0.25) continue; // 快速经过音不逐音包络
    const base = plateauAt(st);
    out.push({ atTick: st, controller: 11, value: clamp(base - 18) });                        // 软起
    out.push({ atTick: st + Math.min(Math.round(ppq * 0.3), Math.round(dur / 2)), controller: 11, value: clamp(base) });
    if (dur >= ppq * 1.5) { // 长音:鼓起再收
      out.push({ atTick: st + Math.round(dur * 0.55), controller: 11, value: clamp(base + 8) });
      out.push({ atTick: st + Math.round(dur * 0.9), controller: 11, value: clamp(base - 6) });
    }
  }
  // 排序 + 相邻等值去重(低速率纪律)
  out.sort((a, b) => a.atTick - b.atTick);
  const deduped: WindCcEvent[] = [];
  for (const e of out) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.value === e.value) continue;
    deduped.push(e);
  }
  return deduped;
}
