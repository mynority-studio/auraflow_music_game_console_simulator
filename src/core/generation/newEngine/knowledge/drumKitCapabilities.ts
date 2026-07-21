export type DrumKitProgram = 8 | 25 | 40;
export type DrumKitPitchOrigin = 'native' | 'inherited-gm' | 'unsupported';

export interface DrumKitCapability {
  program: DrumKitProgram;
  name: 'Room Drum-X' | 'TR808 Drum-X' | 'Brush Drum-X';
  /** Pitches explicitly replaced by this Dream GMBK variation. */
  nativePitches: ReadonlySet<number>;
  /** The XDB variation inherits every other core GM percussion pitch. */
  inheritedCorePitches: ReadonlySet<number>;
  /** SF2 inspection found one sample zone per pitch, so velocity supplies gain, not round-robin timbre. */
  sampleVelocityLayers: 1;
}

// Core surfaces used by the engine. Dream's variation table leaves blank cells
// to the Standard Drum EQ parent rather than making those MIDI notes silent.
const CORE_GM_PITCHES = new Set<number>([
  35, 36, 37, 38, 39, 40,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
  51, 52, 53, 54, 55, 56, 57, 58, 59, 62, 63,
  69, 70, 82,
]);

const capability = (
  program: DrumKitProgram,
  name: DrumKitCapability['name'],
  nativePitches: readonly number[],
): DrumKitCapability => {
  const native = new Set(nativePitches);
  return Object.freeze({
    program,
    name,
    nativePitches: native,
    inheritedCorePitches: new Set([...CORE_GM_PITCHES].filter((pitch) => !native.has(pitch))),
    sampleVelocityLayers: 1,
  });
};

/**
 * Source: DREAM SDK 20250802 GMBK5X128_Midi.tsv, drumset table.
 * Blank variation cells inherit the Standard Drum EQ parent.
 */
export const DRUM_KIT_CAPABILITIES: Readonly<Record<DrumKitProgram, DrumKitCapability>> = {
  8: capability(8, 'Room Drum-X', [35, 36, 41, 43, 45, 47, 48, 50]),
  25: capability(25, 'TR808 Drum-X', [36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 56, 62, 63]),
  40: capability(40, 'Brush Drum-X', [35, 36, 38, 39, 40]),
};

export function drumKitCapability(program: DrumKitProgram): DrumKitCapability {
  return DRUM_KIT_CAPABILITIES[program];
}

export function drumKitPitchOrigin(program: DrumKitProgram, pitch: number): DrumKitPitchOrigin {
  const kit = drumKitCapability(program);
  if (kit.nativePitches.has(pitch)) return 'native';
  if (kit.inheritedCorePitches.has(pitch)) return 'inherited-gm';
  return 'unsupported';
}

/** Resolve semantic stick intent to the native articulation of the selected kit. */
export function projectDrumPitchForKit(program: DrumKitProgram, pitch: number): number {
  // GM side stick 37 is blank in the Brush variation; pitch 39 is its native Brush Slap.
  if (program === 40 && pitch === 37) return 39;
  return pitch;
}
