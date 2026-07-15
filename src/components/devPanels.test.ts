import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GM128_DRUM_PROGRAMS } from '../core/sound/Aura25Palette';
import { DEV_PANELS } from './devPanels';
import { POP_DRUM_MACHINE_AUDITION_ITEMS, POP_DRUM_MACHINE_AUDITION_KIT } from './PopDrumMachineAuditionPanel';

describe('components/devPanels — Q+H/Q+N ingress consolidation', () => {
  it('exposes Q+H as the only full-song generation entry in DevDock', () => {
    expect(DEV_PANELS.some((p) => p.id === 'pipeline' && p.combo === 'Q+H')).toBe(true);
    // 精确锁定面板集合:Q+H 音乐生成 + Motif + MIDI 输出 + 鼓机试听 + 用户接管;无退役的 Q+N 诊断面板 / Q+N combo。
    expect(DEV_PANELS.map((p) => p.id).sort()).toEqual(['drumAudition', 'midiOut', 'motif', 'pipeline', 'takeover']);
    expect(DEV_PANELS.some((p) => p.combo === 'Q+N')).toBe(false);
    expect(DEV_PANELS.some((p) => p.id === 'drumAudition' && p.combo === 'Q+D')).toBe(true);
  });

  it('does not mount the legacy NewEnginePanel in App', () => {
    const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(appSource).not.toContain('NewEnginePanel');
  });

  it('exposes the POP macro drum machine family audition list', () => {
    expect(POP_DRUM_MACHINE_AUDITION_ITEMS.map((x) => x.id)).toEqual([
      'citypop-syncopated-boogie',
      'citypop-disco-boogie',
      'jpop-driving-8ths',
      'pop-backbeat',
      'ballad-halftime',
    ]);
  });

  it('forces the POP drum machine audition panel onto a Dream GM128 drum kit before playback', () => {
    expect(GM128_DRUM_PROGRAMS).toContain(POP_DRUM_MACHINE_AUDITION_KIT.program);

    const panelSource = readFileSync(join(process.cwd(), 'src/components/PopDrumMachineAuditionPanel.tsx'), 'utf8');
    expect(panelSource).not.toContain('AudioEngine.controllerChange(DRUM_CHANNEL, 0');
    expect(panelSource).not.toContain('AudioEngine.controllerChange(DRUM_CHANNEL, 32');
    expect(panelSource).toContain('AudioEngine.programChange(DRUM_CHANNEL, POP_DRUM_MACHINE_AUDITION_KIT.program)');
  });
});
