// ============================================================
// newEngine · sandbox · 共享房间混响(render 层下面的音频混音,2026-06-05)
// ------------------------------------------------------------
// 锁:per-genre 房间湿度(LOFI>POP>JAZZ)· bass 干(高通等效)· lead 比 comp/pad 略干靠前 ·
//   comp/pad 进共享房间(同量)· 确定性。混响不进 IR/render,在 sandbox 音频层。
// ============================================================

import { describe, expect, it } from 'vitest';
import { traceGeneration } from '../generation';
import { musicalIRToMidiEvents } from './irToMidi';
import { roomWetFor } from './mixProfile';

const CH: Record<string, number> = { bass: 3, comp: 2, lead: 1, pad: 4, drum: 9 };
function reverbByRole(style: string, seed = 7): Record<string, number> {
  const t = traceGeneration({ seed, styleHint: style, mood: 'x', targetDuration: 120 });
  const ev = musicalIRToMidiEvents(t.ir, roomWetFor(style));
  const byCh: Record<number, number> = {};
  for (const e of ev) if (e.type === 'cc' && e.data1 === 91) byCh[e.channel] = e.data2;
  const out: Record<string, number> = {};
  for (const tr of t.ir.tracks) out[tr.role] = byCh[CH[tr.role]];
  return out;
}

describe('共享房间混响(混音层)', () => {
  it('per-genre 房间湿度:LOFI > POP > JAZZ(小干房间=清晰)', () => {
    expect(roomWetFor('lofi')).toBeGreaterThan(roomWetFor('pop'));
    expect(roomWetFor('pop')).toBeGreaterThan(roomWetFor('jazz'));
  });

  it('bass 干(高通等效,低频不进房间)+ lead 比 comp 略干靠前 + comp=pad 进共享房间', () => {
    const r = reverbByRole('pop'); // pop seed7 含 bass/comp/pad/lead
    expect(r.bass).toBeLessThanOrEqual(10);           // 近干
    expect(r.comp).toBe(roomWetFor('pop'));           // 进满房间
    if (r.pad !== undefined) expect(r.pad).toBe(roomWetFor('pop')); // 同一个房间
    if (r.lead !== undefined) expect(r.lead).toBeLessThan(r.comp);  // 旋律略干靠前
  });

  it('确定性:同 style 两次混响一致', () => {
    expect(JSON.stringify(reverbByRole('pop'))).toBe(JSON.stringify(reverbByRole('pop')));
  });

  it('未知 style 回退中等房间(非 0)', () => {
    expect(roomWetFor('whatever')).toBeGreaterThan(0);
  });
});
