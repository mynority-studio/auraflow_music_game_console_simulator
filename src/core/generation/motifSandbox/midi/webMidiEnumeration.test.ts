import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestMidiInputDevices } from './webMidi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestMidiInputDevices', () => {
  it('enumerates the console list without replacing an active MIDI listener', async () => {
    const activeMessageListener = vi.fn();
    const activeStateListener = vi.fn();
    const input = {
      id: 'controller-1',
      name: 'USB Controller',
      manufacturer: 'Aura',
      onmidimessage: activeMessageListener,
    };
    const access = {
      inputs: new Map([[input.id, input]]),
      onstatechange: activeStateListener,
    };
    vi.stubGlobal('navigator', {
      requestMIDIAccess: vi.fn(async () => access),
    });

    const result = await requestMidiInputDevices();

    expect(result.status).toBe('ready');
    expect(result.devices).toEqual([{
      id: 'controller-1',
      name: 'USB Controller',
      manufacturer: 'Aura',
      transport: 'usb',
    }]);
    expect(input.onmidimessage).toBe(activeMessageListener);
    expect(access.onstatechange).toBe(activeStateListener);
  });
});

