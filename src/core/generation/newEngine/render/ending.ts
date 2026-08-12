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
// ★ Loop G:末和弦延留角色默认 = 和声件 comp/pad(不含 lead;lead 时值不被 tag 强拉)。
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
    // ★ Loop G:延留角色 = endingPlan.sustainRoles(默认 comp/pad)。lead 即使被误配进集合也不强拉时值。
    const sustainSet = endingPlan.sustainRoles ? new Set<string>(endingPlan.sustainRoles) : DEFAULT_SUSTAIN;
    const isHold = t.role !== 'lead' && endingPlan.holdFinalChord && sustainSet.has(t.role);
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
    return { ...t, notes };
  });
}

/** lead-in 衔接:伴奏 crescendo 0.82→1.18；lead 轻量 0.92→1.08，保留 MG 原始表情。 */
export function applyLeadIns(tracks: TrackIR[], leadInBars: ReadonlySet<number>, ppq: number, bpb: number): TrackIR[] {
  if (leadInBars.size === 0) return tracks;
  const barTicks = bpb * ppq;
  return tracks.map((t) => {
    return {
      ...t,
      notes: t.notes.map((n) => {
        const st = n.startTick as number;
        const bar = Math.floor(st / barTicks);
        if (!leadInBars.has(bar)) return n;
        const pos = clamp01((st - bar * barTicks) / barTicks);
        const scale = t.role === 'lead'
          ? 0.92 + 0.16 * pos
          : 0.82 + 0.36 * pos;
        return { ...n, velocity: clampVel(n.velocity * scale) };
      }),
    };
  });
}

// ============================================================
// ★ ending 重构(2026-08-12,墨盒审计后):终止区手势 —— applyEnding 只会"停止",
//   这里补上"终止":最后一击(cold/tag 的 crash+kick)、lead liquidation+持留落点、
//   末小节长时值化(伪 ritardando:细碎 onset 收敛 + 延音到落点)。
//   仍是纯确定性投影;唯一"加音"= 鼓的最后一击(endingPlan 驱动,合同可见)。
// ============================================================

const GM_KICK = 36;
const GM_CRASH = 49;

/** 终止区手势(在 applyEnding 之后调用;ACG/Jazz54 score-owned 在调用点豁免)。 */
export function applyEndingCadenceZone(
  tracks: TrackIR[],
  arrangement: ArrangementPlan,
  endingPlan: EndingPlan,
  ppq: number,
  bpb: number,
): TrackIR[] {
  const barTicks = bpb * ppq;
  const win = outroWindow(arrangement, endingPlan.outroSectionId, barTicks);
  if (!win) return tracks;
  const { end: outroEnd } = win;
  const lastBarStart = outroEnd - barTicks;
  const liquidationStart = outroEnd - 2 * barTicks; // 终止区 = 末 2 小节
  const releaseTicks = Math.max(1, Math.round(ppq * 0.06));

  return tracks.map((t) => {
    if (t.role === 'drum') {
      // 最后一击:cold/tag 在末小节下拍补 kick+crash(fade 不打,继续渐隐)
      if (!endingPlan.coldStop && !endingPlan.holdFinalChord) return t;
      if (t.notes.length === 0) return t; // 编制里无鼓 → 不无中生有
      const hasFinalDownbeat = t.notes.some((n) => Math.abs((n.startTick as number) - lastBarStart) <= ppq * 0.1);
      if (hasFinalDownbeat) return t;
      const hit = (pitch: number, velocity: number): NoteIR => ({
        pitch, startTick: lastBarStart, durationTicks: Math.round(barTicks / 2), velocity,
      } as unknown as NoteIR);
      return { ...t, notes: [...t.notes.filter((n) => (n.startTick as number) < lastBarStart), hit(GM_KICK, 108), hit(GM_CRASH, 102)] };
    }
    // ⚠️ lead 不在此处理:mgFinalLeadParity / productLeadNonMutation 合同 = lead 在 MG
    //   生成后事件级不可变异(当年撤末音 snap 同理)。lead 的 liquidation/持留落点必须
    //   走上游(RoadMap 终止 brick / scheduler),列 ending 重构后备。
    if (t.role === 'comp' || t.role === 'bass' || t.role === 'pad') {
      // 伪 ritardando:末小节 beat2 之后的 onset 收敛(丢),留存音延到曲末(cold 例外:保持干净停)
      const kept = t.notes.filter((n) => {
        const st = n.startTick as number;
        return st < lastBarStart + 2 * ppq || st < lastBarStart;
      });
      if (endingPlan.coldStop) return { ...t, notes: kept };
      return {
        ...t,
        notes: kept.map((n) => {
          const st = n.startTick as number;
          if (st < lastBarStart) return n;
          return { ...n, durationTicks: ticks(Math.max(n.durationTicks as number, outroEnd - st - releaseTicks)) };
        }),
      };
    }
    return t;
  });
}
