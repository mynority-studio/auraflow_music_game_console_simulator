// ============================================================
// newEngine · knowledge · VoiceLeadingLedger 测试
// ------------------------------------------------------------
// 锁 Phase 5 port:V7→I 生成 dom3/dom7/bassLeading 义务 · maj7 软义务 ·
// 评分 overallScore 边界 + stats 自洽 + severity 加权。
// ============================================================

import { describe, expect, it } from 'vitest';
import { buildVoiceLeadingLedger, evaluateVoiceLeading, scoreVoiceLeading, type LedgerChord } from './voiceLeadingLedger';

// G7 → Cmaj7
const g7toC: LedgerChord[] = [
  { type: '7', rootMidi: 67, notesMidi: [67, 71, 74, 77], bassMidi: 43 },
  { type: 'maj7', rootMidi: 60, notesMidi: [60, 64, 67, 71], bassMidi: 36 },
];

describe('buildVoiceLeadingLedger', () => {
  it('属和弦 → dom3 / dom7 / bassLeading 义务', () => {
    const obs = buildVoiceLeadingLedger(g7toC);
    const roles = new Set(obs.map((o) => o.sourceRole));
    expect(roles.has('dom3')).toBe(true);
    expect(roles.has('dom7')).toBe(true);
    expect(roles.has('bassLeading')).toBe(true);
    // dom3 = 硬义务,maxMotion 2(级进)
    const dom3 = obs.find((o) => o.sourceRole === 'dom3')!;
    expect(dom3.severity).toBe('hard');
    expect(dom3.maxMotion).toBe(2);
  });

  it('maj7 和弦换根 → maj7 软义务', () => {
    const obs = buildVoiceLeadingLedger([
      { type: 'maj7', rootMidi: 60, notesMidi: [60, 64, 67, 71], bassMidi: 36 },
      { type: 'm7', rootMidi: 57, notesMidi: [57, 60, 64, 67], bassMidi: 33 },
    ]);
    const maj7 = obs.find((o) => o.sourceRole === 'maj7');
    expect(maj7).toBeDefined();
    expect(maj7!.severity).toBe('soft');
  });

  it('非属、非 maj7、无借和弦 → 无义务', () => {
    expect(buildVoiceLeadingLedger([
      { type: 'm7', rootMidi: 62, notesMidi: [62, 65, 69], bassMidi: 38 },
      { type: 'm7', rootMidi: 60, notesMidi: [60, 63, 67], bassMidi: 36 },
    ])).toHaveLength(0);
  });
});

describe('scoreVoiceLeading', () => {
  it('overallScore ∈ [0,1] 且 stats.total = 义务数', () => {
    const r = evaluateVoiceLeading(g7toC);
    expect(r.overallScore).toBeGreaterThanOrEqual(0);
    expect(r.overallScore).toBeLessThanOrEqual(1);
    expect(r.stats.total).toBe(r.obligations.length);
    expect(r.resolutions.length).toBe(r.obligations.length);
  });

  it('无义务 → overallScore = 1(满分,无债)', () => {
    const r = scoreVoiceLeading([], g7toC);
    expect(r.overallScore).toBe(1);
  });
});
