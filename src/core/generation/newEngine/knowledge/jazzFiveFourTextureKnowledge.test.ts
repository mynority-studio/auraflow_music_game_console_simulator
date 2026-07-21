import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  JAZZ_FIVE_FOUR_BASS_TEXTURE_CELLS,
  JAZZ_FIVE_FOUR_BASS_TEXTURE_VARIANTS,
  JAZZ_FIVE_FOUR_FOUNDATION_MODES,
  JAZZ_FIVE_FOUR_PIANO_TEXTURE_CELLS,
  JAZZ_FIVE_FOUR_PIANO_TEXTURE_VARIANTS,
  jazzFiveFourBassTextureCells,
  jazzFiveFourPianoTextureCells,
  jazzFiveFourTextureOnsetMask,
} from './jazzFiveFourTextureKnowledge';

describe('knowledge/jazzFiveFourTextureKnowledge', () => {
  it('projects exact A full/foundation/upper masks without per-hit omission', () => {
    expect(jazzFiveFourTextureOnsetMask(jazzFiveFourPianoTextureCells('a.full')))
      .toEqual([0, 305, 785, 960, 1_440, 1_920]);
    expect(jazzFiveFourTextureOnsetMask(jazzFiveFourPianoTextureCells('a.foundationOnly')))
      .toEqual([0, 785, 1_440]);
    expect(jazzFiveFourTextureOnsetMask(jazzFiveFourPianoTextureCells('a.upperOnly')))
      .toEqual([305, 960, 1_920]);
  });

  it('owns B-body and turnaround omissions as complete variants', () => {
    expect(jazzFiveFourTextureOnsetMask(jazzFiveFourPianoTextureCells('b.body.full')))
      .toEqual([0, 305, 785, 1_440, 1_920]);
    expect(jazzFiveFourTextureOnsetMask(jazzFiveFourPianoTextureCells('b.turnaround.full')))
      .toEqual([0, 305, 785, 960, 1_440]);
    expect(jazzFiveFourTextureOnsetMask(jazzFiveFourPianoTextureCells('b.body.upperOnly')))
      .toEqual([305, 1_920]);
    expect(jazzFiveFourTextureOnsetMask(jazzFiveFourPianoTextureCells('b.turnaround.upperOnly')))
      .toEqual([305, 960]);
  });

  it('provides acoustic A and the evidence-bounded turnaround overlap', () => {
    expect(jazzFiveFourTextureOnsetMask(jazzFiveFourBassTextureCells('acoustic.a')))
      .toEqual([0, 1_440, 1_920]);
    const turnaround = jazzFiveFourBassTextureCells('bridge.turnaround');
    expect(jazzFiveFourTextureOnsetMask(turnaround)).toEqual([0, 800, 1_440, 1_920]);
    const approach = turnaround.find((cell) => cell.phase.engineTicks === 800)!;
    expect(approach.gate.engineTicks).toBe(730);
    expect(approach.phase.engineTicks + approach.gate.engineTicks - 1_440).toBe(90);
    expect(approach.harmonicToneIntent).toBe('approach-next-root');
    expect(approach.provenance.authority).toBe('generative-extension');
  });

  it('keeps every rational cell exact and inside one 5/4 bar', () => {
    for (const cell of [...JAZZ_FIVE_FOUR_PIANO_TEXTURE_CELLS, ...JAZZ_FIVE_FOUR_BASS_TEXTURE_CELLS]) {
      expect(Number.isInteger(cell.phase.engineTicks), cell.id).toBe(true);
      expect(Number.isInteger(cell.gate.engineTicks), cell.id).toBe(true);
      expect(cell.phase.engineTicks, cell.id).toBeGreaterThanOrEqual(0);
      expect(cell.phase.engineTicks, cell.id).toBeLessThan(2_400);
      expect(cell.gate.engineTicks, cell.id).toBeGreaterThan(0);
    }
  });

  it('declares all foundation ownership/doubling decisions explicitly', () => {
    expect(Object.keys(JAZZ_FIVE_FOUR_FOUNDATION_MODES).sort()).toEqual([
      'acousticBass+fullPiano', 'acousticBass+upperComp', 'compOwnsFoundation', 'keyboardBassOnly',
    ]);
    expect(JAZZ_FIVE_FOUR_FOUNDATION_MODES['acousticBass+fullPiano'].allowsLowRegisterDoubling).toBe(true);
    expect(Object.values(JAZZ_FIVE_FOUR_FOUNDATION_MODES)
      .filter((policy) => policy.id !== 'acousticBass+fullPiano')
      .every((policy) => !policy.allowsLowRegisterDoubling)).toBe(true);
  });

  it('is a pitchless product KB with full source/generative provenance', () => {
    const serialized = JSON.stringify({
      piano: JAZZ_FIVE_FOUR_PIANO_TEXTURE_VARIANTS,
      bass: JAZZ_FIVE_FOUR_BASS_TEXTURE_VARIANTS,
      pianoCells: JAZZ_FIVE_FOUR_PIANO_TEXTURE_CELLS,
      bassCells: JAZZ_FIVE_FOUR_BASS_TEXTURE_CELLS,
    });
    expect(serialized).not.toMatch(/"(?:pitch|midi|noteName|absoluteBar|sourceOriginTick)"/i);
    expect([...JAZZ_FIVE_FOUR_PIANO_TEXTURE_CELLS, ...JAZZ_FIVE_FOUR_BASS_TEXTURE_CELLS]
      .every((cell) => cell.provenance.authority === 'generative-extension' || Boolean(cell.provenance.sourceSha256)))
      .toBe(true);
    const source = readFileSync(new URL('./jazzFiveFourTextureKnowledge.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*jazzFiveFourEvidence['"]/);
    expect(source).not.toContain('Take-Five-1.mid');
  });
});
