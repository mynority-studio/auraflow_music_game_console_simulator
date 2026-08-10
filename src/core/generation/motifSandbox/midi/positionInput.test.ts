import { describe, expect, it } from 'vitest';
import { PAD_POSITION_MIDI_NOTES, padIndexFromPositionNote, mapPositionNoteToScale } from './positionInput';
import { scaleNoteMap } from '../model/sandboxScales';

describe('positionInput · 产品 3×5 按位输入', () => {
  it('位置表 = C3..C5 十五个自然音(阅读顺序,与 Q+T 同表)', () => {
    expect(PAD_POSITION_MIDI_NOTES).toEqual([
      48, 50, 52, 53, 55,
      57, 59, 60, 62, 64,
      65, 67, 69, 71, 72,
    ]);
  });

  it('位置 note → pad 索引;黑键/超范围 → null', () => {
    expect(padIndexFromPositionNote(48)).toBe(0);  // C3 顶行最左
    expect(padIndexFromPositionNote(60)).toBe(7);  // C4 中行中间
    expect(padIndexFromPositionNote(72)).toBe(14); // C5 底行最右
    expect(padIndexFromPositionNote(49)).toBeNull(); // C#3
    expect(padIndexFromPositionNote(47)).toBeNull();
    expect(padIndexFromPositionNote(73)).toBeNull();
  });

  it('C 大调下按位映射 = 原音高(位置表本身就是 C 大调 3×5 音表)', () => {
    for (const n of PAD_POSITION_MIDI_NOTES) expect(mapPositionNoteToScale(n, 0, 'major')).toBe(n);
  });

  it('任意调性下按位映射 = 屏幕 PadKeyboard 同位音', () => {
    const dMajor = scaleNoteMap(2, 'major');
    PAD_POSITION_MIDI_NOTES.forEach((n, i) => {
      expect(mapPositionNoteToScale(n, 2, 'major')).toBe(dMajor[i]);
    });
    const aMinorPent = scaleNoteMap(9, 'minorPent'); // 5 音音阶 → 15 键跨三个八度循环
    PAD_POSITION_MIDI_NOTES.forEach((n, i) => {
      expect(mapPositionNoteToScale(n, 9, 'minorPent')).toBe(aMinorPent[i]);
    });
  });

  it('非位置键在任何调性下都不映射', () => {
    expect(mapPositionNoteToScale(49, 2, 'major')).toBeNull();
    expect(mapPositionNoteToScale(46, 9, 'minorPent')).toBeNull();
  });
});
