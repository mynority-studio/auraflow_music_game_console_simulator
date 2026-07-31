import { analyzeMidiBytes } from './analyzeMidi';
import type { MidiAnalysisReport } from './types';

type WorkerResponse =
  | { id: number; ok: true; report: MidiAnalysisReport }
  | { id: number; ok: false; error: string };

interface PendingRequest {
  resolve: (report: MidiAnalysisReport) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function analysisWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  worker = new Worker(new URL('./midiAnalysis.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.ok) request.resolve(event.data.report);
    else request.reject(new Error('error' in event.data ? event.data.error : 'MIDI analysis worker failed'));
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'MIDI analysis worker failed');
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export async function analyzeMidiOffMainThread(
  input: ArrayBuffer | Uint8Array,
): Promise<MidiAnalysisReport> {
  const source = input instanceof Uint8Array
    ? input.slice().buffer
    : input.slice(0);
  const backgroundWorker = analysisWorker();
  if (!backgroundWorker) return analyzeMidiBytes(source);
  const id = nextRequestId++;
  return new Promise<MidiAnalysisReport>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    backgroundWorker.postMessage({ id, buffer: source }, [source]);
  });
}

export function terminateMidiAnalysisWorker(): void {
  worker?.terminate();
  worker = null;
  const error = new Error('MIDI analysis worker terminated');
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}
