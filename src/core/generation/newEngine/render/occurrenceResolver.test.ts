import { describe, it, expect } from 'vitest';
import { resolveOccurrenceSpans } from './occurrenceResolver';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createRandomContext } from '../foundation';

describe('render/occurrenceResolver', () => {
  const band = buildBandSpec({ seed: 5, styleHint: 'pop', mood: 'x', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(5));

  // verse1-p0 与 verse2-p0 共享 motifId 'm-V-0'(排比)
  const motifId = arrangement.motifBindings.find((b) => b.phraseId === 'verse1-p0')!.motifId;

  it('global:并集覆盖 verse1 + verse2 两个 section 的 chord spans', () => {
    const spans = resolveOccurrenceSpans(motifId, arrangement.motifBindings, arrangement.phrases, plan, 'global');
    const sections = new Set(
      spans.map((id) => plan.chordTimeline.find((c) => c.id === id)!.sectionId),
    );
    expect(sections.has('verse1')).toBe(true);
    expect(sections.has('verse2')).toBe(true);
    expect(sections.has('chorus1')).toBe(false);
  });

  it('local:只当前 phrase 所在 section 的 chord spans', () => {
    const spans = resolveOccurrenceSpans(motifId, arrangement.motifBindings, arrangement.phrases, plan, 'local', 'verse1-p0');
    const sections = new Set(
      spans.map((id) => plan.chordTimeline.find((c) => c.id === id)!.sectionId),
    );
    expect([...sections]).toEqual(['verse1']);
  });

  it('返回的 spanId 都在 HarmonicPlan 里', () => {
    const spans = resolveOccurrenceSpans(motifId, arrangement.motifBindings, arrangement.phrases, plan, 'global');
    const all = new Set(plan.chordTimeline.map((c) => c.id));
    expect(spans.every((id) => all.has(id))).toBe(true);
  });

  it('未知 motifId → 空数组', () => {
    expect(resolveOccurrenceSpans('nope', arrangement.motifBindings, arrangement.phrases, plan, 'global')).toEqual([]);
  });
});
