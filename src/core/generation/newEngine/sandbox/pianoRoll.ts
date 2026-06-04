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
