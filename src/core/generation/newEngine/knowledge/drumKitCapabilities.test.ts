import { describe, expect, it } from 'vitest';
import { DRUM, drumPerformanceVariants } from './grooves';
import {
  DRUM_KIT_CAPABILITIES,
  drumKitPitchOrigin,
  projectDrumPitchForKit,
  type DrumKitProgram,
} from './drumKitCapabilities';

describe('Dream drum kit capabilities', () => {
  it('covers every engine core surface in Room, TR-808 and Brush kits', () => {
    const core: readonly number[] = Object.values(DRUM);
    for (const program of [8, 25, 40] as const) {
      for (const pitch of core) expect(drumKitPitchOrigin(program, pitch), `${program}:${pitch}`).not.toBe('unsupported');
    }
  });

  it('records native kit overrides from the Dream drumset table', () => {
    expect(drumKitPitchOrigin(8, DRUM.TOM_HI)).toBe('native');
    expect(drumKitPitchOrigin(25, DRUM.SIDESTICK)).toBe('native');
    expect(drumKitPitchOrigin(25, DRUM.OHAT)).toBe('native');
    expect(drumKitPitchOrigin(40, DRUM.SNARE)).toBe('native');
    expect(DRUM_KIT_CAPABILITIES[40].sampleVelocityLayers).toBe(1);
  });

  it('projects Brush side-stick intent to native Brush Slap without changing 808 rim shot', () => {
    expect(projectDrumPitchForKit(40, DRUM.SIDESTICK)).toBe(DRUM.CLAP);
    expect(projectDrumPitchForKit(25, DRUM.SIDESTICK)).toBe(DRUM.SIDESTICK);
  });

  it.each([
    [8, 'citypop-disco-boogie'],
    [25, 'tr808-dilla-pocket'],
    [25, 'tr808-lofi-dusty-break'],
    [40, 'jazz-brush-ballad'],
    [40, 'jazz-bebop-comping'],
  ] as const)('kit %s can play every pitch authored by %s', (program, family) => {
    for (const variant of drumPerformanceVariants({ patternFamily: family })) {
      for (const hit of variant) {
        const projected = projectDrumPitchForKit(program as DrumKitProgram, hit.drum);
        expect(drumKitPitchOrigin(program as DrumKitProgram, projected), `${family}:${hit.drum}`).not.toBe('unsupported');
      }
    }
  });
});
