import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(path), 'utf8');

describe('lead takeover input isolation', () => {
  it('keeps TapArea state visible to Q+T while hiding it from the underlying app', () => {
    const app = read('src/App.tsx');

    expect(app).toContain('const appActiveKeys = takeoverOpen ? EMPTY_ACTIVE_KEYS : activeKeys');
    expect(app).toContain('onOpenChange={setTakeoverOpen}');
    expect(app).toContain('<AuraSystem activeKeys={appActiveKeys}');
    expect(app).toContain('<ActiveApp activeKeys={appActiveKeys}');
  });

  it('routes both TapArea and mapped MIDI attacks through the same nativeNoteDown consumer', () => {
    const panel = read('src/core/generation/leadTakeoverSandbox/LeadTakeoverSandboxPanel.tsx');

    expect(panel).toContain("if (event.type === 'down') nativeNoteDown(event.padIndex)");
    expect(panel).toContain('nativeNoteDown(event.padIndex, event.velocity, event.sourceId)');
    expect(panel).toContain('executeLeadTakeoverActions(AudioEngine, actions, executeOptions)');
    expect(panel).toContain("uploaded.nativeMuteStrategy !== 'none'");
    expect(panel).toContain('nativeLeadNoteRange: nativeLeadNoteRangeRef.current');
    expect(panel).toContain('nativeLeadNoteTargets: nativeLeadNoteTargetsRef.current');
    expect(panel).toContain('lastResultRef.current = currentResult');
    expect(panel).toContain('controllerRef.current.tick(liveBeat)');
    expect(panel).toContain('pushActions(reconcileNativeLeadMute(');
    expect(panel).toContain("action.type === 'lead-mute' && !action.muted");
    expect(panel).toContain('controllerRef.current.reset({ restoreNativeLead: true })');
    expect(panel).toContain("sourceKind === 'uploaded'");
    expect(panel).toContain("takeoverSourceMode === 'midi-score' ? 'MIDI谱接管模式' : '音乐生成接管模式'");
    expect(panel).toContain("{takeoverSourceMode === 'midi-score' ? (");
    expect(panel).toContain('沿用原音乐生成和弦与局部安全音阶接管链路');
  });
});
