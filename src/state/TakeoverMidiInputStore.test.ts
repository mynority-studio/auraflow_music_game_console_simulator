import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MidiDeviceInfo } from '../core/generation/motifSandbox/midi/webMidi';

const device = (
  id: string,
  name: string,
  manufacturer = '',
): MidiDeviceInfo => ({
  id,
  name,
  manufacturer,
  transport: 'unknown',
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('TakeoverMidiInputStore', () => {
  it('resolves the exact persisted Web MIDI port ID first', async () => {
    const { resolveTakeoverMidiInput } = await import('./TakeoverMidiInputStore');
    const devices = [
      device('other', 'Controller', 'Aura'),
      device('fixed', 'Controller', 'Aura'),
    ];

    expect(resolveTakeoverMidiInput(devices, {
      id: 'fixed',
      name: 'Controller',
      manufacturer: 'Aura',
    })?.id).toBe('fixed');
  });

  it('follows the same physical device when a reconnect changes its port ID', async () => {
    const { resolveTakeoverMidiInput } = await import('./TakeoverMidiInputStore');
    const devices = [device('new-ble-id', 'WIDI Master', 'CME')];

    expect(resolveTakeoverMidiInput(devices, {
      id: 'old-ble-id',
      name: ' WIDI   MASTER ',
      manufacturer: 'cme',
    })?.id).toBe('new-ble-id');
  });

  it('does not guess when multiple ports only share the same name', async () => {
    const { resolveTakeoverMidiInput } = await import('./TakeoverMidiInputStore');
    const devices = [
      device('port-a', 'MIDI Keyboard', 'Vendor A'),
      device('port-b', 'MIDI Keyboard', 'Vendor B'),
    ];

    expect(resolveTakeoverMidiInput(devices, {
      id: 'missing',
      name: 'MIDI Keyboard',
      manufacturer: 'Unknown Vendor',
    })).toBeNull();
  });

  it('does not guess between duplicate ports with the same device identity', async () => {
    const { resolveTakeoverMidiInput } = await import('./TakeoverMidiInputStore');
    const devices = [
      device('duplicate-a', 'Bluetooth Controller', 'Aura'),
      device('duplicate-b', 'Bluetooth Controller', 'Aura'),
    ];

    expect(resolveTakeoverMidiInput(devices, {
      id: 'missing',
      name: 'Bluetooth Controller',
      manufacturer: 'Aura',
    })).toBeNull();
  });

  it('persists the fixed input and restores it when the store reloads', async () => {
    const values = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    vi.stubGlobal('window', { localStorage });

    const first = await import('./TakeoverMidiInputStore');
    first.setTakeoverMidiInputPreference(device('fixed-id', 'KeyStep 37', 'Arturia'));

    vi.resetModules();
    const reloaded = await import('./TakeoverMidiInputStore');
    expect(reloaded.getTakeoverMidiInputPreference()).toEqual({
      id: 'fixed-id',
      name: 'KeyStep 37',
      manufacturer: 'Arturia',
    });

    reloaded.setTakeoverMidiInputPreference(null);
    expect(values.size).toBe(0);
  });
});
