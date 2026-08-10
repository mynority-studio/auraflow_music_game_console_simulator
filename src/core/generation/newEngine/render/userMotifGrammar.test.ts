import { describe, it, expect } from 'vitest';
import { makeSeededRng } from './mgRng';
import { expandGrammarForBrick, type GrammarExpansionTraceEvent } from './mgGrammarRuntime';
import { POP_ENRICHED_GRAMMAR } from '../knowledge/melodyStyleGrammarProfiles';
import { buildMelodyRhythmShapeProfile } from './mgRhythmShapeMatcher';
import {
  createUserMotifGrammarInjector,
  motifNotesToTokens,
  userMotifGrammarRules,
  USER_MOTIF_RULE_SOURCE,
} from './userMotifGrammar';
import type { AuthoredUserMotifBrickPlan, UserMotifBrickNote } from './userMotifBrick';

const NOTES: UserMotifBrickNote[] = [
  { pitch: 60, onsetBeat: 0, durationBeat: 1, velocity: 100, structuralToneScore: 1 },
  { pitch: 64, onsetBeat: 1, durationBeat: 0.5, velocity: 92, structuralToneScore: 1 },
  { pitch: 67, onsetBeat: 2, durationBeat: 1, velocity: 96, structuralToneScore: 1 },
  { pitch: 64, onsetBeat: 3, durationBeat: 1, velocity: 90, structuralToneScore: 1 },
];

const plan = (): AuthoredUserMotifBrickPlan => ({
  roadMapBrickIndices: [0],
  roadMapBrickNames: ['on-0'],
  startBeat: 0,
  endBeat: 4,
  sourceSpanBeats: 4,
  targetSpanBeats: 4,
  scaleFactor: 1,
  harmonicSupportRatio: 1,
  placementScore: 100,
  timingDeviationRatioLimit: 0.2,
  fidelityReferenceNotes: NOTES,
  rhythmShapeProfile: buildMelodyRhythmShapeProfile(NOTES, 0, 4),
  notes: NOTES,
});

describe('userMotifGrammar · motif 语法化(四期)', () => {
  it('token 编码:节奏含休止、首音 C 锚、逐步 slope 窗口 = 音程 ±1、收尾 SlopeExit', () => {
    const tokens = motifNotesToTokens(NOTES.map((n) => ({ pitch: n.pitch, onset: n.onsetBeat, dur: n.durationBeat })));
    const kinds = tokens.map((t) => t.kind);
    expect(kinds[0]).toBe('C');
    expect(kinds[kinds.length - 1]).toBe('SlopeExit');
    // 步进 +4, +3, -3 → 窗口 [3,5] [2,4] [-4,-2]
    const slopes = tokens.filter((t) => t.kind === 'SlopeEnter') as Array<{ dirMin: number; dirMax: number }>;
    expect(slopes.map((s) => [s.dirMin, s.dirMax])).toEqual([[3, 5], [2, 4], [-4, -2]]);
    // 0.5 拍音后有 0.5 拍休止(时间轴纯顺序)
    expect(tokens.some((t) => t.kind === 'R' && Math.abs(t.duration - 0.5) < 1e-6)).toBe(true);
    // 总时长 = 4 拍
    expect(tokens.reduce((s, t) => s + t.duration, 0)).toBeCloseTo(4, 6);
  });

  it('规则:四个变体、不同 RHS、lhs=Phrase、sourceName=user-motif', () => {
    const rules = userMotifGrammarRules(plan());
    expect(rules.map((r) => r.metadata?.sourceRuleId)).toEqual([
      'usermotif_full', 'usermotif_head', 'usermotif_tail', 'usermotif_head3', 'usermotif_diminished', 'usermotif_augmented',
    ]);
    for (const r of rules) {
      expect(r.lhs).toBe('Phrase');
      expect(r.metadata?.sourceName).toBe(USER_MOTIF_RULE_SOURCE);
      expect(r.conditions).toBeUndefined(); // legacy 风格下全 brick 可用
    }
    expect(rules[5].metadata?.authoredDurationBeats).toBeCloseTo(8, 6); // augmented = ×2
  });

  it('注入:不改原 Grammar、保留 selectionPolicy、WeakMap 记忆化', () => {
    const inject = createUserMotifGrammarInjector(plan());
    const before = POP_ENRICHED_GRAMMAR.rulesByLhs.get('Phrase')!.length;
    const injected = inject(POP_ENRICHED_GRAMMAR);
    expect(POP_ENRICHED_GRAMMAR.rulesByLhs.get('Phrase')!.length).toBe(before); // 原对象未变
    expect(injected.rulesByLhs.get('Phrase')!.length).toBe(before + 6);
    expect(injected.selectionPolicy).toBe(POP_ENRICHED_GRAMMAR.selectionPolicy);
    expect(inject(POP_ENRICHED_GRAMMAR)).toBe(injected); // memo
    const noPlan = createUserMotifGrammarInjector(undefined);
    expect(noPlan(POP_ENRICHED_GRAMMAR)).toBe(POP_ENRICHED_GRAMMAR);
  });

  it('采样可达:多 seed 展开中 user-motif 规则真实被选中', () => {
    const inject = createUserMotifGrammarInjector(plan());
    const injected = inject(POP_ENRICHED_GRAMMAR);
    const brick = { name: 'on-0', family: 'Major-On' as const, startBeat: 0, durationBeats: 4, chordIndices: [0], cost: 0 };
    let hits = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const events: GrammarExpansionTraceEvent[] = [];
      expandGrammarForBrick(injected, { brick, rng: makeSeededRng(seed), trace: (e) => events.push(e) });
      if (events.some((e) => e.type === 'rule-selected' && e.sourceName === USER_MOTIF_RULE_SOURCE)) hits++;
    }
    expect(hits).toBeGreaterThan(0); // family-only 按签名 cap ≈ 4×2.5%,60 seed 内必现
  });
});
