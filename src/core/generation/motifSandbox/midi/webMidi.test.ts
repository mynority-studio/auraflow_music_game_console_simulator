import { describe, it, expect } from 'vitest';
import {
  canReceiveMidiInput,
  claimMidiInputExclusive,
  getMidiInputExclusiveOwner,
  inferMidiInputTransport,
  midiInputTransportLabel,
  parseMidiMessage,
  subscribeMidiInputExclusive,
} from './webMidi';
import { MidiMotifRecorder } from '../capture/MidiMotifRecorder';

describe('motifSandbox/webMidi parseMidiMessage', () => {
  it('note on(0x90, vel>0)', () => {
    expect(parseMidiMessage([0x90, 60, 100])).toEqual({ type: 'noteOn', channel: 0, note: 60, velocity: 100 });
    expect(parseMidiMessage([0x95, 64, 80]).channel).toBe(5);
  });
  it('note off(0x80)', () => {
    expect(parseMidiMessage([0x80, 60, 0])).toEqual({ type: 'noteOff', channel: 0, note: 60, velocity: 0 });
  });
  it('velocity-0 note on 视作 note off', () => {
    expect(parseMidiMessage([0x90, 60, 0]).type).toBe('noteOff');
  });
  it('★ CC(0xB0)= controlChange:踏板 CC64 等(note=controller,velocity=value)', () => {
    expect(parseMidiMessage([0xb0, 64, 127])).toEqual({ type: 'controlChange', channel: 0, note: 64, velocity: 127 }); // 踏板踩下
    expect(parseMidiMessage([0xb0, 64, 0]).type).toBe('controlChange'); // 踏板抬起
    expect(parseMidiMessage([0xb3, 7, 100]).channel).toBe(3);
  });
  it('其它消息(clock 等)= other', () => {
    expect(parseMidiMessage([0xf8]).type).toBe('other');
  });
});

describe('motifSandbox/webMidi input device transport', () => {
  it('identifies Bluetooth MIDI names for the device picker without excluding unknown devices', () => {
    expect(inferMidiInputTransport('CME WIDI Master')).toBe('bluetooth');
    expect(inferMidiInputTransport('My Bluetooth MIDI Keyboard')).toBe('bluetooth');
    expect(inferMidiInputTransport('USB MIDI Device')).toBe('usb');
    expect(inferMidiInputTransport('CoreMIDI Port')).toBe('unknown');
    expect(midiInputTransportLabel({ transport: 'bluetooth' })).toBe('BT');
  });
});

describe('motifSandbox/webMidi exclusive input ownership', () => {
  it('announces Q+T takeover ownership and releases it deterministically', () => {
    const seen: Array<'takeover' | null> = [];
    const unsubscribe = subscribeMidiInputExclusive((owner) => seen.push(owner));
    const release = claimMidiInputExclusive('takeover');

    expect(getMidiInputExclusiveOwner()).toBe('takeover');
    release();
    unsubscribe();

    expect(getMidiInputExclusiveOwner()).toBeNull();
    expect(seen).toEqual(['takeover', null]);
  });

  it('delivers input only to Q+T while takeover owns the transport', () => {
    const release = claimMidiInputExclusive('takeover');

    expect(canReceiveMidiInput()).toBe(false);
    expect(canReceiveMidiInput('takeover')).toBe(true);

    release();
    expect(canReceiveMidiInput()).toBe(true);
  });
});

describe('motifSandbox/MidiMotifRecorder', () => {
  it('录 noteOn/noteOff → onset/duration/velocity(注入时钟)', () => {
    let t = 0;
    const rec = new MidiMotifRecorder(() => t);
    rec.start();
    t = 0; rec.noteOn(60, 100);
    t = 500; rec.noteOff(60);
    t = 1000; rec.noteOn(64, 80);
    t = 1400; rec.noteOff(64);
    const notes = rec.stop();
    expect(notes.length).toBe(2);
    expect(notes[0]).toMatchObject({ midi: 60, velocity: 100, onsetMs: 0, durationMs: 500 });
    expect(notes[1]).toMatchObject({ midi: 64, onsetMs: 1000, durationMs: 400 });
  });

  it('未关音符 stop 时补 duration', () => {
    let t = 0;
    const rec = new MidiMotifRecorder(() => t);
    rec.start();
    rec.noteOn(67, 90);
    t = 700;
    const notes = rec.stop();
    expect(notes.length).toBe(1);
    expect(notes[0].durationMs).toBe(700); // 补到 stop
  });

  it('★ 同 pitch 重触发不覆盖旧音(directive Phase 1):noteOn 60@0 / noteOn 60@80 / noteOff 60@160 → 2 个音', () => {
    let t = 0;
    const rec = new MidiMotifRecorder(() => t);
    rec.start();
    t = 0; rec.noteOn(60, 100);
    t = 80; rec.noteOn(60, 90);   // 同 pitch 重触发 → 先 commit 旧音(onset0)再开新音(onset80)
    t = 160; rec.noteOff(60);
    const notes = rec.stop();
    expect(notes.length).toBe(2);
    expect(notes[0]).toMatchObject({ midi: 60, onsetMs: 0 });   // 旧音保留(onset 0)
    expect(notes[1]).toMatchObject({ midi: 60, onsetMs: 80 });  // 新音(onset 80)
    expect(notes[0].durationMs).toBeGreaterThanOrEqual(60);     // 旧音 ≥ MIN_DUR
    expect(notes[1].durationMs).toBeGreaterThanOrEqual(60);
  });

  it('超过 4 秒的 noteOn 自动停止', () => {
    let t = 0;
    const rec = new MidiMotifRecorder(() => t);
    rec.start({ maxMs: 4000 });
    t = 0; rec.noteOn(60, 100); t = 500; rec.noteOff(60);
    t = 4200; const stopped = rec.noteOn(72, 100); // 超时
    expect(stopped).toBe(true);
    expect(rec.isActive()).toBe(false);
  });
});
