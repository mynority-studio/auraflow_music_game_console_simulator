import { describe, it, expect } from 'vitest';
import { planPhrases } from './phrasePlanner';
import { planForm } from './formPlanner';

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
});
