// ============================================================
// auraRoaming · auraKeyRuntime(Aura Key 引导模式运行时,单例)
// ------------------------------------------------------------
// 打开 Aura Key 后:
//   · lead 继续播放(LeadTakeoverController 用 nativeLeadMuteEnabled:false,
//     从不产生 lead-mute,也不跑 reconcileNativeLeadMute);
//   · 15 键逻辑与用户接管沙盒一致:亮/未亮的键都能按,发接管乐器音色
//     (channel 15,和弦安全音映射,声音链仍是 AudioEngine → Dream5504);
//   · 每 50ms 轮询播放时钟,对生成曲 lead 重音做提示计划,提前把呼吸灯
//     事件发给 LedMatrix(峰值时刻自带,发送抖动不影响精度);
//   · 判定 Perfect/普通/按偏/无视,维护 combo、律光、律光音轨。
// 只读消费 MusicalIR;不注册 scheduler listener(只读时钟状态)。
// ============================================================

import { AudioEngine } from '../../../core/audio/AudioEngine';
import { globalMidiScheduler } from '../../../core/audio/MidiScheduler';
import { LeadTakeoverController } from '../../../core/generation/leadTakeoverSandbox/leadTakeoverController';
import {
  TAKEOVER_USER_CHANNEL,
  executeLeadTakeoverActions,
  prepareLeadTakeoverVoice,
  resetLeadTakeoverRuntimeState,
  takeoverSnapshotFromMusicGeneration,
} from '../../../core/generation/leadTakeoverSandbox/qhTakeoverConsumer';
import { DREAM5504_DEFAULT_CHANNEL_VOLUME } from '../../../core/generation/newEngine/knowledge/gmMixProfile';
import {
  resetTakeoverPadInputState,
  subscribeTakeoverPadInput,
  type TakeoverPadInputEvent,
} from '../../../core/generation/leadTakeoverSandbox/takeoverInputBus';
import { takeoverPadCoord } from '../../../core/generation/leadTakeoverSandbox/padLayout';
import { modulateTakeoverMidiMessage } from '../../../core/generation/leadTakeoverSandbox/takeoverMidiModulator';
import {
  claimMidiInputExclusive,
  requestMidiAccess,
  type MidiAccessHandle,
  type MidiDeviceInfo,
  type ParsedMidiMessage,
} from '../../../core/generation/motifSandbox/midi/webMidi';
import {
  getTakeoverMidiInputPreference,
  resolveTakeoverMidiInput,
} from '../../../state/TakeoverMidiInputStore';
import type { MusicGenerationResult } from '../../../core/generation/musicGeneration/types';
import { scoreLeadAccents } from '../accent/leadAccents';
import { planCues } from '../cue/cuePlanner';
import { planHarmonicFillCues } from '../cue/harmonicFill';
import { padIndexForPitch } from '../cue/padLookup';
import { classifyPressDelta } from '../judge/judgement';
import {
  INITIAL_LUX_TRAIL_STATE,
  trailOnAttemptMiss,
  trailOnCueSuccess,
  trailOnUnlitPress,
  type LuxTrailState,
} from '../judge/luxTrail';
import {
  getAuraRoamingSnapshot,
  patchAuraRoaming,
  recordAuraJudgement,
  recordAuraTrail,
  resetAuraSession,
} from '../state/auraRoamingStore';
import {
  CUE_FADE_MS,
  CUE_HOLD_MS,
  CUE_HUE,
  CUE_PEAK_LEAD_MS,
  CUE_RISE_MS,
  CUE_SUSTAIN_MAX_MS,
  CUE_SUSTAIN_TAIL_MS,
  DEFAULT_JUDGE_WINDOWS,
  type PlannedCue,
} from '../types';

const POLL_MS = 50;
const SCHEDULE_LOOKAHEAD_MS = 150;
const DEFAULT_PAD_VELOCITY = 112;
/** 亮灯键早按 → 推迟到 lead 正点发声;提前这点量让控制器的
 *  groove/16 分量化(snap 窗 60ms)把音精确落回谱面格点。 */
const SNAP_FIRE_EARLY_MS = 30;
/** 命中打击感:鼓通道(scheduler ch9 → 出板 ch10 GM 鼓组)一次性叠击。
 *  命中用拍手(39)— 与歌曲鼓组的军鼓/踩镲彻底区分;按偏用鼓边边击。 */
const DRUM_CHANNEL = 9;
const GM_HAND_CLAP = 39;
const GM_SIDE_STICK = 37;
/** Aura Key 期间用户接管通道音量:与生成 lead 持平(2026-08-25 用户
 *  裁定,127 对比档听感过响撤销)。仍显式补发 — voice setup 时序防覆盖。 */
const AURA_KEY_USER_CC7 = DREAM5504_DEFAULT_CHANNEL_VOLUME;
/** voice setup 会写 CC7=默认值,延迟这点量再抬,保证 last-writer-wins。 */
const USER_GAIN_BOOST_DELAY_MS = 90;

interface RuntimeCue extends PlannedCue {
  padIndex: number;
  col: number;
  row: number;
  cueState: 'pending' | 'lit' | 'done';
  wallMs: number;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

class AuraKeyRuntime {
  private running = false;
  private controller = new LeadTakeoverController({ nativeLeadMuteEnabled: false });
  private cues: RuntimeCue[] = [];
  private lastResult: MusicGenerationResult | null = null;
  private songReady = false;
  private trail: LuxTrailState = INITIAL_LUX_TRAIL_STATE;
  private ppq = 480;
  private bpm = 120;
  private lastTick = 0;
  private pollTimer: number | null = null;
  private unsubPad: (() => void) | null = null;
  private midiHandle: MidiAccessHandle | null = null;
  private releaseMidiClaim: (() => void) | null = null;
  /** 亮灯键自动时值延音:sourceId → 挂住到几时(timer=已松手在等 note-off)。 */
  private sustains = new Map<string, { untilMs: number; timer: number | null; padIndex: number }>();
  /** 亮灯键早按的贴谱发声:sourceId → 等待发 noteOn 的定时器。 */
  private snapTimers = new Map<string, number>();
  private gainBoostTimer: number | null = null;

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.controller = new LeadTakeoverController({ nativeLeadMuteEnabled: false });
    this.cues = [];
    this.lastResult = null;
    this.songReady = false;
    this.trail = INITIAL_LUX_TRAIL_STATE;
    resetTakeoverPadInputState();
    resetLeadTakeoverRuntimeState(AudioEngine);
    if (AudioEngine.getCurrentMusicGeneration()) prepareLeadTakeoverVoice(AudioEngine);
    this.applyUserGainBoost();
    this.unsubPad = subscribeTakeoverPadInput(this.onPadBusEvent);
    this.pollTimer = window.setInterval(this.poll, POLL_MS);
    resetAuraSession();
    patchAuraRoaming({ auraKeyOn: true, songReady: false, cueTotal: 0 });
    void this.connectMidi();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.unsubPad?.();
    this.unsubPad = null;
    for (const sustain of this.sustains.values()) {
      if (sustain.timer !== null) window.clearTimeout(sustain.timer);
    }
    this.sustains.clear();
    for (const timer of this.snapTimers.values()) window.clearTimeout(timer);
    this.snapTimers.clear();
    if (this.gainBoostTimer !== null) window.clearTimeout(this.gainBoostTimer);
    this.gainBoostTimer = null;
    AudioEngine.controllerChange(TAKEOVER_USER_CHANNEL, 7, DREAM5504_DEFAULT_CHANNEL_VOLUME);
    executeLeadTakeoverActions(AudioEngine, this.controller.reset());
    resetLeadTakeoverRuntimeState(AudioEngine);
    this.emitClear();
    this.disconnectMidi();
    this.cues = [];
    this.songReady = false;
    patchAuraRoaming({ auraKeyOn: false, songReady: false, midiStatus: 'off' });
  }

  // ---- 播放时钟轮询:计划重建 + 亮灯排程 + 过期判 miss ----

  private poll = (): void => {
    const now = nowMs();
    const result = AudioEngine.getCurrentMusicGeneration();
    const playing = globalMidiScheduler.isPlaying && AudioEngine.getCurrentPlaybackKind() === 'generated';

    if (!result || result.status !== 'ok' || !result.ir || !playing) {
      if (this.songReady) {
        this.songReady = false;
        this.emitClear();
        for (const cue of this.cues) if (cue.cueState === 'lit') cue.cueState = 'pending';
        patchAuraRoaming({ songReady: false });
      }
      return;
    }

    if (result !== this.lastResult) this.rebuild(result);
    if (!this.songReady) {
      this.songReady = true;
      patchAuraRoaming({ songReady: true, cueTotal: this.cues.length });
    }

    const currentTick = AudioEngine.getCurrentTick();
    // 重播/回跳:tick 大幅倒退 → 重新武装未来提示,曲首则整局清零
    if (currentTick + this.ppq * 2 < this.lastTick) this.rearm(currentTick);
    this.lastTick = currentTick;

    const ticksPerMs = ((this.bpm / 60) * this.ppq) / 1000;

    for (const cue of this.cues) {
      if (cue.cueState === 'done') continue;
      const wallMs = now + (cue.tick - currentTick) / ticksPerMs;
      cue.wallMs = wallMs;

      if (cue.cueState === 'pending') {
        if (wallMs < now - DEFAULT_JUDGE_WINDOWS.attemptMs) {
          cue.cueState = 'done'; // seek 越过的历史提示不判 miss
          continue;
        }
        // 每个提示独立排灯:统一上升时长,只按自己的峰值时刻倒推起亮点;
        // 与前一个灯是否还亮着无关,窗口重叠就同时呼吸
        const riseStartMs = wallMs - CUE_PEAK_LEAD_MS - CUE_RISE_MS;
        if (riseStartMs <= now + SCHEDULE_LOOKAHEAD_MS) {
          AudioEngine.emitVisualEvent({
            type: 'aura_cue',
            cueId: cue.id,
            col: cue.col,
            row: cue.row,
            hue: CUE_HUE,
            peakAtMs: wallMs - CUE_PEAK_LEAD_MS,
            riseMs: CUE_RISE_MS,
            holdMs: CUE_HOLD_MS,
            fadeMs: CUE_FADE_MS,
          });
          cue.cueState = 'lit';
        }
      } else if (now > wallMs + DEFAULT_JUDGE_WINDOWS.attemptMs + POLL_MS) {
        cue.cueState = 'done';
        recordAuraJudgement('missIgnore'); // 完全没按:清 combo,但不打断律光音轨(A→C 语义)
      }
    }
  };

  private rebuild(result: MusicGenerationResult): void {
    this.lastResult = result;
    const ir = result.ir;
    if (!ir) return;
    this.ppq = AudioEngine.getPpq();
    this.bpm = result.bpm;
    const snapshot = takeoverSnapshotFromMusicGeneration(result);
    this.controller.setSnapshot(snapshot, AudioEngine.getCurrentBeat());
    prepareLeadTakeoverVoice(AudioEngine);
    this.applyUserGainBoost();

    const ts = snapshot.timeSignature;
    const beatsPerBar = Math.max(1, ts[0] * (4 / ts[1]));
    const leadTrack = ir.tracks.find((t) => t.role === 'lead');
    const notes = (leadTrack?.notes ?? []).map((n) => ({
      pitch: n.pitch as number,
      startTick: n.startTick as number,
      durationTicks: n.durationTicks as number,
      velocity: n.velocity,
    }));
    const totalBeats = (ir.durationTicks as number) / this.ppq;
    const accents = scoreLeadAccents(notes, { ppq: this.ppq, beatsPerBar });
    const planned = planCues(accents, { beatsPerBar, totalBeats, seed: result.seed });

    const bound: Array<PlannedCue & { padIndex: number }> = [];
    for (const cue of planned) {
      const cells = this.controller.getPadMap(cue.beat)?.cells ?? [];
      const padIndex = padIndexForPitch(cells, cue.pitch);
      if (padIndex === null) continue; // 布局外的音符不提示(引导必须诚实)
      bound.push({ ...cue, source: 'lead', padIndex });
    }
    // 和声填充:lead 空窗里按当前布局的结构音(强拍)/色彩音(弱拍)补提示,
    // ACG 等旋律稀疏风格的密度救星 — 布局即安全音图,亮谁都和谐
    const fillers = planHarmonicFillCues(bound, {
      beatsPerBar,
      totalBeats,
      seed: result.seed,
      ppq: this.ppq,
      cellsAtBeat: (b) => this.controller.getPadMap(b)?.cells ?? null,
    });
    this.cues = [...bound, ...fillers]
      .sort((a, b) => a.tick - b.tick)
      .map((cue, index) => {
        const { col, row } = takeoverPadCoord(cue.padIndex);
        return { ...cue, id: index, col, row, cueState: 'pending' as const, wallMs: 0 };
      });
    this.trail = INITIAL_LUX_TRAIL_STATE;
    this.lastTick = 0;
    this.emitClear();
    resetAuraSession();
    patchAuraRoaming({ songReady: true, cueTotal: this.cues.length });
    this.songReady = true;
  }

  private rearm(currentTick: number): void {
    this.emitClear();
    for (const cue of this.cues) {
      cue.cueState = cue.tick > currentTick ? 'pending' : 'done';
    }
    this.trail = INITIAL_LUX_TRAIL_STATE;
    if (currentTick < this.ppq) resetAuraSession(); // 从头重播 → 新一局
  }

  private emitClear(): void {
    AudioEngine.emitVisualEvent({ type: 'aura_cue_clear' });
  }

  // ---- 输入(屏幕 pad 总线 + BLE/Web MIDI 位置键) ----

  private onPadBusEvent = (event: TakeoverPadInputEvent): void => {
    if (event.type === 'down') this.onPadDown(event.padIndex, event.atMs, DEFAULT_PAD_VELOCITY, `pad:${event.padIndex}`);
    else this.onPadUp(event.padIndex, `pad:${event.padIndex}`);
  };

  private onMidiMessage = (message: ParsedMidiMessage): void => {
    const positioned = modulateTakeoverMidiMessage(message);
    if (!positioned) return;
    if (positioned.type === 'down') {
      this.onPadDown(positioned.padIndex, nowMs(), positioned.velocity || DEFAULT_PAD_VELOCITY, positioned.sourceId);
    } else {
      this.onPadUp(positioned.padIndex, positioned.sourceId);
    }
  };

  private onPadDown(padIndex: number, atMs: number, velocity: number, sourceId: string): void {
    if (!this.running) return;
    this.flushSustain(sourceId); // 上一次延音/待发声还挂着 → 先收掉,legato 交接
    const beat = AudioEngine.getCurrentBeat();

    if (!this.songReady) {
      executeLeadTakeoverActions(AudioEngine, this.controller.noteOn(padIndex, beat, velocity, sourceId));
      return;
    }

    const latencyOffsetMs = getAuraRoamingSnapshot().latencyOffsetMs;
    const now = nowMs();
    const currentTick = AudioEngine.getCurrentTick();
    const ticksPerMs = ((this.bpm / 60) * this.ppq) / 1000;

    let best: RuntimeCue | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const cue of this.cues) {
      if (cue.cueState !== 'lit' || cue.padIndex !== padIndex) continue;
      const cueWallMs = now + (cue.tick - currentTick) / ticksPerMs;
      const delta = atMs - cueWallMs - latencyOffsetMs;
      if (Math.abs(delta) <= DEFAULT_JUDGE_WINDOWS.attemptMs && Math.abs(delta) < Math.abs(bestDelta)) {
        best = cue;
        bestDelta = delta;
      }
    }

    if (!best) {
      // 未亮键:即按即响(原行为);同时是开着锚点的律光音轨材料
      executeLeadTakeoverActions(AudioEngine, this.controller.noteOn(padIndex, beat, velocity, sourceId));
      this.trail = trailOnUnlitPress(this.trail);
      patchAuraRoaming({ lastPress: `自由 pad${padIndex} · 即发` });
      return;
    }

    best.cueState = 'done';
    const kind = classifyPressDelta(bestDelta) ?? 'missAttempt';

    if (kind === 'missAttempt') {
      // 按偏(早了/晚了两种情况):乐器音色不发声 — 引导音要么正点要么沉默;
      // 只即刻回一记鼓边边击作为"偏了"反馈,收灯但不放命中动效
      this.fireHitPercussion(kind);
      AudioEngine.emitVisualEvent({ type: 'aura_cue_hit', cueId: best.id });
      recordAuraJudgement(kind);
      this.trail = trailOnAttemptMiss(this.trail);
      patchAuraRoaming({ lastPress: `按偏 Δ${Math.round(bestDelta)}ms · 静默+边击` });
      return;
    }

    // 亮灯键贴谱发声:阈值内早按 → 声音推迟到 lead 音符正点;正点后按 → 立即。
    // 命中成功再叠一记鼓击(与音符同一时刻,transient 对齐强化打击感)
    const bestWallMs = now + (best.tick - currentTick) / ticksPerMs;
    const fireInMs = bestWallMs - now - SNAP_FIRE_EARLY_MS;
    if (fireInMs > 5) {
      const timer = window.setTimeout(() => {
        this.snapTimers.delete(sourceId);
        if (!this.running) return;
        executeLeadTakeoverActions(
          AudioEngine,
          this.controller.noteOn(padIndex, AudioEngine.getCurrentBeat(), velocity, sourceId),
        );
        this.fireHitPercussion(kind);
      }, fireInMs);
      this.snapTimers.set(sourceId, timer);
    } else {
      executeLeadTakeoverActions(AudioEngine, this.controller.noteOn(padIndex, beat, velocity, sourceId));
      this.fireHitPercussion(kind);
    }
    patchAuraRoaming({
      lastPress: `${kind === 'perfect' ? 'Perfect' : '普通'} Δ${Math.round(bestDelta)}ms · `
        + `${fireInMs > 5 ? `+${Math.round(fireInMs)}ms 贴谱` : '即发'}${best.source === 'harmonic' ? ' · 和声' : ''}`,
    });
    // 亮灯键自动时值延音:按 lead 音符时值挂住 + legato 尾巴;未亮键不享受
    const cueEndTick = best.tick + best.durationBeats * this.ppq;
    const sustainUntilMs = Math.min(
      now + CUE_SUSTAIN_MAX_MS,
      now + (cueEndTick - currentTick) / ticksPerMs + CUE_SUSTAIN_TAIL_MS,
    );
    if (sustainUntilMs > now) this.sustains.set(sourceId, { untilMs: sustainUntilMs, timer: null, padIndex });
    recordAuraJudgement(kind);
    const trailResult = trailOnCueSuccess(this.trail, best.id, best.beat);
    this.trail = trailResult.state;
    if (trailResult.completedTrail) recordAuraTrail();
    // 带 col/row/hue/energy → LedMatrix 收灯 + 整键爆闪 + 全板波纹
    AudioEngine.emitVisualEvent({
      type: 'aura_cue_hit',
      cueId: best.id,
      col: best.col,
      row: best.row,
      hue: kind === 'perfect' ? 48 : CUE_HUE,
      energy: kind === 'perfect' ? 2.8 : 2.2,
    });
    AudioEngine.emitVisualEvent({
      type: 'custom_particle',
      col: best.col,
      row: best.row,
      hue: kind === 'perfect' ? 48 : CUE_HUE,
      energy: kind === 'perfect' ? 3.6 : 2.8,
      spread: 2.6,
    });
  }

  /** 接管通道音量抬档:在 voice setup(CC7=默认)落地后补发,确保生效。 */
  private applyUserGainBoost(): void {
    if (this.gainBoostTimer !== null) window.clearTimeout(this.gainBoostTimer);
    this.gainBoostTimer = window.setTimeout(() => {
      this.gainBoostTimer = null;
      if (!this.running) return;
      AudioEngine.controllerChange(TAKEOVER_USER_CHANNEL, 7, AURA_KEY_USER_CC7);
    }, USER_GAIN_BOOST_DELAY_MS);
  }

  /** 打击反馈:Perfect=重拍手,普通=轻拍手(与贴谱 noteOn 同刻);
   *  按偏=鼓边边击(即刻,乐器音色不发声,边击是唯一反馈)。 */
  private fireHitPercussion(kind: 'perfect' | 'good' | 'missAttempt'): void {
    const note = kind === 'missAttempt' ? GM_SIDE_STICK : GM_HAND_CLAP;
    const velocity = kind === 'perfect' ? 112 : kind === 'good' ? 88 : 80;
    AudioEngine.noteOn(DRUM_CHANNEL, note, velocity);
    AudioEngine.noteOffAt(DRUM_CHANNEL, note, AudioEngine.getAudioTime() + 0.12);
  }

  private onPadUp(padIndex: number, sourceId: string): void {
    if (!this.running) return;
    const sustain = this.sustains.get(sourceId);
    const now = nowMs();
    if (sustain && sustain.timer === null && sustain.untilMs - now > 40) {
      // 松手但 lead 时值未走完 → note-off 推迟到时值结束(自动延音)
      sustain.timer = window.setTimeout(() => {
        this.sustains.delete(sourceId);
        if (!this.running) return;
        executeLeadTakeoverActions(AudioEngine, this.controller.noteOff(padIndex, AudioEngine.getCurrentBeat(), sourceId));
      }, sustain.untilMs - now);
      return;
    }
    this.sustains.delete(sourceId);
    executeLeadTakeoverActions(AudioEngine, this.controller.noteOff(padIndex, AudioEngine.getCurrentBeat(), sourceId));
  }

  /** 同一 sourceId 再次按下前,把仍在延音等待/待贴谱发声的上一个音收掉。 */
  private flushSustain(sourceId: string): void {
    const snapTimer = this.snapTimers.get(sourceId);
    if (snapTimer !== undefined) {
      window.clearTimeout(snapTimer); // 还没发声就被再次按下 → 直接作废,无需 noteOff
      this.snapTimers.delete(sourceId);
    }
    const sustain = this.sustains.get(sourceId);
    if (!sustain) return;
    this.sustains.delete(sourceId);
    if (sustain.timer !== null) {
      window.clearTimeout(sustain.timer);
      executeLeadTakeoverActions(AudioEngine, this.controller.noteOff(sustain.padIndex, AudioEngine.getCurrentBeat(), sourceId));
    }
  }

  // ---- BLE/Web MIDI 接入(设备偏好与 Q+T 共享) ----

  private async connectMidi(): Promise<void> {
    this.releaseMidiClaim = claimMidiInputExclusive('auraKey');
    const res = await requestMidiAccess(this.onMidiMessage, (devices) => this.selectFromDevices(devices), {
      exclusiveOwner: 'auraKey',
    });
    if (!this.running) {
      res.handle?.dispose();
      this.disconnectMidi();
      return;
    }
    if (res.status !== 'ready' || !res.handle) {
      patchAuraRoaming({ midiStatus: res.status === 'unsupported' ? 'MIDI: 浏览器不支持' : 'MIDI: 未授权' });
      return;
    }
    this.midiHandle = res.handle;
    this.selectFromDevices(res.handle.listInputs());
  }

  private selectFromDevices(devices: MidiDeviceInfo[]): void {
    if (!this.midiHandle) return;
    const preferred = resolveTakeoverMidiInput(devices, getTakeoverMidiInputPreference()) ?? devices[0] ?? null;
    this.midiHandle.selectInput(preferred?.id ?? null);
    patchAuraRoaming({ midiStatus: preferred ? `MIDI: ${preferred.name}` : 'MIDI: 无输入设备' });
  }

  private disconnectMidi(): void {
    this.midiHandle?.dispose();
    this.midiHandle = null;
    this.releaseMidiClaim?.();
    this.releaseMidiClaim = null;
  }
}

const runtime = new AuraKeyRuntime();

export function isAuraKeyOn(): boolean {
  return runtime.isRunning();
}

export function setAuraKeyOn(on: boolean): void {
  if (on) runtime.start();
  else runtime.stop();
}

export function toggleAuraKey(): void {
  setAuraKeyOn(!runtime.isRunning());
}
