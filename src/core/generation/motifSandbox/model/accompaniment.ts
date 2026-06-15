// ============================================================
// motifSandbox · model · 伴奏织体(comp + bass,感知旋律 → 重拍/结构点对拍)
// ------------------------------------------------------------
// 用户:伴奏 bass 要和旋律【重音/骨干音】的拍对齐(复调对拍),做重拍 + 拍子结构点对齐。
//   做法:① 每小节【下拍 root 稳锚】(重拍)② 其余击点【落在旋律的结构点上】(取该小节
//   骨干/重音音的实际 onset,不改旋律一个音 → 伴奏跟着旋律走,两声部锁在一起)。
//   无 lead(向后兼容)或某小节旋律稀疏 → 回退该风格的默认织体拍位。
// 风格(只决定【音色/音的选择/密度】,击点由旋律结构点驱动):
//   POP 柱式(下拍 root + 结构点 fifth)· LOFI 整小节柔延音 · RNB 切分短和弦 ·
//   JAZZ 四分走音(覆盖全拍=天然对齐,保留)。
// ============================================================

import type { SandboxChord } from './chords';
import type { MotifNote, SandboxStyle } from './types';
import { makeRng, type SeededRng } from './rng';

export interface AccompNote { midi: number; onsetBeat: number; durationBeat: number; velocity: number; }
export interface Accompaniment { comp: AccompNote[]; bass: AccompNote[]; compProgram: number; bassProgram: number; }

const mod = (n: number, m: number): number => ((n % m) + m) % m;

const COMP_PROGRAM: Record<SandboxStyle, number> = { pop: 4, lofi: 4, rnb: 5, jazz: 0 };
const BASS_PROGRAM: Record<SandboxStyle, number> = { pop: 33, lofi: 33, rnb: 33, jazz: 32 };

// 某小节旋律稀疏(无结构点)时回退的默认织体击点(≈ 老固定 pattern)。
const DEFAULT_STRUCT: Record<SandboxStyle, number[]> = { pop: [2], lofi: [], rnb: [1.5, 2.5], jazz: [] };
const ACCENT_MIN = 0.58; // 视为【骨干/重音】的 accent 阈值

/** 三和弦闭合排列(root 落 comp 音区底,三/五度叠上);comp 区 ≈ [48,67]。 */
function triadVoicing(chord: SandboxChord): number[] {
  const rootBase = 48 + mod(chord.rootPc, 12);
  const tones = chord.tonePcs.map((pc) => rootBase + mod(pc - chord.rootPc, 12));
  return Array.from(new Set(tones)).sort((a, b) => a - b);
}

/** 低音根音(bass 区 ≈ [36,47])。 */
function bassRoot(chord: SandboxChord): number { return 36 + mod(chord.rootPc, 12); }

function compChord(voicing: number[], onsetBeat: number, durationBeat: number, vel: number): AccompNote[] {
  return voicing.map((midi) => ({ midi, onsetBeat, durationBeat, velocity: vel }));
}

/** 某小节【旋律结构点】= 该小节里骨干/重音音的相对拍位(下拍 0 单独锚,这里取中后段 ≥1 拍);
 *  ≤2 个(铺开取首尾,不挤);旋律稀疏 → 风格默认击点。不改旋律,只读它的 onset。 */
function barStructPoints(lead: readonly MotifNote[] | undefined, bar: number, fallback: number[]): number[] {
  if (!lead) return fallback;
  const offs = new Set<number>();
  for (const n of lead) {
    if (Math.floor(n.onsetBeat / 4) !== bar) continue;
    if (n.accent < ACCENT_MIN) continue;
    const off = +(n.onsetBeat - bar * 4).toFixed(3);
    if (off >= 1.0 && off <= 3.9) offs.add(off);
  }
  const pts = [...offs].sort((a, b) => a - b);
  if (pts.length === 0) return fallback;
  return pts.length <= 2 ? pts : [pts[0], pts[pts.length - 1]];
}

export function buildAccompaniment(progression: readonly SandboxChord[], style: SandboxStyle, seed: number, lead?: readonly MotifNote[]): Accompaniment {
  const rng: SeededRng = makeRng((seed ^ 0x51ed270b) >>> 0);
  const comp: AccompNote[] = [];
  const bass: AccompNote[] = [];
  const jit = (base: number): number => base + (rng.next() - 0.5) * 0.06;

  for (let i = 0; i < progression.length; i++) {
    const ch = progression[i];
    const v = triadVoicing(ch);
    const root = bassRoot(ch);
    const fifth = root + 7;
    const start = ch.startBeat;
    const nextRoot = bassRoot(progression[Math.min(i + 1, progression.length - 1)]);
    const sp = barStructPoints(lead, i, DEFAULT_STRUCT[style]); // 旋律结构点(对拍落点)
    const durTo = (o: number, k: number, cap: number): number => Math.min(cap, (sp[k + 1] ?? 4) - o); // 到下一击点/小节末

    if (style === 'jazz') {
      comp.push(...compChord(v, start, 0.7, jit(0.46)), ...compChord(v, start + 1.5, 1.2, jit(0.42))); // Charleston
      const third = root + mod(ch.tonePcs[1] - ch.rootPc, 12);
      const fifthB = root + mod(ch.tonePcs[2] - ch.rootPc, 12);
      const walk = [root, third, fifthB, nextRoot - 1]; // 四分走音覆盖全拍 → 天然对齐
      for (let b = 0; b < 4; b++) bass.push({ midi: walk[b], onsetBeat: start + b, durationBeat: 0.95, velocity: jit(0.6) });
      continue;
    }

    // —— 下拍稳锚(重拍):root + 和弦 ——
    if (style === 'lofi') {
      comp.push(...compChord(v, start + 0.08, 3.6, jit(0.4)));      // 整小节柔延音
      bass.push({ midi: root, onsetBeat: start, durationBeat: 3.6, velocity: jit(0.6) });
      if (sp.length) bass.push({ midi: fifth, onsetBeat: start + sp[0], durationBeat: 1.4, velocity: jit(0.46) }); // 轻补一个结构点
      continue;
    }
    const downDur = sp.length ? Math.min(1.6, sp[0]) : 1.6;
    bass.push({ midi: root, onsetBeat: start, durationBeat: style === 'rnb' ? Math.min(1.2, downDur) : downDur, velocity: jit(0.66) });
    comp.push(...compChord(v, start, sp.length ? Math.min(1.9, sp[0]) : 1.8, jit(style === 'rnb' ? 0.48 : 0.5)));
    // —— 其余击点落在【旋律结构点】上(对拍)——
    for (let k = 0; k < sp.length; k++) {
      const o = sp[k];
      comp.push(...compChord(v, start + o, durTo(o, k, style === 'rnb' ? 0.9 : 1.8), jit(0.42)));
      bass.push({ midi: style === 'rnb' ? root + 12 : (k % 2 === 0 ? fifth : root), onsetBeat: start + o, durationBeat: durTo(o, k, 1.4), velocity: jit(0.55) });
    }
  }
  return { comp, bass, compProgram: COMP_PROGRAM[style], bassProgram: BASS_PROGRAM[style] };
}
