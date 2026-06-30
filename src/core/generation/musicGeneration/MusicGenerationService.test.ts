import { describe, it, expect } from 'vitest';
import { generateMusic, generateMotifMusic } from './MusicGenerationService';

// ============================================================
// musicGeneration · MusicGenerationService(Q+N 主链路服务层验收)
// ------------------------------------------------------------
// qn_main_engine_takeover §4:产 MusicalIR(正式音频合同)+ 结构化 uiSnapshot;Band Selection 三态。
// ============================================================

describe('musicGeneration/MusicGenerationService', () => {
  it('★ generateMusic:全风格产 ok + 非空 IR + 结构化 uiSnapshot', async () => {
    for (const styleHint of ['pop', 'jazz', 'lofi', 'rnb', 'acg']) {
      const r = await generateMusic({ seed: 7, styleHint, mood: 'build', targetDuration: 90 });
      expect(r.status, `${styleHint} status`).toBe('ok');
      expect(r.ir, `${styleHint} ir`).toBeTruthy();
      expect(r.ir!.tracks.length, `${styleHint} tracks`).toBeGreaterThan(0);
      expect(r.bpm).toBeGreaterThan(0);
      expect(r.seed).toBe(7);
      expect(r.styleHint).toBe(styleHint);
      // uiSnapshot 结构
      const ui = r.uiSnapshot;
      expect(ui.sections.length, `${styleHint} ui.sections`).toBeGreaterThan(0);
      expect(ui.chords.length, `${styleHint} ui.chords`).toBeGreaterThan(0);
      expect(ui.roster.length, `${styleHint} ui.roster`).toBeGreaterThan(0);
      expect(ui.tracks.length, `${styleHint} ui.tracks`).toBe(r.ir!.tracks.length);
      expect(ui.bpm).toBe(r.bpm);
      expect(typeof ui.key).toBe('string');
      // roster 角色名/乐器名非空
      for (const p of ui.roster) { expect(p.instrumentName.length).toBeGreaterThan(0); expect(['auto', 'selected', 'disabled']).toContain(p.state); }
    }
  });

  it('★ 确定性:同 seed/style 两次产物 IR 轨数 + uiSnapshot 一致', async () => {
    const a = await generateMusic({ seed: 42, styleHint: 'pop', mood: 'build', targetDuration: 90 });
    const b = await generateMusic({ seed: 42, styleHint: 'pop', mood: 'build', targetDuration: 90 });
    expect(JSON.stringify(a.uiSnapshot)).toBe(JSON.stringify(b.uiSnapshot));
    expect(a.ir!.tracks.length).toBe(b.ir!.tracks.length);
  });

  it('★ Band Selection 新语义:participant 限 lineup,不写 TrackIR.program override(§4/§5/§8.3)', async () => {
    const base = await generateMusic({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 90 });
    const req = { seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 90 } as const;

    // disabled drummer → IR 无 drum 轨(职责不生成,非后处理丢轨)
    const noDrum = await generateMusic({ ...req, bandParticipants: [{ role: 'drummer', state: 'disabled' }] });
    expect(noDrum.ir!.tracks.some((t) => t.role === 'drum'), 'disabled drummer → 无 drum').toBe(false);

    // 选 键盘手+贝斯手+鼓手 → 仅这些乐手覆盖的职责;音色仍由器配层定(program 不被锁成用户值)
    const trio = await generateMusic({
      ...req,
      bandParticipants: [
        { role: 'keyboardist', state: 'selected' },
        { role: 'bassist', state: 'selected' },
        { role: 'drummer', state: 'selected' },
      ],
    });
    for (const t of trio.ir!.tracks) expect(['lead', 'comp', 'pad', 'bass', 'drum']).toContain(t.role);
    // bass 音色由器配层 rng 选 → 与默认 base 的 bass program 一致(participant 不改音色,只限 lineup)
    const trioBass = trio.ir!.tracks.find((t) => t.role === 'bass')?.program;
    const baseBass = base.ir!.tracks.find((t) => t.role === 'bass')?.program;
    expect(trioBass, 'participant 不写 program override → 与器配层默认一致').toBe(baseBass);

    // roster 音色 = IR 实际 program(只读),非用户指定
    for (const p of trio.uiSnapshot.roster) {
      const irTrack = trio.ir!.tracks.find((t) => t.role === p.role);
      if (irTrack) expect(p.program).toBe(irTrack.program);
    }
  });

  it('★ 器配层音色随机性保留:同 participants 不同 seed → 可得不同 GM program(§5.2)', async () => {
    const participants = [
      { role: 'keyboardist' as const, state: 'selected' as const },
      { role: 'bassist' as const, state: 'selected' as const },
    ];
    const programs = new Set<string>();
    for (let seed = 0; seed < 16; seed++) {
      const r = await generateMusic({ seed, styleHint: 'pop', mood: 'build', targetDuration: 90, bandParticipants: participants });
      programs.add(r.ir!.tracks.map((t) => `${t.role}:${t.program}`).sort().join('|'));
    }
    expect(programs.size, '不同 seed → 音色世界/GM 有多样性').toBeGreaterThanOrEqual(3);
  });

  it('★ key/mode 字符串 → Q+N:请求 key="D" → uiSnapshot.key 反映', async () => {
    const r = await generateMusic({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 90, key: 'D', mode: 'minor' });
    expect(r.uiSnapshot.key).toBe('D');
    expect(r.status).toBe('ok');
  });

  it('★ generateMotifMusic:无 override 也产完整成曲(ok + 非空 IR + uiSnapshot)', async () => {
    const r = await generateMotifMusic({ seed: 7, styleHint: 'jazz', mood: 'build', targetDuration: 90 }, {});
    expect(r.status).toBe('ok');
    expect(r.ir!.tracks.length).toBeGreaterThan(0);
    expect(r.uiSnapshot.sections.length).toBeGreaterThan(0);
    expect(r.uiSnapshot.chords.length).toBeGreaterThan(0);
  });
});
