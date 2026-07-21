import { describe, it, expect } from 'vitest';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { JAZZ_4_4_ARCHETYPE_ID } from '../arranger/jazzArchetypePlanner';
import { chordTones, getChordPitchClasses, normalizeChordType } from '../knowledge/chords';
import { createRandomContext, pc } from '../foundation';

describe('harmony · chord-scale 集成不变量 (3.6)', () => {
  const mkPlan = (style: string) => {
    const band = buildBandSpec({ seed: 5, styleHint: style, mood: 'x', targetDuration: 120, key: pc(0) });
    const arrangement = buildArrangementPlan(band);
    return buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(5));
  };

  it('每个和弦的 chord-scale = 完整 7 音调式音阶(取代旧 6 音占位)', () => {
    const plan = mkPlan('pop');
    for (const span of plan.chordTimeline) {
      const scale = plan.chordScaleMap[span.id];
      expect(scale.length).toBe(7);
      expect(new Set(scale).size).toBe(7); // 无重复
    }
  });

  it('★ 不变量:声明的和弦音 ⊆ chord-scale(含副属/借和弦离调)', () => {
    for (const style of ['pop', 'jazz', 'lofi']) {
      const plan = mkPlan(style);
      for (const span of plan.chordTimeline) {
        const scale = new Set<number>(plan.chordScaleMap[span.id]);
        // chordType 是作者定义的完整和弦；quality 只是旧 renderer 的窄投影。
        const chordType = span.chordType ? normalizeChordType(span.chordType) : null;
        const declaredChordPcs = chordType
          ? getChordPitchClasses(span.rootPc, chordType)
          : chordTones(span.rootPc, span.quality);
        for (const t of declaredChordPcs) {
          expect(
            scale.has(t),
            `${style}:${span.id}:${span.chordType ?? span.quality} missing pc ${t} from [${[...scale].join(',')}]`,
          ).toBe(true);
        }
      }
    }
  });

  it('Jazz 4/4 跨 seed/prototype 仍保持宽和弦音 ⊆ chord-scale', () => {
    for (let seed = 0; seed < 32; seed++) {
      const band = buildBandSpec({ seed, styleHint: 'jazz', mood: 'x', targetDuration: 120, key: pc(0) });
      const arrangement = buildArrangementPlan(band, {
        rng: createRandomContext(seed),
        jazzArchetypeId: JAZZ_4_4_ARCHETYPE_ID,
      });
      const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
      for (const span of plan.chordTimeline) {
        const chordType = span.chordType ? normalizeChordType(span.chordType) : null;
        const declared = chordType
          ? getChordPitchClasses(span.rootPc, chordType)
          : chordTones(span.rootPc, span.quality);
        const scale = new Set<number>(plan.chordScaleMap[span.id]);
        for (const tone of declared) {
          expect(scale.has(tone), `seed=${seed} ${span.chordType} missing pc ${tone}`).toBe(true);
        }
      }
    }
  });

  it('副属/借和弦的 chord-scale 含离调音(非纯母调)', () => {
    const majorPcs = new Set([0, 2, 4, 5, 7, 9, 11]);
    const jazz = mkPlan('jazz'); // 出副属
    const sdIdx = jazz.romanProgression.findIndex((r) => r.secondaryTarget !== undefined);
    if (sdIdx >= 0) {
      const scale = jazz.chordScaleMap[jazz.chordTimeline[sdIdx].id];
      expect(scale.some((p) => !majorPcs.has(p))).toBe(true); // 含离调
    }
    const pop = mkPlan('pop'); // 出借和弦
    const borrowedId = Object.keys(pop.borrowedChordMap)[0];
    if (borrowedId) {
      const scale = pop.chordScaleMap[borrowedId];
      expect(scale.some((p) => !majorPcs.has(p))).toBe(true);
    }
  });

  it('确定性:同 seed 两次构建 chord-scale 完全一致', () => {
    const a = mkPlan('jazz');
    const b = mkPlan('jazz');
    for (const span of a.chordTimeline) {
      expect(a.chordScaleMap[span.id]).toEqual(b.chordScaleMap[span.id]);
    }
  });
});
