// ============================================================
// newEngine · sandbox · 混响(2026-06-05 → 2026-06-10 ESP32 改制)
// ------------------------------------------------------------
// ★ 2026-06-10(esp32s2_gm128_instrument_mix_directive):CC91 混响【已上移到器配层 mix】并随 IR 携带,
//   不再由 irToMidi.reverbSend(roomWet) 硬算。roomWetFor 退成【缺 mix 时】的回退湿度(per-genre,仍 LOFI>POP>JAZZ)。
// 新承重不变量:bass 干(高通等效)· pad 比 comp 更湿(关系型护栏 ≥+20)· lead 不过湿 · 确定性。
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

  it('★ 混响由器配层 mix 决定(IR 携带):bass 干 + pad 比 comp 更湿(≥+20)+ lead 不过湿', () => {
    const r = reverbByRole('pop'); // pop seed7 含 bass/comp/pad/lead
    expect(r.bass).toBeLessThanOrEqual(8);            // 干(高通等效,guardrail bass.reverb≤8)
    if (r.pad !== undefined && r.comp !== undefined)
      expect(r.pad).toBeGreaterThanOrEqual(r.comp + 20); // pad 更湿(关系型护栏)
    if (r.lead !== undefined) expect(r.lead).toBeLessThanOrEqual(65); // lead 不过湿(directive lead reverb ≤65)
  });

  it('确定性:同 style 两次混响一致', () => {
    expect(JSON.stringify(reverbByRole('pop'))).toBe(JSON.stringify(reverbByRole('pop')));
  });

  it('未知 style 回退中等房间(非 0)', () => {
    expect(roomWetFor('whatever')).toBeGreaterThan(0);
  });
});
