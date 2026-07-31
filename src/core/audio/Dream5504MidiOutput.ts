// ============================================================
// Dream5504MidiOutput
// ------------------------------------------------------------
// Core Web MIDI sink for the Dream 5504 EK hardware path. UI panels only
// control this singleton; generated playback, live notes, uploaded MIDI and
// auditions all leave the browser as MIDI bytes and never require WebAudio.
// ============================================================

import { globalMidiScheduler, type MidiEvent } from './MidiScheduler';
import { DREAM5504_DEFAULT_MASTER_VOLUME } from './masteringProfile';
import {
  DEFAULT_CHANNELS,
  DREAM5504_RAW_DEFAULT_OUTPUT,
  MIDI_OUT_TRACKS,
  isDream5504RawDefaultMessageAllowed,
  midiEventToRoutedMessage,
  requestMidiOutputAccess,
  registerMidiPolyphonyAuditionSender,
  resolveOutputChannel,
  resolveSchedulerOutputChannel,
  schedulerChannelToRole,
  sendMidiMessage,
  sendDream5504NeutralOutputBaseline,
  sendNrpn7,
  sendNotes,
  sendPanic,
  type MidiOutputAccessHandle,
  type MidiOutDeviceInfo,
  type MidiOutputMode,
  type MidiOutMessage,
  type MidiOutRole,
  type MidiOutSupport,
  type MidiPolyphonyAudition,
} from '../generation/midiOutSandbox/midiOut';

type MidiStatus = MidiOutSupport | 'idle';
type RoleMap<T> = Record<MidiOutRole, T>;
type Listener = () => void;

export interface Dream5504MidiState {
  status: MidiStatus;
  armed: boolean;
  outputs: MidiOutDeviceInfo[];
  mode: MidiOutputMode;
  singleOutputId: string | null;
  roleOutputs: RoleMap<string | null>;
  channels: RoleMap<number>;
  eventCount: number;
  lastEvent: string;
  silentReason: string | null;
}

const emptyRoleMap = <T,>(value: T): RoleMap<T> => MIDI_OUT_TRACKS.reduce(
  (acc, track) => ({ ...acc, [track.role]: value }),
  {} as RoleMap<T>,
);

function defaultRouteMap(outputs: MidiOutDeviceInfo[]): RoleMap<string | null> {
  return MIDI_OUT_TRACKS.reduce((acc, track) => {
    const roleName = track.role.toLowerCase();
    const label = track.label.toLowerCase();
    const matched = outputs.find((d) => {
      const name = `${d.name} ${d.manufacturer}`.toLowerCase();
      return name.includes(roleName) || name.includes(label) || name.includes('dream') || name.includes('5504');
    });
    acc[track.role] = matched?.id ?? outputs[0]?.id ?? null;
    return acc;
  }, {} as RoleMap<string | null>);
}

function hasSelectedOutput(outputs: MidiOutDeviceInfo[], id: string | null): boolean {
  return !!id && outputs.some((d) => d.id === id);
}

function clampChannel(v: number): number {
  return Math.max(1, Math.min(16, Math.round(v || 1)));
}

function clamp7(v: number): number {
  return Math.max(0, Math.min(127, Math.round(v)));
}

function schedulerChannelToOutputRole(channel: number): MidiOutRole {
  return schedulerChannelToRole(channel) ?? (channel === 0 ? 'lead' : 'lead');
}

class Dream5504MidiOutputController {
  private state: Dream5504MidiState = {
    status: 'idle',
    armed: false,
    outputs: [],
    mode: 'single-port',
    singleOutputId: null,
    roleOutputs: emptyRoleMap<string | null>(null),
    channels: DEFAULT_CHANNELS,
    eventCount: 0,
    lastEvent: '等待 Dream 5504 MIDI 输出',
    silentReason: '未连接 Dream 5504 EK：已静音',
  };

  private handle: MidiOutputAccessHandle | null = null;
  private listeners = new Set<Listener>();
  private schedulerUnsubscribe: (() => void) | null = null;
  private schedulerQueueClearUnsubscribe: (() => void) | null = null;
  private outputCache = new Map<string, MIDIOutput>();
  private lastSilentMarkMs = 0;
  private lastUiUpdateMs = 0;

  constructor() {
    this.attachSchedulerBridge();
    registerMidiPolyphonyAuditionSender((request) => this.sendPolyphonyAudition(request));
  }

  public getState(): Dream5504MidiState {
    return {
      ...this.state,
      outputs: [...this.state.outputs],
      roleOutputs: { ...this.state.roleOutputs },
      channels: { ...this.state.channels },
    };
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public isReady(): boolean {
    return this.state.armed && !!this.currentRoutedOutputs().length;
  }

  public requireReady(context = '播放'): boolean {
    if (this.isReady()) return true;
    this.markSilent(`${context}需要 Dream 5504 EK MIDI 输出：未连接，已静音`);
    return false;
  }

  public async enableMidi(): Promise<void> {
    const result = await requestMidiOutputAccess((devices) => this.applyDeviceList(devices));
    this.handle = result.handle ?? null;
    this.outputCache.clear();
    this.setState({ status: result.status });
    if (result.status === 'ready') {
      const devices = result.handle?.listOutputs() ?? [];
      this.applyDeviceList(devices);
      await this.enableOutput();
    } else if (result.status === 'unsupported') {
      this.markSilent('当前浏览器不支持 Web MIDI：Dream 5504 输出不可用，已静音');
    } else {
      this.markSilent('MIDI 未授权：Dream 5504 输出不可用，已静音');
    }
  }

  public async enableOutput(): Promise<void> {
    if (this.state.status === 'idle') {
      await this.enableMidi();
      return;
    }
    if (this.state.status !== 'ready' || !this.canArm()) {
      this.markSilent(this.state.mode === 'five-port' ? '先给 5 轨选择 MIDI 输出端口：已静音' : '先选择 Dream 5504 MIDI 输出端口：已静音');
      return;
    }
    const ids = this.state.mode === 'single-port'
      ? [this.state.singleOutputId]
      : MIDI_OUT_TRACKS.map((track) => this.state.roleOutputs[track.role]);
    try {
      const opened = await Promise.all([...new Set(ids)].map((id) => this.handle?.openOutput(id) ?? null));
      if (opened.some((output) => !output)) {
        this.markSilent('MIDI 端口打开失败：已静音');
        return;
      }
      this.setState({
        armed: true,
        silentReason: null,
        eventCount: 0,
        lastEvent: 'Dream 5504 MIDI 输出已开启',
      });
    } catch (error) {
      this.markSilent(`MIDI 端口打开失败：${error instanceof Error ? error.message : 'unknown'}，已静音`);
    }
  }

  public disableOutput(): void {
    this.applyDefaultMasterVolume();
    this.panic();
    this.setState({ armed: false });
    this.markSilent('Dream 5504 MIDI 输出已关闭：已静音');
  }

  public refreshOutputs(): void {
    this.applyDeviceList(this.handle?.listOutputs() ?? []);
  }

  public setMode(mode: MidiOutputMode): void {
    this.setState({ mode });
  }

  public setSingleOutputId(id: string | null): void {
    this.setState({ singleOutputId: id || null });
  }

  public setRoleOutput(role: MidiOutRole, id: string | null): void {
    this.setState({ roleOutputs: { ...this.state.roleOutputs, [role]: id || null } });
  }

  public setChannel(role: MidiOutRole, channel: number): void {
    this.setState({ channels: { ...this.state.channels, [role]: clampChannel(channel) } });
  }

  public panic(): void {
    const now = performance.now();
    for (const output of this.currentRoutedOutputs()) {
      try {
        (output as MIDIOutput & { clear?: () => void }).clear?.();
        sendPanic(output, now);
      } catch { /* best effort */ }
    }
    this.setState({ lastEvent: 'panic sent' });
  }

  /** DREAM 官方 GM2 固件：NRPN 3707h = General Master Volume。 */
  public setGeneralMasterVolume(value: number): void {
    if (DREAM5504_RAW_DEFAULT_OUTPUT) {
      this.setState({ lastEvent: 'Raw default：忽略 Master Volume NRPN' });
      return;
    }
    if (!this.requireReady('设置 Dream 5504 Master Volume')) return;
    const now = performance.now();
    for (const output of this.currentRoutedOutputs()) {
      try { sendNrpn7(output, 1, 0x3707, clamp7(value), now); } catch { /* best effort */ }
    }
    this.setState({ lastEvent: `Dream 5504 Master Volume ${clamp7(value)}` });
  }

  /**
   * Establish the Firm5504 power-up General Master Volume unconditionally.
   * Playback branches call this at their boundary because an uploaded SMF may
   * have changed the board's NRPN state.
   */
  public applyDefaultMasterVolume(): boolean {
    if (!this.requireReady('恢复 Dream 5504 默认 Master')) return false;
    const now = performance.now();
    for (const output of this.currentRoutedOutputs()) {
      try { sendNrpn7(output, 1, 0x3707, DREAM5504_DEFAULT_MASTER_VOLUME, now); } catch { /* best effort */ }
    }
    this.setState({ lastEvent: `Dream 5504 Master default ${DREAM5504_DEFAULT_MASTER_VOLUME}` });
    return true;
  }

  /** Firm5504-EK 官方 NRPN：关闭总 EQ，并把板载输出级固定在 0 dB。 */
  public setNeutralOutputBaseline(): void {
    if (DREAM5504_RAW_DEFAULT_OUTPUT) {
      this.setState({ lastEvent: 'Raw default：忽略 EQ / Front Gain NRPN' });
      return;
    }
    if (!this.requireReady('设置 Dream 5504 中性输出基线')) return;
    const now = performance.now();
    for (const output of this.currentRoutedOutputs()) {
      try { sendDream5504NeutralOutputBaseline(output, now); } catch { /* best effort */ }
    }
    this.setState({ lastEvent: 'Dream 5504 EQ OFF · Front 0 dB' });
  }

  public pingRole(role: MidiOutRole): boolean {
    const track = MIDI_OUT_TRACKS.find((candidate) => candidate.role === role);
    if (!track) return false;
    const ok = this.sendRoleNotes(role, [track.testNote], 110, 360);
    this.setState({ lastEvent: ok ? `${track.label} ping` : `${track.label} no route` });
    return ok;
  }

  public sendSchedulerChannelMessage(
    channel0: number,
    message: Omit<MidiOutMessage, 'channel'>,
    timestampMs?: number,
  ): boolean {
    if (!this.requireReady('实时演奏')) return false;
    const role = schedulerChannelToOutputRole(channel0);
    const output = this.outputForRole(role);
    if (!output) {
      this.markSilent(`${role} 没有 MIDI 输出路由：已静音`);
      return false;
    }
    const channel = resolveSchedulerOutputChannel(channel0, this.state.mode, this.state.channels);
    const routedMessage = { ...message, channel } as MidiOutMessage;
    if (!isDream5504RawDefaultMessageAllowed(routedMessage, role)) return true;
    try {
      sendMidiMessage(output, routedMessage, timestampMs);
      this.incrementEvent(`${role} · ch ${channel} · ${message.type}`);
      return true;
    } catch {
      this.markSilent(`${role} MIDI 发送失败：已静音`);
      return false;
    }
  }

  public sendPolyphonyAudition(request: MidiPolyphonyAudition): boolean {
    if (!this.requireReady('音色试听')) return false;
    const output = this.outputForRole(request.role);
    if (!output) {
      this.markSilent(`${request.role} 没有 MIDI 输出路由：已静音`);
      return false;
    }
    const channel = resolveOutputChannel(request.role, this.state.mode, this.state.channels);
    const bank = clamp7(request.bank);
    try {
      if (request.role !== 'drum') {
        sendMidiMessage(output, { type: 'cc', channel, data1: 0, data2: bank });
      }
      sendMidiMessage(output, { type: 'programChange', channel, data1: clamp7(request.program) });
      sendNotes(output, channel, request.notes, request.velocity, request.durationMs);
      this.incrementEvent(`${request.role} · MIDI 原始复音测试 · ${request.durationMs}ms`, request.notes.length * 2 + (request.role === 'drum' ? 1 : 2));
      return true;
    } catch {
      this.markSilent(`${request.role} MIDI 复音测试发送失败：已静音`);
      return false;
    }
  }

  private attachSchedulerBridge(): void {
    if (!this.schedulerUnsubscribe) {
      this.schedulerUnsubscribe = globalMidiScheduler.addMidiEventListener(
        (event, timestampMs) => this.routeSchedulerEvent(event, timestampMs),
      );
    }
    if (!this.schedulerQueueClearUnsubscribe) {
      this.schedulerQueueClearUnsubscribe = globalMidiScheduler.addMidiQueueClearListener(
        () => this.clearScheduledMessages(),
      );
    }
  }

  private routeSchedulerEvent(event: MidiEvent, timestampMs?: number): void {
    if (!this.state.armed) {
      this.markSilent('播放需要 Dream 5504 EK MIDI 输出：未连接，已静音');
      return;
    }
    const routed = midiEventToRoutedMessage(event, this.state.channels, this.state.mode);
    if (!routed) return;
    const output = this.outputForRole(routed.role);
    if (!output) {
      this.markSilent(`${routed.role} 没有 MIDI 输出路由：已静音`);
      return;
    }
    try {
      // Uploaded SMF events carry an explicit hardware-channel claim and own
      // their file-authored CC/pitch-bend stream. Generated/live events do not,
      // so they remain behind the strict Firm5504 default-output contract.
      const isUploadedMidiBus = event.outputChannel !== undefined;
      if (!isUploadedMidiBus && !isDream5504RawDefaultMessageAllowed(routed.message, routed.role, event.outputPolicy)) return;
      sendMidiMessage(output, routed.message, timestampMs);
      this.incrementEvent(`${routed.role} · ch ${routed.message.channel} · ${routed.message.type}`);
    } catch {
      this.markSilent(`${routed.role} MIDI 发送失败：已静音`);
    }
  }

  private sendRoleNotes(role: MidiOutRole, pitches: readonly number[], velocity: number, durationMs: number): boolean {
    if (!this.requireReady(`${role} ping`)) return false;
    const output = this.outputForRole(role);
    if (!output) return false;
    const channel = resolveOutputChannel(role, this.state.mode, this.state.channels);
    try {
      sendNotes(output, channel, pitches, velocity, durationMs);
      this.incrementEvent(`${role} ping`, pitches.length * 2);
      return true;
    } catch {
      this.markSilent(`${role} ping 发送失败：已静音`);
      return false;
    }
  }

  private canArm(): boolean {
    if (this.state.status !== 'ready') return false;
    if (this.state.mode === 'single-port') return hasSelectedOutput(this.state.outputs, this.state.singleOutputId);
    return MIDI_OUT_TRACKS.every((track) => hasSelectedOutput(this.state.outputs, this.state.roleOutputs[track.role]));
  }

  private outputForRole(role: MidiOutRole): MIDIOutput | null {
    const id = this.state.mode === 'single-port' ? this.state.singleOutputId : this.state.roleOutputs[role];
    return this.outputForId(id);
  }

  private outputForId(id: string | null): MIDIOutput | null {
    if (!id) return null;
    const cached = this.outputCache.get(id);
    if (cached) return cached;
    const output = this.handle?.getOutput(id) ?? null;
    if (output) this.outputCache.set(id, output);
    return output;
  }

  private clearScheduledMessages(): void {
    for (const output of this.currentRoutedOutputs()) {
      try { (output as MIDIOutput & { clear?: () => void }).clear?.(); } catch { /* best effort */ }
    }
  }

  private currentRoutedOutputs(): MIDIOutput[] {
    if (!this.handle) return [];
    const ids = new Set<string>();
    for (const track of MIDI_OUT_TRACKS) {
      const id = this.state.mode === 'single-port' ? this.state.singleOutputId : this.state.roleOutputs[track.role];
      if (id) ids.add(id);
    }
    const out: MIDIOutput[] = [];
    ids.forEach((id) => {
      const output = this.outputForId(id);
      if (output) out.push(output);
    });
    return out;
  }

  private applyDeviceList(devices: MidiOutDeviceInfo[]): void {
    this.outputCache.clear();
    const fallback = defaultRouteMap(devices);
    const singleOutputId = hasSelectedOutput(devices, this.state.singleOutputId)
      ? this.state.singleOutputId
      : devices.find((device) => /dream|5504/i.test(`${device.name} ${device.manufacturer}`))?.id ?? devices[0]?.id ?? null;
    const roleOutputs = MIDI_OUT_TRACKS.reduce((acc, track) => {
      const current = this.state.roleOutputs[track.role];
      acc[track.role] = hasSelectedOutput(devices, current) ? current : fallback[track.role];
      return acc;
    }, {} as RoleMap<string | null>);
    this.setState({
      outputs: devices,
      singleOutputId,
      roleOutputs,
      lastEvent: `${devices.length} MIDI outputs`,
      silentReason: devices.length ? this.state.silentReason : '未找到 Dream 5504 MIDI 输出：已静音',
    });
  }

  private incrementEvent(lastEvent: string, count = 1): void {
    const nextCount = this.state.eventCount + count;
    const now = performance.now();
    if (now - this.lastUiUpdateMs > 120 || count !== 1) {
      this.lastUiUpdateMs = now;
      this.setState({ eventCount: nextCount, lastEvent, silentReason: null });
    } else {
      this.state.eventCount = nextCount;
    }
  }

  private markSilent(reason: string): void {
    const now = performance.now();
    if (now - this.lastSilentMarkMs < 500 && this.state.silentReason === reason) return;
    this.lastSilentMarkMs = now;
    this.setState({
      armed: false,
      silentReason: reason,
      lastEvent: reason,
    });
  }

  private setState(patch: Partial<Dream5504MidiState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => {
      try { listener(); } catch { /* ignore */ }
    });
  }
}

export const Dream5504MidiOutput = new Dream5504MidiOutputController();
