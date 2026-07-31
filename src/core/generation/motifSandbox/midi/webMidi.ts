// ============================================================
// motifSandbox · midi · Web MIDI 接入(浏览器原生,无 npm 包)
// ------------------------------------------------------------
// navigator.requestMIDIAccess → 枚举 input → 监听 noteon/noteoff。第一版忽略 clock/CC/pitchbend。
// parseMidiMessage 是纯函数(可测);access/枚举需浏览器 secure context(localhost HTTPS OK)。
// ============================================================

export type MidiSupport = 'unsupported' | 'denied' | 'ready';
export type MidiInputTransport = 'bluetooth' | 'usb' | 'network' | 'unknown';
export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  /** Web MIDI has no transport field; this is a display-only name heuristic. */
  transport: MidiInputTransport;
}

export function inferMidiInputTransport(name: string, manufacturer = ''): MidiInputTransport {
  const label = `${name} ${manufacturer}`.toLowerCase();
  if (/(bluetooth|ble[ -]?midi|bt[ -]?midi|wireless midi|widi)/.test(label)) return 'bluetooth';
  if (/(network|rtp[ -]?midi|session)/.test(label)) return 'network';
  if (/usb/.test(label)) return 'usb';
  return 'unknown';
}

export function midiInputTransportLabel(device: Pick<MidiDeviceInfo, 'transport'>): string {
  if (device.transport === 'bluetooth') return 'BT';
  if (device.transport === 'usb') return 'USB';
  if (device.transport === 'network') return 'NET';
  return '';
}

/**
 * Q+T owns incoming MIDI while takeover is visible. This prevents another
 * sandbox from auditioning the raw external pitch beside Q+T's position map.
 */
export type MidiInputExclusiveOwner = 'takeover';
let exclusiveMidiInputOwner: MidiInputExclusiveOwner | null = null;
const exclusiveMidiInputListeners = new Set<(owner: MidiInputExclusiveOwner | null) => void>();

function notifyExclusiveMidiInputOwner(): void {
  for (const listener of exclusiveMidiInputListeners) listener(exclusiveMidiInputOwner);
}

export function getMidiInputExclusiveOwner(): MidiInputExclusiveOwner | null {
  return exclusiveMidiInputOwner;
}

/**
 * A claimed owner is the only browser-side MIDI consumer allowed to receive
 * input. Keeping this test at the transport boundary prevents a stale or
 * newly-created sandbox listener from auditioning an external key directly.
 */
export function canReceiveMidiInput(owner?: MidiInputExclusiveOwner): boolean {
  return exclusiveMidiInputOwner === null || exclusiveMidiInputOwner === owner;
}

export function claimMidiInputExclusive(owner: MidiInputExclusiveOwner): () => void {
  exclusiveMidiInputOwner = owner;
  notifyExclusiveMidiInputOwner();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (exclusiveMidiInputOwner !== owner) return;
    exclusiveMidiInputOwner = null;
    notifyExclusiveMidiInputOwner();
  };
}

export function subscribeMidiInputExclusive(
  listener: (owner: MidiInputExclusiveOwner | null) => void,
): () => void {
  exclusiveMidiInputListeners.add(listener);
  return () => exclusiveMidiInputListeners.delete(listener);
}

export interface ParsedMidiMessage {
  type: 'noteOn' | 'noteOff' | 'controlChange' | 'other';
  channel: number;
  note: number;        // CC 消息时 = controller number
  velocity: number;    // CC 消息时 = controller value
}

/** 解析 MIDI 三字节消息。velocity=0 的 noteon 视作 noteoff;0xB0 = controlChange(踏板 CC64 等)。纯函数。 */
export function parseMidiMessage(data: Uint8Array | readonly number[]): ParsedMidiMessage {
  const status = (data[0] ?? 0) & 0xf0;
  const channel = (data[0] ?? 0) & 0x0f;
  const note = data[1] ?? 0;
  const velocity = data[2] ?? 0;
  if (status === 0x90 && velocity > 0) return { type: 'noteOn', channel, note, velocity };
  if (status === 0x80 || (status === 0x90 && velocity === 0)) return { type: 'noteOff', channel, note, velocity: 0 };
  if (status === 0xb0) return { type: 'controlChange', channel, note, velocity }; // note=controller, velocity=value(CC64=延音踏板)
  return { type: 'other', channel, note, velocity };
}

export function isWebMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function';
}

export interface MidiAccessHandle {
  listInputs(): MidiDeviceInfo[];
  selectInput(id: string | null): void;
  dispose(): void;
}

export interface MidiInputRequestOptions {
  /** Q+T declares itself here so it remains the sole input consumer. */
  exclusiveOwner?: MidiInputExclusiveOwner;
}

function midiDeviceInfo(input: MIDIInput): MidiDeviceInfo {
  const name = input.name ?? '(未命名)';
  const manufacturer = input.manufacturer ?? '';
  return {
    id: input.id,
    name,
    manufacturer,
    transport: inferMidiInputTransport(name, manufacturer),
  };
}

function midiInputDevices(access: MIDIAccess): MidiDeviceInfo[] {
  const devices: MidiDeviceInfo[] = [];
  access.inputs.forEach((input) => devices.push(midiDeviceInfo(input)));
  return devices;
}

/**
 * Permission-aware enumeration for the always-visible console. Unlike
 * requestMidiAccess this never writes onmidimessage/onstatechange, so refreshing
 * the fixed-device list cannot steal an active Q+T listener.
 */
export async function requestMidiInputDevices(): Promise<{
  status: MidiSupport;
  devices: MidiDeviceInfo[];
}> {
  if (!isWebMidiSupported()) return { status: 'unsupported', devices: [] };
  try {
    const access = await (navigator as Navigator & { requestMIDIAccess(): Promise<MIDIAccess> }).requestMIDIAccess();
    return { status: 'ready', devices: midiInputDevices(access) };
  } catch {
    return { status: 'denied', devices: [] };
  }
}

/**
 * 请求 MIDI 权限并返回句柄。onMessage 收 note on/off;onDevices 在插拔时回调最新设备列表。
 *   浏览器不支持/未授权 → status 标记,handle 为空。
 */
export async function requestMidiAccess(
  onMessage: (msg: ParsedMidiMessage) => void,
  onDevices: (devices: MidiDeviceInfo[]) => void,
  options: MidiInputRequestOptions = {},
): Promise<{ status: MidiSupport; handle?: MidiAccessHandle }> {
  if (!isWebMidiSupported()) return { status: 'unsupported' };
  let access: MIDIAccess;
  try {
    access = await (navigator as Navigator & { requestMIDIAccess(): Promise<MIDIAccess> }).requestMIDIAccess();
  } catch {
    return { status: 'denied' };
  }

  const list = (): MidiDeviceInfo[] => midiInputDevices(access);

  let selectedId: string | null = null;
  const attach = (): void => {
    access.inputs.forEach((inp) => {
      inp.onmidimessage = inp.id === selectedId
        ? (e: MIDIMessageEvent) => {
          if (e.data && canReceiveMidiInput(options.exclusiveOwner)) onMessage(parseMidiMessage(e.data));
        }
        : null;
      // BLE MIDI ports often remain closed until explicitly opened. Calling
      // open is harmless for USB/network ports and lets statechange reconnect
      // the selected Bluetooth controller without a second user gesture.
      if (inp.id === selectedId) void inp.open().catch(() => undefined);
    });
  };
  access.onstatechange = () => { attach(); onDevices(list()); };

  onDevices(list());
  const handle: MidiAccessHandle = {
    listInputs: list,
    selectInput: (id) => { selectedId = id; attach(); },
    dispose: () => { access.inputs.forEach((i) => { i.onmidimessage = null; }); access.onstatechange = null; },
  };
  return { status: 'ready', handle };
}
