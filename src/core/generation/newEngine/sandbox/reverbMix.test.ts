// ============================================================
// newEngine · sandbox · 混响(2026-06-05 → 2026-06-10 ESP32 改制)
// ------------------------------------------------------------
// 原生默认试听期不向 5504 发送 CC91；roomWetFor 仅保留为兼容 API。
// ============================================================

import { describe, expect, it } from 'vitest';
import { traceGeneration } from '../generation';
import { musicalIRToMidiEvents } from './irToMidi';
import { roomWetFor } from './mixProfile';

function outgoingReverb(style: string, seed = 7): number[] {
  const t = traceGeneration({ seed, styleHint: style, mood: 'x', targetDuration: 120 });
  const ev = musicalIRToMidiEvents(t.ir, roomWetFor(style));
  return ev.filter((event) => event.type === 'cc' && event.data1 === 91).map((event) => event.data2);
}

describe('共享房间混响兼容元数据', () => {
  it('四个目标风格的兼容值为 0', () => {
    expect(roomWetFor('lofi')).toBe(0);
    expect(roomWetFor('pop')).toBe(0);
    expect(roomWetFor('jazz')).toBe(0);
    expect(roomWetFor('rnb')).toBe(0);
  });

  it('四风格都不发送 CC91，包括 CC91=0', () => {
    for (const style of ['pop', 'lofi', 'jazz', 'rnb']) expect(outgoingReverb(style), style).toEqual([]);
  });

  it('确定性:同 style 两次输出一致', () => {
    expect(outgoingReverb('pop')).toEqual(outgoingReverb('pop'));
  });

  it('未知 style 回退中等房间(非 0)', () => {
    expect(roomWetFor('whatever')).toBeGreaterThan(0);
  });
});
