// ============================================================
// midiOutSandbox · Web MIDI output sandbox helpers
// ------------------------------------------------------------
// MIDI-out helper layer for the Q+M sandbox. The UI registers a listener on the
// scheduler; this module only maps scheduler events to Cubase-facing routes.
// Browser Web MIDI can send to existing OS MIDI outputs, but cannot create
// virtual ports by itself.
// ============================================================

import type { MidiEvent } from '../../audio/MidiScheduler';

export type MidiOutRole = 'lead' | 'comp' | 'bass' | 'pad' | 'drum';
export type MidiOutputMode = 'single-port' | 'five-port';
export type MidiOutSupport = 'unsupported' | 'denied' | 'ready';

export interface MidiOutDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
}

export interface MidiOutTrack {
  role: MidiOutRole;
  label: string;
  shortLabel: string;
  defaultChannel: number; // Cubase-facing 1..16 channel number
  testNote: number;
  program: number;
}

export const MIDI_OUT_TRACKS: readonly MidiOutTrack[] = [
  { role: 'lead', label: 'Lead', shortLabel: 'LD', defaultChannel: 1, testNote: 72, program: 73 },
  { role: 'comp', label: 'Comp', shortLabel: 'CP', defaultChannel: 2, testNote: 60, program: 0 },
  { role: 'bass', label: 'Bass', shortLabel: 'BS', defaultChannel: 3, testNote: 36, program: 33 },
  { role: 'pad', label: 'Pad', shortLabel: 'PD', defaultChannel: 4, testNote: 55, program: 89 },
  { role: 'drum', label: 'Drum', shortLabel: 'DR', defaultChannel: 10, testNote: 36, program: 0 },
];

export const DEFAULT_CHANNELS: Record<MidiOutRole, number> = MIDI_OUT_TRACKS.reduce(
  (acc, track) => ({ ...acc, [track.role]: track.defaultChannel }),
  {} as Record<MidiOutRole, number>,
);

// Scheduler channels are the current Q+N playback contract. Cubase-facing
// channels are configurable and default to 1/2/3/4/10 above.
export const SCHEDULER_CHANNEL_TO_ROLE: Readonly<Record<number, MidiOutRole>> = {
  1: 'lead',
  2: 'comp',
  3: 'bass',
  4: 'pad',
  9: 'drum',
};

export interface MidiOutMessage {
  type: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'pitchBend';
  channel: number; // Cubase-facing 1..16 channel number
  data1: number;
  data2?: number;
}

/**
 * Firm5504 starts each generated channel at its controller defaults. CC0
 * remains necessary for the GMBK full address. The only musical exceptions
 * are Instrumentation-authored CC11/CC64 on the piano-capable roles; detailed
 * program-address gating happens in musicalIRToMidiEvents before this sink.
 */
export const DREAM5504_RAW_DEFAULT_OUTPUT = true;
const RAW_DEFAULT_TRANSPORT_CC = new Set([120, 121, 123]);
const PIANO_EXPRESSION_ROLES = new Set<MidiOutRole>(['lead', 'comp', 'bass']);

export function isDream5504RawDefaultMessageAllowed(message: MidiOutMessage, role?: MidiOutRole): boolean {
  if (!DREAM5504_RAW_DEFAULT_OUTPUT) return true;
  if (message.type === 'pitchBend') return false;
  if (message.type !== 'cc') return true;
  if (message.data1 === 0) return true;
  if (message.data1 === 11) return !!role && PIANO_EXPRESSION_ROLES.has(role);
  if (message.data1 === 64) return (message.data2 ?? 0) <= 63 || (!!role && PIANO_EXPRESSION_ROLES.has(role));
  return RAW_DEFAULT_TRANSPORT_CC.has(message.data1) && (message.data2 ?? 0) === 0;
}

export interface RoutedMidiOutMessage {
  role: MidiOutRole;
  message: MidiOutMessage;
}

export interface MidiPolyphonyAudition {
  role: MidiOutRole;
  bank: number; // Dream/GMBK5X128 melodic variation = CC0. Drum kits ignore bank and use Program Change only.
  program: number;
  notes: readonly number[];
  velocity: number;
  durationMs: number;
}

type MidiPolyphonyAuditionSender = (request: MidiPolyphonyAudition) => boolean;
let polyphonyAuditionSender: MidiPolyphonyAuditionSender | null = null;

export function registerMidiPolyphonyAuditionSender(sender: MidiPolyphonyAuditionSender | null): () => void {
  polyphonyAuditionSender = sender;
  return () => {
    if (polyphonyAuditionSender === sender) polyphonyAuditionSender = null;
  };
}

export function sendMidiPolyphonyAudition(request: MidiPolyphonyAudition): boolean {
  return polyphonyAuditionSender?.(request) ?? false;
}

export interface MidiOutputAccessHandle {
  listOutputs(): MidiOutDeviceInfo[];
  getOutput(id: string | null): MIDIOutput | null;
  openOutput(id: string | null): Promise<MIDIOutput | null>;
  dispose(): void;
}

const clamp7 = (v: number): number => Math.max(0, Math.min(127, Math.round(v)));
const clamp14 = (v: number): number => Math.max(0, Math.min(0x3fff, Math.round(v)));
const clampChannel = (v: number): number => Math.max(1, Math.min(16, Math.round(v || 1)));

function statusByte(kind: number, channel: number): number {
  return kind | (clampChannel(channel) - 1);
}

export function midiMessageToBytes(message: MidiOutMessage): number[] {
  const channel = clampChannel(message.channel);
  const d1 = clamp7(message.data1);
  const d2 = clamp7(message.data2 ?? 0);

  if (message.type === 'noteOn') return [statusByte(0x90, channel), d1, d2];
  if (message.type === 'noteOff') return [statusByte(0x80, channel), d1, d2];
  if (message.type === 'cc') return [statusByte(0xb0, channel), d1, d2];
  if (message.type === 'programChange') return [statusByte(0xc0, channel), d1];
  // MidiScheduler carries pitch bend as a single 14-bit value in data1.
  // Raw MIDI transmits it least-significant 7 bits first, then the MSB.
  const bend = clamp14(message.data1);
  return [statusByte(0xe0, channel), bend & 0x7f, (bend >> 7) & 0x7f];
}

export function schedulerChannelToRole(channel: number): MidiOutRole | null {
  return SCHEDULER_CHANNEL_TO_ROLE[Math.round(channel)] ?? null;
}

export function resolveOutputChannel(
  role: MidiOutRole,
  _mode: MidiOutputMode,
  channels: Record<MidiOutRole, number> = DEFAULT_CHANNELS,
): number {
  // Firm5504-EK exposes two 16-channel MIDI ports, not five isolated synths.
  // Upstream may still use five DAW/virtual routes, but the board-facing
  // channel identity must always remain 1/2/3/4/10 so PC/CC cannot collide.
  return channels[role];
}

/**
 * Formal song channels use their configured role route. Auxiliary realtime
 * channels (for example scheduler channel 15 = MIDI channel 16 auditions)
 * must retain their own MIDI channel and never collapse onto Lead channel 1.
 */
export function resolveSchedulerOutputChannel(
  schedulerChannel: number,
  mode: MidiOutputMode,
  channels: Record<MidiOutRole, number> = DEFAULT_CHANNELS,
): number {
  const role = schedulerChannelToRole(schedulerChannel);
  return role ? resolveOutputChannel(role, mode, channels) : clampChannel(schedulerChannel + 1);
}

export function midiEventToRoutedMessage(
  event: MidiEvent,
  channels: Record<MidiOutRole, number> = DEFAULT_CHANNELS,
  mode: MidiOutputMode = 'single-port',
): RoutedMidiOutMessage | null {
  if (event.type === 'visual') return null;
  const role = schedulerChannelToRole(event.channel);
  if (!role) return null;
  const channel = resolveOutputChannel(role, mode, channels);

  if (event.type === 'noteOn') {
    return { role, message: { type: 'noteOn', channel, data1: event.data1, data2: event.data2 } };
  }
  if (event.type === 'noteOff') {
    return { role, message: { type: 'noteOff', channel, data1: event.data1, data2: event.data2 } };
  }
  if (event.type === 'cc') {
    return { role, message: { type: 'cc', channel, data1: event.data1, data2: event.data2 } };
  }
  if (event.type === 'programChange') {
    return { role, message: { type: 'programChange', channel, data1: event.data1 } };
  }
  return { role, message: { type: 'pitchBend', channel, data1: event.data1, data2: event.data2 } };
}

export function isWebMidiOutputSupported(): boolean {
  return typeof navigator !== 'undefined' &&
    typeof (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function';
}

export async function requestMidiOutputAccess(
  onDevices: (devices: MidiOutDeviceInfo[]) => void,
): Promise<{ status: MidiOutSupport; handle?: MidiOutputAccessHandle }> {
  if (!isWebMidiOutputSupported()) return { status: 'unsupported' };

  let access: MIDIAccess;
  try {
    access = await (navigator as Navigator & { requestMIDIAccess(): Promise<MIDIAccess> }).requestMIDIAccess();
  } catch {
    return { status: 'denied' };
  }

  const info = (out: MIDIOutput): MidiOutDeviceInfo => ({
    id: out.id,
    name: out.name ?? '(unnamed)',
    manufacturer: out.manufacturer ?? '',
  });
  const list = (): MidiOutDeviceInfo[] => {
    const devices: MidiOutDeviceInfo[] = [];
    access.outputs.forEach((output) => devices.push(info(output)));
    return devices;
  };

  access.onstatechange = () => onDevices(list());
  onDevices(list());

  return {
    status: 'ready',
    handle: {
      listOutputs: list,
      getOutput: (id) => {
        if (!id) return null;
        let found: MIDIOutput | null = null;
        access.outputs.forEach((output) => {
          if (output.id === id) found = output;
        });
        return found;
      },
      openOutput: async (id) => {
        if (!id) return null;
        let found: MIDIOutput | null = null;
        access.outputs.forEach((output) => {
          if (output.id === id) found = output;
        });
        if (!found) return null;
        await found.open();
        return found.connection === 'open' ? found : null;
      },
      dispose: () => {
        access.onstatechange = null;
      },
    },
  };
}

export function sendMidiMessage(output: MIDIOutput, message: MidiOutMessage, timestamp?: number): void {
  output.send(midiMessageToBytes(message), timestamp);
}

/** 发送 7-bit Data Entry 的标准 NRPN，并在写入后取消参数选择，避免后续 CC6 误改同一参数。 */
export function sendNrpn7(
  output: MIDIOutput,
  channel: number,
  parameter: number,
  value: number,
  timestamp?: number,
): void {
  sendMidiMessage(output, { type: 'cc', channel, data1: 99, data2: (parameter >> 8) & 0x7f }, timestamp);
  sendMidiMessage(output, { type: 'cc', channel, data1: 98, data2: parameter & 0x7f }, timestamp);
  sendMidiMessage(output, { type: 'cc', channel, data1: 6, data2: clamp7(value) }, timestamp);
  sendMidiMessage(output, { type: 'cc', channel, data1: 99, data2: 0x7f }, timestamp);
  sendMidiMessage(output, { type: 'cc', channel, data1: 98, data2: 0x7f }, timestamp);
}

/**
 * Firm5504-EK 官方 NRPN 中性输出基线：关闭板载总 EQ，并把低/高频增益及
 * General Front Output 明确写回 0 dB。固件默认的 EQ 双频段 +6 dB 与 Front
 * Output 正增益会吃掉五轨叠加所需的余量。
 */
export function sendDream5504NeutralOutputBaseline(
  output: MIDIOutput,
  timestamp?: number,
): void {
  sendNrpn7(output, 1, 0x3755, 0, timestamp);  // Synth EQ OFF
  sendNrpn7(output, 1, 0x3708, 0x40, timestamp); // EQ low gain 0 dB
  sendNrpn7(output, 1, 0x370b, 0x40, timestamp); // EQ high gain 0 dB
  sendNrpn7(output, 1, 0x375e, 0x40, timestamp); // General front output 0 dB
}

export function sendProgram(output: MIDIOutput, channel: number, program: number, timestamp?: number): void {
  sendMidiMessage(output, { type: 'programChange', channel, data1: program }, timestamp);
}

export function sendNotes(
  output: MIDIOutput,
  channel: number,
  pitches: readonly number[],
  velocity: number,
  durationMs: number,
  timestamp = performance.now(),
): void {
  for (const pitch of pitches) {
    sendMidiMessage(output, { type: 'noteOn', channel, data1: pitch, data2: velocity }, timestamp);
    sendMidiMessage(output, { type: 'noteOff', channel, data1: pitch, data2: 0 }, timestamp + Math.max(10, durationMs));
  }
}

export function sendPanic(output: MIDIOutput, timestamp = performance.now()): void {
  for (let channel = 1; channel <= 16; channel++) {
    // Transport safety only. CC121 restores channel controllers to firmware
    // defaults; do not impose FX, filter, envelope or expression values here.
    sendMidiMessage(output, { type: 'cc', channel, data1: 64, data2: 0 }, timestamp);
    sendMidiMessage(output, { type: 'cc', channel, data1: 120, data2: 0 }, timestamp);
    sendMidiMessage(output, { type: 'cc', channel, data1: 123, data2: 0 }, timestamp);
    sendMidiMessage(output, { type: 'cc', channel, data1: 121, data2: 0 }, timestamp);
    sendMidiMessage(output, { type: 'pitchBend', channel, data1: 8192 }, timestamp);
  }
}
