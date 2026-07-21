// ============================================================
// newEngine · render · PadRenderer(sustain / air / 慢声部层)
// ------------------------------------------------------------
// pad = 独立乐器轨。按 PadCompPolicy 的 PadCompDecision 选 voicing:
//   · chord-bed:当前和弦的薄铺底；不使用固定 3rd+7th 模板。
//   · guide-tone:仅供显式风格特效使用的 3rd+7th 壳，不是生产默认。
//   · drone:整段严格共同音；没有共同音就休息，不逐和弦平移出一条“三度旋律”。
//   · full-support:3-4 个当前和弦稳定音，pad-only 段承担完整和声。
//   · inner-line:慢内声部半音/全音级进线条(line cliché,neo-soul);按段重置 → 守 repeatGroup。
//   · cluster-mist:高区轻二度簇(ambient 雾感),软、远离低频(避 mud)。
//   · gated-pad:pad 自身节奏 shimmer(MIDI 层用节奏化音符表达;不耦合 comp,守"不碰伴奏")。
//   · silent:不出音。
// 铁律:pad 只用【当前和弦稳定音 / 正交音阶(chordScale)】内、非 avoid 的音；
//   配音优先共同音与小步移动。绝对音高避让由 comp 侧消费 padOccupiedPitchesBySpan。
//   纯函数、确定性、深不可变安全。pad→audio ch4。
// ============================================================

import { beats, midi, mod12, ticks, type Timebase } from '../foundation';
import type { HarmonicPlan, ChordSpan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import type { PadCompDecision } from './padCompPolicy';

const PAD_LOW = 48;          // C3:给 3-4 声部留出开放排列空间；仍高于常规 bass 主体
const PAD_HIGH = 79;
const CLUSTER_LOW = 60;       // cluster-mist 最低:远离低频(避 mud)
const COMP_ACTIVE_LOW = 48;   // 与 comp 共存时靠开放排列/精确同音避让，不把 Pad 挤成一组窄三度
const DEFAULT_LEAD_LOW = 67;  // melodyReservationPlan.reservedRegister.lowMidi 缺省

export interface PadOptions {
  padDensity: number;                                  // styleProfile.padDensity → 整体存在感(0..1)
  decisionBySection: Record<string, PadCompDecision>;  // 每段 pad↔comp 决策(coordinator 算)
  leadReservedLow?: number;                            // 旋律保留区地板:pad 顶须 < 此(避让 lead)
  padRegister?: { lowMidi: number; highMidi: number }; // 器配层选定 Pad 音色的实际写作音区
  // ★ pedal anchor 铺法(二选一,coordinator 按概率一首一掷):仅在整段存在严格共同结构音时
  //   铺一条 anchor 长 pedal + 一条随和弦走的 guide tone；无共同音则回退逐和弦选音。
  pedalAnchor?: boolean;
  tonicPc?: number;
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
 * 静态模式(chord-bed / guide-tone / full-support)的 Pad pitch classes。
 *   full-support 写当前和弦的完整 3-4 声部；chord-bed 写较薄的当前和弦上层；
 *   guide-tone 只保留作显式旧模式。共同音提前，让截断后的声部也尽量连续。
 */
function selectStaticPcs(
  span: ChordSpan, prev: ChordSpan | undefined, next: ChordSpan | undefined,
  dec: PadCompDecision, plan: HarmonicPlan, roles: RolePcs,
): number[] {
  const tensions = legalTensions(span, plan, roles);
  const ordered: number[] = [];
  const push = (pc: number | undefined) => { if (pc !== undefined && !ordered.includes(pc)) ordered.push(pc); };

  if (dec.padMode === 'full-support') {
    // Pad 独自承担和声：root/3/7 定义和弦，合法 9/11/13 优先于可省略的 5th。
    if (!dec.padOmitRoot) push(roles.root);
    push(roles.third);
    push(roles.seventh);
    push(tensions[0]);
    if (!dec.padOmitFifth) push(roles.fifth);
  } else if (dec.padMode === 'chord-bed' || dec.padMode === 'gated-pad') {
    // comp/bass 已承担节奏与低音：Pad 仍来自当前和弦，但只留薄的三声部。
    // 七和弦优先 root/3/7（有 bass 时 3/7/5），三和弦再由 5th 补完整。
    if (!dec.padOmitRoot) push(roles.root);
    push(roles.third);
    push(roles.seventh);
    if (!dec.padOmitFifth) push(roles.fifth);
    if (ordered.length < dec.padMaxVoices) push(tensions[0]);
  } else {
    // guide-tone(显式旧模式):3rd+7th 为核；不再由生产策略默认选择。
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

/** 把一个 pitch class 的全部可用八度列出来。 */
function pcToMidiInRangeStrict(pc: number, low: number, high: number): number | undefined {
  const base = mod12(pc);
  for (let m = low; m <= high; m++) if (mod12(m) === base) return m;
  return undefined;
}

function midiCandidatesForPc(pc: number, low: number, high: number): number[] {
  const out: number[] = [];
  for (let m = low; m <= high; m++) {
    if (mod12(m) === mod12(pc)) out.push(m);
  }
  return out;
}

/**
 * 开放排列 + 声部连接成本。共同绝对音高最优；其余声部倾向同音、级进或小三度内移动。
 * 首个和弦倾向 3 声部约 14 半音、4 声部约 18 半音的开放跨度，避免把每个 pc 都放到
 * “最低可用八度”后形成机械的连续三度堆叠。
 */
function padVoicingCost(midis: readonly number[], previous: readonly number[] | undefined, low: number, high: number): number {
  if (midis.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...midis].sort((a, b) => a - b);
  const span = sorted[sorted.length - 1] - sorted[0];
  const targetSpan = Math.min(high - low, sorted.length >= 4 ? 18 : sorted.length === 3 ? 14 : sorted.length === 2 ? 12 : 0);
  let cost = Math.abs(span - targetSpan) * 2;
  const center = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  cost += Math.abs(center - (low + high) / 2) * 0.35;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap < 4) cost += (4 - gap) * 6;
    if (gap > 12) cost += (gap - 12) * 1.5;
  }
  // C3-B3 只允许一条柔和底声；多条声部挤在这里会发糊。
  for (const pitch of sorted) if (pitch < 52) cost += (52 - pitch) * 0.7;

  if (previous?.length) {
    for (const pitch of sorted) {
      const nearest = Math.min(...previous.map((prev) => Math.abs(pitch - prev)));
      cost += nearest * 1.8;
      if (previous.includes(pitch)) cost -= 7;
    }
    for (const prev of previous) cost += Math.min(...sorted.map((pitch) => Math.abs(pitch - prev))) * 0.55;
    cost += Math.abs(sorted[sorted.length - 1] - previous[previous.length - 1]) * 0.7;
  }
  return cost;
}

function placePadMidis(pcs: number[], previous: readonly number[] | undefined, low: number, high: number): number[] {
  const candidates = pcs.map((pc) => midiCandidatesForPc(pc, low, high));
  if (candidates.some((values) => values.length === 0)) return [];
  let best: number[] = [];
  let bestCost = Number.POSITIVE_INFINITY;
  const visit = (index: number, chosen: number[]): void => {
    if (index >= candidates.length) {
      const sorted = [...chosen].sort((a, b) => a - b);
      const cost = padVoicingCost(sorted, previous, low, high);
      let lexical = best.length === 0;
      for (let i = 0; !lexical && i < sorted.length; i++) {
        if (sorted[i] === best[i]) continue;
        lexical = sorted[i] < best[i];
        break;
      }
      if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) <= 1e-9 && lexical)) {
        best = sorted;
        bestCost = cost;
      }
      return;
    }
    for (const pitch of candidates[index]) visit(index + 1, [...chosen, pitch]);
  };
  visit(0, []);
  return best;
}

/** inner-line:从合法 pad 音里取【最贴 prevTop】的为线条顶音(级进),再补一个 guide tone 作 body。 */
function innerLineMidis(
  span: ChordSpan, dec: PadCompDecision, plan: HarmonicPlan, roles: RolePcs,
  prevTop: number | undefined, low: number, high: number,
): number[] {
  const legalPcs = [roles.third, roles.seventh, ...legalTensions(span, plan, roles)]
    .filter((pc): pc is number => pc !== undefined && (!dec.padOmitRoot || pc !== roles.root));
  const placed = [...new Set(legalPcs.map((pc) => pcToMidiInRangeStrict(pc, low, high)).filter((m): m is number => m !== undefined))];
  if (placed.length === 0) return [];
  // 线条顶音:最贴上一段顶(半音/全音级进);无 prev → 取最高(线条起点稳定、确定性)。
  const ref = prevTop ?? Math.max(...placed);
  const top = placed.slice().sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref) || a - b)[0];
  const out = [top];
  if (dec.padMaxVoices >= 2) {
    // body:贴在 top 之下最近的 guide tone(3/7),不与 top 同音。
    const guides = [roles.third, roles.seventh].filter((pc): pc is number => pc !== undefined);
    const below = guides.map((pc) => pcToMidiInRangeStrict(pc, low, Math.max(low, top))).filter((m): m is number => m !== undefined)
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
  let anchorMidi = pcToMidiInRangeStrict(anchorPc, low, high);
  if (anchorMidi === undefined) return [];
  if (neighborPc === undefined) return [anchorMidi];
  if (anchorMidi + bestIv > high && anchorMidi - 12 >= low) anchorMidi -= 12; // 腾出二度空间(留高区)
  const neighborMidi = anchorMidi + bestIv;
  return neighborMidi <= high ? [anchorMidi, neighborMidi].sort((a, b) => a - b) : [anchorMidi];
}

/** 每段所有和弦稳定音的【严格共同音】(有主音时优先主音);无共同音则返回 undefined。 */
function commonToneBySection(
  timeline: HarmonicPlan['chordTimeline'],
  stableToneMap: HarmonicPlan['stableToneMap'],
  tonicPc?: number,
): Record<string, number | undefined> {
  const spansBySec: Record<string, string[]> = {};
  for (const s of timeline) (spansBySec[s.sectionId] ??= []).push(s.id);
  const out: Record<string, number | undefined> = {};
  for (const sid of Object.keys(spansBySec)) {
    let inter: Set<number> | null = null;
    for (const id of spansBySec[sid]) {
      const st = new Set<number>(stableToneMap[id] ?? []);
      inter = inter === null ? st : new Set<number>([...inter].filter((x) => st.has(x)));
    }
    const common = inter ? [...inter] : [];
    out[sid] = common.length
      ? (tonicPc !== undefined && common.includes(tonicPc) ? tonicPc : common.sort((a, b) => a - b)[0])
      : undefined;
  }
  return out;
}

interface SpanPad { startTick: number; endTick: number; startBeat: number; durBeats: number; sectionId: string; midis: number[]; vel: number; gated: boolean }

export function renderPad(plan: HarmonicPlan, timebase: Timebase, opts: PadOptions): TrackIR {
  const { padDensity, decisionBySection } = opts;
  const leadLow = opts.leadReservedLow ?? DEFAULT_LEAD_LOW;
  const timeline = plan.chordTimeline;
  const commonBySection = commonToneBySection(timeline, plan.stableToneMap, opts.tonicPc);
  let prevTop: number | undefined;       // inner-line 线条记忆
  let prevVoicing: number[] | undefined; // chord-bed/full-support 声部连接记忆
  let prevSection: string | undefined;   // 段落边界 → 重置 prevTop(守 repeatGroup)

  // —— 第一遍:逐 span 算 pad voicing + 力度 + 是否 gated(inner-line 线条记忆在此推进)——
  const perSpan: SpanPad[] = [];
  for (let i = 0; i < timeline.length; i++) {
    const span = timeline[i];
    const dec = decisionBySection[span.sectionId];
    if (span.sectionId !== prevSection) {
      prevTop = undefined;
      prevVoicing = undefined;
      prevSection = span.sectionId;
    }
    const startTick = timebase.beatToTick(span.startBeat) as number;
    const endTick = startTick + (timebase.beatToTick(span.durationBeats) as number);
    const slot: SpanPad = { startTick, endTick, startBeat: span.startBeat as number, durBeats: span.durationBeats as number, sectionId: span.sectionId, midis: [], vel: 0, gated: false };
    if (!dec || dec.padMode === 'silent' || dec.padMaxVoices < 1) { perSpan.push(slot); continue; } // 静默(fail-closed)

    const compActive = dec.interactionMode === 'pad-under-comp' || dec.interactionMode === 'breath-space' || dec.interactionMode === 'gated-pad-drives';
    const registerLow = opts.padRegister?.lowMidi ?? PAD_LOW;
    const registerHigh = opts.padRegister?.highMidi ?? PAD_HIGH;
    const high = Math.min(PAD_HIGH, registerHigh, leadLow - 1); // 顶须 < 旋律保留区(避让 lead)
    const lowFloor = dec.padMode === 'cluster-mist' ? CLUSTER_LOW : (compActive ? COMP_ACTIVE_LOW : PAD_LOW);
    const low = Math.max(PAD_LOW, registerLow, lowFloor);
    if (high < low) { perSpan.push(slot); continue; }
    const hi = high;
    const roles = classifyRoles(span.rootPc, plan.stableToneMap[span.id] ?? []);

    let midis: number[];
    if (dec.padMode === 'inner-line') {
      midis = innerLineMidis(span, dec, plan, roles, prevTop, low, hi);
      if (midis.length) prevTop = midis[midis.length - 1];
    } else if (dec.padMode === 'cluster-mist') {
      midis = clusterMidis(span, plan, roles, low, hi).slice(0, dec.padMaxVoices);
    } else if (dec.padMode === 'drone') {
      // Drone 必须真的是整段共同音；否则休息，不能逐和弦跟着 3rd 平移。
      const commonPc = commonBySection[span.sectionId];
      midis = commonPc === undefined ? [] : placePadMidis([commonPc], prevVoicing, low, hi);
    } else if (opts.pedalAnchor && commonBySection[span.sectionId] !== undefined) {
      // ★ pedal anchor 铺法:anchor 长 pedal(整段同 pc 同窗口 → tie 连成长音)+ 动 guide tone(随和弦走)。
      const anchorPc = commonBySection[span.sectionId]!;
      const anchorPcs = [anchorPc];
      if (dec.padMaxVoices >= 2) {
        const moveCands = [roles.third, roles.seventh, ...legalTensions(span, plan, roles)].filter((p): p is number => p !== undefined && p !== anchorPc);
        if (moveCands[0] !== undefined) anchorPcs.push(moveCands[0]);
      }
      midis = placePadMidis(anchorPcs, prevVoicing, low, hi);
    } else {
      const pcs = selectStaticPcs(span, timeline[i - 1], timeline[i + 1], dec, plan, roles);
      midis = placePadMidis(pcs, prevVoicing, low, hi);
    }
    if (midis.length === 0) { perSpan.push(slot); continue; }
    prevVoicing = midis;

    // 力度:pad 是背景层,相对软(comp active 更软;drone/cluster/gated 再软一档)。
    //   ★ 用户:pad 实际响度(CC7 96 × velocity)控制在 ~4500 → 抬基底使均值 velocity ≈ 47(原 ~27)。
    const recede = compActive ? 0.7 : 0.92;
    const modeSoft = dec.padMode === 'drone' ? 0.88 : (dec.padMode === 'cluster-mist' ? 0.78 : (dec.padMode === 'gated-pad' ? 0.82 : 1));
    const vel = Math.max(1, Math.min(127, Math.round((52 + padDensity * 28) * recede * modeSoft)));
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
        while (j + 1 < perSpan.length && perSpan[j + 1].startTick === perSpan[j].endTick && perSpan[j + 1].sectionId === perSpan[j].sectionId && has(j + 1)) j++; // ★ 段边界断开 tie:pad 每段重新起音(pedal/共同音不跨段连成全曲 drone)
        notes.push({ pitch: midi(p), startTick: ticks(runStart), durationTicks: ticks(perSpan[j].endTick - runStart), velocity: vel });
        i = j + 1;
      } else i++;
    }
  }
  notes.sort((a, b) => (a.startTick as number) - (b.startTick as number) || (a.pitch as number) - (b.pitch as number));
  return { role: 'pad', notes };
}
