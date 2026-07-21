import { describe, expect, it } from 'vitest';
import { pc } from '../foundation';
import { deriveMusicIntentPlan } from '../arranger/deriveMusicIntentPlan';
import { buildSongBundle, generateSongFromBundle } from '../generation/GenerationController';
import { bassPatternFamilyForId, grooveBassPattern } from '../knowledge/grooveBassPatterns';
import { rhythmSwingSourceForContract } from '../knowledge/grooveContracts';
import { swingBeat } from './swing';

describe('GrooveContract bassPattern production consumption', () => {
  it('flows Contract -> Arranger intent -> Bass MIDI onsets for R&B', () => {
    const bundle = buildSongBundle({
      seed: 7,
      styleHint: 'rnb',
      mood: 'build',
      targetDuration: 120,
      key: pc(0),
    });
    const contract = bundle.arrangement.songGrooveContract;
    const pattern = grooveBassPattern(contract.bassPattern);
    expect(pattern, contract.id).toBeDefined();

    const intent = deriveMusicIntentPlan('rnb', bundle.arrangement);
    const target = bundle.arrangement.sections
      .map((section, index) => ({
        section,
        index,
        active: bundle.instrumentation.activeRolesBySection[section.id]?.includes('bass') ?? false,
      }))
      .find(({ section, active }) => active && section.role !== 'intro' && section.role !== 'outro' && section.bars >= 2);
    expect(target).toBeDefined();
    expect(intent.sections[target!.index].grooveContractId).toBe(contract.id);
    expect(intent.sections[target!.index].bassPatternSchedule?.slots[0]?.family)
      .toBe(bassPatternFamilyForId(contract.bassPattern));

    const result = generateSongFromBundle(bundle);
    expect(result.status, result.report.findings.map((finding) => finding.ruleId).join(','))
      .not.toBe('failed');
    const bass = result.ir!.tracks.find((track) => track.role === 'bass');
    expect(bass).toBeDefined();

    const beatsPerBar = bundle.arrangement.meter.numerator * (4 / bundle.arrangement.meter.denominator);
    const sectionStartBar = bundle.arrangement.sections
      .slice(0, target!.index)
      .reduce((sum, section) => sum + section.bars, 0);
    const auditedBar = sectionStartBar + 1;
    const barStartBeat = auditedBar * beatsPerBar;
    const actual = bass!.notes
      .map((note) => (note.startTick as number) / bundle.timebase.ppq)
      .filter((beat) => beat >= barStartBeat - 0.02 && beat < barStartBeat + beatsPerBar - 0.02)
      .map((beat) => beat - barStartBeat);
    const expected = pattern!.hits.map((hit) => swingBeat(
      hit.beat,
      contract.compSwingRatio,
      rhythmSwingSourceForContract(contract),
    ));
    const matched = expected.filter((beat) => actual.some((candidate) => Math.abs(candidate - beat) <= 0.08));
    expect(matched.length, JSON.stringify({ contract: contract.id, expected, actual }))
      .toBeGreaterThanOrEqual(Math.ceil(expected.length * 0.6));
  });
});
