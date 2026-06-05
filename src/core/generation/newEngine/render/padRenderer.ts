// ============================================================
// newEngine · render · PadRenderer(sustain / air / 慢声部层)
// ------------------------------------------------------------
// pad = 独立乐器轨,但【不再复制完整和弦】。按 PadCompPolicy 的 PadCompDecision 选 voicing:
//   · comp active → guide-tone(3rd/7th,≤2 音)或 drone(单共同音);省 root(bass 有)、通常省 5th。
//   · comp inactive(pad-only 段)→ full-support(≤3 音,可含 5th / 一个延伸),pad 承担更多和声。
//   · silent → 不出音(jazz combo / 低密度 / pad 不在场)。
// 音区 mid-soft,thin + soft → 与 comp 像"弦乐垫 + 钢琴"共存(靠减内容而非 EQ 解决 mud)。
//   绝对音高避让由 comp 侧消费 padOccupiedPitchesBySpan 完成(comp 先让 pad)。pad→audio ch4。
// 纯函数、确定性、深不可变安全。
// ============================================================

import { midi, mod12, type Timebase } from '../foundation';
import { pcToMidiInRange } from '../knowledge/pitchPlacement';
import type { HarmonicPlan, ChordSpan } from '../harmony/HarmonicPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import type { PadCompDecision } from './padCompPolicy';

const PAD_LOW = 55;
const PAD_HIGH = 79;
const DEFAULT_LEAD_LOW = 67; // melodyReservationPlan.reservedRegister.lowMidi 缺省

export interface PadOptions {
  padDensity: number;                                  // styleProfile.padDensity → 整体存在感(0..1)
  decisionBySection: Record<string, PadCompDecision>;  // 每段 pad↔comp 决策(coordinator 算)
  leadReservedLow?: number;                            // 旋律保留区地板:pad 顶须 < 此(避让 lead)
}

interface RolePcs {
  root?: number;
  third?: number;
  fifth?: number;
  seventh?: number;
}

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
 * 选 pad 的 pitch classes(≤ padMaxVoices)。
 *   guide-tone:[3rd, 7th] 优先(承载和声身份);drone:单音偏共同音/3rd/7th/5th;
 *   full-support:[3rd, 7th, 5th 或一个延伸]。按 decision 省 root / 省 5th。
 *   共同音(∩ 前后和弦稳定音)提前 → 截断时优先保留 → pad 锚点稳。
 */
function selectPadPcs(
  span: ChordSpan,
  prev: ChordSpan | undefined,
  next: ChordSpan | undefined,
  dec: PadCompDecision,
  stableToneMap: HarmonicPlan['stableToneMap'],
  colorToneMap: HarmonicPlan['colorToneMap'],
): number[] {
  const roles = classifyRoles(span.rootPc, stableToneMap[span.id] ?? []);
  const ext = colorToneMap[span.id] ?? []; // 9 / 11 / 13 等延伸色彩

  const ordered: number[] = [];
  const push = (pc: number | undefined) => { if (pc !== undefined && !ordered.includes(pc)) ordered.push(pc); };

  if (dec.padMode === 'full-support') {
    push(roles.third); push(roles.seventh);
    push(ext[0]);                 // 一个延伸色彩
    if (!dec.padOmitFifth) push(roles.fifth);
  } else if (dec.padMode === 'drone') {
    push(roles.third); push(roles.seventh);
    if (!dec.padOmitFifth) push(roles.fifth);
    push(ext[0]);
  } else {
    // guide-tone(及其它 thin mode):3rd + 7th 为核,缺则补 6/9 色彩。
    push(roles.third); push(roles.seventh);
    push(ext[0]); push(ext[1]);
    if (!dec.padOmitFifth) push(roles.fifth);
  }

  let cands = ordered.filter((pc) => {
    if (dec.padOmitRoot && pc === roles.root) return false;
    if (dec.padOmitFifth && pc === roles.fifth) return false;
    return true;
  });

  // 共同音提前(稳定排序:仅把共同音抬到最前,其余相对次序不变)。
  const prevTones = prev ? new Set(stableToneMap[prev.id] ?? []) : new Set<number>();
  const nextTones = next ? new Set(stableToneMap[next.id] ?? []) : new Set<number>();
  const isCommon = (pc: number) => prevTones.has(pc) || nextTones.has(pc);
  cands = cands
    .map((pc, idx) => ({ pc, idx, c: isCommon(pc) ? 0 : 1 }))
    .sort((a, b) => a.c - b.c || a.idx - b.idx)
    .map((x) => x.pc);

  if (cands.length === 0) {
    const fb = roles.third ?? roles.root; // 兜底:至少 1 音承载身份
    if (fb !== undefined) cands = [fb];
  }
  return cands.slice(0, Math.max(0, dec.padMaxVoices));
}

/** 把选中的 pc 落到 [low, high] 窗口(不同 pc 各自最低八度;去重、升序)。 */
function placePadMidis(pcs: number[], low: number, high: number): number[] {
  const out: number[] = [];
  for (const pc of pcs) {
    const m = pcToMidiInRange(pc, low, high) as number;
    if (!out.includes(m)) out.push(m);
  }
  return out.sort((a, b) => a - b);
}

export function renderPad(plan: HarmonicPlan, timebase: Timebase, opts: PadOptions): TrackIR {
  const notes: NoteIR[] = [];
  const { padDensity, decisionBySection } = opts;
  const leadLow = opts.leadReservedLow ?? DEFAULT_LEAD_LOW;
  const timeline = plan.chordTimeline;

  for (let i = 0; i < timeline.length; i++) {
    const span = timeline[i];
    const dec = decisionBySection[span.sectionId];
    if (!dec || dec.padMode === 'silent' || dec.padMaxVoices < 1) continue; // 缺决策 = 静默(fail-closed)

    const compActive = dec.interactionMode === 'pad-under-comp' || dec.interactionMode === 'breath-space';
    // 音区窗口:顶须 < 旋律保留区(避让 lead);comp active → mid-soft 抬底(让出低区给 bass/comp 核心)。
    const high = Math.min(PAD_HIGH, leadLow - 1);
    const low = compActive ? Math.max(PAD_LOW, 58) : PAD_LOW;

    const pcs = selectPadPcs(span, timeline[i - 1], timeline[i + 1], dec, plan.stableToneMap, plan.colorToneMap);
    const midis = placePadMidis(pcs, low, Math.max(low, high));
    if (midis.length === 0) continue;

    // 力度:pad 是背景层 → 整体软;comp active 时更软(更让位);drone(单音)再软一档。
    const recede = compActive ? 0.7 : 0.92;
    const droneSoft = dec.padMode === 'drone' ? 0.88 : 1;
    const vel = Math.max(1, Math.min(127, Math.round((30 + padDensity * 16) * recede * droneSoft)));

    const startTick = timebase.beatToTick(span.startBeat);
    const durationTicks = timebase.beatToTick(span.durationBeats); // 长 sustain:整段
    for (const m of midis) {
      notes.push({ pitch: midi(m), startTick, durationTicks, velocity: vel });
    }
  }
  return { role: 'pad', notes };
}
