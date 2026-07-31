import type {
  MidiInventory,
  MidiLaneAnalysis,
  MidiLaneFeatures,
  MidiLaneRoleScore,
  MidiNoteSpan,
  MidiProgramEpoch,
  RichSmfDocument,
} from './types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const laneId = (trackIndex: number, channel: number): string => `t${trackIndex}:ch${channel}`;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function maxSimultaneous(notes: ReadonlyArray<MidiNoteSpan>): number {
  const points: Array<{ tick: number; delta: number }> = [];
  for (const note of notes) {
    points.push({ tick: note.startTick, delta: 1 });
    points.push({ tick: note.keyDownEndTick, delta: -1 });
  }
  points.sort((a, b) => (a.tick - b.tick) || (a.delta - b.delta));
  let active = 0;
  let maximum = 0;
  for (const point of points) {
    active += point.delta;
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

function scoreLaneRole(features: MidiLaneFeatures): {
  role: MidiLaneAnalysis['role'];
  confidence: number;
  scores: MidiLaneRoleScore[];
  warnings: string[];
} {
  if (features.noteCount === 0) {
    return { role: 'unknown', confidence: 0, scores: [], warnings: ['该 Lane 没有音符事件'] };
  }

  const programNumbers = new Set(features.programs.map((epoch) => epoch.program));
  const hasProgramIn = (start: number, end: number): boolean =>
    Array.from(programNumbers).some((program) => program >= start && program <= end);
  const medianPitch = features.medianPitch ?? 60;
  const monophonic = features.maxSimultaneousNotes <= 1 ? 1 : 0;
  const longTone = clamp01(features.meanDurationQuarter / 4);
  const cluster = features.onsetClusterRatio;
  const scores: MidiLaneRoleScore[] = [];

  const push = (
    role: MidiLaneRoleScore['role'],
    score: number,
    evidence: string[],
  ): void => {
    scores.push({ role, score: Math.max(0, score), evidence });
  };

  push(
    'drum',
    (features.drumChannelPrior ? 1.6 : 0) + (hasProgramIn(112, 119) ? 0.15 : 0),
    [
      ...(features.drumChannelPrior ? ['MIDI Channel 10（GM 打击乐强先验）'] : []),
      ...(hasProgramIn(112, 119) ? ['Program 位于打击/效果类'] : []),
    ],
  );
  push(
    'bass',
    0.05
      + (hasProgramIn(32, 39) ? 0.75 : 0)
      + (medianPitch <= 47 ? 0.65 : medianPitch <= 52 ? 0.35 : 0)
      + 0.18 * monophonic
      - 0.12 * cluster,
    [
      ...(hasProgramIn(32, 39) ? ['GM Bass Program'] : []),
      ...(medianPitch <= 52 ? [`低音域中位数 ${medianPitch.toFixed(1)}`] : []),
      ...(monophonic ? ['以单声部为主'] : []),
    ],
  );
  push(
    'comp',
    0.08
      + (hasProgramIn(0, 31) ? 0.28 : 0)
      + 0.62 * cluster
      + (features.maxSimultaneousNotes >= 3 ? 0.28 : 0)
      + (medianPitch >= 45 && medianPitch <= 84 ? 0.12 : 0)
      - 0.18 * longTone,
    [
      ...(hasProgramIn(0, 31) ? ['键盘/吉他 Program 先验'] : []),
      ...(cluster > 0.35 ? [`同时起音比例 ${(cluster * 100).toFixed(0)}%`] : []),
      ...(features.maxSimultaneousNotes >= 3 ? [`最大 ${features.maxSimultaneousNotes} 声部`] : []),
    ],
  );
  push(
    'pad',
    0.05
      + (hasProgramIn(40, 55) || hasProgramIn(88, 95) ? 0.5 : 0)
      + 0.72 * longTone
      + (features.maxSimultaneousNotes >= 3 ? 0.18 : 0),
    [
      ...(hasProgramIn(40, 55) || hasProgramIn(88, 95) ? ['Strings/Pad Program 先验'] : []),
      ...(features.meanDurationQuarter >= 1.5
        ? [`平均持续 ${features.meanDurationQuarter.toFixed(2)} 个四分音符`]
        : []),
    ],
  );
  push(
    'lead',
    0.08
      + (hasProgramIn(56, 87) ? 0.35 : 0)
      + 0.42 * monophonic
      + (medianPitch >= 60 ? 0.28 : 0)
      + (cluster < 0.2 ? 0.15 : 0)
      - 0.1 * longTone,
    [
      ...(hasProgramIn(56, 87) ? ['铜管/木管/Synth Lead Program 先验'] : []),
      ...(monophonic ? ['单声部线条'] : []),
      ...(medianPitch >= 60 ? [`中高音域中位数 ${medianPitch.toFixed(1)}`] : []),
    ],
  );

  scores.sort((a, b) => b.score - a.score);
  const first = scores[0];
  const second = scores[1];
  if (!first || first.score < 0.5) {
    return { role: 'unknown', confidence: clamp01(first?.score ?? 0), scores, warnings: ['角色证据不足'] };
  }
  if (first.role !== 'drum' && second && second.score >= 0.58 && first.score - second.score < 0.13) {
    return {
      role: 'mixed',
      confidence: clamp01(1 - (first.score - second.score)),
      scores,
      warnings: [`${first.role}/${second.role} 证据接近，保留 mixed 而不强判`],
    };
  }
  const confidence = first.role === 'drum' && features.drumChannelPrior
    ? 0.96
    : clamp01(0.55 + (first.score - (second?.score ?? 0)) * 0.55);
  return { role: first.role, confidence, scores, warnings: [] };
}

export function buildMidiInventory(
  document: RichSmfDocument,
  notes: ReadonlyArray<MidiNoteSpan>,
): MidiInventory {
  const laneKeys = new Set<string>();
  const eventsByLane = new Map<string, number>();
  const notesByLane = new Map<string, MidiNoteSpan[]>();
  const usedChannels = new Set<number>();

  for (const event of document.events) {
    if (event.kind !== 'channel') continue;
    const id = laneId(event.trackIndex, event.channel);
    laneKeys.add(id);
    usedChannels.add(event.channel);
    eventsByLane.set(id, (eventsByLane.get(id) ?? 0) + 1);
  }
  for (const note of notes) {
    const id = laneId(note.trackIndex, note.channel);
    laneKeys.add(id);
    usedChannels.add(note.channel);
    const laneNotes = notesByLane.get(id) ?? [];
    laneNotes.push(note);
    notesByLane.set(id, laneNotes);
  }

  const programEpochsByChannel = new Map<number, MidiProgramEpoch[]>();
  const bankMsb = new Array<number>(16).fill(0);
  const bankLsb = new Array<number>(16).fill(0);
  for (const event of document.events) {
    if (event.kind !== 'channel') continue;
    if (event.type === 'cc' && event.data1 === 0) bankMsb[event.channel] = event.data2;
    else if (event.type === 'cc' && event.data1 === 32) bankLsb[event.channel] = event.data2;
    else if (event.type === 'programChange') {
      const epochs = programEpochsByChannel.get(event.channel) ?? [];
      epochs.push({
        tick: event.tick,
        program: event.data1,
        bankMsb: bankMsb[event.channel],
        bankLsb: bankLsb[event.channel],
      });
      programEpochsByChannel.set(event.channel, epochs);
    }
  }

  const ppq = document.timeDivision.kind === 'ppq' ? document.timeDivision.ppq : 1;
  const lanes: MidiLaneAnalysis[] = [];
  for (const id of laneKeys) {
    const [, trackText, channelText] = /^t(\d+):ch(\d+)$/.exec(id) ?? [];
    const trackIndex = Number(trackText);
    const channel = Number(channelText);
    const laneNotes = notesByLane.get(id) ?? [];
    const pitches = laneNotes.map((note) => note.pitch);
    const onsetCounts = new Map<number, number>();
    for (const note of laneNotes) onsetCounts.set(note.startTick, (onsetCounts.get(note.startTick) ?? 0) + 1);
    const clusteredNotes = laneNotes.filter((note) => (onsetCounts.get(note.startTick) ?? 0) >= 2).length;
    const polyphonicOnsets = Array.from(onsetCounts.values()).filter((count) => count >= 2).length;
    const uniqueOnsets = onsetCounts.size;
    const track = document.tracks[trackIndex];
    const features: MidiLaneFeatures = {
      id,
      trackIndex,
      channel,
      trackName: track?.name,
      instrumentName: track?.instrumentName,
      programs: programEpochsByChannel.get(channel) ?? [],
      noteCount: laneNotes.length,
      eventCount: eventsByLane.get(id) ?? 0,
      minPitch: pitches.length > 0 ? Math.min(...pitches) : null,
      maxPitch: pitches.length > 0 ? Math.max(...pitches) : null,
      meanPitch: pitches.length > 0 ? pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length : null,
      medianPitch: median(pitches),
      meanDurationQuarter: laneNotes.length > 0
        ? laneNotes.reduce((sum, note) => sum + (note.keyDownEndTick - note.startTick) / ppq, 0) / laneNotes.length
        : 0,
      onsetClusterRatio: laneNotes.length > 0 ? clusteredNotes / laneNotes.length : 0,
      polyphonicOnsetRatio: uniqueOnsets > 0 ? polyphonicOnsets / uniqueOnsets : 0,
      maxSimultaneousNotes: maxSimultaneous(laneNotes),
      drumChannelPrior: channel === 9,
    };
    const classification = scoreLaneRole(features);
    lanes.push({
      ...features,
      role: classification.role,
      roleConfidence: classification.confidence,
      roleScores: classification.scores,
      warnings: classification.warnings,
    });
  }
  lanes.sort((a, b) => (a.trackIndex - b.trackIndex) || (a.channel - b.channel));

  return {
    physicalTrackCount: document.tracks.length,
    usedChannels: Array.from(usedChannels).sort((a, b) => a - b),
    lanes,
    noteCount: notes.length,
    channelEventCount: document.events.filter((event) => event.kind === 'channel').length,
    warnings: document.analysisSupport.supported
      ? []
      : [`${'reason' in document.analysisSupport ? document.analysisSupport.reason : 'unsupported'}: 仅展示清单，不执行节拍/和声推断`],
  };
}
