import { describe, it, expect } from 'vitest';
import {
  SANDBOX_TONALITIES, TONALITY_INTERVALS, tonalityParentMode,
  snapMidiToTonality, scaleNoteMap, padIndex, midiName, isBluesTonality,
} from './sandboxScales';
import { analyzeAndNormalize } from './motifAnalysis';
import { isInScale } from './scale';
import type { CapturedMidiNote } from './types';

describe('motifSandbox/sandboxScales(音阶词汇 + 3×5 键盘)', () => {
  it('6 种音阶 + 母调推断', () => {
    expect(SANDBOX_TONALITIES).toEqual(['major', 'minor', 'majorPent', 'minorPent', 'majorBlues', 'minorBlues']);
    expect(tonalityParentMode('major')).toBe('major');
    expect(tonalityParentMode('majorPent')).toBe('major');
    expect(tonalityParentMode('majorBlues')).toBe('major'); // 大调布鲁斯 → 大调母调
    expect(tonalityParentMode('minor')).toBe('minor');
    expect(tonalityParentMode('minorPent')).toBe('minor');
    expect(tonalityParentMode('minorBlues')).toBe('minor');
  });

  it('isBluesTonality:仅大/小调布鲁斯为真', () => {
    expect(isBluesTonality('majorBlues')).toBe(true);
    expect(isBluesTonality('minorBlues')).toBe(true);
    for (const t of ['major', 'minor', 'majorPent', 'minorPent'] as const) expect(isBluesTonality(t)).toBe(false);
  });

  it('小调布鲁斯含 b5 蓝调音(相对根 +6 半音);大调布鲁斯含 b3(+3 半音)', () => {
    expect(TONALITY_INTERVALS.minorBlues).toContain(6); // b5
    expect(TONALITY_INTERVALS.majorBlues).toContain(3); // b3(大调布鲁斯的蓝调音)
    // C 小调布鲁斯:b5 = F#(midi 66 相对 C5 60)→ snap 保留,不被吸走
    expect(snapMidiToTonality(66, 0, 'minorBlues')).toBe(66);
    // 同一音在小调里会被吸走(b5 不在 Aeolian)
    expect(isInScale(66, 0, 'minor')).toBe(false);
    // C 大调布鲁斯:b3 = Eb(midi 63)→ snap 保留(大调里算离调)
    expect(snapMidiToTonality(63, 0, 'majorBlues')).toBe(63);
    expect(isInScale(63, 0, 'major')).toBe(false);
  });

  it('snapMidiToTonality:把离调音吸到该音阶最近音(五声=子集,零损耗)', () => {
    // C 大调五声 [0,2,4,7,9]:E(64)在内不动;F(65)不在五声 → 吸到最近(E64 或 G67)
    expect(snapMidiToTonality(64, 0, 'majorPent')).toBe(64);
    expect([64, 67]).toContain(snapMidiToTonality(65, 0, 'majorPent'));
    // 五声音都是大调子集
    for (const m of scaleNoteMap(0, 'majorPent')) expect(isInScale(m, 0, 'major')).toBe(true);
  });

  it('scaleNoteMap:15 音升序、都在该音阶内', () => {
    for (const t of SANDBOX_TONALITIES) {
      const notes = scaleNoteMap(0, t);
      expect(notes.length).toBe(15);
      for (let i = 1; i < notes.length; i++) expect(notes[i]).toBeGreaterThan(notes[i - 1]); // 升序
      const ivs = TONALITY_INTERVALS[t];
      for (const m of notes) expect(ivs.includes(((m % 12) + 12) % 12)).toBe(true);
    }
  });

  it('padIndex:阅读顺序(顶行最左=0 → 底行最右=14),15 键全填无 FN', () => {
    expect(padIndex(0, 0)).toBe(0); expect(padIndex(4, 0)).toBe(4);   // 顶行(低)
    expect(padIndex(0, 1)).toBe(5); expect(padIndex(4, 1)).toBe(9);   // 中行
    expect(padIndex(0, 2)).toBe(10); expect(padIndex(4, 2)).toBe(14); // 底行(高)
    const all = new Set<number>();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) all.add(padIndex(c, r));
    expect(all.size).toBe(15); // 15 个互异、无 -1
    expect(all.has(-1)).toBe(false);
  });

  it('midiName', () => {
    expect(midiName(60)).toBe('C4');
    expect(midiName(66)).toBe('F#4');
  });

  it('analyze 走 inputTonality:小调布鲁斯输入保留 b5(母调小调里算离调)', () => {
    const msPerBeat = 60000 / 96;
    // C 小调布鲁斯音序 + 一个 b5(F#5=66)
    const captured: CapturedMidiNote[] = [60, 63, 66, 67, 70].map((midi, i) => ({
      midi, velocity: 90, onsetMs: i * msPerBeat, durationMs: msPerBeat * 0.8,
    }));
    const a = analyzeAndNormalize(captured, 0, 'minor', 96, 0, 'minorBlues');
    // b5(66 的 pc=6)应保留在 motif 里
    expect(a.motif.notes.some((n) => ((n.midi % 12) + 12) % 12 === 6)).toBe(true);
    // 不给 inputTonality → 吸到小调母调,b5 被吸走
    const b = analyzeAndNormalize(captured, 0, 'minor', 96, 0);
    expect(b.motif.notes.some((n) => ((n.midi % 12) + 12) % 12 === 6)).toBe(false);
  });

  it('analyze 走 inputTonality:大调布鲁斯输入保留 b3(母调大调里算离调)', () => {
    const msPerBeat = 60000 / 96;
    // C 大调布鲁斯音序 + 蓝调音 b3(Eb4=63)
    const captured: CapturedMidiNote[] = [60, 62, 63, 64, 67].map((midi, i) => ({
      midi, velocity: 90, onsetMs: i * msPerBeat, durationMs: msPerBeat * 0.8,
    }));
    const a = analyzeAndNormalize(captured, 0, 'major', 96, 0, 'majorBlues');
    // b3(63 的 pc=3)应保留在 motif 里
    expect(a.motif.notes.some((n) => ((n.midi % 12) + 12) % 12 === 3)).toBe(true);
    // 不给 inputTonality → 吸到大调母调,b3 被吸走
    const b = analyzeAndNormalize(captured, 0, 'major', 96, 0);
    expect(b.motif.notes.some((n) => ((n.midi % 12) + 12) % 12 === 3)).toBe(false);
  });
});
