import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_PANELS } from './devPanels';

describe('components/devPanels — Q+H/Q+N ingress consolidation', () => {
  it('exposes Q+H as the only full-song generation entry in DevDock', () => {
    expect(DEV_PANELS.some((p) => p.id === 'pipeline' && p.combo === 'Q+H')).toBe(true);
    // 精确锁定面板集合:Q+H 音乐生成 + Q+A MIDI 只读分析 + 现有沙盒;无退役的 Q+N 诊断面板 / Q+N combo。
    expect(DEV_PANELS.map((p) => p.id).sort()).toEqual(['auraRoam', 'midiAnalysis', 'midiOut', 'motif', 'pipeline', 'takeover']);
    expect(DEV_PANELS.some((p) => p.combo === 'Q+N')).toBe(false);
    expect(DEV_PANELS.some((p) => p.id === 'midiAnalysis' && p.combo === 'Q+A')).toBe(true);
  });

  it('does not mount the legacy NewEnginePanel in App', () => {
    const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(appSource).not.toContain('NewEnginePanel');
    expect(appSource).toContain('<MidiAnalysisMonitorPanel />');
  });

  it('starts read-only analysis from the existing MIDI upload without writing a HarmonicPlan', () => {
    const uploadSource = readFileSync(join(process.cwd(), 'src/components/SoundFontSelector.tsx'), 'utf8');
    const analysisSource = readFileSync(join(process.cwd(), 'src/core/analysis/midi/analyzeMidi.ts'), 'utf8');
    expect(uploadSource).toContain('startMidiAnalysisSession(buffer.slice(0)');
    expect(analysisSource).not.toContain('HarmonicPlan');
    expect(analysisSource).not.toContain('GenerationController');
  });

});
