// Aura Key 发声链回归:控制器 noteOn/noteOff → executeLeadTakeoverActions 必须成对出声(ch15)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadTakeoverController } from '../../../core/generation/leadTakeoverSandbox/leadTakeoverController';
import {
  executeLeadTakeoverActions,
  prepareLeadTakeoverVoice,
  resetLeadTakeoverRuntimeState,
} from '../../../core/generation/leadTakeoverSandbox/qhTakeoverConsumer';
import type { TakeoverMusicSnapshot } from '../../../core/generation/leadTakeoverSandbox/types';

function makeTarget() {
  const sent: string[] = [];
  let tick = 4 * 480;
  return {
    sent,
    setTick(t: number) { tick = t; },
    getCurrentTick: () => tick,
    getPpq: () => 480,
    getCurrentMusicGeneration: () => null,
    getAudioTime: () => performance.now() / 1000,
    injectMidiEvent: (e: { type: string; channel: number; data1: number; data2: number }) => {
      sent.push(`inject:${e.type}:${e.channel}:${e.data1}:${e.data2}`);
    },
    noteOn: (ch: number, midi: number, vel: number) => sent.push(`noteOn:${ch}:${midi}:${vel}`),
    noteOnAt: (ch: number, midi: number, vel: number) => sent.push(`noteOnAt:${ch}:${midi}:${vel}`),
    noteOff: (ch: number, midi: number) => sent.push(`noteOff:${ch}:${midi}`),
    noteOffAt: (ch: number, midi: number) => sent.push(`noteOffAt:${ch}:${midi}`),
    controllerChange: (ch: number, cc: number, v: number) => sent.push(`cc:${ch}:${cc}:${v}`),
    controllerChangeAt: (ch: number, cc: number, v: number) => sent.push(`ccAt:${ch}:${cc}:${v}`),
    programChange: (ch: number, p: number) => sent.push(`pc:${ch}:${p}`),
  };
}

const SNAPSHOT: TakeoverMusicSnapshot = {
  styleHint: 'pop',
  key: 'C',
  tonality: 'major',
  bpm: 100,
  timeSignature: [4, 4],
  chords: [
    { rootPc: 0, quality: 'maj', startBeat: 0, durationBeats: 8 },
    { rootPc: 5, quality: 'maj', startBeat: 8, durationBeats: 8 },
  ],
  source: 'generated',
};

describe('auraKey 诊断:成功命中链路发声', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('noteOn → execute → 延迟窗口后必须有音高 noteOn 出现在 ch15', () => {
    const target = makeTarget();
    resetLeadTakeoverRuntimeState(target);
    prepareLeadTakeoverVoice(target);
    const controller = new LeadTakeoverController({ nativeLeadMuteEnabled: false });
    controller.setSnapshot(SNAPSHOT, 4);

    const onActions = controller.noteOn(7, 4.02, 112, 'pad:7');
    executeLeadTakeoverActions(target, onActions);
    vi.advanceTimersByTime(300);
    const noteOns = target.sent.filter((s) => s.startsWith('noteOn') && s.includes(':15:'));
    expect(noteOns.length).toBeGreaterThan(0);

    const offActions = controller.noteOff(7, 5.5, 'pad:7');
    executeLeadTakeoverActions(target, offActions);
    vi.advanceTimersByTime(300);
    const noteOffs = target.sent.filter((s) => s.startsWith('noteOff') && s.includes(':15:'));
    expect(noteOffs.length).toBeGreaterThan(0);
  });

  it('模拟延音场景:down→up(推迟 off)→snap noteOn→延音 off 全链平衡', () => {
    const target = makeTarget();
    resetLeadTakeoverRuntimeState(target);
    const controller = new LeadTakeoverController({ nativeLeadMuteEnabled: false });
    controller.setSnapshot(SNAPSHOT, 4);

    // 连续三次命中(模拟用户打了三个提示),每次 down/off 成对
    for (let i = 0; i < 3; i++) {
      const beat = 4 + i;
      executeLeadTakeoverActions(target, controller.noteOn(7, beat + 0.02, 112, 'pad:7'));
      vi.advanceTimersByTime(200);
      executeLeadTakeoverActions(target, controller.noteOff(7, beat + 0.6, 'pad:7'));
      vi.advanceTimersByTime(200);
    }
    const ons = target.sent.filter((s) => s.startsWith('noteOn') && s.includes(':15:'));
    const offs = target.sent.filter((s) => s.startsWith('noteOff') && s.includes(':15:'));
    expect(ons.length).toBeGreaterThanOrEqual(3);
    expect(offs.length).toBeGreaterThanOrEqual(3);
  });
});
