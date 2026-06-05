import { describe, it, expect } from 'vitest';
import { planPhrases } from './phrasePlanner';
import { planForm } from './formPlanner';
import type { Section } from './ArrangementPlan';

describe('arranger/phrasePlanner', () => {
  const sections = planForm({ template: 'verse-chorus' });
  const { phrases, motifBindings } = planPhrases(sections, 4);

  const bindingOf = (phraseId: string) => motifBindings.find((b) => b.phraseId === phraseId)!;

  it('每段按 phraseBars 切句(8 bar / 4 = 2 句)', () => {
    expect(phrases.filter((p) => p.sectionId === 'verse1').length).toBe(2);
    expect(phrases.filter((p) => p.sectionId === 'intro').length).toBe(1); // 4 bar
  });

  it('★ 排比:verse1 与 verse2 同 slot 共享 motifId', () => {
    expect(bindingOf('verse1-p0').motifId).toBe(bindingOf('verse2-p0').motifId);
    expect(bindingOf('verse1-p1').motifId).toBe(bindingOf('verse2-p1').motifId);
    // chorus 同理
    expect(bindingOf('chorus1-p0').motifId).toBe(bindingOf('chorus2-p0').motifId);
  });

  it('★ 对比:verse 与 chorus 不共享 motifId', () => {
    expect(bindingOf('verse1-p0').motifId).not.toBe(bindingOf('chorus1-p0').motifId);
  });

  it('chorus 句 = hook,restatement 强(0.8);verse 中(0.5)', () => {
    const chorusPhrase = phrases.find((p) => p.sectionId === 'chorus1' && p.phraseSlot === 0)!;
    expect(chorusPhrase.skeletonRole).toBe('hook');
    expect(bindingOf('chorus1-p0').requestedRestatementStrength).toBe(0.8);
    expect(bindingOf('verse1-p0').requestedRestatementStrength).toBe(0.5);
  });

  it('末句 = cadence,落 authentic 终止', () => {
    const last = phrases.find((p) => p.sectionId === 'verse1' && p.phraseSlot === 1)!;
    expect(last.role).toBe('cadence');
    expect(last.cadenceTarget).toBe('authentic');
  });

  it('每个 phrase 都有唯一 binding', () => {
    expect(motifBindings.length).toBe(phrases.length);
    expect(new Set(motifBindings.map((b) => b.id)).size).toBe(motifBindings.length);
  });

  it('★ T5 hook scope by functionTag:hook 段前 2 句、headOut/head/loop 仅首句、其它 connector', () => {
    const secs: Section[] = [
      { id: 'hk', role: 'chorus', functionTag: 'hook', bars: 16, hookPolicy: 'main' },    // 16/4=4 句
      { id: 'ho', role: 'chorus', functionTag: 'headOut', bars: 8, hookPolicy: 'light' }, // 2 句
      { id: 'lp', role: 'verse', functionTag: 'loop', bars: 8, hookPolicy: 'light' },     // 2 句
      { id: 'bd', role: 'bridge', functionTag: 'breakdown', bars: 8, hookPolicy: 'none' },// 2 句
    ];
    const { phrases: ph } = planPhrases(secs, 4);
    const sk = (sid: string) => ph.filter((p) => p.sectionId === sid).map((p) => p.skeletonRole);
    expect(sk('hk')).toEqual(['hook', 'hook', 'connector', 'connector']); // 前 2 句 hook(slot<=1 真截断)
    expect(sk('ho')).toEqual(['hook', 'connector']);                       // headOut 仅首句
    expect(sk('lp')).toEqual(['hook', 'connector']);                       // loop 仅首句
    expect(sk('bd')).toEqual(['connector', 'connector']);                  // breakdown 全 connector
  });
});
