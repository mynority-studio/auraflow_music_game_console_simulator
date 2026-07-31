import { analyzeMidiHarmony } from './harmonyAnalysis';
import { extractDeclaredMidiBaseline } from './declaredBaseline';
import { buildMidiInventory } from './inventory';
import { analyzeMidiKey } from './keyAnalysis';
import { buildMidiMeasureMap } from './measureMap';
import { analyzeMidiMeter } from './meterAnalysis';
import { analyzeMidiNoteLayers } from './noteLayerAnalysis';
import { buildMidiNoteSpans } from './noteSpans';
import { parseRichSMF } from './richSmfParser';
import type { MidiAnalysisReport } from './types';
import { refineMidiKeyWithHarmony } from './tonalRefinement';
import { separateMidiVoices } from './voiceSeparation';

export function analyzeMidiBytes(input: ArrayBuffer | Uint8Array): MidiAnalysisReport {
  const document = parseRichSMF(input);
  const baseline = extractDeclaredMidiBaseline(document);
  const noteSpans = buildMidiNoteSpans(document);
  const inventory = buildMidiInventory(document, noteSpans.notes);
  const meter = analyzeMidiMeter(document, noteSpans.notes, inventory, baseline);
  const measures = buildMidiMeasureMap(document, meter, baseline);
  const voices = separateMidiVoices(document, noteSpans.notes, inventory, measures);
  const pitchKey = analyzeMidiKey(
    document,
    noteSpans.notes,
    inventory,
    meter,
    voices,
    baseline,
    measures,
  );
  const chordAnalysis = analyzeMidiHarmony(
    document,
    noteSpans.notes,
    inventory,
    measures,
    voices,
  );
  const key = refineMidiKeyWithHarmony(pitchKey, chordAnalysis);
  const harmony = {
    ...chordAnalysis,
    analysisKey: key.candidates[0] ?? null,
  };
  const noteLayers = analyzeMidiNoteLayers(
    document,
    noteSpans.notes,
    inventory,
    measures,
    voices,
    harmony,
  );
  const warnings = [
    ...document.warnings.map((warning) => `SMF: ${warning}`),
    ...noteSpans.warnings.map((warning) => `Notes: ${warning}`),
    ...inventory.warnings.map((warning) => `Lanes: ${warning}`),
    ...meter.warnings.map((warning) => `Meter: ${warning}`),
    ...measures.warnings.map((warning) => `Measures: ${warning}`),
    ...voices.warnings.map((warning) => `Voices: ${warning}`),
    ...key.warnings.map((warning) => `Key: ${warning}`),
    ...harmony.warnings.map((warning) => `Harmony: ${warning}`),
    ...noteLayers.warnings.map((warning) => `Note layers: ${warning}`),
  ];
  return {
    schemaVersion: 5,
    document,
    baseline,
    noteSpans,
    inventory,
    meter,
    measures,
    voices,
    key,
    harmony,
    noteLayers,
    warnings,
  };
}
