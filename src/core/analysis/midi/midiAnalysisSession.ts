import { analyzeMidiOffMainThread } from './midiAnalysisService';
import type { MidiAnalysisReport } from './types';

export type MidiAnalysisSessionStatus = 'idle' | 'analyzing' | 'ready' | 'error';

export interface MidiAnalysisSessionState {
  id: number;
  status: MidiAnalysisSessionStatus;
  fileName: string | null;
  fileSize: number;
  report: MidiAnalysisReport | null;
  error: string | null;
}

const INITIAL_STATE: MidiAnalysisSessionState = {
  id: 0,
  status: 'idle',
  fileName: null,
  fileSize: 0,
  report: null,
  error: null,
};

let state = INITIAL_STATE;
let nextSessionId = 1;
const listeners = new Set<(state: MidiAnalysisSessionState) => void>();

function publish(next: MidiAnalysisSessionState): void {
  state = next;
  for (const listener of listeners) listener(state);
}

export function getMidiAnalysisSession(): MidiAnalysisSessionState {
  return state;
}

export function subscribeMidiAnalysisSession(
  listener: (state: MidiAnalysisSessionState) => void,
): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export async function startMidiAnalysisSession(
  input: ArrayBuffer | Uint8Array,
  file: { name: string; size: number },
): Promise<MidiAnalysisReport | null> {
  const id = nextSessionId++;
  publish({
    id,
    status: 'analyzing',
    fileName: file.name,
    fileSize: file.size,
    report: null,
    error: null,
  });
  try {
    const report = await analyzeMidiOffMainThread(input);
    if (state.id !== id) return null;
    publish({
      id,
      status: 'ready',
      fileName: file.name,
      fileSize: file.size,
      report,
      error: null,
    });
    return report;
  } catch (error) {
    if (state.id !== id) return null;
    publish({
      id,
      status: 'error',
      fileName: file.name,
      fileSize: file.size,
      report: null,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function clearMidiAnalysisSession(): void {
  publish({ ...INITIAL_STATE, id: nextSessionId++ });
}

