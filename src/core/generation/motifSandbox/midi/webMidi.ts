// ============================================================
// motifSandbox · midi · Web MIDI 接入(浏览器原生,无 npm 包)
// ------------------------------------------------------------
// navigator.requestMIDIAccess → 枚举 input → 监听 noteon/noteoff。第一版忽略 clock/CC/pitchbend。
// parseMidiMessage 是纯函数(可测);access/枚举需浏览器 secure context(localhost HTTPS OK)。
// ============================================================

export type MidiSupport = 'unsupported' | 'denied' | 'ready';
export interface MidiDeviceInfo { id: string; name: string; manufacturer: string; }
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

/**
 * 请求 MIDI 权限并返回句柄。onMessage 收 note on/off;onDevices 在插拔时回调最新设备列表。
 *   浏览器不支持/未授权 → status 标记,handle 为空。
 */
export async function requestMidiAccess(
  onMessage: (msg: ParsedMidiMessage) => void,
  onDevices: (devices: MidiDeviceInfo[]) => void,
): Promise<{ status: MidiSupport; handle?: MidiAccessHandle }> {
  if (!isWebMidiSupported()) return { status: 'unsupported' };
  let access: MIDIAccess;
  try {
    access = await (navigator as Navigator & { requestMIDIAccess(): Promise<MIDIAccess> }).requestMIDIAccess();
  } catch {
    return { status: 'denied' };
  }

  const info = (inp: MIDIInput): MidiDeviceInfo => ({ id: inp.id, name: inp.name ?? '(未命名)', manufacturer: inp.manufacturer ?? '' });
  const list = (): MidiDeviceInfo[] => { const out: MidiDeviceInfo[] = []; access.inputs.forEach((i) => out.push(info(i))); return out; };

  let selectedId: string | null = null;
  const attach = (): void => {
    access.inputs.forEach((inp) => {
      inp.onmidimessage = inp.id === selectedId
        ? (e: MIDIMessageEvent) => { if (e.data) onMessage(parseMidiMessage(e.data)); }
        : null;
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
