// ============================================================
// MIDI analysis · public evidence and SMF document contracts
// ------------------------------------------------------------
// Analysis keeps byte-declared facts separate from inferred musical
// meaning. Nothing in this layer mutates generation state.
// ============================================================

export type AnalysisEvidenceSource = 'declared' | 'inferred' | 'default' | 'manual';

export interface AnalysisAlternative<T> {
  value: T;
  confidence: number;
}

export interface AnalysisEvidence<T> {
  value: T;
  source: AnalysisEvidenceSource;
  confidence: number;
  alternatives: ReadonlyArray<AnalysisAlternative<T>>;
  evidence: ReadonlyArray<string>;
  warnings: ReadonlyArray<string>;
}

export type SmfAnalysisSupport =
  | { supported: true; scope: 'smf-format-0-1-ppq' }
  | { supported: false; reason: 'format-2-independent-sequences' | 'smpte-time-division' };

export type SmfTimeDivision =
  | { kind: 'ppq'; ppq: number }
  | { kind: 'smpte'; framesPerSecond: number; ticksPerFrame: number };

export type SmfChannelMessageType =
  | 'noteOff'
  | 'noteOn'
  | 'polyAftertouch'
  | 'cc'
  | 'programChange'
  | 'channelAftertouch'
  | 'pitchBend';

export interface SmfChannelEvent {
  kind: 'channel';
  type: SmfChannelMessageType;
  tick: number;
  trackIndex: number;
  order: number;
  channel: number;
  data1: number;
  data2: number;
}

export interface SmfMetaEvent {
  kind: 'meta';
  tick: number;
  trackIndex: number;
  order: number;
  metaType: number;
  data: Uint8Array;
}

export interface SmfSysExEvent {
  kind: 'sysex';
  tick: number;
  trackIndex: number;
  order: number;
  status: 0xf0 | 0xf7;
  data: Uint8Array;
}

export type RichSmfEvent = SmfChannelEvent | SmfMetaEvent | SmfSysExEvent;

export interface SmfTempoEvent {
  tick: number;
  trackIndex: number;
  microsecondsPerQuarter: number;
  bpm: number;
}

export interface SmfTimeSignatureEvent {
  tick: number;
  trackIndex: number;
  numerator: number;
  denominator: number;
  denominatorPower: number;
  midiClocksPerMetronomeClick: number;
  notated32ndNotesPerQuarter: number;
  valid: boolean;
}

export interface SmfKeySignatureEvent {
  tick: number;
  trackIndex: number;
  sharpsFlats: number;
  modeByte: number;
  mode: 'major' | 'minor' | 'unknown';
  valid: boolean;
}

export interface SmfTextEvent {
  tick: number;
  trackIndex: number;
  metaType: number;
  text: string;
}

export interface RichSmfTrack {
  index: number;
  declaredLength: number;
  endTick: number;
  name?: string;
  instrumentName?: string;
  events: ReadonlyArray<RichSmfEvent>;
}

export interface RichSmfDocument {
  format: number;
  declaredTrackCount: number;
  timeDivision: SmfTimeDivision;
  analysisSupport: SmfAnalysisSupport;
  tracks: ReadonlyArray<RichSmfTrack>;
  events: ReadonlyArray<RichSmfEvent>;
  tempoMap: ReadonlyArray<SmfTempoEvent>;
  timeSignatureMap: ReadonlyArray<SmfTimeSignatureEvent>;
  keySignatureMap: ReadonlyArray<SmfKeySignatureEvent>;
  textEvents: ReadonlyArray<SmfTextEvent>;
  durationTicks: number;
  warnings: ReadonlyArray<string>;
}

export type NoteReleaseReason =
  | 'noteOff'
  | 'allNotesOff'
  | 'allSoundOff'
  | 'endOfFile';

export interface MidiNoteSpan {
  id: string;
  trackIndex: number;
  channel: number;
  pitch: number;
  velocity: number;
  noteOffVelocity: number;
  startTick: number;
  keyDownEndTick: number;
  soundingEndTick: number;
  releaseReason: NoteReleaseReason;
  pedalExtended: boolean;
  inferredEnd: boolean;
}

export interface MidiNoteSpanResult {
  notes: ReadonlyArray<MidiNoteSpan>;
  warnings: ReadonlyArray<string>;
}

export type MidiLaneRole = 'bass' | 'comp' | 'pad' | 'lead' | 'drum' | 'mixed' | 'unknown';

export interface MidiProgramEpoch {
  tick: number;
  program: number;
  bankMsb: number;
  bankLsb: number;
}

export interface DeclaredProgramEvent extends MidiProgramEpoch {
  trackIndex: number;
  channel: number;
}

export interface DeclaredTrackBaseline {
  trackIndex: number;
  name?: string;
  instrumentName?: string;
  endTick: number;
  eventCount: number;
  channelNumbers: ReadonlyArray<number>;
  programs: ReadonlyArray<DeclaredProgramEvent>;
  textEvents: ReadonlyArray<SmfTextEvent>;
}

/**
 * Facts decoded directly from the MIDI byte stream. This object deliberately
 * contains no inferred/default tempo, meter, key, role or chord values.
 */
export interface DeclaredMidiBaseline {
  format: number;
  declaredTrackCount: number;
  timeDivision: SmfTimeDivision;
  analysisSupport: SmfAnalysisSupport;
  durationTicks: number;
  tempoMap: ReadonlyArray<SmfTempoEvent>;
  timeSignatureMap: ReadonlyArray<SmfTimeSignatureEvent>;
  keySignatureMap: ReadonlyArray<SmfKeySignatureEvent>;
  tracks: ReadonlyArray<DeclaredTrackBaseline>;
  usedChannels: ReadonlyArray<number>;
  programEvents: ReadonlyArray<DeclaredProgramEvent>;
  markers: ReadonlyArray<SmfTextEvent>;
  cuePoints: ReadonlyArray<SmfTextEvent>;
  lyrics: ReadonlyArray<SmfTextEvent>;
  warnings: ReadonlyArray<string>;
}

export interface MidiLaneFeatures {
  id: string;
  trackIndex: number;
  channel: number;
  trackName?: string;
  instrumentName?: string;
  programs: ReadonlyArray<MidiProgramEpoch>;
  noteCount: number;
  eventCount: number;
  minPitch: number | null;
  maxPitch: number | null;
  meanPitch: number | null;
  medianPitch: number | null;
  meanDurationQuarter: number;
  onsetClusterRatio: number;
  polyphonicOnsetRatio: number;
  maxSimultaneousNotes: number;
  drumChannelPrior: boolean;
}

export interface MidiLaneRoleScore {
  role: Exclude<MidiLaneRole, 'mixed' | 'unknown'>;
  score: number;
  evidence: ReadonlyArray<string>;
}

export interface MidiLaneAnalysis extends MidiLaneFeatures {
  role: MidiLaneRole;
  roleConfidence: number;
  roleScores: ReadonlyArray<MidiLaneRoleScore>;
  warnings: ReadonlyArray<string>;
}

export interface MidiInventory {
  physicalTrackCount: number;
  usedChannels: ReadonlyArray<number>;
  lanes: ReadonlyArray<MidiLaneAnalysis>;
  noteCount: number;
  channelEventCount: number;
  warnings: ReadonlyArray<string>;
}

export interface MeterValue {
  numerator: number;
  denominator: number;
}

export interface MeterCandidate extends MeterValue {
  score: number;
  confidence: number;
  barPhaseTick: number;
  beatGrouping: ReadonlyArray<number> | null;
}

export interface MeterAccentPoint {
  tick: number;
  performedAccent: number;
}

export interface MidiMeterAnalysis {
  declared: AnalysisEvidence<MeterValue> | null;
  inferred: AnalysisEvidence<MeterValue> | null;
  selected: MeterValue | null;
  selectedSource: 'declared' | 'inferred' | 'unknown';
  barPhaseTick: number | null;
  beatGrouping: ReadonlyArray<number> | null;
  candidates: ReadonlyArray<MeterCandidate>;
  performedAccents: ReadonlyArray<MeterAccentPoint>;
  warnings: ReadonlyArray<string>;
}

export interface MidiMeasure {
  id: string;
  label: string;
  index: number;
  startTick: number;
  endTick: number;
  meter: MeterValue;
  source: 'declared' | 'inferred' | 'default';
  isPickup: boolean;
  isPartial: boolean;
}

export interface MidiMeasureMap {
  measures: ReadonlyArray<MidiMeasure>;
  warnings: ReadonlyArray<string>;
}

export type MidiDerivedVoiceKind =
  | 'melody'
  | 'accompaniment'
  | 'bass'
  | 'drums'
  | 'unassigned';

export type MidiAccompanimentTexture =
  | 'block'
  | 'arpeggio'
  | 'sustained'
  | 'mixed'
  | 'none'
  | 'unknown';

export interface MidiTextureScores {
  block: number;
  arpeggio: number;
  sustained: number;
}

export interface MidiLaneTextureAnalysis {
  laneId: string;
  texture: MidiAccompanimentTexture;
  confidence: number;
  scores: MidiTextureScores;
  onsetClusterRatio: number;
  onsetRegularity: number;
  repeatedMeasurePatternRatio: number;
  evidence: ReadonlyArray<string>;
}

export interface MidiDerivedVoicePart {
  id: string;
  sourceLaneId: string;
  kind: MidiDerivedVoiceKind;
  noteIds: ReadonlyArray<string>;
  noteCount: number;
  minPitch: number | null;
  maxPitch: number | null;
  meanPitch: number | null;
  confidence: number;
  evidence: ReadonlyArray<string>;
}

export interface MidiVoiceSeparation {
  parts: ReadonlyArray<MidiDerivedVoicePart>;
  laneTextures: ReadonlyArray<MidiLaneTextureAnalysis>;
  notePartById: Readonly<Record<string, MidiDerivedVoiceKind>>;
  warnings: ReadonlyArray<string>;
}

export type MidiMetricLevel =
  | 'downbeat'
  | 'strongBeat'
  | 'beat'
  | 'subdivision'
  | 'offbeat';

export type MidiMelodicFunction =
  | 'chordTone'
  | 'sustainedChordTone'
  | 'passingTone'
  | 'neighborTone'
  | 'anticipation'
  | 'suspension'
  | 'appoggiatura'
  | 'escapeTone'
  | 'scaleNonChordTone'
  | 'nonChordTone'
  | 'percussion'
  | 'unknown';

export type MidiStructuralRole = 'backbone' | 'ornament' | 'ambiguous';

export interface MidiAnalyzedNote {
  id: string;
  noteId: string;
  measureId: string;
  measureLabel: string;
  laneId: string;
  trackIndex: number;
  channel: number;
  pitch: number;
  velocity: number;
  originalStartTick: number;
  originalEndTick: number;
  keyDownEndTick: number;
  soundingEndTick: number;
  pedalExtended: boolean;
  clippedStartTick: number;
  clippedEndTick: number;
  isOnset: boolean;
  isCarriedIn: boolean;
  beatPosition: number;
  metricLevel: MidiMetricLevel;
  metricStrength: number;
  performedAccent: number;
  durationBeats: number;
  voiceKind: MidiDerivedVoiceKind;
  chordTone: boolean | null;
  scaleTone: boolean | null;
  melodicFunction: MidiMelodicFunction;
  functionConfidence: number;
  structuralRole: MidiStructuralRole;
  structuralScore: number;
  evidence: ReadonlyArray<string>;
}

export interface MidiMeasureVoiceSummary {
  kind: MidiDerivedVoiceKind;
  noteCount: number;
  minPitch: number | null;
  maxPitch: number | null;
}

export interface MidiMeasureNoteLayer {
  measure: MidiMeasure;
  chordLabel: string;
  notes: ReadonlyArray<MidiAnalyzedNote>;
  voices: ReadonlyArray<MidiMeasureVoiceSummary>;
}

export interface MidiNoteLayerAnalysis {
  measures: ReadonlyArray<MidiMeasureNoteLayer>;
  warnings: ReadonlyArray<string>;
}

export type TonalMode = 'major' | 'minor';

export interface KeyCandidate {
  tonicPc: number;
  mode: TonalMode;
  label: string;
  score: number;
  confidence: number;
}

export interface LocalKeySegment {
  startTick: number;
  endTick: number;
  startMeasureLabel?: string;
  endMeasureLabel?: string;
  candidates: ReadonlyArray<KeyCandidate>;
  selected?: KeyCandidate | null;
  confidence?: number;
  evidence?: ReadonlyArray<string>;
}

export interface MidiKeyAnalysis {
  declared: AnalysisEvidence<string> | null;
  inferred: AnalysisEvidence<string> | null;
  candidates: ReadonlyArray<KeyCandidate>;
  localSegments: ReadonlyArray<LocalKeySegment>;
  pitchClassHistogram: ReadonlyArray<number>;
  warnings: ReadonlyArray<string>;
}

export interface HarmonicWindow {
  id: string;
  measureId: string;
  measureLabel: string;
  measureIndex: number;
  segmentIndex: number;
  segmentCount: number;
  segmentLabel: string;
  startTick: number;
  endTick: number;
  pitchClassWeights: ReadonlyArray<number>;
  accompanimentPitchClassWeights: ReadonlyArray<number>;
  bassPitchClassWeights: ReadonlyArray<number>;
  strongBeatPitchClassWeights: ReadonlyArray<number>;
  melodyPitchClassWeights: ReadonlyArray<number>;
  bassPc: number | null;
  bassConfidence: number;
  evidenceTotals: {
    accompaniment: number;
    bass: number;
    strongBeat: number;
    melody: number;
    other: number;
  };
  evidence: ReadonlyArray<string>;
  contributingNoteIds: ReadonlyArray<string>;
}

export interface HarmonicBoundary {
  id: string;
  measureId: string;
  measureLabel: string;
  tick: number;
  confidence: number;
  sources: ReadonlyArray<'accompanimentAttack' | 'bassAttack' | 'pitchSetChange'>;
  evidence: ReadonlyArray<string>;
}

export interface HarmonicSegment {
  id: string;
  measureId: string;
  measureLabel: string;
  measureIndex: number;
  segmentIndex: number;
  segmentCount: number;
  segmentLabel: string;
  startTick: number;
  endTick: number;
}

export interface ChordCandidate {
  rootPc: number;
  type: string;
  bassPc: number | null;
  label: string;
  score: number;
  confidence: number;
  rootHeard: boolean;
  missingPitchClasses: ReadonlyArray<number>;
  extraPitchClasses: ReadonlyArray<number>;
}

export interface ChordWindowAnalysis {
  window: HarmonicWindow;
  candidates: ReadonlyArray<ChordCandidate>;
  unknownConfidence: number;
}

export interface DecodedChordSpan {
  id: string;
  startTick: number;
  endTick: number;
  rootPc: number | null;
  type: string | null;
  bassPc: number | null;
  label: string;
  confidence: number;
  sourceWindowIds: ReadonlyArray<string>;
}

export interface AppliedTarget {
  degree: number;
  accidental: number;
}

export interface FunctionalChordAnalysis {
  chordSpanId: string;
  degree: number | null;
  accidental: number;
  roman: string;
  function: 'T' | 'S' | 'D' | 'unknown';
  inversionBassPc: number | null;
  appliedTarget?: AppliedTarget;
}

export interface ProgressionPattern {
  startChordIndex: number;
  endChordIndex: number;
  kind: 'ii-V-I' | 'IV-V-I' | 'V-I' | 'turnaround' | 'deceptive' | 'sequence';
  label: string;
  confidence: number;
}

export interface MidiHarmonyAnalysis {
  boundaries: ReadonlyArray<HarmonicBoundary>;
  windows: ReadonlyArray<ChordWindowAnalysis>;
  chordTimeline: ReadonlyArray<DecodedChordSpan>;
  functions: ReadonlyArray<FunctionalChordAnalysis>;
  patterns: ReadonlyArray<ProgressionPattern>;
  analysisKey: KeyCandidate | null;
  warnings: ReadonlyArray<string>;
}

export interface MidiAnalysisReport {
  schemaVersion: 5;
  document: RichSmfDocument;
  baseline: DeclaredMidiBaseline;
  noteSpans: MidiNoteSpanResult;
  inventory: MidiInventory;
  meter: MidiMeterAnalysis;
  measures: MidiMeasureMap;
  voices: MidiVoiceSeparation;
  key: MidiKeyAnalysis;
  harmony: MidiHarmonyAnalysis;
  noteLayers: MidiNoteLayerAnalysis;
  warnings: ReadonlyArray<string>;
}

export function declaredEvidence<T>(
  value: T,
  evidence: ReadonlyArray<string>,
  warnings: ReadonlyArray<string> = [],
): AnalysisEvidence<T> {
  return {
    value,
    source: 'declared',
    confidence: 1,
    alternatives: [],
    evidence,
    warnings,
  };
}
