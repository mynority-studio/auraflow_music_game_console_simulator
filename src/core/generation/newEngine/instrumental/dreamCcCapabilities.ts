// ============================================================
// newEngine · instrumental · Dream 5504 CC capability registry
// ------------------------------------------------------------
// This is a capability boundary, not a wish list. A MIDI CC number is
// standardized, but its musical response is only automatic when Dream's
// firmware documents it and the voice family makes musical sense.
// ============================================================

import type { InstrumentRoleName } from '../band/BandSpec';
import { dreamVoiceProfileFor, type DreamVoiceAddress } from './dreamVoiceProfiles';

export type DreamCcVerification = 'documented' | 'audition-required' | 'blocked';
export type DreamPedalKind = 'none' | 'piano-damper' | 'vibraphone-damper';
export type DreamCcEvidence = 'dream-5504-midi-mic' | 'dream-instrument-editor';

export interface DreamPedalCapability {
  kind: DreamPedalKind;
  controller: 64;
  verification: DreamCcVerification;
  evidence: DreamCcEvidence;
}

export interface DreamVoiceCcProfile {
  bank?: number;
  program: number;
  role: InstrumentRoleName;
  /** Controllers that are safe for automatic musical expression today. */
  automaticControllers: readonly number[];
  /** Hardware supports these, but this concrete GMBK voice still needs audition. */
  auditionControllers: readonly number[];
  /** Never emit these automatically for this voice family. */
  blockedControllers: readonly number[];
  pedal: DreamPedalCapability;
}

const NO_PEDAL: DreamPedalCapability = {
  kind: 'none', controller: 64, verification: 'blocked', evidence: 'dream-5504-midi-mic',
};

const PIANO_DAMPER: DreamPedalCapability = {
  kind: 'piano-damper', controller: 64, verification: 'documented', evidence: 'dream-5504-midi-mic',
};

const VIBRAPHONE_DAMPER: DreamPedalCapability = {
  kind: 'vibraphone-damper', controller: 64, verification: 'audition-required', evidence: 'dream-5504-midi-mic',
};

const profile = (
  program: number,
  role: InstrumentRoleName,
  automaticControllers: readonly number[] = [],
  auditionControllers: readonly number[] = [],
  blockedControllers: readonly number[] = [],
  pedal: DreamPedalCapability = NO_PEDAL,
): DreamVoiceCcProfile => ({ program, role, automaticControllers, auditionControllers, blockedControllers, pedal });

/**
 * Dream's MIDI-MIC firmware documents the controller targets, while the
 * GMBK sound bank does not publish a per-preset expressive-articulation map.
 * Keep uncertain mappings in auditionControllers; only automaticControllers
 * may be emitted by generation.
 */
export function dreamVoiceCcProfile(addressOrProgram: DreamVoiceAddress | number, legacyRole?: InstrumentRoleName): DreamVoiceCcProfile {
  const address: DreamVoiceAddress = typeof addressOrProgram === 'number'
    ? { bank: 0, program: addressOrProgram, role: legacyRole ?? 'lead' }
    : { bank: addressOrProgram.bank ?? 0, program: addressOrProgram.program, role: addressOrProgram.role ?? legacyRole ?? 'lead' };
  const role = address.role!;
  const withAddress = (next: DreamVoiceCcProfile): DreamVoiceCcProfile => ({ ...next, bank: address.bank });

  // Program 0 on channel 10 is still a drum kit. Role wins over the melodic
  // address so percussion can never inherit piano pedal semantics.
  if (role === 'drum') return withAddress(profile(address.program, role, [], [], [2, 4, 64, 65, 84]));

  // CC0=127 is intentionally absent from DreamVoiceProfile. A compatibility
  // remap must never borrow a GM program's gesture or CC policy.
  const voice = dreamVoiceProfileFor(address);
  if (!voice) return withAddress(profile(address.program, role, [], [], [2, 64, 65, 84]));

  if (voice.expressionFamily === 'piano-damper') {
    // Firm5504-EK documents CC11 Expression and CC64 Sustain for GM voices.
    // CC11 is limited upstream to low-rate phrase dynamics; it is not a
    // substitute for piano touch velocity or the CC64 damper plan.
    return withAddress(profile(address.program, role, [11], [67], [], PIANO_DAMPER));
  }
  if (voice.expressionFamily === 'electric-keyboard') {
    // Firm5504-EK 文档的 CC11 Expression 是通道级、对 GM 音色普适 —— 电钢的乐句
    // 表情(低速率平台)与原声钢琴同权;CC64 维持 blocked(板上实测边界,未过 audition)。
    return withAddress(profile(address.program, role, [11], [72, 74], [64]));
  }
  if (voice.expressionFamily === 'mallet-damper') {
    return withAddress(profile(address.program, role, [], [], [], VIBRAPHONE_DAMPER));
  }
  if (voice.expressionFamily === 'mallet-strike' || voice.expressionFamily === 'pitched-percussion') {
    return withAddress(profile(address.program, role, [], [], [64]));
  }

  // Continuous dynamic control is documented as CC11. It is only automatic
  // for sustained, physically continuous families. CC2 remains blocked: it is
  // merely the generic Breath Controller number, not a documented GMBK map.
  if (voice.expressionFamily === 'sax-air' || voice.expressionFamily === 'brass-air'
    || voice.expressionFamily === 'woodwind-air' || voice.expressionFamily === 'bowed-string') {
    return withAddress(profile(address.program, role, [11], [76, 77, 78], [2, 64, 65, 84]));
  }
  if (voice.expressionFamily === 'synth-pad') {
    // Firm5504-MIDI-MIC documents standard CC1 as Modulation Wheel. Enable it
    // only for the authored Pad role; other roles choosing a synth-pad timbre
    // do not silently inherit a vibrato lane. CC11 remains the volume/expression
    // controller, while CC72/74 still require per-preset board audition.
    return withAddress(profile(address.program, role, role === 'pad' ? [1, 11] : [11], [72, 74], [64]));
  }

  // Plucked instruments get realism from note timing, velocity and duration.
  // Synth bass portamento is hardware-capable but stays audition-only.
  if (voice.expressionFamily === 'synth-bass') {
    return withAddress(profile(address.program, role, [], [65, 84], [2, 64]));
  }
  if (voice.expressionFamily === 'guitar-pluck' || voice.expressionFamily === 'bass-pluck'
    || voice.expressionFamily === 'plucked-string' || voice.expressionFamily === 'plucked-keyboard') {
    return withAddress(profile(address.program, role, [], [], [2, 64]));
  }

  return withAddress(profile(address.program, role));
}

export function hasDocumentedPedal(profile: DreamVoiceCcProfile): boolean {
  return profile.pedal.verification === 'documented' && profile.pedal.kind !== 'none';
}

export function mayEmitAutomaticCc(profile: DreamVoiceCcProfile, controller: number): boolean {
  return profile.automaticControllers.includes(controller) && !profile.blockedControllers.includes(controller);
}
