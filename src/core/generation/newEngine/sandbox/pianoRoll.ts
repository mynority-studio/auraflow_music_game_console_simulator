// ============================================================
// newEngine · sandbox · PianoRoll(IR → 可视化几何,纯函数可测)
// ------------------------------------------------------------
// 把 MusicalIR 各轨音符换算成 piano-roll 矩形(x/y/w/h + 角色配色)。
// 纯几何换算,无 React / DOM 依赖 → 面板 SVG 直接消费;单测锁换算正确性。
//   x/w ∝ tick(时间轴);y 随音高翻转(高音在上);角色配色对齐混音分层。
// ============================================================

import type { InstrumentRole, MusicalIR } from '../ir/MusicalIR';

export interface PianoRollNote {
  x: number;
  y: number;
  w: number;
  h: number;
  pitch: number;
  role: InstrumentRole;
  color: string;
}

export interface PianoRoll {
  width: number;
  height: number;
  pitchMin: number;
  pitchMax: number;
  notes: PianoRollNote[];
}

export interface PianoRollOptions {
  width?: number;
  height?: number;
}

// 角色配色(对齐面板/混音:lead 亮 / bass 暖 / pad 冷 / comp 中 / drum 灰)
export const ROLE_COLOR: Record<InstrumentRole, string> = {
  lead: '#34d399', // emerald
  comp: '#60a5fa', // blue
  bass: '#f59e0b', // amber
  pad: '#a78bfa',  // violet
  drum: '#9ca3af', // gray
};

/** mute/solo 解析:有 solo → 只放 solo 轨;否则放未 mute 轨。纯函数,供音频层 + 面板共用。 */
export function resolveAudibleRoles(
  roles: readonly string[],
  muted: ReadonlySet<string>,
  solo: ReadonlySet<string>,
): Set<string> {
  return new Set(roles.filter((r) => (solo.size > 0 ? solo.has(r) : !muted.has(r))));
}

// —— 音名 / 鼓名(逐轨视图用)——
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** MIDI → 音名(60 = C4 中央 C)。 */
export function midiToNoteName(pitch: number): string {
  const name = NOTE_NAMES[((pitch % 12) + 12) % 12];
  return `${name}${Math.floor(pitch / 12) - 1}`;
}
// GM 打击乐件名(常用)
const GM_DRUM_NAMES: Record<number, string> = {
  35: 'Kick', 36: 'Kick', 37: 'Rim', 38: 'Snare', 39: 'Clap', 40: 'Snare',
  41: 'Tom', 42: 'HH', 43: 'Tom', 44: 'HH', 45: 'Tom', 46: 'OpenHH', 47: 'Tom',
  48: 'Tom', 49: 'Crash', 50: 'Tom', 51: 'Ride', 53: 'Bell', 57: 'Crash', 59: 'Ride',
};
/** 鼓轨用件名(非音高);其它轨用音名。 */
export function noteLabel(pitch: number, isDrum: boolean): string {
  return isDrum ? (GM_DRUM_NAMES[pitch] ?? `D${pitch}`) : midiToNoteName(pitch);
}

export interface LaneNote {
  x: number; w: number; y: number; h: number;
  startTick: number;
  durationTicks: number; // playhead 判定正在发声用
  pitch: number;
  label: string;   // 音名 / 鼓件名
  velocity: number;
}
export interface TrackLane {
  role: InstrumentRole;
  group: 'melody' | 'accomp'; // 主旋律 / 伴奏
  color: string;
  notes: LaneNote[];          // 按时间序(前→后)
  pitchMin: number;
  pitchMax: number;
  count: number;
  sequence: string[];         // 音名序列(前→后,显示"播放什么 + 前后")
}
export interface LaneRoll {
  width: number;
  laneHeight: number;
  ppq: number;
  totalTicks: number;
  lanes: TrackLane[];
}

/**
 * 逐轨泳道:每轨独立纵向缩放成一条 strip(主旋律 lead / 伴奏 comp·bass·pad·drum 分组),
 * 带音名标签 + 时间序音名序列。空轨跳过。供独立弹窗逐轨显示 + 单独开关。
 */
export function buildTrackLanes(ir: MusicalIR, opts: { width?: number; laneHeight?: number } = {}): LaneRoll {
  const width = opts.width ?? 560;
  const laneHeight = opts.laneHeight ?? 46;
  const totalTicks = Math.max(1, ir.durationTicks as number);
  const lanes: TrackLane[] = [];
  for (const tr of ir.tracks) {
    if (tr.notes.length === 0) continue;
    const isDrum = tr.role === 'drum';
    let pMin = Infinity, pMax = -Infinity;
    for (const n of tr.notes) { const p = n.pitch as number; if (p < pMin) pMin = p; if (p > pMax) pMax = p; }
    const span = Math.max(1, pMax - pMin);
    const rowH = Math.max(3, laneHeight / (span + 1));
    const sorted = [...tr.notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
    const notes: LaneNote[] = sorted.map((n) => {
      const s = n.startTick as number, d = n.durationTicks as number, p = n.pitch as number;
      return {
        x: (s / totalTicks) * width,
        w: Math.max(2, (d / totalTicks) * width),
        y: ((pMax - p) / span) * (laneHeight - rowH),
        h: rowH,
        startTick: s,
        durationTicks: d,
        pitch: p,
        label: noteLabel(p, isDrum),
        velocity: n.velocity,
      };
    });
    lanes.push({
      role: tr.role,
      group: tr.role === 'lead' ? 'melody' : 'accomp',
      color: ROLE_COLOR[tr.role] ?? '#d4d4d8',
      notes,
      pitchMin: pMin,
      pitchMax: pMax,
      count: tr.notes.length,
      sequence: notes.map((n) => n.label),
    });
  }
  return { width, laneHeight, ppq: ir.timebase.ppq, totalTicks, lanes };
}

/** IR → piano-roll 几何。空 IR(无音符)→ notes 空但保留画布尺寸。 */
export function buildPianoRoll(ir: MusicalIR, opts: PianoRollOptions = {}): PianoRoll {
  const width = opts.width ?? 520;
  const height = opts.height ?? 180;
  const totalTicks = Math.max(1, ir.durationTicks as number); // 防除零

  let pitchMin = Infinity;
  let pitchMax = -Infinity;
  for (const tr of ir.tracks) {
    for (const n of tr.notes) {
      const p = n.pitch as number;
      if (p < pitchMin) pitchMin = p;
      if (p > pitchMax) pitchMax = p;
    }
  }
  if (!Number.isFinite(pitchMin)) { pitchMin = 60; pitchMax = 72; } // 无音符兜底
  const span = Math.max(1, pitchMax - pitchMin); // 防除零
  const rowH = Math.max(2, height / (span + 1)); // 每半音行高

  const notes: PianoRollNote[] = [];
  for (const tr of ir.tracks) {
    const color = ROLE_COLOR[tr.role] ?? '#d4d4d8';
    for (const n of tr.notes) {
      const start = n.startTick as number;
      const dur = n.durationTicks as number;
      const pitch = n.pitch as number;
      notes.push({
        x: (start / totalTicks) * width,
        w: Math.max(1, (dur / totalTicks) * width), // 至少 1px 可见
        y: ((pitchMax - pitch) / span) * (height - rowH), // 高音→y 小(在上)
        h: rowH,
        pitch,
        role: tr.role,
        color,
      });
    }
  }

  return { width, height, pitchMin, pitchMax, notes };
}
