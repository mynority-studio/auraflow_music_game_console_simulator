// ============================================================
// motifSandbox · ui · 3×5 音阶键盘(点击输入旋律)
// ------------------------------------------------------------
// 复用 ScaleEngine 的 5×3=15 pad 布局(padIndex):底行低音 → 顶行高音,右上 FN 空位。
// pad 的音 = 当前选定音阶的 noteMap[idx]。按下=试听+(录制中)记音,松开=停音。
// ============================================================

import React from 'react';
import { padIndex, midiName } from '../model/sandboxScales';

interface PadKeyboardProps {
  noteMap: number[];                          // 14 音升序(scaleNoteMap)
  recording: boolean;
  onPadDown: (idx: number, midi: number) => void;
  onPadUp: (idx: number, midi: number) => void;
}

const COLS = 5, ROWS = 3;

export const PadKeyboard: React.FC<PadKeyboardProps> = ({ noteMap, recording, onPadDown, onPadUp }) => {
  const cells: { c: number; r: number; idx: number; midi: number }[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const idx = padIndex(c, r);
    cells.push({ c, r, idx, midi: idx >= 0 ? (noteMap[idx] ?? 60) : -1 });
  }
  return (
    <div className="grid gap-1 select-none" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, touchAction: 'none' }}>
      {cells.map(({ c, r, idx, midi }) => {
        if (idx < 0) return <div key={`${c}-${r}`} className="rounded-md border border-zinc-800 bg-zinc-900/40 text-zinc-600 text-[9px] flex items-center justify-center py-2">FN</div>;
        return (
          <button
            key={`${c}-${r}`}
            type="button"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onPadDown(idx, midi); }}
            onPointerUp={() => onPadUp(idx, midi)}
            onPointerLeave={(e) => { if (e.buttons) onPadUp(idx, midi); }}
            onPointerCancel={() => onPadUp(idx, midi)}
            className={`rounded-md border py-2 text-[10px] leading-tight transition-colors active:scale-95
              ${recording ? 'border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-100' : 'border-fuchsia-500/30 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-fuchsia-100'}`}
          >
            {midiName(midi)}
          </button>
        );
      })}
    </div>
  );
};
