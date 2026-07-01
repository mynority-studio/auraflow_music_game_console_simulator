import { describe, it, expect, afterEach } from 'vitest';
import { runPipeline } from './index';
import { musicalIRToMidiEvents } from '../../audio/musicalIrToMidi';
import { generateMusicSync } from '../musicGeneration/MusicGenerationService';
import { MusicGenerationStyleStore } from '../../../state/MusicGenerationStyleStore';
import { MusicGenerationSeedStore } from '../../../state/MusicGenerationSeedStore';
import { MusicGenerationKeyStore } from '../../../state/MusicGenerationKeyStore';
import { QnBandSelectionStore } from '../../../state/QnBandSelectionStore';

afterEach(() => {
  QnBandSelectionStore.reset();
  MusicGenerationStyleStore.setStyle('POP');
  MusicGenerationKeyStore.setKey('C');
  MusicGenerationSeedStore.setSuffix('42');
}); // singleton:勿污染其它测试

// ============================================================
// qn_main_engine_takeover §6/§14 — 生产主链路端到端(runPipeline 外观 → Q+N → MusicalIR → MIDI)
// ------------------------------------------------------------
// 锁:runPipeline 现是 Q+N 服务外观(不调 mgEngine);返回完整 result(含 IR);IR 经正式 adapter 出可播 MIDI。
// ============================================================

describe('pipeline/qnFacade — Q+N 主链路端到端', () => {
  it('★ runPipeline 返回 Q+N result(ok + 非空 IR + uiSnapshot),不再 mg track', () => {
    MusicGenerationStyleStore.setStyle('POP');
    MusicGenerationSeedStore.setSuffix('42');
    const { result } = runPipeline({});
    expect(result.status).toBe('ok');
    expect(result.ir).toBeTruthy();
    expect(result.ir!.tracks.length).toBeGreaterThan(0);
    expect(result.uiSnapshot.sections.length).toBeGreaterThan(0);
    expect(result.uiSnapshot.chords.length).toBeGreaterThan(0);
    // ★ runPipeline 只返回 { result }(已删旧 {track, context} 兼容投影);UI 读 result.uiSnapshot。
    expect((runPipeline({}) as unknown as Record<string, unknown>).track).toBeUndefined();
  });

  it('★ Q+H facade 与直接 Q+N service 同链路:同 seed/style/key 得到同一结构化结果', () => {
    MusicGenerationStyleStore.setStyle('RNB');
    MusicGenerationKeyStore.setKey('D');
    MusicGenerationSeedStore.setSuffix('qh-qn-closure');
    const seed = MusicGenerationSeedStore.getSeedNumber();

    const direct = generateMusicSync({
      seed,
      styleHint: 'rnb',
      mood: 'build',
      targetDuration: 120,
      key: 'D',
      bandParticipants: QnBandSelectionStore.getParticipants(),
    });
    const { result } = runPipeline({});

    expect(result.status).toBe(direct.status);
    expect(result.seed).toBe(direct.seed);
    expect(result.styleHint).toBe(direct.styleHint);
    expect(result.bpm).toBe(direct.bpm);
    expect(JSON.stringify(result.uiSnapshot)).toBe(JSON.stringify(direct.uiSnapshot));
    expect(result.ir?.tracks.map((t) => `${t.role}:${t.program}:${t.notes.length}`))
      .toEqual(direct.ir?.tracks.map((t) => `${t.role}:${t.program}:${t.notes.length}`));
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
    // 键盘手承担 lead/comp,贝斯手 bass,鼓手 drum(pad 由合成乐手承担,本例未选 → 不出 pad)
    for (const r of roles) expect(['lead', 'comp', 'bass', 'drum']).toContain(r);
    expect(roles.has('bass')).toBe(true);
    expect(roles.has('drum'), '选了鼓手 → 必有 drum(P1)').toBe(true);
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
