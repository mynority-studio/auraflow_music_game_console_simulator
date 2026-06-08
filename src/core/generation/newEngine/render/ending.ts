// ============================================================
// newEngine · render · Ending + LeadIn(2026-06-08)
// ------------------------------------------------------------
// 把 Arranger 的【边界意图】(endingStyle / entryBySection)投影成可听手势(不改 tempo):
//   applyEnding — 收尾:fade(outro 内力度渐弱 + 节奏件按 exitBarByRole 错开退出)/
//                 tag(末和弦延留 + 节奏件末小节退出 = 渐慢感)/ cold(末小节 button 重音 + 干净停)。
//   applyLeadIns — 衔接:能量跃升段前一段【末小节】做 crescendo,把能量推向下一段下拍(release)。
// 纯力度/时值变换、确定性;退出 = 丢音(只减不增 → 不会引入和声 avoid)。
// ============================================================

import { ticks } from '../foundation';
import type { InstrumentRoleName } from '../band/BandSpec';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import type { EndingPlan } from '../instrumental/InstrumentationPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const clampVel = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
// ★ Loop G:末和弦延留角色默认 = 和声件 comp/pad(不含 lead;lead 落主音由 mgLeadRenderer snap 管,时值不被强拉)。
//   实际用 endingPlan.sustainRoles 覆盖(器配定:pad 优先/无 pad 用 comp)。
const DEFAULT_SUSTAIN = new Set<string>(['comp', 'pad']);

/** outro 段的 tick 窗口(从段落累加小节算,与 durationTicks 自洽)。无 outro → null。 */
function outroWindow(arrangement: ArrangementPlan, outroId: string | null, barTicks: number): { start: number; end: number } | null {
  if (outroId == null) return null;
  let cursor = 0;
  for (const s of arrangement.sections) {
    const start = cursor;
    const end = cursor + s.bars * barTicks;
    if (s.id === outroId) return { start, end };
    cursor = end;
  }
  return null;
}

/** 收尾手势:fade/tag/cold(见文件头)。bpb=每小节拍数,ppq=每拍 tick。 */
export function applyEnding(
  tracks: TrackIR[],
  arrangement: ArrangementPlan,
  endingPlan: EndingPlan,
  ppq: number,
  bpb: number,
): TrackIR[] {
  const barTicks = bpb * ppq;
  const win = outroWindow(arrangement, endingPlan.outroSectionId, barTicks);
  if (!win) return tracks;
  const { start: outroStart, end: outroEnd } = win;
  const lastBarStart = outroEnd - barTicks;
  const span = Math.max(1, outroEnd - outroStart);

  return tracks.map((t) => {
    const exitN = endingPlan.exitBarByRole[t.role as InstrumentRoleName];
    const exitTick = exitN !== undefined ? outroStart + exitN * barTicks : Infinity;
    // ★ 末和弦延留(tag):延留【真正最后一个和弦】到曲末,即便它起在末小节之前
    //   (否则末小节可能空 = tag 收不住)。先扫该 hold 声部在 outro 内的最晚起音作为延留起点。
    // ★ Loop G:延留角色 = endingPlan.sustainRoles(默认 comp/pad);protectLeadTiming → lead 永不被延留。
    const sustainSet = endingPlan.sustainRoles ? new Set<string>(endingPlan.sustainRoles) : DEFAULT_SUSTAIN;
    const leadProtected = endingPlan.protectLeadTiming !== false && t.role === 'lead';
    const isHold = endingPlan.holdFinalChord && sustainSet.has(t.role) && !leadProtected;
    let holdFrom = lastBarStart;
    if (isHold) {
      let maxStart = -1;
      for (const n of t.notes) { const st = n.startTick as number; if (st >= outroStart && st < Math.min(outroEnd, exitTick) && st > maxStart) maxStart = st; }
      if (maxStart >= 0) holdFrom = Math.min(lastBarStart, maxStart);
    }
    const notes: NoteIR[] = [];
    for (const n of t.notes) {
      const st = n.startTick as number;
      if (st >= exitTick) continue; // 该 role 退出点后(outro 内)静音 = 丢音
      let vel = n.velocity;
      let dur = n.durationTicks as number;
      if (st >= outroStart) {
        if (endingPlan.fadeOut) {
          const pos = clamp01((st - outroStart) / span);
          vel = vel * (1 - 0.82 * pos); // 1.0 → 0.18 线性渐弱
        }
        if (isHold && st >= holdFrom) {
          dur = Math.max(dur, outroEnd - st); // 末和弦延留到曲末(含起在末小节前的最后一个和弦)
        }
        if (endingPlan.coldStop) {
          if (st >= lastBarStart) vel = vel * 1.25;          // button 重音
          dur = Math.min(dur, Math.max(1, outroEnd - st));   // 干净停,不越界
        }
      }
      notes.push({ ...n, velocity: clampVel(vel), durationTicks: ticks(Math.max(1, Math.round(dur))) });
    }
    return { role: t.role, notes };
  });
}

/** lead-in 衔接:leadInBars(绝对小节序号,= 跃升段前一段末小节)内做 crescendo(0.82→1.18)推向下拍。 */
export function applyLeadIns(tracks: TrackIR[], leadInBars: ReadonlySet<number>, ppq: number, bpb: number): TrackIR[] {
  if (leadInBars.size === 0) return tracks;
  const barTicks = bpb * ppq;
  return tracks.map((t) => ({
    role: t.role,
    notes: t.notes.map((n) => {
      const st = n.startTick as number;
      const bar = Math.floor(st / barTicks);
      if (!leadInBars.has(bar)) return n;
      const pos = clamp01((st - bar * barTicks) / barTicks);
      return { ...n, velocity: clampVel(n.velocity * (0.82 + 0.36 * pos)) };
    }),
  }));
}
