// ============================================================
// newEngine · render · GroovePocket(MG 升级 Phase 2c part 2,directive §7.4)
// ------------------------------------------------------------
// GrooveContract 的 ms pocket → tick lay-back(ms→拍 via tempoBpm)。
// ★ lead + bass + comp:comp 的 pocketizeBeat 只负责把近网格 texture 收紧；
//   GrooveContract.chordPocketMs 在这里负责最终乐手 lay-back，二者职责不同。
// ★ pocket-handled 角色在 renderCoordinator【跳过 humanizeTiming】(lead 本就被 humanizeTiming 跳)
//   → pocket 是这些角色的唯一时序主(§7.4 不双重)。
// ★ legacy contract(BLUES/无 rng 兜底)pocket 全 [0,0] → pocketedRoles 空 → applyGroovePocket no-op(无漂)。
// 纯函数 + 稳定哈希(无 rng) → 确定性。
// ============================================================

import { ticks } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';
import type { GrooveScorePlan } from '../arranger/ArrangementPlan';

// DeepReadonly 把 [number,number] 元组宽化为 readonly number[];故宽接收 + 安全取 [0]/[1]。
type PocketMs = readonly number[];
export interface PocketContract {
  bassPocketMs: PocketMs;
  chordPocketMs?: PocketMs;
  melodyStrongPocketMs: PocketMs;
  melodyWeakPocketMs: PocketMs;
}

const ZERO_POCKET: PocketMs = [0, 0];

const lo = (p: PocketMs): number => p[0] ?? 0;
const hi = (p: PocketMs): number => p[1] ?? p[0] ?? 0;
const nz = (p: PocketMs): boolean => lo(p) !== 0 || hi(p) !== 0;

/** 需 pocket 落地的角色。空 = legacy(零洗牌)。 */
export function pocketedRoles(c: PocketContract): Set<string> {
  const roles = new Set<string>();
  if (nz(c.melodyStrongPocketMs) || nz(c.melodyWeakPocketMs)) roles.add('lead');
  if (nz(c.bassPocketMs)) roles.add('bass');
  if (nz(c.chordPocketMs ?? ZERO_POCKET)) roles.add('comp');
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

function isIntegerBeat(tick: number, ppq: number): boolean {
  const phase = (((tick / ppq) % 1) + 1) % 1;
  return Math.min(phase, 1 - phase) < 0.12;
}

function pocketedStartTick(tick: number, offset: number, barTicks: number): number {
  if (offset === 0) return tick;
  const absoluteBar = Math.max(0, Math.floor(tick / barTicks));
  const barStart = absoluteBar * barTicks;
  const barEnd = barStart + barTicks - 1;
  return Math.max(barStart, Math.min(barEnd, tick + offset));
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
        } else if (t.role === 'comp') {
          // Integer-beat chord attacks are structural anchors; the chord pocket
          // colors answers and offbeats without creating a band-wide flam.
          p = isIntegerBeat(tick, ppq) ? ZERO_POCKET : c.chordPocketMs ?? ZERO_POCKET;
        } else {
          // lead:强拍(整拍上)用 melodyStrongPocket,弱拍(反拍)用 melodyWeakPocket。
          const beatInBar = (((tick / ppq) % beatsPerBar) + beatsPerBar) % beatsPerBar;
          const onBeat = Math.abs(beatInBar - Math.round(beatInBar)) < 0.12;
          p = onBeat ? c.melodyStrongPocketMs : c.melodyWeakPocketMs;
        }
        // Polyphonic comp notes at one tick are one physical chord attack and
        // must receive one shared offset. Bass/lead retain per-note variation.
        const key = t.role === 'comp' ? tick : tick + (n.pitch as number);
        const off = pocketTickOffset(p, key, tempoBpm, ppq);
        const startTick = pocketedStartTick(tick, off, ppq * beatsPerBar);
        return startTick === tick ? n : { ...n, startTick: ticks(startTick) };
      }),
    };
  });
}

/** Union used by the timing humanizer when contracts may vary by section. */
export function pocketedRolesForContracts(contracts: readonly PocketContract[]): Set<string> {
  const roles = new Set<string>();
  for (const contract of contracts) for (const role of pocketedRoles(contract)) roles.add(role);
  return roles;
}

/**
 * Section-aware production path. GrooveScorePlan supplies the absolute-bar to
 * section mapping, so future section contract changes cannot silently fall
 * back to the song-level pocket.
 */
export function applyGroovePocketBySection(
  tracks: TrackIR[],
  fallback: PocketContract,
  bySection: Readonly<Record<string, PocketContract>>,
  scorePlan: Readonly<GrooveScorePlan>,
  tempoBpm: number,
  ppq: number,
  beatsPerBar: number,
  excludeRoles?: ReadonlySet<string>,
): TrackIR[] {
  const contractByBar = new Map<number, PocketContract>();
  for (const sectionScore of Object.values(scorePlan.bySection)) {
    const contract = bySection[sectionScore.sectionId] ?? fallback;
    for (const bar of sectionScore.bars) contractByBar.set(bar.absoluteBar, contract);
  }
  const contracts = [fallback, ...Object.values(bySection)];
  if (pocketedRolesForContracts(contracts).size === 0) return tracks;
  const barTicks = ppq * beatsPerBar;
  return tracks.map((track) => {
    if (excludeRoles?.has(track.role)) return track;
    return {
      ...track,
      notes: track.notes.map((note) => {
        const tick = note.startTick as number;
        const contract = contractByBar.get(Math.max(0, Math.floor(tick / barTicks))) ?? fallback;
        if (!pocketedRoles(contract).has(track.role)) return note;
        let pocket: PocketMs;
        if (track.role === 'bass') pocket = contract.bassPocketMs;
        else if (track.role === 'comp') {
          pocket = isIntegerBeat(tick, ppq) ? ZERO_POCKET : contract.chordPocketMs ?? ZERO_POCKET;
        }
        else {
          const beatInBar = (((tick / ppq) % beatsPerBar) + beatsPerBar) % beatsPerBar;
          const onBeat = Math.abs(beatInBar - Math.round(beatInBar)) < 0.12;
          pocket = onBeat ? contract.melodyStrongPocketMs : contract.melodyWeakPocketMs;
        }
        const key = track.role === 'comp' ? tick : tick + (note.pitch as number);
        const offset = pocketTickOffset(pocket, key, tempoBpm, ppq);
        const startTick = pocketedStartTick(tick, offset, barTicks);
        return startTick === tick ? note : { ...note, startTick: ticks(startTick) };
      }),
    };
  });
}
