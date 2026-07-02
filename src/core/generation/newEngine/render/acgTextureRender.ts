// ============================================================
// newEngine · render · ACG 织体渲染(忠实 port MG applyTexture 的 ACG 分支,musicEngine.ts:9243-10542)
// ------------------------------------------------------------
// 替换手写 acgChordHits/acgBassHits。MG 的 10 个 ACG 具名手势(broken bass / long color roll / block push /
//   stride / quartal wave / pentatonic shadow / pedal wash)在此按【真实音符 pattern】重建。
// ⚠️ 不做 swing / accent / melody-ducking / density-gate / normalize —— SIM pipeline 后续各自负责
//   (applySwing / carveAcgMelodySpace / normalizeAcgDynamics)。这里只出【原始织体事件】。
// chord + bass 分两函数(SIM 分轨),同一 rootPc+chordType 上下文派生;bass 出【实际 midi】(不丢八度)。
// ============================================================

import { chordTypeIntervals, isKnownChordType } from '../knowledge/chords';
import type { TextureChordHit, TextureBassHit, AcgChordContext } from './textureRenderer';

const mod12 = (x: number) => ((x % 12) + 12) % 12;
const dedupe = (xs: number[]) => Array.from(new Set(xs.filter((m) => Number.isFinite(m))));
const isNum = (m: unknown): m is number => typeof m === 'number' && Number.isFinite(m);

// 确定性 [0,1)(替 MG stableUnitInterval),seed 按 span 上下文。
function acgUnit(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }

const CHORD_LOW = 48, CHORD_HIGH = 88, MELODY_HIGH = 86;
const BASS_LOW = 33, BASS_HIGH = 57;

function ivPcsFor(chordType: string): Set<number> {
  const ivs = isKnownChordType(chordType) ? chordTypeIntervals(chordType) : [0, 4, 7];
  return new Set(ivs.map(mod12));
}
/** pc → 近 target 的 midi,夹 [low,high]。 */
function snapPc(pc: number, target: number, low: number, high: number): number {
  const p = mod12(pc); let best = low, bd = Infinity;
  for (let m = low; m <= high; m++) { if (mod12(m) !== p) continue; const d = Math.abs(m - target); if (d < bd) { bd = d; best = m; } }
  return best;
}
/** 和弦内 interval → midi(非和弦音 null)。 */
function midiForInterval(intervalPc: number, target: number, low: number, high: number, rootPc: number, pcs: Set<number>): number | null {
  const n = mod12(intervalPc); return pcs.has(n) ? snapPc(rootPc + n, target, low, high) : null;
}
function upperColor(target: number, rootPc: number, pcs: Set<number>): number[] {
  const out: number[] = [];
  for (const iv of [2, 11, 10, 9, 6, 7, 4, 3, 0]) { const m = midiForInterval(iv, target, 60, MELODY_HIGH, rootPc, pcs); if (m !== null) out.push(m); }
  return dedupe(out);
}
function upperChord(target: number, rootPc: number, pcs: Set<number>): number[] {
  const out: number[] = [];
  for (const iv of [0, 4, 3, 7, 2, 11, 10, 9, 6]) { const m = midiForInterval(iv, target, CHORD_LOW, CHORD_HIGH, rootPc, pcs); if (m !== null) out.push(m); }
  return dedupe(out);
}

// ============================================================
// CHORD 部分(comp)—— 各 case 的右手/上方色音 pushEvent(part='chord')。
// ============================================================
export function renderAcgChordHits(cMRaw: readonly number[], dur: number, tc: string, ctx?: AcgChordContext): TextureChordHit[] {
  const rootPc = mod12(ctx?.rootPc ?? 0);
  const pcs = ivPcsFor(ctx?.chordType ?? 'maj');
  const cM = [...cMRaw].filter(isNum).sort((a, b) => a - b);
  const hits: TextureChordHit[] = [];
  const push = (midis: number | number[], t: number, d: number, vol: number) => {
    if (t >= dur) return; const rem = dur - t - 0.02; if (rem <= 0) return;
    const ms = dedupe(Array.isArray(midis) ? midis : [midis]); if (ms.length === 0) return;
    hits.push({ tRel: t, dur: Math.max(0.05, Math.min(d, rem)), midis: ms, vel: Math.max(0.05, Math.min(0.95, vol)) });
  };
  // pushAcgLongColorRoll(chord 部分):升序铺开 + 顶音加亮 + 可选下行回声。
  const longColorRoll = (midisIn: number[], startT: number, span: number, vol: number, down: boolean) => {
    const notes = dedupe(midisIn).sort((a, b) => a - b); if (notes.length === 0) return;
    const availSpan = Math.max(0.22, Math.min(span, dur - startT - 0.25));
    const step = notes.length <= 1 ? 0 : availSpan / Math.max(1, notes.length - 1);
    notes.forEach((m, idx) => { const t = startT + idx * step; if (t >= dur - 0.18) return; const isTop = idx === notes.length - 1; push(m, t, isTop ? 0.88 : 0.58, isTop ? vol + 0.05 : vol - idx * 0.012); });
    if (!down || dur < startT + availSpan + 0.80) return;
    dedupe(notes.slice(1, -1)).reverse().slice(0, 3).forEach((m, idx) => { const t = startT + availSpan + 0.48 + idx * 0.24; if (t >= dur - 0.20) return; push(m, t, 0.42, Math.max(0.16, vol - 0.08 - idx * 0.025)); });
  };
  const uc = (target: number) => upperColor(target, rootPc, pcs);
  const uch = (target: number) => upperChord(target, rootPc, pcs);

  switch (tc) {
    case 'Piano_TopVoice_Planing': {
      const sorted = cM;
      const inner = sorted.slice(0, Math.min(3, sorted.length));
      const support = sorted.slice(3, Math.min(4, sorted.length));
      const colorTop = dedupe([...sorted.slice(-1), ...uc(81).slice(0, 2)]);
      const open = [...new Set([...support, ...colorTop])].filter((m) => isNum(m) && !inner.includes(m));
      longColorRoll([...inner, ...open].filter(isNum), 0.10, 1.28, 0.27, true);
      const breath = acgUnit(`planing|${tc}|${rootPc}|${ctx?.chordType}`);
      const echoStart = breath < 0.45 ? 2.72 : 2.42;
      const echo = [...new Set([...open.slice().sort((a, b) => b - a), ...inner.slice(1).sort((a, b) => b - a)])].filter(isNum);
      if (breath > 0.22 && echo.length) echo.slice(0, 4).forEach((m, idx) => { const t = echoStart + idx * 0.16; if (t < dur - 0.18) push(m, t, Math.min(0.55, dur - t), 0.22 - idx * 0.025); });
      if (breath > 0.68 && open.length) { const t = Math.min(dur - 0.48, 3.20); push(open.slice(-1), t, Math.min(0.42, dur - t), 0.20); }
      break;
    }
    case 'ACG_Quartal_Arp_Wave': {
      const support = uch(66).slice(0, 4);
      const colors = uc(78).filter((m) => m >= 69).slice(0, 3);
      const wave = dedupe([...support.slice(0, 2), ...colors, ...support.slice(2, 3)]);
      longColorRoll(wave, 0.12, 1.64, 0.25, true);
      if (dur > 3.1 && colors.length) push(colors[0], 3.04, 0.44, 0.22);
      break;
    }
    case 'ACG_Sakamoto_LH_Arp_RH_Penta': {
      const colors = uc(76);
      const penta = dedupe([
        colors.find((m) => mod12(m - rootPc) === 2) ?? colors[0],
        colors.find((m) => mod12(m - rootPc) === 9) ?? colors[1],
        colors.find((m) => mod12(m - rootPc) === 7) ?? colors[2],
      ].filter(isNum));
      [1.18, 2.74, 3.34].forEach((t, idx) => { if (t < dur - 0.20 && penta.length) push(penta[idx % penta.length], t, 0.42, 0.20); });
      break;
    }
    case 'ACG_Ostinato_Hook_Pulse': {
      const hook = dedupe([...uch(67).slice(0, 2), ...uc(76).slice(0, 2)]).slice(0, 4);
      [0.74, 1.74, 2.74, 3.26].forEach((t, idx) => { if (t >= dur - 0.18 || hook.length === 0) return; push(dedupe([hook[idx % hook.length], hook[(idx + 1) % hook.length]]), t, 0.34, 0.20 + idx * 0.012); });
      break;
    }
    case 'ACG_Stride_Cantabile_Ballad': {
      const upperA = dedupe([...uch(64).slice(0, 3), ...uc(74).slice(0, 1)]).slice(0, 4);
      const upperB = dedupe([...uch(66).slice(1, 4), ...uc(76).slice(1, 2)]).slice(0, 4);
      if (upperA.length) push(upperA, 0.84, Math.min(1.00, dur - 0.86), 0.24);
      if (dur > 2.72) push(upperB.length ? upperB : upperA, 2.72, Math.min(0.86, dur - 2.74), 0.22);
      const highAnswer = uc(79)[0] ?? upperA[upperA.length - 1];
      if (isNum(highAnswer) && dur > 3.36) push(highAnswer, 3.36, 0.38, 0.19);
      break;
    }
    case 'ACG_Anthem_Block_Push': {
      const block = dedupe([...uch(65).slice(0, 3), ...uc(75).slice(0, 1)]).slice(0, 4);
      const pushed = dedupe([...block.slice(1), ...uc(78).slice(0, 1)]).slice(0, 4);
      [0.00, 1.46, 2.00, 2.72, 3.46].forEach((t, idx) => { if (t >= dur - 0.16 || block.length === 0) return; push(idx % 2 === 0 || pushed.length === 0 ? block : pushed, t, 0.42, 0.25 + Math.min(0.05, idx * 0.012)); });
      break;
    }
    case 'ACG_Open_Broken_10th': {
      const upper = dedupe([...uch(67).slice(0, 2), ...uc(77).slice(0, 3)]);
      longColorRoll(upper, 0.20, 1.46, 0.25, true);
      if (dur > 3.2 && upper.length > 2) push(upper[1], 3.18, 0.40, 0.19);
      break;
    }
    case 'ACG_Suspended_Block_Arrival': {
      const middle = uch(65).slice(0, 3);
      const colors = uc(77).slice(0, 3);
      const arrival = dedupe([...middle, ...colors]).slice(0, 5);
      longColorRoll(arrival, 0.08, 1.24, 0.28, false);
      const top = colors[0] ?? arrival[arrival.length - 1];
      const support = colors[1] ?? middle[middle.length - 1];
      if (isNum(support) && dur > 2.3) push(support, 2.32, 0.52, 0.21);
      if (isNum(top) && dur > 3.2) push(top, 3.24, 0.44, 0.25);
      break;
    }
    case 'ACG_Bass_Tremolo_Color': {
      const upper = uc(78).slice(0, 3);
      const bed = uch(65).slice(0, 2);
      longColorRoll([...bed, ...upper], 0.14, 1.22, 0.23, false);
      [2.18, 2.92, 3.46].forEach((t, idx) => { if (t < dur - 0.16 && upper.length) push(upper[idx % upper.length], t, 0.36, 0.22); });
      break;
    }
    case 'ACG_Pedal_Wash_Color_Drops': {
      const bed = uch(64).slice(0, 2);
      if (bed.length) push(bed, 0.28, Math.min(1.60, dur - 0.32), 0.18);
      const colors = uc(79).slice(0, 3);
      [1.96, 2.94, 3.48].forEach((t, idx) => { if (t < dur - 0.18 && colors.length) push(colors[idx % colors.length], t, 0.42, 0.20 + idx * 0.018); });
      break;
    }
  }
  return hits;
}

// ============================================================
// BASS 部分(bass)—— 各 case 的左手,出【实际 midi】(bass 区)。忠实 MG pushAcgBrokenBass + 各 case 内联 bass。
// ============================================================
export function renderAcgBassHits(dur: number, tc: string, ctx?: AcgChordContext): TextureBassHit[] {
  const rootPc = mod12(ctx?.rootPc ?? 0);
  const pcs = ivPcsFor(ctx?.chordType ?? 'maj');
  const bRootLow = snapPc(rootPc, 40, BASS_LOW, 47);       // 低根(C2-B2)
  const bM = Math.min(BASS_HIGH, bRootLow + 12);            // bass anchor(高八度)
  const fifth = snapPc(rootPc + 7, bRootLow + 7, BASS_LOW, BASS_HIGH);
  const third = midiForInterval(4, bRootLow + 16, BASS_LOW, BASS_HIGH, rootPc, pcs)
    ?? midiForInterval(3, bRootLow + 15, BASS_LOW, BASS_HIGH, rootPc, pcs) ?? bM;
  const upperAnchor = bM === bRootLow ? fifth : bM;
  const hits: TextureBassHit[] = [];
  const b = (midi: number, t: number, d: number, vol: number, voice: TextureBassHit['voice'] = 'root') => {
    if (!isNum(midi) || t >= dur) return; const rem = dur - t - 0.02; if (rem <= 0) return;
    hits.push({ tRel: t, dur: Math.max(0.05, Math.min(d, rem)), vel: Math.max(0.05, Math.min(0.95, vol)), voice, midi });
  };
  const brokenBass = (shape: 'pedal' | 'arrival' | 'ripple' | 'open10th') => {
    if (shape === 'pedal') { b(bRootLow, 0.00, Math.max(0.5, dur - 0.08), 0.39); if (dur > 1.0) b(upperAnchor, 0.82, 0.74, 0.24, 'fifth'); if (dur > 2.7) b(third, 2.46, 0.62, 0.22, 'tenth'); return; }
    if (shape === 'arrival') { b(bRootLow, 0.00, Math.max(0.5, dur - 0.08), 0.43); if (dur > 1.2) b(upperAnchor, 0.96, 0.78, 0.25, 'fifth'); if (dur > 3.0) b(fifth, 2.72, 0.58, 0.21, 'fifth'); return; }
    const times = shape === 'ripple' ? [0.00, 0.68, 1.34, 2.14, 3.02] : [0.00, 0.72, 1.42, 2.36, 3.16];
    const notes = shape === 'ripple' ? [bRootLow, upperAnchor, fifth, upperAnchor, third] : [bRootLow, fifth, third, upperAnchor, fifth];
    const voices: TextureBassHit['voice'][] = shape === 'ripple' ? ['root', 'fifth', 'fifth', 'fifth', 'tenth'] : ['root', 'fifth', 'tenth', 'fifth', 'fifth'];
    times.forEach((t, idx) => { if (t >= dur - 0.18) return; b(notes[idx] ?? bRootLow, t, idx === 0 ? 0.82 : 0.52, idx === 0 ? 0.47 : 0.25 - Math.min(idx, 3) * 0.015, voices[idx]); });
  };

  switch (tc) {
    case 'Piano_TopVoice_Planing':
    case 'ACG_Pedal_Wash_Color_Drops': brokenBass('pedal'); break;
    case 'ACG_Suspended_Block_Arrival': brokenBass('arrival'); break;
    case 'ACG_Quartal_Arp_Wave':
    case 'ACG_Bass_Tremolo_Color': brokenBass('ripple'); break;
    case 'ACG_Sakamoto_LH_Arp_RH_Penta': {
      const pat = [bRootLow, fifth, bM, third, fifth, bM];
      const voices: TextureBassHit['voice'][] = ['root', 'fifth', 'root', 'tenth', 'fifth', 'root'];
      [0.00, 0.70, 1.36, 2.04, 2.74, 3.34].forEach((t, idx) => { if (t >= dur - 0.16) return; b(pat[idx % pat.length], t, idx === 0 ? 0.62 : 0.44, idx === 0 ? 0.46 : 0.25, voices[idx]); });
      break;
    }
    case 'ACG_Ostinato_Hook_Pulse': {
      const tenth = midiForInterval(4, bRootLow + 16, BASS_LOW, BASS_HIGH, rootPc, pcs) ?? midiForInterval(3, bRootLow + 15, BASS_LOW, BASS_HIGH, rootPc, pcs) ?? bM;
      const pat = [bRootLow, fifth, bM, fifth, tenth];
      const voices: TextureBassHit['voice'][] = ['root', 'fifth', 'root', 'fifth', 'tenth'];
      [0.00, 0.50, 1.00, 1.50, 2.00, 2.50, 3.00, 3.50].forEach((t, idx) => { if (t >= dur - 0.12) return; b(pat[idx % pat.length], t, idx === 0 ? 0.42 : 0.24, idx === 0 ? 0.44 : 0.24, voices[idx % voices.length]); });
      break;
    }
    case 'ACG_Stride_Cantabile_Ballad': {
      b(bRootLow, 0.00, 0.74, 0.45); if (dur > 2.05) b(fifth, 2.00, 0.62, 0.34, 'fifth');
      break;
    }
    case 'ACG_Anthem_Block_Push': {
      b(bRootLow, 0.00, Math.min(1.48, dur), 0.48); if (dur > 2.0) b(bM, 2.00, Math.min(1.25, dur - 2.02), 0.34);
      break;
    }
    case 'ACG_Open_Broken_10th': {
      b(bRootLow, 0, 0.82, 0.46); if (third !== bM) b(third, 1.42, 0.58, 0.25, 'tenth'); if (dur > 2.8) b(bM, 2.78, 0.54, 0.26);
      break;
    }
  }
  return hits;
}
