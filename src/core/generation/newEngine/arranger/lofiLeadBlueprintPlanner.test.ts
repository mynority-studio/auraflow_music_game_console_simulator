import { describe, expect, it } from 'vitest';
import { createRandomContext } from '../foundation';
import { LOFI_LEAD_PHRASE_BLUEPRINTS } from '../knowledge/lofiLeadPhraseBlueprints';
import { planLofiLeadBlueprint } from './lofiLeadBlueprintPlanner';

describe('arranger/lofiLeadBlueprintPlanner', () => {
  it('selects a deterministic but non-singleton phrase vocabulary', () => {
    const ids = new Set<string>();
    for (let seed = 0; seed < 128; seed++) {
      const first = planLofiLeadBlueprint({
        style: 'lofi',
        foundationArchetypeId: 'slow-soul-boombap',
        rng: createRandomContext(seed),
      });
      const repeated = planLofiLeadBlueprint({
        style: 'lofi',
        foundationArchetypeId: 'slow-soul-boombap',
        rng: createRandomContext(seed),
      });
      expect(first).toEqual(repeated);
      expect(first).toBeDefined();
      if (first) ids.add(first.id);
    }
    expect(ids.size).toBeGreaterThanOrEqual(3);
  });

  it('keeps a four-bar listening window and compact motif cells', () => {
    for (const blueprint of LOFI_LEAD_PHRASE_BLUEPRINTS) {
      expect(blueprint.roleByCycleBar.slice(0, 4)).toEqual([
        'rest', 'rest', 'rest', 'rest',
      ]);
      const active = blueprint.roleByCycleBar.filter((role) => role !== 'rest');
      expect(active.length).toBeGreaterThanOrEqual(2);
      expect(active.length).toBeLessThanOrEqual(3);
      expect(active).toContain('statement');
      expect(active).toContain('return');
      expect(blueprint.motifCell.events.length).toBeGreaterThanOrEqual(2);
      expect(blueprint.motifCell.events.length).toBeLessThanOrEqual(4);
    }
  });
});
