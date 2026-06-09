// ============================================================
// newEngine · render · Gap A 全字段等价(musicgenerative_remaining_strict_migration_gaps.md)
// ------------------------------------------------------------
// 锁:ChordDef 全字段从 ChordSpan 忠实投影,不在 render 凭空造/用裸 roman 覆盖:
//   ① type 宽类型精确保留 ② slash/pedal bass 正确 ③ borrowedFrom = 真实调式/借用来源(非裸 roman)
//   ④ borrowedSource/mustResolve/forcedScale/localTonalCenterPc/tonicizationPlacement/analysisKeyPc/localRoman 透传
//   ⑤ effectiveFunc 用功能值 ⑥ notesMidi = 宽类型真实和弦音(非窄三和弦凑数)。
// ============================================================

import { describe, it, expect } from 'vitest';
import { chordSpanToMgChordDef, harmonicPlanToMgChordDefs } from './mgChordDefAdapter';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createRandomContext, pc } from '../foundation';

const span = (o: Record<string, unknown>) => ({
  id: 'c', startBeat: 0, durationBeats: 4, sectionId: 's',
  roman: { degree: 1, accidental: 'natural', quality: 'maj' }, rootPc: pc(0), quality: 'maj',
  ...o,
} as never);

describe('Gap A — ChordDef 全字段等价(synthetic)', () => {
  it('① 宽 chordType 精确保留(maj7/m7/7alt/sus4/add9/m11/13sus4)', () => {
    for (const t of ['maj7', 'm7', '7alt', 'sus4', 'add9', 'm11', '13sus4']) {
      const d = chordSpanToMgChordDef(span({ chordType: t, quality: t.startsWith('m') && t !== 'maj7' ? 'm7' : 'maj' }));
      expect(d.type, t).toBe(t);
    }
  });

  it('② slash 和弦:bassMidi%12 ≠ rootMidi%12;pedal:bassMidi = pedal pc', () => {
    const slash = chordSpanToMgChordDef(span({ rootPc: pc(0), quality: 'maj', bassRole: '3rd' })); // C/E
    expect(slash.bassMidi % 12).not.toBe(slash.rootMidi % 12);
    expect(slash.bassMidi % 12).toBe(4); // E
    const pedal = chordSpanToMgChordDef(span({ rootPc: pc(7), quality: 'maj', bassRole: 'pedal', bassPedalPc: pc(0) })); // G/C pedal
    expect(pedal.bassMidi % 12).toBe(0); // C pedal
  });

  it('③ borrowedFrom = 真实调式/借用来源,不是裸 roman', () => {
    // forcedScale 显式调式 → 标签带调式名(resolver 据此/forcedScale 选 Dorian)
    const dorian = chordSpanToMgChordDef(span({ roman: { degree: 4, accidental: 'natural', quality: 'maj' }, rootPc: pc(5), quality: 'maj', chordType: 'maj7', borrowedSource: 'modal_interchange', forcedScale: 'Dorian' }));
    expect(dorian.borrowedFrom).toMatch(/Dorian/);
    expect(dorian.borrowedFrom).not.toBe('IV'); // ★ 不是裸 roman
    // 无 forcedScale 的 modal_interchange → 平行小调意图(resolver → Aeolian),仍非裸 roman
    const bVI = chordSpanToMgChordDef(span({ roman: { degree: 6, accidental: 'b', quality: 'maj' }, rootPc: pc(8), quality: 'maj', chordType: 'maj7', borrowedSource: 'modal_interchange' }));
    expect(bVI.borrowedFrom).toMatch(/parallel minor/);
    // 非借用 → null
    expect(chordSpanToMgChordDef(span({})).borrowedFrom).toBeNull();
  });

  it('④ borrowedSource/mustResolve/forcedScale/localTonalCenterPc/tonicization/analysisKeyPc/localRoman 透传', () => {
    const d = chordSpanToMgChordDef(span({
      roman: { degree: 5, accidental: 'natural', quality: 'maj' }, rootPc: pc(7), quality: '7', chordType: '7',
      borrowedSource: 'secondary_dominant', mustResolve: true, forcedScale: 'Mixolydian',
      localTonalCenterPc: pc(2), tonicizationPlacement: 'payoff',
    }));
    expect(d.borrowedSource).toBe('secondary_dominant');
    expect(d.mustResolve).toBe(true);
    expect(d.forcedScale).toBe('Mixolydian');
    expect(d.localTonalCenterPc).toBe(2);
    expect(d.tonicizationPlacement).toBe('payoff');
    expect(d.analysisKeyPc).toBe(2);          // 离调区 = localTonalCenterPc
    expect(d.localRoman).toBeTruthy();          // 局部 roman 存在
    // 非离调 → analysisKeyPc/localRoman 不造
    const home = chordSpanToMgChordDef(span({}));
    expect(home.analysisKeyPc).toBeUndefined();
    expect(home.localRoman).toBeUndefined();
  });

  it('⑤ effectiveFunc:I→T / IV→S / V→D / mustResolve→D', () => {
    expect(chordSpanToMgChordDef(span({ roman: { degree: 1, accidental: 'natural', quality: 'maj' } })).effectiveFunc).toBe('T');
    expect(chordSpanToMgChordDef(span({ roman: { degree: 4, accidental: 'natural', quality: 'maj' } })).effectiveFunc).toBe('S');
    expect(chordSpanToMgChordDef(span({ roman: { degree: 5, accidental: 'natural', quality: 'maj' } })).effectiveFunc).toBe('D');
    expect(chordSpanToMgChordDef(span({ roman: { degree: 2, accidental: 'natural', quality: 'm7' }, mustResolve: true })).effectiveFunc).toBe('D');
  });

  it('⑥ notesMidi = 宽类型真实和弦音(扩展和弦 > 三和弦)', () => {
    const triad = chordSpanToMgChordDef(span({ chordType: 'maj', quality: 'maj' }));
    const m11 = chordSpanToMgChordDef(span({ chordType: 'm11', quality: 'm7' }));
    expect(triad.notesMidi.length).toBe(3);
    expect(m11.notesMidi!.length).toBeGreaterThan(4); // m11 含 9/11
    // notesMidi 是真实 pc(根=rootPc)
    expect(m11.notesMidi![0] % 12).toBe(0);
  });
});

describe('Gap A — 真实 plan 全字段(POP/LOFI/RNB/JAZZ;无字段缺失回退)', () => {
  const REQUIRED = ['root', 'rootMidi', 'type', 'bassMidi', 'duration', 'roman', 'effectiveFunc', 'notesMidi', 'chordSymbol'] as const;
  for (const [seed, style] of [[396040, 'pop'], [7, 'lofi'], [777870, 'rnb'], [3, 'jazz']] as const) {
    it(`${seed}/${style}: 每个 ChordDef 必填字段齐全(shaper 不因缺字段回退)`, () => {
      const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
      const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
      const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
      const defs = harmonicPlanToMgChordDefs(plan);
      expect(defs.length).toBeGreaterThan(0);
      for (const d of defs) {
        for (const f of REQUIRED) expect((d as unknown as Record<string, unknown>)[f], `${seed}/${style} 缺 ${f}`).not.toBeUndefined();
        expect(d.notesMidi!.length, 'notesMidi 空').toBeGreaterThanOrEqual(3); // 真实和弦音,非空凑数
        // 借用和弦 borrowedFrom 不是裸 roman(含调式/借用语义 或 副属 roman)
        if (d.borrowedSource && (d.borrowedSource === 'modal_interchange' || d.borrowedSource === 'backdoor_dominant')) {
          expect(d.borrowedFrom, `${seed} 借用 borrowedFrom`).toMatch(/parallel minor|Dorian|Phrygian|Mixolydian|Aeolian|Lydian/i);
        }
      }
    });
  }
});
