// ============================================================
// leadTakeoverSandbox · direct pad input bus
// ------------------------------------------------------------
// Lets Q+T consume TapArea down/up events before React activeKeys state
// propagates, keeping rhythmic capture closer to the user's gesture.
// ============================================================

import { takeoverPadIndex } from './padLayout';

export interface TakeoverPadInputEvent {
  type: 'down' | 'up';
  col: number;
  row: number;
  padIndex: number;
  atMs: number;
  seq: number;
}

type TakeoverPadInputListener = (event: TakeoverPadInputEvent) => void;

const listeners = new Set<TakeoverPadInputListener>();
const heldPadIndexes = new Set<number>();
let nextSeq = 1;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function emitTakeoverPadInput(type: TakeoverPadInputEvent['type'], col: number, row: number): void {
  const padIndex = takeoverPadIndex(col, row);
  if (type === 'down') {
    if (heldPadIndexes.has(padIndex)) return;
    heldPadIndexes.add(padIndex);
  } else {
    if (!heldPadIndexes.has(padIndex)) return;
    heldPadIndexes.delete(padIndex);
  }
  const event: TakeoverPadInputEvent = {
    type,
    col,
    row,
    padIndex,
    atMs: nowMs(),
    seq: nextSeq++,
  };
  for (const listener of listeners) listener(event);
}

export function resetTakeoverPadInputState(): void {
  heldPadIndexes.clear();
}

export function subscribeTakeoverPadInput(listener: TakeoverPadInputListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
