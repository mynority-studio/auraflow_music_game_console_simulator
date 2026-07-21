import { describe, expect, it } from 'vitest';
import {
  JAZZ_FIVE_FOUR_HARMONIC_FORM_GRAMMAR,
  areJazzFiveFourHarmonicTemplatesCompatible,
  jazzFiveFourHarmonicFunctionSignature,
  jazzFiveFourHarmonicTemplate,
  jazzFiveFourRationalBeat,
  jazzFiveFourRationalBeatValue,
  listJazzFiveFourHarmonicTemplateCandidates,
  realizeJazzFiveFourHarmonicRoots,
  validateJazzFiveFourHarmonicTemplate,
} from './jazzFiveFourHarmonicFormGrammar';

const byId = (id: string) => {
  const template = jazzFiveFourHarmonicTemplate(id);
  expect(template, `missing harmonic template ${id}`).toBeDefined();
  return template!;
};

describe('knowledge/JazzFiveFourHarmonicFormGrammar', () => {
  it('exposes immutable A-vamp, B/bridge, turnaround and tag/coda families through pure role accessors', () => {
    expect(new Set(JAZZ_FIVE_FOUR_HARMONIC_FORM_GRAMMAR.templates.map((template) => template.family)))
      .toEqual(new Set(['a-vamp', 'b-bridge', 'turnaround', 'tag-coda']));
    expect(Object.isFrozen(JAZZ_FIVE_FOUR_HARMONIC_FORM_GRAMMAR)).toBe(true);
    expect(Object.isFrozen(JAZZ_FIVE_FOUR_HARMONIC_FORM_GRAMMAR.templates)).toBe(true);

    expect(listJazzFiveFourHarmonicTemplateCandidates({
      family: 'a-vamp', sectionRole: 'vamp', phraseRole: 'base',
    }).map((template) => template.id)).toEqual([
      'j54.harmony.a-vamp.minor-i-v.base.v1',
    ]);
    expect(listJazzFiveFourHarmonicTemplateCandidates({
      family: 'b-bridge', sectionRole: 'bridge', phraseRole: 'lift',
    })).toHaveLength(2);
    expect(listJazzFiveFourHarmonicTemplateCandidates({
      family: 'turnaround', sectionRole: 'recap', phraseRole: 'turnaround',
    })).toHaveLength(2);
    expect(listJazzFiveFourHarmonicTemplateCandidates({
      family: 'tag-coda', sectionRole: 'coda', phraseRole: 'ending', terminal: true,
    })).toHaveLength(2);
    expect(jazzFiveFourHarmonicTemplate('unknown')).toBeUndefined();
  });

  it('tiles every bar exactly from rational beat zero to beat five', () => {
    expect(JAZZ_FIVE_FOUR_HARMONIC_FORM_GRAMMAR.meter).toEqual({
      numerator: 5,
      denominator: 4,
      beatGrouping: [3, 2],
      beatsPerBar: { numerator: 5, denominator: 1 },
    });

    for (const template of JAZZ_FIVE_FOUR_HARMONIC_FORM_GRAMMAR.templates) {
      for (const bar of template.bars) {
        let cursor = 0;
        for (const slot of bar.slots) {
          expect(jazzFiveFourRationalBeatValue(slot.span.start)).toBe(cursor);
          cursor += jazzFiveFourRationalBeatValue(slot.span.duration);
        }
        expect(cursor).toBe(5);
      }
      expect(validateJazzFiveFourHarmonicTemplate(template)).toEqual([]);
    }

    expect(jazzFiveFourRationalBeat(6, 2)).toEqual({ numerator: 3, denominator: 1 });
    expect(jazzFiveFourRationalBeat(1, -2)).toEqual({ numerator: -1, denominator: 2 });
    expect(() => jazzFiveFourRationalBeat(1, 0)).toThrow('denominator must not be zero');
  });

  it('makes every A-vamp candidate an explicit 3+2 harmonic pendulum', () => {
    const candidates = listJazzFiveFourHarmonicTemplateCandidates({ family: 'a-vamp' });
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    for (const template of candidates) {
      expect(template.bars).toHaveLength(1);
      expect(template.bars[0].slots.map((slot) => jazzFiveFourRationalBeatValue(slot.span.start)))
        .toEqual([0, 3]);
      expect(template.bars[0].slots.map((slot) => jazzFiveFourRationalBeatValue(slot.span.duration)))
        .toEqual([3, 2]);
      expect(template.bars[0].slots.map((slot) => [slot.function, slot.rootOffset]))
        .toEqual([['T', 0], ['D', 7]]);
    }
  });

  it('keeps function/root-offset signatures invariant while realized roots transpose uniformly', () => {
    const serializedKnowledge = JSON.stringify(JAZZ_FIVE_FOUR_HARMONIC_FORM_GRAMMAR);
    expect(serializedKnowledge).not.toMatch(/"(?:rootPc|rootName|pitch|midiNote)"/);

    for (const template of JAZZ_FIVE_FOUR_HARMONIC_FORM_GRAMMAR.templates) {
      const signature = jazzFiveFourHarmonicFunctionSignature(template);
      const atC = realizeJazzFiveFourHarmonicRoots(template, 0);
      const atGb = realizeJazzFiveFourHarmonicRoots(template, 6);

      expect(atC.map((slot) => `${slot.function}:${slot.rootOffset}`))
        .toEqual(atGb.map((slot) => `${slot.function}:${slot.rootOffset}`));
      expect(atC.map((slot) => slot.rootPc))
        .toEqual(atGb.map((slot) => (slot.rootPc + 6) % 12));
      expect(jazzFiveFourHarmonicFunctionSignature(template)).toBe(signature);
    }
  });

  it('filters candidates by bilateral family compatibility and cadence-owned tonic resolution', () => {
    const a = byId('j54.harmony.a-vamp.minor-i-v.base.v1');
    const bridge = byId('j54.harmony.b-bridge.minor-cycle.body.v1');
    const turn = byId('j54.harmony.turnaround.minor-two-five.v1');
    const tonicCoda = byId('j54.harmony.coda.tonic-hold.v1');
    const plagalCoda = byId('j54.harmony.coda.minor-plagal-arrival.v1');

    expect(areJazzFiveFourHarmonicTemplatesCompatible(a, bridge)).toBe(true);
    expect(areJazzFiveFourHarmonicTemplatesCompatible(bridge, turn)).toBe(true);
    expect(areJazzFiveFourHarmonicTemplatesCompatible(turn, a)).toBe(true);
    expect(areJazzFiveFourHarmonicTemplatesCompatible(turn, tonicCoda)).toBe(true);
    expect(areJazzFiveFourHarmonicTemplatesCompatible(turn, plagalCoda)).toBe(false);
    expect(areJazzFiveFourHarmonicTemplatesCompatible(tonicCoda, a)).toBe(false);

    const afterTurn = listJazzFiveFourHarmonicTemplateCandidates({
      family: 'tag-coda',
      phraseRole: 'ending',
      previousTemplateId: turn.id,
    });
    expect(afterTurn.map((template) => template.id)).toEqual([
      'j54.harmony.tag.echo-vamp.v1',
      'j54.harmony.coda.tonic-sustain.v1',
      'j54.harmony.coda.tonic-hold.v1',
    ]);
    expect(listJazzFiveFourHarmonicTemplateCandidates({ previousTemplateId: 'unknown' })).toEqual([]);
  });

  it('makes every turnaround and terminal coda cadence structurally legal', () => {
    const turnarounds = listJazzFiveFourHarmonicTemplateCandidates({ family: 'turnaround' });
    for (const template of turnarounds) {
      const lastBar = template.bars.at(-1)!;
      const lastSlot = lastBar.slots.at(-1)!;
      expect(template.cadence).toMatchObject({
        kind: 'turnaround',
        terminal: false,
        resolution: { targetFunction: 'T', targetRootOffset: 0, withinBars: 1 },
      });
      expect(lastSlot.function).toBe('D');
    }

    const terminalCodas = listJazzFiveFourHarmonicTemplateCandidates({
      family: 'tag-coda', terminal: true,
    });
    expect(terminalCodas).toHaveLength(2);
    for (const template of terminalCodas) {
      const lastBar = template.bars.at(-1)!;
      const lastSlot = lastBar.slots.at(-1)!;
      expect(template.cadence.kind).toBe('closed-coda');
      expect(lastSlot).toMatchObject({ function: 'T', rootOffset: 0 });
      expect(template.compatibility.allowedNextFamilies).toEqual([]);
    }
  });
});
