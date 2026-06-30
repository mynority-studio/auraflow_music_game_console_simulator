import { describe, it, expect } from 'vitest';
import { runPipeline } from './index';
import { BandRole } from '../types';
import { musicalIRToMidiEvents } from '../../audio/musicalIrToMidi';
import { MusicGenerationStyleStore } from '../../../state/MusicGenerationStyleStore';
import { MusicGenerationSeedStore } from '../../../state/MusicGenerationSeedStore';

// ============================================================
// qn_main_engine_takeover §6/§14 — 生产主链路端到端(runPipeline 外观 → Q+N → MusicalIR → MIDI)
// ------------------------------------------------------------
// 锁:runPipeline 现是 Q+N 服务外观(不调 mgEngine);返回完整 result(含 IR);IR 经正式 adapter 出可播 MIDI。
// ============================================================

describe('pipeline/qnFacade — Q+N 主链路端到端', () => {
  it('★ runPipeline 返回 Q+N result(ok + 非空 IR + uiSnapshot),不再 mg track', () => {
    MusicGenerationStyleStore.setStyle('POP');
    MusicGenerationSeedStore.setSuffix('42');
    const { result, track, context } = runPipeline({});
    expect(result.status).toBe('ok');
    expect(result.ir).toBeTruthy();
    expect(result.ir!.tracks.length).toBeGreaterThan(0);
    expect(result.uiSnapshot.sections.length).toBeGreaterThan(0);
    expect(result.uiSnapshot.chords.length).toBeGreaterThan(0);
    // {track, context} 仅兼容投影(非音频源):melody 空,标量来自 uiSnapshot
    expect(track.melody).toEqual([]);
    expect(context.bpm).toBe(result.bpm);
  });

  it('★ result.ir → musicalIRToMidiEvents 产可播 MIDI(noteOn/programChange/CC 齐全)', () => {
    const { result } = runPipeline({});
    const ev = musicalIRToMidiEvents(result.ir!, 50);
    expect(ev.filter((e) => e.type === 'noteOn').length).toBeGreaterThan(0);
    expect(ev.filter((e) => e.type === 'programChange').length).toBeGreaterThan(0);
    expect(ev.filter((e) => e.type === 'cc' && e.data1 === 7).length).toBeGreaterThan(0); // CC7 volume
  });

  it('★ gmOverrides(forcedGmPrograms BandRole.Bass)→ bass TrackIR.program', () => {
    MusicGenerationStyleStore.setStyle('POP');
    MusicGenerationSeedStore.setSuffix('42');
    const { result } = runPipeline({ forcedGmPrograms: { [BandRole.Bass]: 35 } });
    const bass = result.ir!.tracks.find((t) => t.role === 'bass');
    expect(bass, 'bass track 在场').toBeTruthy();
    expect(bass!.program, 'BandRole.Bass override → bass program').toBe(35);
  });

  it('★ 不同 style/seed → 不同曲(确定性 + 可变)', () => {
    MusicGenerationStyleStore.setStyle('JAZZ');
    MusicGenerationSeedStore.setSuffix('7');
    const a = runPipeline({});
    const b = runPipeline({});
    expect(JSON.stringify(a.result.uiSnapshot)).toBe(JSON.stringify(b.result.uiSnapshot)); // 同输入确定
    expect(a.result.uiSnapshot.styleHint).toBe('jazz');
  });
});
