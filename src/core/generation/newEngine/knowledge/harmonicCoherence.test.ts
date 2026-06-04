// ============================================================
// newEngine · knowledge · HarmonicCoherence 测试
// ------------------------------------------------------------
// 锁 Phase 5 port:5 风格 policy · ii-V-I 干净进行高分通过 + 生成 home_dominant 义务 ·
// 属和弦缺导音 → missing_guide_tones issue · subscore 边界。
// ============================================================

import { describe, expect, it } from 'vitest';
import { evaluateHarmony, buildResolutionLedger, COHERENCE_POLICIES, type CoherenceChord } from './harmonicCoherence';

// C 大调 ii-V-I:Dm7 - G7 - Cmaj7
const iiVI = (over: Partial<CoherenceChord>[] = []): CoherenceChord[] => [
  { type: 'm7', rootMidi: 62, notesMidi: [62, 65, 69, 72], bassMidi: 38, roman: 'ii', chordSymbol: 'Dm7', duration: 2, effectiveFunc: 'S', ...over[0] },
  { type: '7', rootMidi: 67, notesMidi: [67, 71, 74, 77], bassMidi: 43, roman: 'V', chordSymbol: 'G7', duration: 2, effectiveFunc: 'D', ...over[1] },
  { type: 'maj7', rootMidi: 60, notesMidi: [60, 64, 67, 71], bassMidi: 36, roman: 'I', chordSymbol: 'Cmaj7', duration: 4, effectiveFunc: 'T', ...over[2] },
];

describe('COHERENCE_POLICIES', () => {
  it('5 风格各有 passThreshold', () => {
    for (const s of ['POP', 'JAZZ', 'RNB', 'BLUES', 'LOFI']) {
      expect(COHERENCE_POLICIES[s].passThreshold).toBeGreaterThan(0);
      expect(COHERENCE_POLICIES[s].style).toBe(s);
    }
  });
});

describe('evaluateHarmony — ii-V-I 干净进行', () => {
  it('JAZZ 下高分通过,且为 V 生成 home_dominant 义务', () => {
    const r = evaluateHarmony(iiVI(), 'JAZZ', 0);
    expect(r.passed).toBe(true);
    expect(r.score).toBeGreaterThan(0.9);
    expect(r.subscores.identity).toBe(1);
    const obs = buildResolutionLedger(iiVI(), COHERENCE_POLICIES.JAZZ, 0);
    expect(obs.some((o) => o.role === 'home_dominant')).toBe(true);
    // home_dominant 义务解决到 Cmaj7(index 2)
    expect(obs.find((o) => o.role === 'home_dominant')!.targetChordIndex).toBe(2);
  });

  it('所有 subscore 落在 [0,1]', () => {
    const r = evaluateHarmony(iiVI(), 'POP', 0);
    for (const v of Object.values(r.subscores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('collectIssues — 属和弦缺导音', () => {
  it('G7 去掉 3 音(B)→ missing_guide_tones(high)', () => {
    const broken = iiVI([{}, { notesMidi: [67, 74, 77] }]); // G D F,无 B(3)
    const r = evaluateHarmony(broken, 'JAZZ', 0);
    expect(r.issues.some((iss) => iss.kind === 'missing_guide_tones' && iss.severity === 'high')).toBe(true);
  });

  it('末和弦 mustResolve → unresolved_final_dominant', () => {
    const ending = iiVI([{}, {}, { mustResolve: true }]);
    const r = evaluateHarmony(ending, 'POP', 0);
    expect(r.issues.some((iss) => iss.kind === 'unresolved_final_dominant')).toBe(true);
  });
});
