// ============================================================
// newEngine · render · lead 空拍补全(2026-06-11,用户:75528/pop 末音后大空拍)
// ============================================================
import { describe, it, expect } from 'vitest';
import { fillLeadBarGaps, planLeadGapFills } from './leadGapFill';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderMgMelody } from './mgLeadRenderer';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { createTimebase, createRandomContext, beats, midi, ticks, type Timebase } from '../foundation';
import type { ChordSpan } from '../harmony/HarmonicPlan';
import type { NoteIR } from '../ir/MusicalIR';

const tb: Timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
const BAR = 1920;

// 合成和弦:整 bar 一个和弦(Cmaj),用于单元用例
function oneChordPerBar(nbars: number): ChordSpan[] {
  const out: ChordSpan[] = [];
  for (let b = 0; b < nbars; b++) {
    out.push({ id: `c${b}` as never, roman: { degree: 1 } as never, rootPc: 0 as never, quality: 'maj' as never, startBeat: beats(b * 4), durationBeats: beats(4), sectionId: 's' as never });
  }
  return out;
}
const note = (start: number, dur: number, pitch = 72): NoteIR => ({ pitch: midi(pitch), startTick: ticks(start), durationTicks: ticks(dur), velocity: 90 });

describe('render/leadGapFill — 单元', () => {
  it('末音结束在 bar 内 + 后接大空拍 + 本 bar 余下全空 → 延长到 bar 末', () => {
    // bar1: 音@0..960(beat0-2),之后空到 bar3(下一音@5760)→ 延长到 1920(bar1 末)
    const notes = [note(0, 960), note(5760, 480)];
    const fills = planLeadGapFills(notes, oneChordPerBar(4), tb, 4);
    expect(fills.length).toBe(1);
    expect(fills[0].newEnd).toBe(BAR); // 补到 bar1 末
    const out = fillLeadBarGaps([{ role: 'lead', notes }], oneChordPerBar(4), tb, 4)[0];
    expect((out.notes[0].durationTicks as number)).toBe(BAR); // 0→1920
  });

  it('末音已落 bar 线(整 bar 收束)→ 不补', () => {
    const notes = [note(0, 1920), note(5760, 480)]; // 音@0..1920(正好 bar 线)
    expect(planLeadGapFills(notes, oneChordPerBar(4), tb, 4).length).toBe(0);
  });

  it('空拍小(< 2 拍)→ 不补', () => {
    const notes = [note(0, 480), note(1440, 480)]; // 空 960... 实际 gap=1440-960=480=1拍 <2拍
    expect(planLeadGapFills(notes, oneChordPerBar(4), tb, 4).length).toBe(0);
  });

  it('本 bar 余下还有后续音 → 不补(旋律未断)', () => {
    // 音@0..480(beat0-1),下一音@1440(beat3,同 bar)→ 不补;但下一音后空到 bar3
    const notes = [note(0, 480), note(1440, 480), note(5760, 480)];
    const fills = planLeadGapFills(notes, oneChordPerBar(4), tb, 4);
    // 第一个音不补(同 bar 有后续);第二个音(@1440..1920,落 bar 线)不补
    expect(fills.length).toBe(0);
  });

  it('★ 2 和弦/bar:补到起音和弦末,不得把持续音拖进下一和弦', () => {
    // bar0: chord1@0-960, chord2@960-1920;音@0..480,空到 bar2 → 只补到 chord1 末 960
    const chords: ChordSpan[] = [
      { id: 'a' as never, roman: { degree: 1 } as never, rootPc: 0 as never, quality: 'maj' as never, startBeat: beats(0), durationBeats: beats(2), sectionId: 's' as never },
      { id: 'b' as never, roman: { degree: 5 } as never, rootPc: 7 as never, quality: 'dom7' as never, startBeat: beats(2), durationBeats: beats(2), sectionId: 's' as never },
    ];
    const notes = [note(0, 480), note(3840, 480)];
    const fills = planLeadGapFills(notes, chords, tb, 4);
    expect(fills.length).toBe(1);
    expect(fills[0].newEnd).toBe(960);
    expect(fills[0].barEnd).toBe(1920);
    expect(fills[0].chordClamped).toBe(true);
    const out = fillLeadBarGaps([{ role: 'lead', notes }], chords, tb, 4)[0];
    expect((out.notes[0].durationTicks as number)).toBe(960);
  });

  it('深不可变 / 只动 lead / onset 不变', () => {
    const notes = [note(0, 960), note(5760, 480)];
    const tracks = [{ role: 'lead' as const, notes }, { role: 'comp' as const, notes: [note(0, 480)] }];
    const out = fillLeadBarGaps(tracks, oneChordPerBar(4), tb, 4);
    expect(out[1]).toBe(tracks[1]);                          // comp 原样(引用不变)
    expect(out[0].notes[0].startTick).toBe(notes[0].startTick); // onset 不变
  });
});

describe('render/leadGapFill — 75528/pop(用户报告)', () => {
  it('末音后大空拍被补到 bar 末(或和弦末);确定性', () => {
    const band = buildBandSpec({ seed: 75528, styleHint: 'pop', mood: 'build', targetDuration: 150 });
    const arr = buildArrangementPlan(band, { rng: createRandomContext(75528) });
    const harm = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(75528));
    const t = createTimebase({ meter: { numerator: arr.meter.numerator, denominator: arr.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arr.tempoBpm }] });
    const raw = renderMgMelody(harm, band, t, 75528);
    const fills = planLeadGapFills(raw.notes, harm.chordTimeline, t, beatsPerBarOf(arr.meter));
    // ⚠️ Phase B(2026-06-28):生产 RoadMap 改 functional(554-brick)→ 75528 lead 结构变(空拍变少,
    //   现仅 1 处大空拍)。gap-fill 机制仍生效(≥1 触发);原阈 >5 是旧 stale-RoadMap 的密 lead 特征。
    //   生产 lead 真值 rebaseline 留 Phase F(post-shaper 还会再动);此处仅验机制存活。
    expect(fills.length).toBeGreaterThanOrEqual(1);     // gap-fill 机制仍生效(EAR-CHECK / Phase F rebaseline)
    // 每个补全:newEnd 落在 bar 末或起音和弦末,且 > oldEnd
    for (const f of fills) {
      expect(f.newEnd).toBeGreaterThan(f.oldEnd);
      expect(f.newEnd).toBeLessThanOrEqual(f.barEnd);
      expect(f.chordClamped).toBe(f.newEnd < f.barEnd);
    }
    expect(planLeadGapFills(raw.notes, harm.chordTimeline, t, beatsPerBarOf(arr.meter))).toEqual(fills); // 确定性
  });
});
