// ============================================================
// motifSandbox · ui · 3×5 音阶键盘(点击输入旋律)
// ------------------------------------------------------------
// 5×3=15 pad,【阅读顺序】排列音阶:顶行最左 = 最低音 → 逐行向右向下 → 底行最右 = 最高音。
// pad 的音 = 当前选定音阶的 noteMap[idx]。按下=试听+(录制中)记音,松开=停音。
// ============================================================

import React from 'react';
import { padIndex, midiName } from '../model/sandboxScales';

interface PadKeyboardProps {
  noteMap: number[];                          // 15 音升序(scaleNoteMap)
  recording: boolean;
  activeNotes: Set<number>;                   // 当前按住的音(pad/MIDI)→ 点亮对应键
  onPadDown: (idx: number, midi: number) => void;
  onPadUp: (idx: number, midi: number) => void;
}

const COLS = 5, ROWS = 3;

export const PadKeyboard: React.FC<PadKeyboardProps> = ({ noteMap, recording, activeNotes, onPadDown, onPadUp }) => {
  const cells: { idx: number; midi: number }[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const idx = padIndex(c, r);
    cells.push({ idx, midi: noteMap[idx] ?? 60 });
  }
  return (
    <div className="grid gap-1 select-none" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, touchAction: 'none' }}>
      {cells.map(({ idx, midi }) => {
        const on = activeNotes.has(midi); // 该键的音正在响 → 高亮 + 放大
        return (
          <button
            key={idx}
            type="button"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onPadDown(idx, midi); }}
            onPointerUp={() => onPadUp(idx, midi)}
            onPointerLeave={(e) => { if (e.buttons) onPadUp(idx, midi); }}
            onPointerCancel={() => onPadUp(idx, midi)}
            className={`rounded-md border py-2 text-[10px] leading-tight transition-all duration-75 active:scale-95
              ${on
                ? 'scale-95 border-fuchsia-300 bg-fuchsia-400/50 text-white shadow-[0_0_10px_2px_rgba(232,121,249,0.7)]'
                : recording
                  ? 'border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-100'
                  : 'border-fuchsia-500/30 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-fuchsia-100'}`}
          >
            {midiName(midi)}
          </button>
        );
      })}
    </div>
  );
};
