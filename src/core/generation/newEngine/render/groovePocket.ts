// ============================================================
// newEngine · render · GroovePocket(MG 升级 Phase 2c part 2,directive §7.4)
// ------------------------------------------------------------
// GrooveContract 的 ms pocket → tick lay-back(ms→拍 via tempoBpm)。
// ★ 只 lead + bass:comp 的 pocket 由 accompanimentRenderer.pocketizeBeat 拥有(已是 per-span lay-back),
//   这里不再叠 chordPocket → 避免 comp 双重 humanize(§7.4)。
// ★ pocket-handled 角色(此处 bass)在 renderCoordinator【跳过 humanizeTiming】(lead 本就被 humanizeTiming 跳)
//   → pocket 是这些角色的唯一时序主(§7.4 不双重)。
// ★ legacy contract pocket 全 [0,0] → pocketedRoles 空 → applyGroovePocket no-op(非 ACG 零洗牌)。
// 纯函数 + 稳定哈希(无 rng) → 确定性。
// ============================================================

import { ticks } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';

// DeepReadonly 把 [number,number] 元组宽化为 readonly number[];故宽接收 + 安全取 [0]/[1]。
type PocketMs = readonly number[];
export interface PocketContract {
  bassPocketMs: PocketMs;
  melodyStrongPocketMs: PocketMs;
  melodyWeakPocketMs: PocketMs;
}

const lo = (p: PocketMs): number => p[0] ?? 0;
const hi = (p: PocketMs): number => p[1] ?? p[0] ?? 0;
const nz = (p: PocketMs): boolean => lo(p) !== 0 || hi(p) !== 0;

/** 需 pocket 落地的角色:lead(melody pocket 非 0)/ bass(bass pocket 非 0)。空 = legacy(零洗牌)。 */
export function pocketedRoles(c: PocketContract): Set<string> {
  const roles = new Set<string>();
  if (nz(c.melodyStrongPocketMs) || nz(c.melodyWeakPocketMs)) roles.add('lead');
  if (nz(c.bassPocketMs)) roles.add('bass');
  return roles;
}

// 稳定 [0,1) 哈希:确定性 per-note pocket 变化(替代被跳过的 humanize 抖动,给 lay-back 自然微差)。
function hash01(n: number): number {
  let h = (Math.imul(n | 0, 2654435761) >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** pocket 区间 [min,max]ms → tick 偏移(稳定哈希取区间内确定性值;ms→拍×ppq)。 */
function pocketTickOffset(p: PocketMs, key: number, tempoBpm: number, ppq: number): number {
  const ms = lo(p) + (hi(p) - lo(p)) * hash01(key);
  return Math.round((ms * tempoBpm) / 60000 * ppq);
}

/**
 * ACG ms-pocket → lead+bass onset lay-back(+=晚/lay-back,负 ms=push 提前)。
 * 其余角色原样。pocketedRoles 空(legacy) → 整体原样返回(零洗牌)。
 */
export function applyGroovePocket(
  tracks: TrackIR[],
  c: PocketContract,
  tempoBpm: number,
  ppq: number,
  beatsPerBar: number,
  excludeRoles?: ReadonlySet<string>,
): TrackIR[] {
  const roles = pocketedRoles(c);
  if (roles.size === 0) return tracks; // legacy pocket=0 → no-op
  return tracks.map((t) => {
    if (!roles.has(t.role) || excludeRoles?.has(t.role)) return t; // ★ excludeRoles:走A override lead 自带权威 timing,不被 band pocket 覆盖
    return {
      ...t,
      notes: t.notes.map((n) => {
        const tick = n.startTick as number;
        let p: PocketMs;
        if (t.role === 'bass') {
          p = c.bassPocketMs;
        } else {
          // lead:强拍(整拍上)用 melodyStrongPocket,弱拍(反拍)用 melodyWeakPocket。
          const beatInBar = (((tick / ppq) % beatsPerBar) + beatsPerBar) % beatsPerBar;
          const onBeat = Math.abs(beatInBar - Math.round(beatInBar)) < 0.12;
          p = onBeat ? c.melodyStrongPocketMs : c.melodyWeakPocketMs;
        }
        const off = pocketTickOffset(p, tick + (n.pitch as number), tempoBpm, ppq);
        return off === 0 ? n : { ...n, startTick: ticks(Math.max(0, tick + off)) };
      }),
    };
  });
}
