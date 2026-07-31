import type { MidiDeviceInfo } from '../core/generation/motifSandbox/midi/webMidi';

export interface TakeoverMidiInputPreference {
  id: string;
  name: string;
  manufacturer: string;
}

const STORAGE_KEY = 'auraflow.takeover-midi-input.v1';
const listeners = new Set<(preference: TakeoverMidiInputPreference | null) => void>();

function readStoredPreference(): TakeoverMidiInputPreference | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TakeoverMidiInputPreference>;
    if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') return null;
    return {
      id: parsed.id,
      name: parsed.name,
      manufacturer: typeof parsed.manufacturer === 'string' ? parsed.manufacturer : '',
    };
  } catch {
    return null;
  }
}

function persistPreference(preference: TakeoverMidiInputPreference | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (preference) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing or a storage policy may reject localStorage. The
    // in-memory preference still remains valid for the current console session.
  }
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

let currentPreference = readStoredPreference();

export function getTakeoverMidiInputPreference(): TakeoverMidiInputPreference | null {
  return currentPreference ? { ...currentPreference } : null;
}

export function setTakeoverMidiInputPreference(
  device: Pick<MidiDeviceInfo, 'id' | 'name' | 'manufacturer'> | null,
): void {
  currentPreference = device
    ? { id: device.id, name: device.name, manufacturer: device.manufacturer }
    : null;
  persistPreference(currentPreference);
  const snapshot = getTakeoverMidiInputPreference();
  for (const listener of listeners) listener(snapshot);
}

export function subscribeTakeoverMidiInputPreference(
  listener: (preference: TakeoverMidiInputPreference | null) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Web MIDI port IDs are normally stable, but some BLE/USB drivers recreate an
 * ID after reconnecting. Fall back to manufacturer + name (then a unique name)
 * so the fixed console preference follows the same physical controller.
 */
export function resolveTakeoverMidiInput(
  devices: readonly MidiDeviceInfo[],
  preference: TakeoverMidiInputPreference | null = currentPreference,
): MidiDeviceInfo | null {
  if (!preference) return null;

  const exactId = devices.find((device) => device.id === preference.id);
  if (exactId) return exactId;

  const preferredName = normalized(preference.name);
  const preferredManufacturer = normalized(preference.manufacturer);
  const sameIdentity = devices.filter((device) =>
    normalized(device.name) === preferredName
    && normalized(device.manufacturer) === preferredManufacturer
  );
  if (sameIdentity.length === 1) return sameIdentity[0];
  if (sameIdentity.length > 1) return null;

  const sameName = devices.filter((device) => normalized(device.name) === preferredName);
  return sameName.length === 1 ? sameName[0] : null;
}
