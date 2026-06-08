// ============================================================
// newEngine · render · PadRenderer(sustain / air / 慢声部层)
// ------------------------------------------------------------
// pad = 独立乐器轨,【不复制完整和弦】。按 PadCompPolicy 的 PadCompDecision 选 voicing:
//   · guide-tone:3rd+7th(身份),≤2 音;省 root(bass 有)、通常省 5th。
//   · drone:单共同音(最安全)。
//   · full-support:3rd+7th + 一个【上层结构张力】(9/11/13,upper structure),pad-only 段承担更多和声。
//   · inner-line:慢内声部半音/全音级进线条(line cliché,neo-soul);按段重置 → 守 repeatGroup。
//   · cluster-mist:高区轻二度簇(ambient 雾感),软、远离低频(避 mud)。
//   · gated-pad:pad 自身节奏 shimmer(MIDI 层用节奏化音符表达;不耦合 comp,守"不碰伴奏")。
//   · silent:不出音。
// 铁律:pad 是辅助轨 —— 只用【和弦上层结构 / 正交音阶(chordScale)】内、非 avoid 的音,
//   绝不漏掉 3/7 身份音(否则变成另一个和弦)。绝对音高避让由 comp 侧消费 padOccupiedPitchesBySpan。
//   纯函数、确定性、深不可变安全。pad→audio ch4。
// ============================================================

import { beats, midi, mod12, ticks, type Timebase } from '../foundation';
import { pcToMidiInRange } from '../knowledge/pitchPlacement';
import type { HarmonicPlan, ChordSpan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import type { PadCompDecision } from './padCompPolicy';

const PAD_LOW = 55;
const PAD_HIGH = 79;
const CLUSTER_LOW = 60;       // cluster-mist 最低:远离低频(避 mud)
const COMP_ACTIVE_LOW = 58;   // comp active 时 pad 抬底(让出低区给 bass/comp 核心)
const DEFAULT_LEAD_LOW = 67;  // melodyReservationPlan.reservedRegister.lowMidi 缺省

export interface PadOptions {
  padDensity: number;                                  // styleProfile.padDensity → 整体存在感(0..1)
  decisionBySection: Record<string, PadCompDecision>;  // 每段 pad↔comp 决策(coordinator 算)
  leadReservedLow?: number;                            // 旋律保留区地板:pad 顶须 < 此(避让 lead)
}

interface RolePcs { root?: number; third?: number; fifth?: number; seventh?: number }

/** 把和弦稳定音(root+3+5+7 的 pc)按距 root 的音程归类到声部角色。 */
function classifyRoles(rootPc: number, stableTones: readonly number[]): RolePcs {
  const out: RolePcs = {};
  for (const pc of stableTones) {
    const iv = mod12(pc - rootPc);
    if (iv === 0) out.root = pc;
    else if (iv === 3 || iv === 4) out.third = pc;
    else if (iv === 6 || iv === 7 || iv === 8) out.fifth = pc;
    else if (iv === 9) { if (out.seventh === undefined) out.seventh = pc; } // 6 和弦:9 度位当 7th 替身
    else if (iv === 10 || iv === 11) out.seventh = pc;
  }
  return out;
}

/**
 * 合法上层结构张力 pc:colorToneMap ∩ 正交音阶(chordScale ∪ 和弦音)∖ avoidNoteMap ∖ {root,fifth}。
 *   铁律:pad 张力必须落在【正交音阶 chordScale】内、非 avoid → 绝不破坏和声合同。
 */
function legalTensions(span: ChordSpan, plan: HarmonicPlan, roles: RolePcs): number[] {
  const color = plan.colorToneMap[span.id] ?? [];
  const avoid = new Set<number>(plan.avoidNoteMap[span.id] ?? []);
  const scale = new Set<number>([...(plan.chordScaleMap[span.id] ?? []), ...(plan.stableToneMap[span.id] ?? [])]);
  return color.filter((pc) => scale.has(pc) && !avoid.has(pc) && pc !== roles.root && pc !== roles.fifth);
}

/**
 * 静态模式(drone / guide-tone / full-support)的 pad pcs(≤ padMaxVoices)。
 *   guide-tone:[3rd,7th] 身份优先;不足补一个上层张力;drone:单音偏共同音;
 *   full-support:[3rd,7th + 一个上层结构张力],承担更多和声。共同音提前 → 截断优先存活。
 */
function selectStaticPcs(
  span: ChordSpan, prev: ChordSpan | undefined, next: ChordSpan | undefined,
  dec: PadCompDecision, plan: HarmonicPlan, roles: RolePcs,
): number[] {
  const tensions = legalTensions(span, plan, roles);
  const ordered: number[] = [];
  const push = (pc: number | undefined) => { if (pc !== undefined && !ordered.includes(pc)) ordered.push(pc); };

  if (dec.padMode === 'full-support') {
    push(roles.third); push(roles.seventh);
    push(tensions[0]);                       // 上层结构张力(9/11/13)在顶
    if (!dec.padOmitFifth) push(roles.fifth);
  } else if (dec.padMode === 'drone') {
    push(roles.third); push(roles.seventh);
    if (!dec.padOmitFifth) push(roles.fifth);
    push(tensions[0]);
  } else {
    // guide-tone(及兜底):3rd+7th 为核;三和弦缺 7th 时补一个上层张力(upper structure)再 5th。
    push(roles.third); push(roles.seventh);
    push(tensions[0]);
    if (!dec.padOmitFifth) push(roles.fifth);
  }

  let cands = ordered.filter((pc) => {
    if (dec.padOmitRoot && pc === roles.root) return false;
    if (dec.padOmitFifth && pc === roles.fifth) return false;
    return true;
  });

  // 共同音提前(稳定排序:仅把 ∩前/后和弦稳定音 的 pc 抬到最前)。
  const prevTones = prev ? new Set(plan.stableToneMap[prev.id] ?? []) : new Set<number>();
  const nextTones = next ? new Set(plan.stableToneMap[next.id] ?? []) : new Set<number>();
  const isCommon = (pc: number) => prevTones.has(pc) || nextTones.has(pc);
  cands = cands.map((pc, idx) => ({ pc, idx, c: isCommon(pc) ? 0 : 1 }))
    .sort((a, b) => a.c - b.c || a.idx - b.idx).map((x) => x.pc);

  if (cands.length === 0) {
    const fb = roles.third ?? roles.root;
    if (fb !== undefined) cands = [fb];
  }
  return cands.slice(0, Math.max(0, dec.padMaxVoices));
}

/** 把选中的 pc 落到 [low, high](不同 pc 各自最低八度;去重、升序)。 */
function placePadMidis(pcs: number[], low: number, high: number): number[] {
  const out: number[] = [];
  for (const pc of pcs) {
    const m = pcToMidiInRange(pc, low, high) as number;
    if (!out.includes(m)) out.push(m);
  }
  return out.sort((a, b) => a - b);
}

/** inner-line:从合法 pad 音里取【最贴 prevTop】的为线条顶音(级进),再补一个 guide tone 作 body。 */
function innerLineMidis(
  span: ChordSpan, dec: PadCompDecision, plan: HarmonicPlan, roles: RolePcs,
  prevTop: number | undefined, low: number, high: number,
): number[] {
  const legalPcs = [roles.third, roles.seventh, ...legalTensions(span, plan, roles)]
    .filter((pc): pc is number => pc !== undefined && (!dec.padOmitRoot || pc !== roles.root));
  const placed = [...new Set(legalPcs.map((pc) => pcToMidiInRange(pc, low, high) as number))];
  if (placed.length === 0) return [];
  // 线条顶音:最贴上一段顶(半音/全音级进);无 prev → 取最高(线条起点稳定、确定性)。
  const ref = prevTop ?? Math.max(...placed);
  const top = placed.slice().sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref) || a - b)[0];
  const out = [top];
  if (dec.padMaxVoices >= 2) {
    // body:贴在 top 之下最近的 guide tone(3/7),不与 top 同音。
    const guides = [roles.third, roles.seventh].filter((pc): pc is number => pc !== undefined);
    const below = guides.map((pc) => pcToMidiInRange(pc, low, Math.max(low, top)) as number)
      .filter((m) => m !== top).sort((a, b) => (top - a) - (top - b));
    if (below.length) out.push(below[0]);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** cluster-mist:锚一个 chord/color 音 + 其上方相邻 chordScale 音(二度簇),高区、紧排、≤2。 */
function clusterMidis(span: ChordSpan, plan: HarmonicPlan, roles: RolePcs, low: number, high: number): number[] {
  const scale = (plan.chordScaleMap[span.id] ?? plan.stableToneMap[span.id] ?? []) as readonly number[];
  const avoid = new Set<number>(plan.avoidNoteMap[span.id] ?? []);
  const anchorPc = roles.third ?? roles.seventh ?? scale[0];
  if (anchorPc === undefined) return [];
  // 上方相邻 scale 音(最小正音程 = 二度);排除 avoid。
  let neighborPc: number | undefined; let bestIv = 99;
  for (const pc of scale) {
    const iv = mod12(pc - anchorPc);
    if (iv >= 1 && iv <= 2 && iv < bestIv && !avoid.has(pc)) { bestIv = iv; neighborPc = pc; }
  }
  let anchorMidi = pcToMidiInRange(anchorPc, low, high) as number;
  if (neighborPc === undefined) return [anchorMidi];
  if (anchorMidi + bestIv > high && anchorMidi - 12 >= low) anchorMidi -= 12; // 腾出二度空间(留高区)
  const neighborMidi = anchorMidi + bestIv;
  return neighborMidi <= high ? [anchorMidi, neighborMidi].sort((a, b) => a - b) : [anchorMidi];
}

interface SpanPad { startTick: number; endTick: number; startBeat: number; durBeats: number; midis: number[]; vel: number; gated: boolean }

export function renderPad(plan: HarmonicPlan, timebase: Timebase, opts: PadOptions): TrackIR {
  const { padDensity, decisionBySection } = opts;
  const leadLow = opts.leadReservedLow ?? DEFAULT_LEAD_LOW;
  const timeline = plan.chordTimeline;
  let prevTop: number | undefined;       // inner-line 线条记忆
  let prevSection: string | undefined;   // 段落边界 → 重置 prevTop(守 repeatGroup)

  // —— 第一遍:逐 span 算 pad voicing + 力度 + 是否 gated(inner-line 线条记忆在此推进)——
  const perSpan: SpanPad[] = [];
  for (let i = 0; i < timeline.length; i++) {
    const span = timeline[i];
    const dec = decisionBySection[span.sectionId];
    if (span.sectionId !== prevSection) { prevTop = undefined; prevSection = span.sectionId; }
    const startTick = timebase.beatToTick(span.startBeat) as number;
    const endTick = startTick + (timebase.beatToTick(span.durationBeats) as number);
    const slot: SpanPad = { startTick, endTick, startBeat: span.startBeat as number, durBeats: span.durationBeats as number, midis: [], vel: 0, gated: false };
    if (!dec || dec.padMode === 'silent' || dec.padMaxVoices < 1) { perSpan.push(slot); continue; } // 静默(fail-closed)

    const compActive = dec.interactionMode === 'pad-under-comp' || dec.interactionMode === 'breath-space' || dec.interactionMode === 'gated-pad-drives';
    const high = Math.min(PAD_HIGH, leadLow - 1);         // 顶须 < 旋律保留区(避让 lead)
    const low = dec.padMode === 'cluster-mist' ? Math.max(CLUSTER_LOW, PAD_LOW) : (compActive ? COMP_ACTIVE_LOW : PAD_LOW);
    const hi = Math.max(low, high);
    const roles = classifyRoles(span.rootPc, plan.stableToneMap[span.id] ?? []);

    let midis: number[];
    if (dec.padMode === 'inner-line') {
      midis = innerLineMidis(span, dec, plan, roles, prevTop, low, hi);
      if (midis.length) prevTop = midis[midis.length - 1];
    } else if (dec.padMode === 'cluster-mist') {
      midis = clusterMidis(span, plan, roles, low, hi).slice(0, dec.padMaxVoices);
    } else {
      midis = placePadMidis(selectStaticPcs(span, timeline[i - 1], timeline[i + 1], dec, plan, roles), low, hi);
    }
    if (midis.length === 0) { perSpan.push(slot); continue; }

    // 力度:pad 是背景层 → 整体软;comp active 更软;drone/cluster/gated 再软一档(留白/雾/shimmer)。
    const recede = compActive ? 0.7 : 0.92;
    const modeSoft = dec.padMode === 'drone' ? 0.88 : (dec.padMode === 'cluster-mist' ? 0.78 : (dec.padMode === 'gated-pad' ? 0.82 : 1));
    const vel = Math.max(1, Math.min(127, Math.round((30 + padDensity * 16) * recede * modeSoft)));
    perSpan.push({ ...slot, midis, vel, gated: dec.padMode === 'gated-pad' });
  }

  // —— 第二遍:① gated span 各自节奏 emit(dormant);② 非 gated:共同音【tie】成跨 span 长音 ——
  //   只对【变化的声部】重新击发,持续的同一音高合并成一个长音 → 铺底连续(链接完整),不再每和弦重拍。
  const notes: NoteIR[] = [];
  for (const s of perSpan) {
    if (!s.gated || s.midis.length === 0) continue;
    const gateLen = timebase.beatToTick(beats(0.4)); // 8 分脉冲铺满整段
    for (let b = 0; b + 0.5 <= s.durBeats + 1e-9; b += 0.5) {
      const at = timebase.beatToTick(beats(s.startBeat + b));
      for (const m of s.midis) notes.push({ pitch: midi(m), startTick: at, durationTicks: gateLen, velocity: s.vel });
    }
  }
  const pitches = new Set<number>();
  for (const s of perSpan) if (!s.gated) for (const m of s.midis) pitches.add(m);
  for (const p of pitches) {
    const has = (k: number) => !perSpan[k].gated && perSpan[k].midis.includes(p);
    let i = 0;
    while (i < perSpan.length) {
      if (has(i)) {
        const runStart = perSpan[i].startTick;
        const vel = perSpan[i].vel; // run 取首 span 力度
        let j = i;
        while (j + 1 < perSpan.length && perSpan[j + 1].startTick === perSpan[j].endTick && has(j + 1)) j++;
        notes.push({ pitch: midi(p), startTick: ticks(runStart), durationTicks: ticks(perSpan[j].endTick - runStart), velocity: vel });
        i = j + 1;
      } else i++;
    }
  }
  notes.sort((a, b) => (a.startTick as number) - (b.startTick as number) || (a.pitch as number) - (b.pitch as number));
  return { role: 'pad', notes };
}
