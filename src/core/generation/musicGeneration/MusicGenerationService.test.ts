import { describe, it, expect } from 'vitest';
import { generateMusic, generateMotifMusic } from './MusicGenerationService';
import { instrumentInfo } from '../newEngine/knowledge/instruments';

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
      expect(ui.grooveContract?.id, `${styleHint} ui.grooveContract`).toBeTruthy();
      expect(ui.grooveContract?.melodyWeakPocketMs.length, `${styleHint} melody pocket`).toBe(2);
      expect(Object.keys(ui.grooveContractBySection ?? {}).length, `${styleHint} section groove`).toBe(ui.sections.length);
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

  it('★ P1:selected 乐手【必出声】—— seed=7 键盘手+贝斯手+鼓手 必含 drum;鼓手 only 必含 drum+自动 lead', async () => {
    const req = { seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 90 } as const;

    const trio = await generateMusic({
      ...req,
      bandParticipants: [
        { role: 'keyboardist', state: 'selected' },
        { role: 'bassist', state: 'selected' },
        { role: 'drummer', state: 'selected' },
      ],
    });
    const trioRoles = new Set(trio.ir!.tracks.map((t) => t.role));
    expect(trioRoles.has('drum'), 'seed=7 选了鼓手 → 必有 drum').toBe(true);
    expect(trioRoles.has('bass')).toBe(true);
    expect(trioRoles.has('comp')).toBe(true);

    const drumOnly = await generateMusic({ ...req, bandParticipants: [{ role: 'drummer', state: 'selected' }] });
    const drumRoles = new Set(drumOnly.ir!.tracks.map((t) => t.role));
    expect(drumRoles.has('drum'), '鼓手 only → 必有 drum').toBe(true);
    expect(drumRoles.has('lead'), '鼓手 only → 自动补 lead').toBe(true);
  });

  it('★ disabled 乐手职责不生成;不写 TrackIR.program override(roster 只读=IR program)', async () => {
    const req = { seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 90 } as const;
    const noDrum = await generateMusic({ ...req, bandParticipants: [{ role: 'drummer', state: 'disabled' }] });
    expect(noDrum.ir!.tracks.some((t) => t.role === 'drum'), 'disabled drummer → 无 drum').toBe(false);
    for (const p of noDrum.uiSnapshot.roster) {
      const irTrack = noDrum.ir!.tracks.find((t) => t.role === p.role);
      if (irTrack) expect(p.program).toBe(irTrack.program); // roster 音色 = IR 实际 program(无后处理覆盖)
    }
  });

  it('★ P1/P2:participant 家族闭环到【最终发声音色】—— 合成氛围→pad 族,键盘手→keyboard 族(§5)', async () => {
    for (let seed = 0; seed < 12; seed++) {
      // 合成/氛围乐手 → pad 必在 pad 家族
      const synth = await generateMusic({ seed, styleHint: 'pop', mood: 'build', targetDuration: 90, bandParticipants: [{ role: 'synthPlayer', state: 'selected' }, { role: 'leadPlayer', state: 'selected' }] });
      const pad = synth.ir!.tracks.find((t) => t.role === 'pad');
      if (pad) expect(instrumentInfo(pad.program).family, `seed ${seed} pad 家族`).toBe('pad');
      // 键盘手 → comp/lead 必在 keyboard 家族(最终 program,经 orchestration+守卫)
      const kb = await generateMusic({ seed, styleHint: 'pop', mood: 'build', targetDuration: 90, bandParticipants: [{ role: 'keyboardist', state: 'selected' }, { role: 'bassist', state: 'selected' }, { role: 'drummer', state: 'selected' }] });
      for (const role of ['comp', 'lead'] as const) {
        const t = kb.ir!.tracks.find((x) => x.role === role);
        if (t) expect(instrumentInfo(t.program).family, `seed ${seed} ${role} 家族`).toBe('keyboard');
      }
    }
  });

  it('★ P2:drum roster 不显示成 Acoustic Grand(role=drum → Dream 5504 官方鼓组名)', async () => {
    const r = await generateMusic({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 90, bandParticipants: [{ role: 'drummer', state: 'selected' }] });
    const drumRow = r.uiSnapshot.roster.find((p) => p.role === 'drum');
    expect(drumRow, 'drum roster 行存在').toBeTruthy();
    expect(drumRow!.instrumentName).not.toBe('Acoustic Grand');
    expect(drumRow!.instrumentName).toBe('Room Drum-X');
  });

  it('★ 器配手势计划下发到 uiSnapshot roster:键盘/鼓/bass/sax 可审计', async () => {
    const r = await generateMusic({ seed: 4, styleHint: 'jazz', mood: 'build', targetDuration: 90 });
    const byRole = new Map(r.uiSnapshot.roster.map((p) => [p.role, p]));
    expect(byRole.get('lead')?.gesture?.kind).toBe('sax-breath-legato');
    expect(byRole.get('lead')?.gesture?.ccControllers).toEqual([11, 2]);
    expect(byRole.get('comp')?.gesture?.kind).toBe('keyboard-touch');
    expect(byRole.get('comp')?.gesture?.pedalPolicy).toBe('none');
    expect(byRole.get('bass')?.gesture?.kind).toBe('bass-walk');
    expect(byRole.get('drum')?.gesture?.kind).toBe('drum-rudiment');
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

  it('★ uiSnapshot.sections.endBeat = startBeat + bars×拍/小节;首段起 0、段间连续(AuraBar/AuraJam 段命中契约)', async () => {
    for (const styleHint of ['pop', 'acg', 'jazz']) {
      const r = await generateMusic({ seed: 3, styleHint, mood: 'build', targetDuration: 90 });
      const secs = r.uiSnapshot.sections;
      const bpb = r.uiSnapshot.timeSignature[0];
      expect(secs.length).toBeGreaterThan(0);
      expect(secs[0].startBeat).toBe(0);
      for (let i = 0; i < secs.length; i++) {
        expect(secs[i].endBeat, `${styleHint} #${i} endBeat`).toBe(secs[i].startBeat + secs[i].bars * bpb);
        if (i > 0) expect(secs[i].startBeat, `${styleHint} #${i} 连续`).toBe(secs[i - 1].endBeat);
      }
    }
  });

  it('★ key/tonality 不开放给产品请求:由 Q+N 开局按 seed/style 抽取且同输入确定', async () => {
    const a = await generateMusic({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 90 });
    const b = await generateMusic({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 90 });
    expect(a.status).toBe('ok');
    expect(a.uiSnapshot.key).toBe(b.uiSnapshot.key);
    expect(a.uiSnapshot.tonality).toBe(b.uiSnapshot.tonality);
    expect(typeof a.uiSnapshot.key).toBe('string');
    const keys = new Set<string>();
    for (let seed = 0; seed < 16; seed++) {
      keys.add((await generateMusic({ seed, styleHint: 'pop', mood: 'build', targetDuration: 90 })).uiSnapshot.key);
    }
    expect(keys.size).toBeGreaterThanOrEqual(4);
  });

  it('★ generateMotifMusic:无 override 也产完整成曲(ok + 非空 IR + uiSnapshot)', async () => {
    const r = await generateMotifMusic({ seed: 7, styleHint: 'jazz', mood: 'build', targetDuration: 90 }, {});
    expect(r.status).toBe('ok');
    expect(r.ir!.tracks.length).toBeGreaterThan(0);
    expect(r.uiSnapshot.sections.length).toBeGreaterThan(0);
    expect(r.uiSnapshot.chords.length).toBeGreaterThan(0);
  });
});
