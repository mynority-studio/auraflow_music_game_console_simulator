// ============================================================
// motifSandbox · midi · 产品 3×5 按位输入(与 Q+T 共享位置表)
// ------------------------------------------------------------
// 产品蓝牙 MIDI 每个 pad 发 C3..C5 自然音 = 位置编码(阅读顺序 0-14),
// 不代表真实音高。按位模式:位置 → 当前调性 scaleNoteMap 同位取音,
// 与屏幕 PadKeyboard 点击同位 pad 完全一致(任意调全键可用)。
// ============================================================

import { scaleNoteMap, type SandboxTonality } from '../model/sandboxScales';

/** 3×5 位置编码音表(阅读顺序:顶行左→右 = 0-4 … 底行 = 10-14)。Q+T 按位映射用同一张表。 */
export const PAD_POSITION_MIDI_NOTES = [
  48, 50, 52, 53, 55,
  57, 59, 60, 62, 64,
  65, 67, 69, 71, 72,
] as const;

const padIndexByPositionNote = new Map<number, number>(
  PAD_POSITION_MIDI_NOTES.map((midi, padIndex) => [midi, padIndex]),
);

/** 位置编码 note → pad 索引(0-14);非位置键(黑键/超范围)→ null。 */
export function padIndexFromPositionNote(midi: number): number | null {
  return padIndexByPositionNote.get(Math.round(midi)) ?? null;
}

/** 按位映射:位置编码 note → 当前调性 3×5 键盘同位音;非位置键 → null。 */
export function mapPositionNoteToScale(midi: number, keyPc: number, tonality: SandboxTonality): number | null {
  const padIndex = padIndexFromPositionNote(midi);
  if (padIndex === null) return null;
  return scaleNoteMap(keyPc, tonality)[padIndex] ?? null;
}
