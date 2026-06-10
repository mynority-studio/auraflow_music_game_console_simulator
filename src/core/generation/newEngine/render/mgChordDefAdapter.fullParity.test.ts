// ============================================================
// newEngine · render · Gap A 全字段【分层透传】parity(musicgenerative_remaining_strict_migration_gaps.md)
// ------------------------------------------------------------
// 严格判据(CODEX 复审):borrowedFrom 等【作者语义标签】必须从 ChordSpan(harmony 层已定)原样 passthrough,
//   render adapter 不二次推导。锁:
//   ① 作者 borrowedFrom 精确字符串 passthrough(不被改写、不被 roman 覆盖)
//   ② 无 borrowedFrom 的 span → adapter 不发明(=span 给什么就什么,render 零推导)
//   ③ widePianoVoicing 不丢(deep equal passthrough)
//   ④ analysisKeyPc/localRoman/effectiveFunc/tonicizationPlacement passthrough
//   ⑤ 真实 plan:KB 作者标签(soft V/vi · Dorian IV (raised 6) · ii/IV · V/V to home V …)贯穿 harmony→render
//      到最终 ChordDef(证明分层 lineage,而非 adapter 重建)。
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

describe('Gap A — ChordDef 全字段【分层透传】(synthetic)', () => {
  it('① 宽 chordType 精确保留(maj7/m7/7alt/sus4/add9/m11/13sus4)', () => {
    for (const t of ['maj7', 'm7', '7alt', 'sus4', 'add9', 'm11', '13sus4'])
      expect(chordSpanToMgChordDef(span({ chordType: t, quality: t.startsWith('m') && t !== 'maj7' ? 'm7' : 'maj' })).type, t).toBe(t);
  });

  it('② slash:bassMidi%12≠rootMidi%12;pedal:bassMidi=pedal pc', () => {
    expect(chordSpanToMgChordDef(span({ bassRole: '3rd' })).bassMidi % 12).toBe(4);            // C/E
    expect(chordSpanToMgChordDef(span({ rootPc: pc(7), bassRole: 'pedal', bassPedalPc: pc(0) })).bassMidi % 12).toBe(0); // G/C
  });

  it('③ ★ 作者 borrowedFrom 精确字符串 passthrough(render 不改写、不推导)', () => {
    for (const label of ['soft V/vi', 'Dorian IV (raised 6)', 'ii/IV', 'Phrygian bII color', 'V/V to home V']) {
      const d = chordSpanToMgChordDef(span({ borrowedSource: 'modal_interchange', forcedScale: 'Dorian', borrowedFrom: label }));
      expect(d.borrowedFrom, label).toBe(label); // 精确等于作者标签,forcedScale 也不覆盖它
    }
  });

  it('② ★ 无 borrowedFrom 的 span → adapter 不发明(render 零推导)', () => {
    // span 带 borrowedSource/forcedScale 但【没】borrowedFrom → adapter 输出 null(推导是 harmony 的活,不在 render)
    expect(chordSpanToMgChordDef(span({ borrowedSource: 'modal_interchange', forcedScale: 'Dorian' })).borrowedFrom).toBeNull();
    expect(chordSpanToMgChordDef(span({})).borrowedFrom).toBeNull(); // 非借用
  });

  it('③ widePianoVoicing 不丢(deep equal passthrough)', () => {
    const wpv = [48, 55, 60, 64, 67];
    expect(chordSpanToMgChordDef(span({ widePianoVoicing: wpv })).widePianoVoicing).toEqual(wpv);
    expect(chordSpanToMgChordDef(span({})).widePianoVoicing).toBeUndefined();
  });

  it('④ analysisKeyPc/localRoman/effectiveFunc/tonicizationPlacement passthrough(span 给什么=输出什么)', () => {
    const d = chordSpanToMgChordDef(span({
      effectiveFunc: 'S', analysisKeyPc: pc(2), localRoman: 'V/ii', tonicizationPlacement: 'payoff',
      mustResolve: true, forcedScale: 'Mixolydian', localTonalCenterPc: pc(2), borrowedSource: 'secondary_dominant',
    }));
    expect(d.effectiveFunc).toBe('S');           // 用 span 的功能值(非度数重推)
    expect(d.analysisKeyPc).toBe(2);
    expect(d.localRoman).toBe('V/ii');
    expect(d.tonicizationPlacement).toBe('payoff');
    expect(d.forcedScale).toBe('Mixolydian');
    expect(d.localTonalCenterPc).toBe(2);
    expect(d.mustResolve).toBe(true);
    // 老 ChordSpan(无 effectiveFunc)→ 回退度数 TSD(向后兼容)
    expect(chordSpanToMgChordDef(span({ roman: { degree: 5, accidental: 'natural', quality: 'maj' } })).effectiveFunc).toBe('D');
  });

  it('⑥ notesMidi = 宽类型真实和弦音', () => {
    expect(chordSpanToMgChordDef(span({ chordType: 'maj', quality: 'maj' })).notesMidi.length).toBe(3);
    expect(chordSpanToMgChordDef(span({ chordType: 'm11', quality: 'm7' })).notesMidi!.length).toBeGreaterThan(4);
  });
});

describe('Gap A — 真实 plan:KB 作者标签贯穿 harmony→render(分层 lineage)', () => {
  // 这些标签【只有 KB 作者写】,harmony 推导兜底产不出(soft V/vi≠V/vi;Dorian IV (raised 6)≠Dorian IV)→
  // 若它们出现在最终 ChordDef,证明 slot→realizer→ResolvedChord→ChordSpan→adapter 全链透传成立。
  const AUTHORED_ONLY = ['soft V/vi', 'Dorian IV (raised 6)', 'ii/IV', 'ii/vi', 'Phrygian bII color', 'V/V to home V', 'Aeolian modal cadence', 'Aeolian modal cadence V→bVII→i'];

  it('扫 seeds:作者专属 borrowedFrom 标签精确出现在最终 ChordDef(证明 lineage,非 render 重建)', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 120; seed++) {
      for (const style of ['pop', 'rnb', 'lofi', 'jazz']) {
        const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
        const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
        const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
        for (const d of harmonicPlanToMgChordDefs(plan)) if (d.borrowedFrom && AUTHORED_ONLY.includes(d.borrowedFrom)) seen.add(d.borrowedFrom);
      }
    }
    // 至少命中若干作者专属标签(平行小调 iv / V/vi 等高频进行带它们;120 seed×4 风格足够覆盖)
    expect(seen.size, `命中作者专属标签: ${[...seen].join(' | ') || '无(lineage 断了)'}`).toBeGreaterThan(0);
  });

  it('真实 plan 必填字段齐全 + 借用 borrowedFrom 非裸 roman(POP/LOFI/RNB/JAZZ)', () => {
    for (const [seed, style] of [[396040, 'pop'], [7, 'lofi'], [777870, 'rnb'], [3, 'jazz']] as const) {
      const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
      const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
      const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
      const defs = harmonicPlanToMgChordDefs(plan);
      expect(defs.length).toBeGreaterThan(0);
      for (const d of defs) {
        for (const f of ['root', 'rootMidi', 'type', 'bassMidi', 'duration', 'roman', 'effectiveFunc', 'notesMidi', 'analysisKeyPc']) {
          expect((d as unknown as Record<string, unknown>)[f], `${seed}/${style} 缺 ${f}`).not.toBeUndefined();
        }
        if (d.borrowedSource === 'modal_interchange' || d.borrowedSource === 'backdoor_dominant') {
          expect(d.borrowedFrom, `${seed} 借用 borrowedFrom`).toMatch(/parallel|Dorian|Phrygian|Mixolydian|Aeolian|Lydian|bVII|bII|iv|bVI/i);
        }
      }
    }
  });
});
