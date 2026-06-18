import { describe, it, expect } from 'vitest';
import { parseMidiMessage } from './webMidi';
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
