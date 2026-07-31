// ============================================================
// musicGeneration · current-song voice override
// ------------------------------------------------------------
// User-selected voice changes belong to the already generated song only.
// They do not feed back into the arranger/orchestration seed decisions.
// ============================================================

import {
  dreamVoiceProfileFor,
  dreamVoiceProfilesForRole,
  type DreamVoiceProfile,
} from '../newEngine/instrumental/dreamVoiceProfiles';
import { freezeMusicalIR, type TrackIR } from '../newEngine/ir/MusicalIR';
import type { MusicGenerationResult, QnRole } from './types';

export interface CurrentSongVoiceSelection {
  role: QnRole;
  bank?: number;
  program: number;
}

/** Safe, modern Dream voices for the role. MT-32 compatibility remaps stay out. */
export function availableCurrentSongVoices(role: QnRole): readonly DreamVoiceProfile[] {
  return dreamVoiceProfilesForRole(role);
}

function cloneTrack(track: TrackIR): TrackIR {
  return {
    ...track,
    notes: track.notes.map((note) => ({ ...note })),
    programChanges: track.programChanges?.map((change) => ({ ...change })),
    pedalEvents: track.pedalEvents?.map((event) => ({ ...event })),
    mix: track.mix ? { ...track.mix } : undefined,
    mixChanges: track.mixChanges?.map((change) => ({ ...change, mix: { ...change.mix } })),
    ccEvents: track.ccEvents?.map((event) => ({ ...event })),
    pitchBendEvents: track.pitchBendEvents?.map((event) => ({ ...event })),
  };
}

function assertRoleVoice(selection: CurrentSongVoiceSelection): DreamVoiceProfile {
  const profile = dreamVoiceProfileFor(selection);
  if (!profile || !profile.roleCapabilities.includes(selection.role) || profile.arrangementStatus !== 'available') {
    throw new RangeError(`Dream 5504 voice is not available for ${selection.role}: CC0=${selection.bank ?? 0}, PC=${selection.program}`);
  }
  return profile;
}

/**
 * Revoices one rendered role without touching its notes, timing, harmony or
 * generation seed. Segment program changes are deliberately removed: a user
 * pick means one explicit voice for that role across the current song.
 */
export function applyCurrentSongVoiceOverride(
  result: MusicGenerationResult,
  selection: CurrentSongVoiceSelection,
): MusicGenerationResult {
  if (!result.ir) throw new Error('Cannot override a failed music generation');
  const profile = assertRoleVoice(selection);
  const isDrum = selection.role === 'drum';
  const bank = isDrum ? undefined : (profile.address.bank ?? 0);
  let found = false;

  const ir = freezeMusicalIR({
    timebase: result.ir.timebase,
    durationTicks: result.ir.durationTicks,
    tracks: result.ir.tracks.map((readonlyTrack) => {
      const track = cloneTrack(readonlyTrack as TrackIR);
      if (track.role !== selection.role) return track;
      found = true;
      return {
        ...track,
        program: profile.address.program,
        bank,
        programChanges: undefined,
        mixChanges: undefined,
        // Controller lanes belong to the score, not to the temporary output
        // voice. The MIDI adapter capability-gates them, so retaining these
        // lets piano -> non-piano -> piano recover the original CC64/CC11 plan.
        pedalEvents: track.pedalEvents,
        ccEvents: track.ccEvents?.filter((event) => event.controller === 11),
        pitchBendEvents: undefined,
      };
    }),
  });
  if (!found) throw new RangeError(`Current song has no ${selection.role} track`);

  const uiSnapshot = {
    ...result.uiSnapshot,
    roster: result.uiSnapshot.roster.map((player) => player.role === selection.role
      ? { ...player, program: profile.address.program, bank, instrumentName: profile.name, family: profile.family }
      : player),
    tracks: result.uiSnapshot.tracks.map((track) => track.role === selection.role
      ? { ...track, program: profile.address.program, bank, instrumentName: profile.name }
      : track),
  };
  return { ...result, ir, uiSnapshot };
}
