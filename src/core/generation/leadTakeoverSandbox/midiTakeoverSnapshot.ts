import type {
  MidiAnalysisReport,
  MidiAnalyzedNote,
  MidiDerivedVoicePart,
  MidiLaneAnalysis,
  MidiNoteSpan,
} from '../../analysis/midi/types';
import type { MidiNoteRange, MidiNoteTarget } from '../../audio/MidiScheduler';
import type {
  TakeoverLayoutMode,
  TakeoverMeasureNote,
  TakeoverMusicSnapshot,
} from './types';

const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface MidiTakeoverSnapshotResult {
  snapshot: TakeoverMusicSnapshot;
  nativeLeadChannel: number;
  canMuteNativeLead: boolean;
  nativeMuteStrategy: 'lead-channel' | 'top-voice-notes' | 'none';
  nativeLeadNoteRange: MidiNoteRange | null;
  nativeLeadNoteTargets: ReadonlyArray<MidiNoteTarget> | null;
  nativeMuteLaneId: string | null;
  leadLaneId: string;
  leadSelectionSource: 'separated-melody' | 'declared-lead-lane' | 'highest-register-fallback';
  leadConfidence: number;
}

function notePriority(note: MidiAnalyzedNote): number {
  const structural = note.structuralRole === 'backbone'
    ? 300
    : note.structuralRole === 'ambiguous'
      ? 200
      : 100;
  const metric: Record<MidiAnalyzedNote['metricLevel'], number> = {
    downbeat: 80,
    strongBeat: 65,
    beat: 40,
    subdivision: 20,
    offbeat: 10,
  };
  return structural
    + metric[note.metricLevel]
    + note.performedAccent * 25
    + note.structuralScore * 20
    + (note.chordTone ? 5 : 0);
}

function toMeasureNote(note: MidiAnalyzedNote): TakeoverMeasureNote {
  return {
    id: note.noteId,
    sourceMidi: note.pitch,
    priority: notePriority(note),
    voiceKind: note.voiceKind === 'melody' || note.voiceKind === 'bass'
      ? note.voiceKind
      : 'accompaniment',
    structuralRole: note.structuralRole,
    metricLevel: note.metricLevel,
    melodicFunction: note.melodicFunction,
  };
}

function parseLaneChannel(laneId: string): number | null {
  const match = /^t\d+:ch(\d+)$/.exec(laneId);
  return match ? Number(match[1]) : null;
}

function laneIdForNote(note: MidiNoteSpan): string {
  return `t${note.trackIndex}:ch${note.channel}`;
}

function toSchedulerNoteTarget(note: MidiNoteSpan, sourcePpq: number): MidiNoteTarget {
  const schedulerTick = (tick: number): number => Math.round(tick / sourcePpq * 480);
  const startTick = schedulerTick(note.startTick);
  return {
    channel: note.channel,
    midi: note.pitch,
    startTick,
    endTick: Math.max(startTick + 1, schedulerTick(note.soundingEndTick)),
  };
}

const MAX_FALLBACK_TOP_VOICE_RATIO = 0.4;

function evenlySampleByTime(
  notes: ReadonlyArray<MidiNoteSpan>,
  count: number,
): MidiNoteSpan[] {
  if (count <= 0) return [];
  if (count >= notes.length) return [...notes];
  const ordered = [...notes].sort((left, right) =>
    (left.startTick - right.startTick) || (left.pitch - right.pitch));
  return Array.from({ length: count }, (_, index) => {
    const sampleIndex = Math.min(
      ordered.length - 1,
      Math.floor((index + 0.5) * ordered.length / count),
    );
    return ordered[sampleIndex];
  });
}

function highestNoteAtEachOnset(notes: ReadonlyArray<MidiNoteSpan>): MidiNoteSpan[] {
  const highestByOnset = new Map<number, MidiNoteSpan>();
  for (const note of notes) {
    const current = highestByOnset.get(note.startTick);
    if (!current
      || note.pitch > current.pitch
      || (
        note.pitch === current.pitch
        && note.soundingEndTick > current.soundingEndTick
      )) {
      highestByOnset.set(note.startTick, note);
    }
  }
  const onsetTops = Array.from(highestByOnset.values())
    .sort((left, right) => (left.startTick - right.startTick) || (left.pitch - right.pitch));
  const maximumTargets = Math.max(
    1,
    Math.floor(notes.length * MAX_FALLBACK_TOP_VOICE_RATIO),
  );
  if (onsetTops.length <= maximumTargets) return onsetTops;

  // An arpeggio commonly has one note at every exact onset. Treating every
  // such note as "the highest voice" would mute almost the entire piano
  // performance. In the low-confidence fallback, retain only the highest
  // register frontier and spread cutoff-pitch ties over the full timeline.
  const byPitch = [...onsetTops].sort((left, right) =>
    (right.pitch - left.pitch) || (left.startTick - right.startTick));
  const cutoffPitch = byPitch[maximumTargets - 1].pitch;
  const aboveCutoff = onsetTops.filter((note) => note.pitch > cutoffPitch);
  const atCutoff = onsetTops.filter((note) => note.pitch === cutoffPitch);
  const selected = [
    ...aboveCutoff,
    ...evenlySampleByTime(atCutoff, maximumTargets - aboveCutoff.length),
  ];
  return selected.sort((left, right) =>
    (left.startTick - right.startTick) || (left.pitch - right.pitch));
}

function chooseLead(
  parts: ReadonlyArray<MidiDerivedVoicePart>,
  lanes: ReadonlyArray<MidiLaneAnalysis>,
  notes: ReadonlyArray<MidiNoteSpan>,
  sourcePpq: number,
): Omit<MidiTakeoverSnapshotResult, 'snapshot'> {
  type LeadCandidate = Pick<
    MidiTakeoverSnapshotResult,
    'nativeLeadChannel' | 'leadLaneId' | 'leadSelectionSource' | 'leadConfidence'
  > & { noteIds?: ReadonlyArray<string> };
  const withMuteStrategy = (
    candidate: LeadCandidate,
  ): Omit<MidiTakeoverSnapshotResult, 'snapshot'> => {
    const channelHasHarmonicMaterial = parts.some((part) =>
      (part.kind === 'accompaniment' || part.kind === 'bass')
      && parseLaneChannel(part.sourceLaneId) === candidate.nativeLeadChannel);
    const canMuteLeadChannel = candidate.leadSelectionSource !== 'highest-register-fallback'
      && !channelHasHarmonicMaterial;
    if (canMuteLeadChannel) {
      return {
        ...candidate,
        canMuteNativeLead: true,
        nativeMuteStrategy: 'lead-channel',
        nativeLeadNoteRange: null,
        nativeLeadNoteTargets: null,
        nativeMuteLaneId: candidate.leadLaneId,
      };
    }
    const candidateNoteIds = candidate.noteIds ? new Set(candidate.noteIds) : null;
    const candidateNotes = candidateNoteIds
      ? notes.filter((note) => candidateNoteIds.has(note.id))
      : highestNoteAtEachOnset(
          notes.filter((note) => laneIdForNote(note) === candidate.leadLaneId),
        );
    const noteTargets = candidateNotes.map((note) =>
      toSchedulerNoteTarget(note, sourcePpq));
    if (noteTargets.length > 0) {
      return {
        ...candidate,
        canMuteNativeLead: false,
        nativeMuteStrategy: 'top-voice-notes',
        nativeLeadNoteRange: null,
        nativeLeadNoteTargets: noteTargets,
        nativeMuteLaneId: candidate.leadLaneId,
      };
    }
    return {
      ...candidate,
      canMuteNativeLead: false,
      nativeMuteStrategy: 'none',
      nativeLeadNoteRange: null,
      nativeLeadNoteTargets: null,
      nativeMuteLaneId: null,
    };
  };
  const separated = parts
    .filter((part) => part.kind === 'melody' && parseLaneChannel(part.sourceLaneId) !== null)
    .sort((left, right) =>
      (right.confidence * right.noteCount) - (left.confidence * left.noteCount))[0];
  if (separated) {
    return withMuteStrategy({
      nativeLeadChannel: parseLaneChannel(separated.sourceLaneId)!,
      leadLaneId: separated.sourceLaneId,
      leadSelectionSource: 'separated-melody',
      leadConfidence: separated.confidence,
      noteIds: separated.noteIds,
    });
  }
  const declaredLead = lanes
    .filter((lane) => lane.noteCount > 0 && lane.role === 'lead')
    .sort((left, right) => right.roleConfidence - left.roleConfidence)[0];
  if (declaredLead) {
    return withMuteStrategy({
      nativeLeadChannel: declaredLead.channel,
      leadLaneId: declaredLead.id,
      leadSelectionSource: 'declared-lead-lane',
      leadConfidence: declaredLead.roleConfidence,
    });
  }
  const fallback = lanes
    .filter((lane) => lane.noteCount > 0 && lane.role !== 'drum')
    .sort((left, right) =>
      ((right.meanPitch ?? -1) - (left.meanPitch ?? -1))
      || (right.noteCount - left.noteCount))[0];
  return withMuteStrategy({
    nativeLeadChannel: fallback?.channel ?? 1,
    leadLaneId: fallback?.id ?? 'fallback:ch1',
    leadSelectionSource: 'highest-register-fallback',
      leadConfidence: Math.min(0.45, fallback?.roleConfidence ?? 0),
  });
}

export function takeoverSnapshotFromMidiAnalysis(
  report: MidiAnalysisReport,
  layoutMode: TakeoverLayoutMode,
  playbackBpm: number,
): MidiTakeoverSnapshotResult {
  const ppq = report.document.timeDivision.kind === 'ppq'
    ? report.document.timeDivision.ppq
    : 480;
  const beat = (tick: number): number => tick / ppq;
  const windowById = new Map(
    report.harmony.windows.map((analysis) => [analysis.window.id, analysis.window]),
  );
  const key = report.key.candidates[0] ?? null;
  const meter = report.meter.selected ?? { numerator: 4, denominator: 4 };
  const snapshot: TakeoverMusicSnapshot = {
    styleHint: 'pop',
    key: key ? PC_NAMES[key.tonicPc] : 'C',
    tonality: key?.mode ?? 'major',
    bpm: Number.isFinite(playbackBpm) && playbackBpm > 0 ? playbackBpm : 120,
    timeSignature: [meter.numerator, meter.denominator],
    source: 'midi-analysis',
    layoutMode,
    chords: report.harmony.chordTimeline
      .filter((chord) => chord.rootPc !== null && chord.type !== null)
      .map((chord) => {
        const window = windowById.get(chord.sourceWindowIds[0]);
        return {
          rootPc: chord.rootPc!,
          quality: chord.type!,
          chordType: chord.type!,
          startBeat: beat(chord.startTick),
          durationBeats: beat(chord.endTick - chord.startTick),
          sectionId: window?.measureLabel,
        };
      }),
    measures: report.noteLayers.measures.map((layer) => ({
      id: layer.measure.id,
      label: layer.measure.label,
      startBeat: beat(layer.measure.startTick),
      durationBeats: beat(layer.measure.endTick - layer.measure.startTick),
      notes: layer.notes
        .filter((note) =>
          note.isOnset
          && (
            note.voiceKind === 'melody'
            || note.voiceKind === 'bass'
            || note.voiceKind === 'accompaniment'
          ))
        .map(toMeasureNote),
    })),
  };
  return {
    snapshot,
    ...chooseLead(
      report.voices.parts,
      report.inventory.lanes,
      report.noteSpans.notes,
      ppq,
    ),
  };
}
