import { afterEach, describe, expect, it } from 'vitest';

import { emitTakeoverPadInput, resetTakeoverPadInputState, subscribeTakeoverPadInput } from './takeoverInputBus';

describe('leadTakeoverSandbox/takeoverInputBus', () => {
  afterEach(() => {
    resetTakeoverPadInputState();
  });

  it('dedupes repeated down/up events for the same pad', () => {
    const events: string[] = [];
    const unsubscribe = subscribeTakeoverPadInput((event) => {
      events.push(`${event.type}:${event.padIndex}`);
    });

    emitTakeoverPadInput('down', 0, 0);
    emitTakeoverPadInput('down', 0, 0);
    emitTakeoverPadInput('up', 0, 0);
    emitTakeoverPadInput('up', 0, 0);

    unsubscribe();
    expect(events).toEqual(['down:0', 'up:0']);
  });

  it('allows a fresh down after reset clears held state', () => {
    const events: string[] = [];
    const unsubscribe = subscribeTakeoverPadInput((event) => {
      events.push(`${event.type}:${event.padIndex}`);
    });

    emitTakeoverPadInput('down', 1, 0);
    resetTakeoverPadInputState();
    emitTakeoverPadInput('down', 1, 0);

    unsubscribe();
    expect(events).toEqual(['down:1', 'down:1']);
  });
});
