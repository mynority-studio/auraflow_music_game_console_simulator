import { describe, it, expect } from 'vitest';
import { BUILTIN_RULES, BUILTIN_GRAMMAR } from './melodyBuiltinGrammar';
import { makeGrammar } from './melodyGrammarTypes';
import { IMPROVISOR_VOCAB, VOCAB_BY_CANONICAL, lookupChordDef } from './improvisorChordVocab';
import {
  BRICK_PATTERNS,
  chordTypeQuality,
  stepMatches,
  type BrickChordBlock,
} from './melodyBrickDictionary';

// ============================================================
// MG strict 移植 Loop 1 — KB 小数据港 parity 锁
// ------------------------------------------------------------
// 终止判据(directive):KB rule count / brick count / vocab count 与 MG 一致。
// 这些常量在 port 当下核对过 = MG ../melodygenerative 对应文件的真实计数。
// 测试把绝对数锁死 —— 后续若有人误删/误加规则会立刻红。
// ============================================================

describe('knowledge/melody KB · MG 移植 parity (Loop 1)', () => {
  it('★ BUILTIN_RULES 计数 = MG(26)', () => {
    expect(BUILTIN_RULES.length).toBe(26);
  });

  it('★ BRICK_PATTERNS 计数 = MG(73)', () => {
    expect(BRICK_PATTERNS.length).toBe(73);
  });

  it('★ IMPROVISOR_VOCAB 计数 = MG(114 full def)', () => {
    expect(IMPROVISOR_VOCAB.length).toBe(114);
  });

  it('grammar 按 lhs 索引;start=Phrase', () => {
    expect(BUILTIN_GRAMMAR.start).toBe('Phrase');
    // 每条规则都能从索引里查回
    for (const r of BUILTIN_RULES) {
      expect(BUILTIN_GRAMMAR.rulesByLhs.get(r.lhs)).toContain(r);
    }
    // makeGrammar 纯:同输入同输出结构
    const again = makeGrammar(BUILTIN_RULES, 'Phrase');
    expect(again.rulesByLhs.size).toBe(BUILTIN_GRAMMAR.rulesByLhs.size);
  });

  it('每个 brick pattern 至少 1 step;baseCost > 0', () => {
    for (const p of BRICK_PATTERNS) {
      expect(p.steps.length).toBeGreaterThan(0);
      expect(p.baseCost).toBeGreaterThan(0);
    }
  });

  it('vocab canonical 唯一;别名 map 与 lookup 自洽', () => {
    const canon = IMPROVISOR_VOCAB.map((d) => d.canonical);
    expect(new Set(canon).size).toBe(canon.length); // 无重复 canonical
    // VOCAB_BY_CANONICAL 覆盖每个 canonical
    for (const d of IMPROVISOR_VOCAB) {
      expect(VOCAB_BY_CANONICAL.get(d.canonical)).toBe(d);
    }
    // lookup 命中 maj/m/7 三个最常用
    expect(lookupChordDef('maj')?.spell).toEqual([0, 4, 7]);
    expect(lookupChordDef('m')?.spell).toEqual([0, 3, 7]);
  });

  it('chordTypeQuality 风格分类(MG 同义,关键类目)', () => {
    expect(chordTypeQuality('maj7')).toBe('major');
    expect(chordTypeQuality('m7')).toBe('minor');
    expect(chordTypeQuality('7')).toBe('dominant');
    expect(chordTypeQuality('9sus4')).toBe('dominant'); // dom-flavored sus
    expect(chordTypeQuality('sus4')).toBe('sus');
    expect(chordTypeQuality('m7b5')).toBe('halfDim');
    expect(chordTypeQuality('dim7')).toBe('diminished');
  });

  it('stepMatches key-relative:ii-V-I in C 匹配 Dm7-G7-Cmaj7', () => {
    const iiVI = BRICK_PATTERNS.find((p) => p.name === 'ii-V-I')!;
    const blocks: BrickChordBlock[] = [
      { rootPc: 2, type: 'm7' },   // Dm7
      { rootPc: 7, type: '7' },    // G7
      { rootPc: 0, type: 'maj7' }, // Cmaj7
    ];
    blocks.forEach((b, i) => {
      expect(stepMatches(iiVI.steps[i], b, 0)).toBe(true); // keyRoot=C(0)
    });
    // 移调到 Bb(10):Cm7-F7-Bbmaj7 同样匹配
    const bbBlocks: BrickChordBlock[] = [
      { rootPc: 0, type: 'm7' },   // Cm7
      { rootPc: 5, type: '7' },    // F7
      { rootPc: 10, type: 'maj7' },// Bbmaj7
    ];
    bbBlocks.forEach((b, i) => {
      expect(stepMatches(iiVI.steps[i], b, 10)).toBe(true);
    });
  });

  it('stableMinor 比 minor 严格:m7 不作 ii-V-i 落地', () => {
    const iiVi = BRICK_PATTERNS.find((p) => p.name === 'ii-V-i')!;
    const target = iiVi.steps[2]; // 落地 step 要 stableMinor
    expect(stepMatches(target, { rootPc: 0, type: 'm7' }, 0)).toBe(false); // m7 不算稳定小调主
    expect(stepMatches(target, { rootPc: 0, type: 'm' }, 0)).toBe(true);   // m 算
  });
});
