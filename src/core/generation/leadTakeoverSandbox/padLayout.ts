// ============================================================
// leadTakeoverSandbox · 3x5 pad layout
// ------------------------------------------------------------
// Reading-order layout: top-left -> right, then next row, ending at
// bottom-right. This matches Q+R PadKeyboard, not the older AuraJam
// 14-key + FN layout.
// ============================================================

export const TAKEOVER_PAD_COLS = 5;
export const TAKEOVER_PAD_ROWS = 3;
export const TAKEOVER_PAD_COUNT = TAKEOVER_PAD_COLS * TAKEOVER_PAD_ROWS;
export const TAKEOVER_CENTER_PAD_INDEX = 7;
export const TAKEOVER_ASCENDING_PAD_INDICES = [
  10, 11, 12, 13, 14,
  5, 6, 7, 8, 9,
  0, 1, 2, 3, 4,
] as const;

export function takeoverPadIndex(col: number, row: number): number {
  return row * TAKEOVER_PAD_COLS + col;
}

export function takeoverPadCoord(index: number): { col: number; row: number } {
  return {
    col: index % TAKEOVER_PAD_COLS,
    row: Math.floor(index / TAKEOVER_PAD_COLS),
  };
}

const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  return `${PC_NAMES[pc]}${Math.floor(midi / 12) - 1}`;
}
