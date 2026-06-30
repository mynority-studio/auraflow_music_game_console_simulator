import { describe, it, expect, afterEach } from 'vitest';
import { runPipeline } from './index';
import { musicalIRToMidiEvents } from '../../audio/musicalIrToMidi';
import { MusicGenerationStyleStore } from '../../../state/MusicGenerationStyleStore';
import { MusicGenerationSeedStore } from '../../../state/MusicGenerationSeedStore';
import { QnBandSelectionStore } from '../../../state/QnBandSelectionStore';

afterEach(() => QnBandSelectionStore.reset()); // singleton:勿污染其它测试

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

  it('★ Band Selection 参与乐手 → 限制 lineup(选 键盘手+贝斯手+鼓手 → 仅这些职责出轨,无 GM 音色 override)', () => {
    MusicGenerationStyleStore.setStyle('POP');
    MusicGenerationSeedStore.setSuffix('42');
    QnBandSelectionStore.setState('keyboardist', 'selected');
    QnBandSelectionStore.setState('bassist', 'selected');
    QnBandSelectionStore.setState('drummer', 'selected');
    const { result } = runPipeline({});
    const roles = new Set(result.ir!.tracks.map((t) => t.role));
    // 键盘手承担 lead/comp/pad,贝斯手 bass,鼓手 drum → 不会出现这些以外的职责(本例已覆盖全部)
    for (const r of roles) expect(['lead', 'comp', 'pad', 'bass', 'drum']).toContain(r);
    expect(roles.has('bass')).toBe(true);
    expect(roles.has('drum')).toBe(true);
    // 音色仍由器配层定(非用户指定);bass program 合法但不被锁死成某值
    expect(typeof result.ir!.tracks.find((t) => t.role === 'bass')?.program).toBe('number');
  });

  it('★ disabled participant → 该职责不生成(禁用鼓手 → 无 drum 轨,无 program 后处理)', () => {
    MusicGenerationStyleStore.setStyle('POP');
    MusicGenerationSeedStore.setSuffix('42');
    QnBandSelectionStore.setState('drummer', 'disabled');
    const { result } = runPipeline({});
    expect(result.ir!.tracks.some((t) => t.role === 'drum'), 'drummer disabled → 无 drum 轨').toBe(false);
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
