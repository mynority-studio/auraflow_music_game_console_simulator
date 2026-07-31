import { analyzeMidiBytes } from './analyzeMidi';

interface WorkerRequest {
  id: number;
  buffer: ArrayBuffer;
}

type WorkerResponse =
  | { id: number; ok: true; report: ReturnType<typeof analyzeMidiBytes> }
  | { id: number; ok: false; error: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

workerScope.onmessage = (event) => {
  const { id, buffer } = event.data;
  try {
    workerScope.postMessage({ id, ok: true, report: analyzeMidiBytes(buffer) });
  } catch (error) {
    workerScope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

