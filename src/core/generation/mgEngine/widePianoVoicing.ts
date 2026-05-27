// ==========================================
// widePianoVoicing.ts — 钢琴-真实手感的宽阔排列 + 内部副旋律层.
//
// 不替代 assembleVoicing / placeVoicingMidi(它们继续为 close/drop2/spread
// 系统服务). 这一层是"零件级":
//   - 把和弦音按 register zone 分配到 6 条 voice lane
//   - 强拍弹整 7-voice 宽排列
//   - 弱拍只让 1-2 条 inner lane 朝下一个和弦"暗中漂"
//
// → 副旋律不是另起一条独立旋律,而是和弦排列内部的若隐若现声部.
//
// 风险点 + 已设计的解决:
//   1. Root 重复需要 conditional (colorLevel >= 1 才在 middle 加 root,
//      否则 bass 单独负责 root)
//   2. velocity 内部用 0-127 (MIDI 标准),pushEvent 时再 / 127 转 0-1
//   3. 选 midi 后必须跑 muddy-check (m9 cluster / 低区 m2/M2),
//      违例时把 voice 上移八度 (整层做完一次校正)
//   4. inner motion 跟既有 melodyEvents 碰撞检测合并,不要双 check
// ==========================================

import { ChordDef, NoteEvent } from './musicEngine';
import { SCALE_TYPES } from './musicTheory';

const pc = (n: number): number => ((n % 12) + 12) % 12;

// ─────────────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────────────

export type PianoVoiceLane =
  | 'bass'
  | 'low_outer'
  | 'inner_low'
  | 'inner_mid'
  | 'inner_high'
  | 'upper_outer';

export type VoiceRole =
  | 'root' | 'third' | 'fifth' | 'seventh'
  | 'ninth' | 'eleventh' | 'thirteenth'
  | 'sixth' | 'color' | 'doubling';

export interface PianoVoicingNote {
  midi: number;
  pc: number;
  role: VoiceRole;
  lane: PianoVoiceLane;
  hand: 'LH' | 'RH';
  velocity: number;       // 0-127 (MIDI standard)
}

export interface InnerMotionEvent {
  midi: number;
  time: number;           // 相对 chord 起拍的 beat offset
  duration: number;
  velocity: number;       // 0-127
  lane: PianoVoiceLane;
}

export interface WidePianoVoicing {
  notes: PianoVoicingNote[];
  innerLanes: PianoVoicingNote[];
  attackMidi: number[];   // 强拍同时发声的 MIDI 列表 (sorted)
  innerMotion?: InnerMotionEvent[];
  spreadMode?: SpreadMode;  // 诊断用 — 这个 chord 用了哪种 spread
}

/**
 * Spread mode — voicing 的"开阔程度"分级.
 *   close       — 4 voices, span ≤ 12 semis (~1 octave). cadence / 收束用.
 *                 紧凑稳定,声部不张开.
 *   half_wide   — 5 voices, span ~16-20 semis (~10-12 度). 默认中间地带,
 *                 lowOuter + inner 3 lane,无 upperOuter.
 *   wide        — 5-7 voices, span ~24-27 semis (~16-18 度). 全开阔,
 *                 lowOuter + all inner + upperOuter, 适合 lift / CHORUS.
 *   drop2_wide  — 在 wide 基础上把第 2-from-top 下移八度 (Bill Evans drop-2).
 *                 制造内部"反向 counter-melody",适合 BRIDGE 或 D function 张力.
 */
export type SpreadMode = 'close' | 'half_wide' | 'wide' | 'drop2_wide';

export interface WidePianoOptions {
  includeRootInComp: boolean;
  colorLevel: 0 | 1 | 2;
  style: string;
  spreadMode: SpreadMode;
}

// ─────────────────────────────────────────────────────────────────────
// Register zones — 两边开阔,中间密集 (用户原则).
//
//   外声部 (low_outer + upper_outer): 放 root / 3 / 5 (结构音), 间距大
//   内声部 (inner_low/mid/high):       放 7 / 9 / 11 / 13 / color, 紧凑
//
// 整个 voicing 总 span (不含 bass) 上限 29 半音 (= 18 度 = 真实钢琴手
// 双手最舒适宽度上限).
//
// 内声部三个 zone 故意收紧到 ~ 1 octave (62-72) 形成 "中间密集 cluster".
// ─────────────────────────────────────────────────────────────────────

const PIANO_ZONES = {
  bass:       [36, 52] as const,  // C2-E3 (单独,不算 wide voicing 内)
  lowOuter:   [50, 61] as const,  // D3-C#4 (LH 上方 / RH 低区 — root, 3rd)
  innerLow:   [62, 66] as const,  // D4-F#4 (cluster 底,通常 5th)
  innerMid:   [65, 70] as const,  // F4-A#4 (cluster 中,通常 7th + color)
  innerHigh:  [68, 72] as const,  // G#4-C5 (cluster 顶,通常 9th / 3rd 重叠)
  upperOuter: [73, 79] as const,  // C#5-G5 (RH 顶 — 5th / root 重叠)
};

/** Voicing 总 span 上限 (低 voice 到高 voice 的半音距离 — 不含 bass). */
const VOICING_MAX_TOTAL_SPAN = 29;  // 18 度

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function rolePc(rootPc: number, semis: number): number {
  return pc(rootPc + semis);
}

/** 在 [low, high] MIDI 区间找最接近 prefer 且 pc 匹配的 midi. */
function nearestMidiForPc(targetPc: number, low: number, high: number, prefer: number): number {
  let best = -1;
  let bestCost = Infinity;
  for (let m = low; m <= high; m++) {
    if (pc(m) !== targetPc) continue;
    const cost = Math.abs(m - prefer);
    if (cost < bestCost) {
      best = m;
      bestCost = cost;
    }
  }
  if (best < 0) {
    // 区间内没有这个 pc — 找最近一个八度外的
    for (let m = low - 12; m <= high + 12; m++) {
      if (pc(m) !== targetPc) continue;
      const cost = Math.abs(m - prefer);
      if (cost < bestCost) {
        best = m;
        bestCost = cost;
      }
    }
  }
  return best;
}

/** 根据 chord type 返回各角色的 pc. 不止 close 7 个,而是所有"可用"角色. */
function getChordRolePcs(rootPc: number, type: string): Partial<Record<VoiceRole, number>> {
  const result: Partial<Record<VoiceRole, number>> = {
    root: rolePc(rootPc, 0),
  };
  const isMaj = type.startsWith('maj') || type === 'add9' || type === '6' || type === '6/9' || type === 'maj';
  const isMin = !isMaj && (type.startsWith('m') && !type.startsWith('maj')) || type === 'min';
  const isSus = type.includes('sus');
  const isDim = type.includes('dim') || type === 'm7b5' || type === 'm9b5';

  // 3rd
  if (isSus) result.eleventh = rolePc(rootPc, 5);  // sus = 4th = 11
  else if (isMin || isDim) result.third = rolePc(rootPc, 3);
  else result.third = rolePc(rootPc, 4);

  // 5th
  if (isDim) result.fifth = rolePc(rootPc, 6);
  else if (type === 'aug' || type === '7#5') result.fifth = rolePc(rootPc, 8);
  else result.fifth = rolePc(rootPc, 7);

  // 7th
  if (type.startsWith('maj') || type === 'maj7' || type === 'maj9' || type === 'maj13' || type === 'maj7#11') {
    result.seventh = rolePc(rootPc, 11);
  } else if (type.includes('7') || type.includes('9') || type.includes('11') || type.includes('13')) {
    result.seventh = rolePc(rootPc, 10);
  }

  // 9 / 11 / 13 / 6
  if (type.includes('9') || type === 'add9' || type === '6/9') result.ninth = rolePc(rootPc, 2);
  if (type.includes('11')) result.eleventh = rolePc(rootPc, 5);
  if (type === '6' || type === '6/9') result.sixth = rolePc(rootPc, 9);
  if (type.includes('13')) result.thirteenth = rolePc(rootPc, 9);

  // Altered tensions on dom (b9 / #9 / b13)
  if (type.includes('b9')) result.color = rolePc(rootPc, 1);
  if (type.includes('#9')) result.color = rolePc(rootPc, 3);
  if (type.includes('b13')) result.color = rolePc(rootPc, 8);
  if (type.includes('#11')) result.color = rolePc(rootPc, 6);

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// 主构造: buildWidePianoVoicing
// ─────────────────────────────────────────────────────────────────────

/**
 * 生成钢琴宽阔排列 (~5-7 voices). 不分接管 bass — bass 由现有 bassline rules
 * 决定. 这里只产生 comping 部分 (LH 上方 + RH 全区).
 *
 * 输出: WidePianoVoicing.notes 全部按 midi 升序排好.
 * attackMidi: 强拍同时按下的 MIDI 列表.
 * innerLanes: 中间 3 条 lane (inner_low / inner_mid / inner_high),
 *             给 buildInnerMotion 用做"副旋律候选".
 */
export function buildWidePianoVoicing(args: {
  rootPc: number;
  chordType: string;
  bassMidi: number;
  options: WidePianoOptions;
  /** Previous chord's wide voicing — when present, each lane's prefer
   *  midi defaults to the prev voice on the same lane. This pulls the
   *  voicing toward common-tone retention and minimum-motion voice
   *  leading: a voice whose pc carries over keeps its exact midi; an
   *  inner voice whose pc changes picks the nearest matching pc to the
   *  prev voice (stepwise inner motion rather than zone-fresh placement).
   *
   *  When prev is omitted (first chord of song / per-chord regen),
   *  falls back to zone-midpoint preferences (original behavior). */
  prev?: WidePianoVoicing;
}): WidePianoVoicing {
  const { rootPc, chordType, options, prev } = args;
  const pcs = getChordRolePcs(rootPc, chordType);
  const notes: PianoVoicingNote[] = [];

  // Look up prev's voice midi on a given (lane, role) — if multiple,
  // returns the closest-to-zoneCenter one. Returns undefined when prev
  // has no voice for this (lane, role).
  const prevAnchor = (lane: PianoVoiceLane, role: VoiceRole, zoneCenter: number): number => {
    if (!prev) return zoneCenter;
    // Same lane + same role = ideal match (e.g. prev's inner_mid seventh → curr's inner_mid seventh)
    const exactMatch = prev.notes.filter(n => n.lane === lane && n.role === role);
    if (exactMatch.length > 0) {
      exactMatch.sort((a, b) => Math.abs(a.midi - zoneCenter) - Math.abs(b.midi - zoneCenter));
      return exactMatch[0].midi;
    }
    // Same lane, different role = use the closest-by-pitch voice in that lane
    // (common-tone retention: if pcs.X happens to equal a prev voice on this
    // lane, anchoring there will preserve the exact midi)
    const laneMatch = prev.notes.filter(n => n.lane === lane);
    if (laneMatch.length > 0) {
      laneMatch.sort((a, b) => Math.abs(a.midi - zoneCenter) - Math.abs(b.midi - zoneCenter));
      return laneMatch[0].midi;
    }
    return zoneCenter;
  };

  const add = (
    role: VoiceRole,
    lane: PianoVoiceLane,
    hand: 'LH' | 'RH',
    midi: number,
    velocity: number,
  ): void => {
    if (midi < 0 || !Number.isFinite(midi)) return;
    notes.push({ midi, pc: pc(midi), role, lane, hand, velocity });
  };

  const [LO_LO, LO_HI] = PIANO_ZONES.lowOuter;
  const [IL_LO, IL_HI] = PIANO_ZONES.innerLow;
  const [IM_LO, IM_HI] = PIANO_ZONES.innerMid;
  const [IH_LO, IH_HI] = PIANO_ZONES.innerHigh;
  const [UO_LO, UO_HI] = PIANO_ZONES.upperOuter;

  const mode = options.spreadMode;

  // ─── 外声部 = 结构音 (root / 3 / 5), 内声部 = 色彩音 (7 / 9 / 11 / 13). ───

  // ① lowOuter (结构): root + 3rd 是 LH 顶或 RH 极低区,定调骨架.
  //    close 模式不在 lowOuter 放任何 voice — 直接从 inner 起.
  if (mode !== 'close') {
    if (options.includeRootInComp && pcs.root !== undefined) {
      add('root', 'low_outer', 'LH', nearestMidiForPc(pcs.root, LO_LO, LO_LO + 7, prevAnchor('low_outer', 'root', LO_LO + 3)), 58);
    }
    if (pcs.third !== undefined) {
      add('third', 'low_outer', 'LH', nearestMidiForPc(pcs.third, LO_LO + 2, LO_HI, prevAnchor('low_outer', 'third', LO_LO + 6)), 54);
    }
  }

  // ② inner cluster (色彩, 紧凑 1-octave 区间 D4-C5): 5 / 7 / root double / 9 / color.
  //    所有模式都至少要 3-4 voice 在这里 — 这是 "中间密集" 的核心.

  // inner_low: 5th (cluster 底)
  if (pcs.fifth !== undefined) {
    add('fifth', 'inner_low', 'RH', nearestMidiForPc(pcs.fifth, IL_LO, IL_HI, prevAnchor('inner_low', 'fifth', IL_LO + 2)), 48);
  }

  // inner_mid: 7th + root doubling
  if (pcs.seventh !== undefined) {
    add('seventh', 'inner_mid', 'RH', nearestMidiForPc(pcs.seventh, IM_LO, IM_HI, prevAnchor('inner_mid', 'seventh', IM_LO + 2)), 46);
  }
  // close 模式不加 root doubling (太密),其它模式 colorLevel >= 1 时加
  if (mode !== 'close' && options.colorLevel >= 1 && pcs.root !== undefined) {
    add('doubling', 'inner_mid', 'RH', nearestMidiForPc(pcs.root, IM_LO + 1, IM_HI, prevAnchor('inner_mid', 'doubling', IM_LO + 3)), 42);
  }

  // inner_high: 9th (priority) 或 3rd 重叠 — cluster 顶
  if (options.colorLevel >= 1 && pcs.ninth !== undefined) {
    add('ninth', 'inner_high', 'RH', nearestMidiForPc(pcs.ninth, IH_LO, IH_HI, prevAnchor('inner_high', 'ninth', IH_LO + 2)), 40);
  } else if (pcs.third !== undefined) {
    add('third', 'inner_high', 'RH', nearestMidiForPc(pcs.third, IH_LO, IH_HI, prevAnchor('inner_high', 'third', IH_LO + 2)), 40);
  }

  // colorLevel >= 2 + 含 13/6 时,再加一条 13/6 色彩在 inner_high
  if (mode !== 'close' && options.colorLevel >= 2) {
    const ext = pcs.thirteenth ?? pcs.sixth ?? pcs.eleventh ?? pcs.color;
    if (ext !== undefined) {
      add('thirteenth', 'inner_high', 'RH', nearestMidiForPc(ext, IH_LO + 1, IH_HI, prevAnchor('inner_high', 'thirteenth', IH_LO + 3)), 38);
    }
  }

  // ③ upperOuter (结构 air voice): 5th / root 高八度 — 仅 wide / drop2_wide 模式
  if (mode === 'wide' || mode === 'drop2_wide') {
    if (pcs.fifth !== undefined) {
      add('fifth', 'upper_outer', 'RH', nearestMidiForPc(pcs.fifth, UO_LO, UO_HI, prevAnchor('upper_outer', 'fifth', UO_LO + 2)), 38);
    }
    if (options.colorLevel >= 2 && pcs.root !== undefined) {
      add('root', 'upper_outer', 'RH', nearestMidiForPc(pcs.root, UO_LO + 3, UO_HI, prevAnchor('upper_outer', 'root', UO_LO + 6)), 34);
    }
  }
  // half_wide 给一个 upper voice 但不那么高 (用 inner_high 已经覆盖, 不重复)

  // 排序 + 去重 (同 MIDI 不重复)
  const seen = new Set<number>();
  const dedup: PianoVoicingNote[] = [];
  for (const n of notes.sort((a, b) => a.midi - b.midi)) {
    if (seen.has(n.midi)) continue;
    seen.add(n.midi);
    dedup.push(n);
  }

  // 后置校正 1: drop2_wide 模式应用 Drop-2 变换 (2nd-from-top 下移八度)
  let processed = dedup;
  if (mode === 'drop2_wide' && processed.length >= 4) {
    const sortedAsc = processed.slice().sort((a, b) => a.midi - b.midi);
    const idx2FromTop = sortedAsc.length - 2;
    const droppedMidi = sortedAsc[idx2FromTop].midi - 12;
    // safety: 不能掉到 bass 以下或 sub-musical (< A1)
    if (droppedMidi > args.bassMidi + 4 && droppedMidi >= 33) {
      sortedAsc[idx2FromTop] = { ...sortedAsc[idx2FromTop], midi: droppedMidi, pc: pc(droppedMidi) };
      processed = sortedAsc.sort((a, b) => a.midi - b.midi);
    }
  }

  // 后置校正 2: muddy-check (低区 m2 / 跟 bass 的 m9 cluster)
  const sanitized = sanitizeMuddyVoices(processed, args.bassMidi);

  // 后置校正 3: 总 span ≤ VOICING_MAX_TOTAL_SPAN (29 半音, 18 度).
  // 把超出的外侧 voice 向中间压(高 voice 下移八度 / 低 voice 上移八度).
  const compressed = compressVoicingSpan(sanitized, VOICING_MAX_TOTAL_SPAN);

  return {
    notes: compressed,
    attackMidi: compressed.map(n => n.midi),
    innerLanes: compressed.filter(n =>
      n.lane === 'inner_low' || n.lane === 'inner_mid' || n.lane === 'inner_high',
    ),
  };
}

/**
 * 把超过 maxSpan 半音的 voicing 压缩到范围内. 策略:
 *   优先把最高 voice 下移八度 (假定 upper_outer 区比 low_outer 更宽容),
 *   如果下移后底音变成新最低且仍超限,改试上移最低 voice.
 *   反复直到 max-min ≤ maxSpan 或无法再压.
 */
function compressVoicingSpan(notes: PianoVoicingNote[], maxSpan: number): PianoVoicingNote[] {
  const out = notes.map(n => ({ ...n })).sort((a, b) => a.midi - b.midi);
  let guard = 0;
  while (out.length >= 2 && (out[out.length - 1].midi - out[0].midi) > maxSpan && guard < 8) {
    guard++;
    const lo = out[0];
    const hi = out[out.length - 1];
    const span = hi.midi - lo.midi;
    // 移动选择: 比较"下移 hi 八度"和"上移 lo 八度"两种,选移完后 max-min 更小的
    const hiDownMidi = hi.midi - 12;
    const loUpMidi = lo.midi + 12;
    const candHiDown = out.slice(0, -1).concat({ ...hi, midi: hiDownMidi, pc: pc(hiDownMidi) });
    const candLoUp = out.slice(1).concat({ ...lo, midi: loUpMidi, pc: pc(loUpMidi) });
    candHiDown.sort((a, b) => a.midi - b.midi);
    candLoUp.sort((a, b) => a.midi - b.midi);
    const newSpanHiDown = candHiDown[candHiDown.length - 1].midi - candHiDown[0].midi;
    const newSpanLoUp = candLoUp[candLoUp.length - 1].midi - candLoUp[0].midi;
    if (newSpanHiDown < newSpanLoUp && newSpanHiDown < span) {
      out.splice(0, out.length, ...candHiDown);
    } else if (newSpanLoUp < span) {
      out.splice(0, out.length, ...candLoUp);
    } else {
      // 两种都不减小 — bail (不应该发生)
      break;
    }
  }
  return out;
}

/**
 * 后置校正: 跑一遍 muddy interval 检查. 违例的 voice 上移八度.
 * 重用 musicTheory 的 PIANO_LIL 概念 — 不直接 import 阈值常量,
 * 在这里用简化判定:
 *   - 任何相邻 voice m2 (距 1 半音) 且 lower < E4 (64) → 上移上方那个
 *   - 任何 voice 跟 bass 形成 13 半音 (octave + m2) → 上移到 25 半音外
 */
function sanitizeMuddyVoices(notes: PianoVoicingNote[], bassMidi: number): PianoVoicingNote[] {
  const out = notes.map(n => ({ ...n }));
  const E4 = 64;
  const bassPc = pc(bassMidi);
  const b9Pc = (bassPc + 1) % 12;

  // m9 cluster — 13 / 25 semis above bass 且 pc 是 b9
  for (const n of out) {
    const interval = n.midi - bassMidi;
    if (interval === 13 && n.pc === b9Pc) {
      n.midi += 12;   // 上移到 25 semi 外
      n.pc = pc(n.midi);
    }
  }

  // 相邻 m2 在低区 — 上移 upper
  out.sort((a, b) => a.midi - b.midi);
  for (let i = 1; i < out.length; i++) {
    const gap = out[i].midi - out[i - 1].midi;
    if (gap === 1 && out[i - 1].midi < E4) {
      out[i].midi += 12;
      out[i].pc = pc(out[i].midi);
    }
  }
  out.sort((a, b) => a.midi - b.midi);
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Inner motion: 跨和弦"暗中漂"的副旋律
// ─────────────────────────────────────────────────────────────────────

/** 把 curr 的 inner lane 跟 next 的 inner lane 配对 (按 lane / pitch / role 最小代价).
 *  只取真正落在 RH 低声部 (C4-D5) 的 voice 作为副旋律候选 — 否则
 *  motion 可能下沉到 LH 区变 bassline. */
function matchInnerLanes(
  curr: WidePianoVoicing,
  next: WidePianoVoicing,
): Array<{ from: PianoVoicingNote; to: PianoVoicingNote }> {
  const inRH = (n: PianoVoicingNote): boolean => n.midi >= 60 && n.midi <= 74;
  const currInnerRH = curr.innerLanes.filter(inRH);
  const nextInnerRH = next.innerLanes.filter(inRH);

  const pairs: Array<{ from: PianoVoicingNote; to: PianoVoicingNote }> = [];
  const used = new Set<number>();
  for (const from of currInnerRH) {
    let bestIdx = -1;
    let bestCost = Infinity;
    nextInnerRH.forEach((to, idx) => {
      if (used.has(idx)) return;
      const laneCost = from.lane === to.lane ? 0 : 3;
      const pitchCost = Math.abs(from.midi - to.midi);
      const roleCost = from.role === to.role ? 0 : 1;
      const cost = pitchCost + laneCost + roleCost;
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) {
      used.add(bestIdx);
      pairs.push({ from, to: nextInnerRH[bestIdx] });
    }
  }
  return pairs;
}

function stepToward(from: number, to: number, allowedPcs: Set<number>): number {
  if (from === to) return from;
  const dir = to > from ? 1 : -1;
  for (let step = 1; step <= 2; step++) {
    const cand = from + dir * step;
    if (allowedPcs.has(pc(cand))) return cand;
  }
  return from + dir * Math.min(2, Math.abs(to - from));
}

/** 生成 1-2 条 inner lane 的"暗中漂"事件. 时间在弱拍 (2.5 / 3.5 in 4/4).
 *
 *  关键约束: motion midi 必须在**右手低声部** (C4-D5 = 60-74) 之间.
 *  这是钢琴师演奏时右手低声部位置 — 副旋律应该在这里"暗中漂",
 *  绝对不能下沉到左手区 (D3-D#4 = low_outer),否则会变成 bassline 跟
 *  真实 bass 重叠.
 *
 *  即使 voicing 含 low_outer (LH) voice,motion 也不动它,只取
 *  inner_low / inner_mid 这些 RH 中低区 lane 做漂移.
 */
const MOTION_RH_LOW = 60;   // C4 — motion 最低不下沉到 LH 区
const MOTION_RH_HIGH = 74;  // D5 — motion 最高不上飘到 upper_outer 空气区

export function buildInnerMotion(args: {
  curr: WidePianoVoicing;
  next: WidePianoVoicing;
  chordScalePcs: Set<number>;
  durationBeats: number;
  density: number;
}): InnerMotionEvent[] {
  if (args.curr.notes.length === 0) return [];

  // motion 只在 [MOTION_RH_LOW, MOTION_RH_HIGH] 区间内动 — 右手低声部范围.
  // 取 curr voicing 中落在这个区间的 voices,如果 curr 的 inner lanes
  // 已经在此范围内,直接用;否则八度移动 clamp 到范围内.
  const clampToRH = (m: number): number => {
    let x = m;
    while (x < MOTION_RH_LOW) x += 12;
    while (x > MOTION_RH_HIGH) x -= 12;
    if (x < MOTION_RH_LOW || x > MOTION_RH_HIGH) return -1;
    return x;
  };

  const pairs = matchInnerLanes(args.curr, args.next);
  const events: InnerMotionEvent[] = [];
  const maxMovingVoices = args.density > 0.6 ? 2 : 1;
  const movingPairs = pairs
    .filter(p => Math.abs(p.from.midi - p.to.midi) > 0)
    .sort((a, b) => Math.abs(a.from.midi - a.to.midi) - Math.abs(b.from.midi - b.to.midi))
    .slice(0, maxMovingVoices);

  for (const { from, to } of movingPairs) {
    // Target 必须在 curr voicing 范围内 (clamp 到 inner 安全带,否则丢弃)
    const targetClamped = clampToRH(to.midi);
    if (targetClamped < 0) continue;  // 目标无法塞进 voicing — 跳过这条声部
    const dist = Math.abs(targetClamped - from.midi);
    if (dist === 0) continue;

    if (dist <= 2) {
      const t = args.durationBeats >= 4 ? 3.5 : args.durationBeats * 0.75;
      events.push({
        midi: targetClamped, time: t, duration: 0.35, velocity: 26, lane: from.lane,
      });
    } else {
      // 经过音: 同样 clamp 到 voicing 范围内
      const passRaw = stepToward(from.midi, targetClamped, args.chordScalePcs);
      const passClamped = clampToRH(passRaw);
      if (args.durationBeats >= 4) {
        if (passClamped >= 0) {
          events.push({ midi: passClamped, time: 2.5, duration: 0.35, velocity: 24, lane: from.lane });
        }
        events.push({ midi: targetClamped, time: 3.5, duration: 0.35, velocity: 26, lane: from.lane });
      } else {
        events.push({
          midi: targetClamped, time: args.durationBeats * 0.65,
          duration: 0.28, velocity: 24, lane: from.lane,
        });
      }
    }
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────
// Post-process: 给整首歌的 chords 挂上 widePianoVoicing
// ─────────────────────────────────────────────────────────────────────

/** Random 接口 (避免循环 import musicEngine.Random) */
interface PickerRandom { next(): number; pick<T>(arr: T[]): T; }

/**
 * 按音乐性 dispatch spread mode. 优先级:
 *   - 末尾 / phrase end / cadence cell → close (收束)
 *   - INTRO / OUTRO 段 → close
 *   - lift cell + CHORUS section → wide
 *   - D function + 非 cadence → wide / drop2_wide
 *   - BRIDGE → drop2_wide (制造对比)
 *   - 其它 → half_wide (默认中庸)
 *
 * tie-break 用 forked random 防止整曲一刀切.
 */
function pickSpreadMode(args: {
  func: 'T' | 'S' | 'D';
  cellRole: 'establish' | 'develop' | 'lift' | 'cadence';
  sectionFunction: 'INTRO' | 'VERSE' | 'CHORUS' | 'BRIDGE' | 'OUTRO';
  isPhraseEnd: boolean;
  isLast: boolean;
  random: PickerRandom;
}): SpreadMode {
  // hard rules
  if (args.isLast || args.isPhraseEnd) return 'close';
  if (args.sectionFunction === 'INTRO' || args.sectionFunction === 'OUTRO') {
    return args.random.next() < 0.7 ? 'close' : 'half_wide';
  }

  // 评分 — 每条规则给 spread mode 加权
  const scores: Record<SpreadMode, number> = {
    close: 0, half_wide: 2, wide: 0, drop2_wide: 0,  // half_wide 默认基线
  };

  // cell role bias
  if (args.cellRole === 'establish') scores.half_wide += 1;
  if (args.cellRole === 'develop')   { scores.half_wide += 1; scores.wide += 1; }
  if (args.cellRole === 'lift')      { scores.wide += 3; scores.drop2_wide += 1; }
  if (args.cellRole === 'cadence')   { scores.half_wide += 1; scores.close += 2; }

  // function bias
  if (args.func === 'T') scores.half_wide += 1;            // T 稳定 — 中庸
  if (args.func === 'S') { scores.half_wide += 1; scores.wide += 1; }
  if (args.func === 'D') { scores.wide += 2; scores.drop2_wide += 2; }  // D 张力 — 开

  // section bias
  if (args.sectionFunction === 'CHORUS') scores.wide += 2;
  if (args.sectionFunction === 'BRIDGE') { scores.drop2_wide += 3; scores.wide += 1; }
  if (args.sectionFunction === 'VERSE')  scores.half_wide += 1;

  // 取最高分;tie 用 random.pick
  const max = Math.max(...Object.values(scores));
  const top = Object.entries(scores).filter(([, v]) => v === max).map(([k]) => k as SpreadMode);
  return top.length === 1 ? top[0] : args.random.pick(top);
}

export function attachWidePianoVoicings(args: {
  chords: ChordDef[];
  style: string;
  density: number;
  keyRootPc: number;
  mode: string;
  sectionFunction: 'INTRO' | 'VERSE' | 'CHORUS' | 'BRIDGE' | 'OUTRO';
  motifInterval: number;
  random: PickerRandom;
}): void {
  const { chords, style, density } = args;

  // 第一遍: 各 chord 决定 spreadMode + 生成 wide voicing.
  // Cross-chord 优化: 每个 voicing 都 peek 前一个 voicing 作为 anchor 池,
  // 让共同音保持原 midi (听感上 "停在那里"),色彩音走最短距离移动.
  // 第一个 chord 没有 prev,用 zone 默认中心.
  const spreadModes: SpreadMode[] = [];
  const wides: WidePianoVoicing[] = [];
  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    // 决定 chord function
    const baseRoman = chord.roman.split('/')[0].replace(/[^a-zA-Z]/g, '');
    const func: 'T' | 'S' | 'D' = chord.effectiveFunc
      ?? (['V', 'v', 'vii', 'VII'].includes(baseRoman) || chord.roman.includes('/') ? 'D'
       :  ['IV', 'iv', 'ii', 'II', 'bVII'].includes(baseRoman) ? 'S' : 'T');

    // phrase 位置
    const isLast = i === chords.length - 1;
    const isPhraseEnd = args.motifInterval > 0 && (i + 1) % args.motifInterval === 0;
    const cellRole: 'establish' | 'develop' | 'lift' | 'cadence' =
      i < chords.length / 4 ? 'establish' :
      i < chords.length / 2 ? 'develop' :
      i < (chords.length * 3) / 4 ? 'lift' : 'cadence';

    const spreadMode = pickSpreadMode({
      func, cellRole,
      sectionFunction: args.sectionFunction,
      isPhraseEnd, isLast,
      random: args.random,
    });
    spreadModes.push(spreadMode);

    const rootPc = pc(chord.rootMidi);
    const colorLevel: 0 | 1 | 2 = density > 0.65 ? 2 : density > 0.35 ? 1 : 0;
    const wide = buildWidePianoVoicing({
      rootPc, chordType: chord.type, bassMidi: chord.bassMidi,
      options: {
        includeRootInComp: style !== 'JAZZ',
        colorLevel,
        style,
        spreadMode,
      },
      prev: i > 0 ? wides[i - 1] : undefined,
    });
    wides.push(wide);
  }

  // 第二遍: 各 chord 算 inner motion (peek 下一 chord)
  // close 模式不动 inner motion (收束应该静态)
  for (let i = 0; i < chords.length; i++) {
    const curr = wides[i];
    const next = wides[(i + 1) % wides.length];
    const chord = chords[i];
    const scaleName = chord.forcedScale ?? args.mode;
    const scaleIntervals = SCALE_TYPES[scaleName] ?? SCALE_TYPES['Ionian'];
    const rootPc = pc(chord.rootMidi);
    const scalePcs = new Set(scaleIntervals.map(iv => pc(rootPc + iv)));

    const innerMotion = spreadModes[i] === 'close' ? [] : buildInnerMotion({
      curr, next, chordScalePcs: scalePcs,
      durationBeats: chord.duration, density,
    });

    chord.widePianoVoicing = { ...curr, innerMotion, spreadMode: spreadModes[i] };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Texture rendering helper
// ─────────────────────────────────────────────────────────────────────

/** 把 widePianoVoicing 渲染成 chord-part NoteEvent.
 *  这是 Piano_Wide_Color_Motion texture case 的核心. */
export function renderWidePianoVoicing(args: {
  wide: WidePianoVoicing;
  bassMidi: number;
  startBeat: number;
  duration: number;
  density: number;
  melodyEvents: NoteEvent[];   // 主旋律 — 副旋律靠近时让位
}): NoteEvent[] {
  const out: NoteEvent[] = [];
  const { wide, startBeat, duration, density } = args;

  // 1) 主和弦 — 微 roll (~18ms 间隔 per voice)
  const attack = wide.attackMidi;
  attack.forEach((m, idx) => {
    const rollOffset = idx * 0.018;  // 18ms ≈ 0.018 beat at 60bpm; OK approx
    const vel = idx < 2 ? 0.48 : 0.34;
    out.push({
      noteNumber: m,
      time: startBeat + rollOffset,
      duration: Math.min(duration, 2.2),
      velocity: vel * 127,
      part: 'chord',
    });
  });

  // 2) 内部声部弱拍运动 — 如果 density 太低或者 melody 在那个位置忙就跳过
  if (wide.innerMotion && density > 0.25) {
    for (const ev of wide.innerMotion) {
      if (ev.time >= duration) continue;
      const absTime = startBeat + ev.time;
      // melody collision: skip if melody fires within ±50ms
      const melodyBusy = args.melodyEvents.some(me =>
        Math.abs(me.time - absTime) < 0.08,
      );
      if (melodyBusy && density < 0.65) continue;
      out.push({
        noteNumber: ev.midi,
        time: absTime,
        duration: ev.duration,
        velocity: (melodyBusy ? 18 : ev.velocity),
        part: 'chord',
      });
    }
  }

  return out;
}
