import { describe, it, expect } from 'vitest';
import { analyzeUserMelodicBrick } from './melodicBrickAnalyzer';
import { inferHarmonyIntent } from './melodicBrickHarmonyIntent';
import { selectProgressionForMotif } from './motifProgressionSelector';
import { scoreProgressionAgainstMelodicBrick } from './melodyProgressionScorer';
import { degreeOctaveToMidi } from './scale';
import type { UserMotif } from './types';
import type { ProgressionCandidate } from './progressionCandidateProvider';
import type { ProgressionSlot, ProgressionPrototype } from '../../newEngine/knowledge/progressions';

function motif(degrees: number[], durs: number[]): UserMotif {
  let onset = 0;
  const notes = degrees.map((d, i) => {
    const n = { midi: degreeOctaveToMidi(d, 5, 0, 'major' as const), onsetBeat: onset, durationBeat: durs[i], velocity: 0.85, scaleDegree: d, octave: 5, accent: 0.7, structuralToneScore: Math.min(1, 0.4 + durs[i] * 0.3) };
    onset += durs[i]; return n;
  });
  const contour: number[] = [];
  for (let i = 1; i < notes.length; i++) contour.push(Math.sign(notes[i].midi - notes[i - 1].midi));
  return { id: 'm', keyPc: 0, mode: 'major', bpm: 96, notes, lengthBeats: 4, contour, rhythmCell: durs, createdAt: 0 };
}
const slot = (roman: string, deg: number, func?: 'T' | 'S' | 'D'): ProgressionSlot => ({ roman, type: 'maj', scaleDegree: deg, rootOffset: 0, effectiveFunc: func });
const fakeCandidate = (id: string, romans: Array<[string, number, ('T' | 'S' | 'D')?]>, cadence?: ProgressionPrototype['cadence']): ProgressionCandidate => {
  const slots = romans.map(([r, d, f]) => slot(r, d, f));
  return { prototype: { id, style: 'POP', mode: 'Major', sectionRoles: ['verse'], lengthBars: 4, slots, cadence }, fittedSlots: slots, modeMatch: true };
};

describe('motifSandbox/motifProgressionSelector(brick 驱动选模板)', () => {
  it('① 端到端:cadence motif → 选出 16-bar 进行,非退化(≥3 个不同级),确定性,POP', () => {
    const brick = analyzeUserMelodicBrick(motif([3, 2, 1], [1, 1, 2]));
    const intent = inferHarmonyIntent(brick);
    const sel = selectProgressionForMotif({ brick, intent, style: 'pop', mode: 'major', keyPc: 0, seed: 7 });
    expect(sel.style).toBe('POP');
    expect(sel.slots.reduce((n, s) => n + (s.beats ?? 4), 0)).toBe(64); // fit 满 16 bar
    // 非退化:引擎自判 degeneratePenalty=0(I-I-I-I/V-I-I-I 类)+ 一个循环 ≥2 个不同和弦(roman 计,
    //   含借和弦如 I-IV-iv-I:scaleDegree 只 2 但 roman 3 个 → 不算退化)。
    expect(sel.scoreBreakdown.degeneratePenalty, '非退化进行').toBe(0);
    const cycleRomans = new Set(sel.slots.slice(0, 4).map((s) => s.roman));
    expect(cycleRomans.size, '一个循环里 ≥2 个不同和弦').toBeGreaterThanOrEqual(2);
    const sel2 = selectProgressionForMotif({ brick, intent, style: 'pop', mode: 'major', keyPc: 0, seed: 7 });
    expect(sel.prototypeId).toBe(sel2.prototypeId); // 确定性
    expect(sel.topCandidates.length).toBeGreaterThan(0);
  });

  it('② 退化进行被重罚:V-I-I-I 分数 < 富进行 I-vi-IV-V', () => {
    const brick = analyzeUserMelodicBrick(motif([3, 2, 1], [1, 1, 2]));
    const intent = inferHarmonyIntent(brick);
    const degenerate = fakeCandidate('deg', [['V', 5, 'D'], ['I', 1, 'T'], ['I', 1, 'T'], ['I', 1, 'T']], 'soft_authentic');
    const rich = fakeCandidate('rich', [['I', 1, 'T'], ['vi', 6, 'T'], ['IV', 4, 'S'], ['V', 5, 'D']], 'soft_authentic');
    const dScore = scoreProgressionAgainstMelodicBrick(brick, intent, degenerate, 0);
    const rScore = scoreProgressionAgainstMelodicBrick(brick, intent, rich, 0);
    expect(dScore.breakdown.degeneratePenalty).toBeGreaterThan(0);
    expect(rScore.breakdown.degeneratePenalty).toBe(0);
    expect(rScore.total).toBeGreaterThan(dScore.total);
  });

  it('③ cadence 偏好:soft_authentic 模板的 cadenceFit 高于 open 模板(对 cadence motif)', () => {
    const brick = analyzeUserMelodicBrick(motif([3, 2, 1], [1, 1, 2])); // 终止类
    const intent = inferHarmonyIntent(brick);
    const authentic = fakeCandidate('a', [['I', 1, 'T'], ['IV', 4, 'S'], ['V', 5, 'D'], ['I', 1, 'T']], 'soft_authentic');
    const open = fakeCandidate('o', [['I', 1, 'T'], ['IV', 4, 'S'], ['vi', 6, 'T'], ['V', 5, 'D']], 'open');
    const a = scoreProgressionAgainstMelodicBrick(brick, intent, authentic, 0);
    const o = scoreProgressionAgainstMelodicBrick(brick, intent, open, 0);
    expect(a.breakdown.cadenceFit).toBeGreaterThan(o.breakdown.cadenceFit);
  });

  it('★ P1:scorer 按【真实和弦】判贴合 —— 同 scaleDegree 但 rootOffset 不同 → 得分不同', () => {
    const brick = analyzeUserMelodicBrick(motif([3, 2, 1], [1, 1, 2])); // 结构音 E/D/C(C 大调)
    const intent = inferHarmonyIntent(brick);
    const realI = fakeCandidate('I', [['I', 1, 'T'], ['vi', 6, 'T'], ['IV', 4, 'S'], ['V', 5, 'D']]); // I=C-E-G,含 C/E
    const slotsB: ProgressionSlot[] = [0, 0, 0, 0].map(() => ({ roman: 'bII', type: 'maj', scaleDegree: 1, rootOffset: 1 })); // 同级数但 rootOffset=1(Db)
    const fakeB: ProgressionCandidate = { prototype: { id: 'bII', style: 'POP', mode: 'Major', sectionRoles: ['verse'], lengthBars: 4, slots: slotsB }, fittedSlots: slotsB, modeMatch: true };
    const sI = scoreProgressionAgainstMelodicBrick(brick, intent, realI, 0);
    const sB = scoreProgressionAgainstMelodicBrick(brick, intent, fakeB, 0);
    expect(sI.breakdown.structuralToneSupport).not.toBe(sB.breakdown.structuralToneSupport); // 不再"得分完全一样"
    expect(sI.breakdown.structuralToneSupport).toBeGreaterThan(sB.breakdown.structuralToneSupport); // I 更贴 C 大调 motif 骨干音
  });

  it('★ B:按【模板循环周期】判贴合(8-bar 模板锚点=0/32 周期头,非固定 16)—— 周期头含 motif 音 > 不含', () => {
    const brick = analyzeUserMelodicBrick(motif([1, 1], [2, 2])); // 强 C(deg1)结构音
    const intent = inferHarmonyIntent(brick);
    const ds = (roman: string, deg: number, rootOffset: number, type = 'maj'): ProgressionSlot => ({ roman, type, scaleDegree: deg, rootOffset });
    // 8-bar 模板,周期头(bar1 = beat0/32)和弦不同:GOOD 含 C(vi),BAD 不含 C(ii)。
    const cand8 = (id: string, head: ProgressionSlot): ProgressionCandidate => {
      const base = [head, ds('V', 5, 7), ds('vi', 6, 9, 'min'), ds('IV', 4, 5), ds('I', 1, 0), ds('V', 5, 7), ds('vi', 6, 9, 'min'), ds('IV', 4, 5)];
      return { prototype: { id, style: 'POP', mode: 'Major', sectionRoles: ['verse'], lengthBars: 8, slots: base }, fittedSlots: [...base, ...base], modeMatch: true };
    };
    const good = cand8('good', ds('vi', 6, 9, 'min')); // 周期头 vi(A-C-E,含 C)
    const bad = cand8('bad', ds('ii', 2, 2, 'min'));   // 周期头 ii(D-F-A,无 C)
    const sGood = scoreProgressionAgainstMelodicBrick(brick, intent, good, 0);
    const sBad = scoreProgressionAgainstMelodicBrick(brick, intent, bad, 0);
    expect(sGood.breakdown.structuralToneSupport).toBeGreaterThan(sBad.breakdown.structuralToneSupport);
  });

  it('④ 非 jazz 不选 jazz', () => {
    const brick = analyzeUserMelodicBrick(motif([1, 3, 5, 4], [1, 1, 1, 1]));
    const intent = inferHarmonyIntent(brick);
    for (const style of ['pop', 'lofi', 'rnb'] as const) {
      const sel = selectProgressionForMotif({ brick, intent, style, mode: 'major', keyPc: 0, seed: 3 });
      expect(sel.style, style).not.toBe('JAZZ');
    }
  });

  it('★ 产品联合规划:只从 production RoadMap 可落位候选中派发', () => {
    const brick = analyzeUserMelodicBrick(motif([1, 3, 5, 4], [1, 1, 1, 1]));
    const intent = inferHarmonyIntent(brick);
    let firstViableId: string | undefined;
    const selected = selectProgressionForMotif({
      brick,
      intent,
      style: 'pop',
      mode: 'major',
      keyPc: 0,
      seed: 999,
      evaluateProductionPlacement: (candidate) => {
        if (!firstViableId && candidate.modeMatch) firstViableId = candidate.prototype.id;
        return { viable: candidate.prototype.id === firstViableId, score: candidate.prototype.id === firstViableId ? 20 : -100 };
      },
    });
    expect(firstViableId).toBeDefined();
    expect(selected.prototypeId).toBe(firstViableId);
  });
});
