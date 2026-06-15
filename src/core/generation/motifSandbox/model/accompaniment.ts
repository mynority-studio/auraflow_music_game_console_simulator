// ============================================================
// motifSandbox · model · 伴奏织体(comp + bass,从配出的和弦进行生成)
// ------------------------------------------------------------
// 用户:配上和声、加入伴奏织体。沙盒自有的 clean-room 伴奏(不进生产链):
//   据 16-bar 进行,按【风格织体】奏出 comp(和弦)+ bass(低音)。稀疏、让位 lead,
//   = 给续写的旋律一个和声底。确定性(seeded rng 只做微力度/走向)。
// 风格织体:
//   POP   comp = 1+3 拍柱式和弦(后半延音);bass = 根音 1 拍 + 五度 3 拍。
//   LOFI  comp = 整小节柔和延音(略靠后 lay-back);bass = 根音长音,稀疏。
//   RNB   comp = 切分短和弦(0/1.5/2.5);bass = 根音 + 高八度回授。
//   JAZZ  comp = Charleston(0 + 1.5 短和弦);bass = 四分走音(根→趋近下一根)。
// ============================================================

import type { SandboxChord } from './chords';
import type { SandboxStyle } from './types';
import { makeRng, type SeededRng } from './rng';

export interface AccompNote { midi: number; onsetBeat: number; durationBeat: number; velocity: number; }
export interface Accompaniment { comp: AccompNote[]; bass: AccompNote[]; compProgram: number; bassProgram: number; }

const mod = (n: number, m: number): number => ((n % m) + m) % m;

// comp 用电钢/钢琴,bass 用指弹贝斯(jazz 用原声贝斯)。
const COMP_PROGRAM: Record<SandboxStyle, number> = { pop: 4, lofi: 4, rnb: 5, jazz: 0 };
const BASS_PROGRAM: Record<SandboxStyle, number> = { pop: 33, lofi: 33, rnb: 33, jazz: 32 };

/** 三和弦闭合排列(root 落 comp 音区底,三/五度叠上);comp 区 ≈ [48,67]。 */
function triadVoicing(chord: SandboxChord): number[] {
  const rootBase = 48 + mod(chord.rootPc, 12); // 48..59
  const tones = chord.tonePcs.map((pc) => rootBase + mod(pc - chord.rootPc, 12));
  return Array.from(new Set(tones)).sort((a, b) => a - b);
}

/** 低音根音(bass 区 ≈ [36,47])。 */
function bassRoot(chord: SandboxChord): number {
  return 36 + mod(chord.rootPc, 12);
}

function compChord(voicing: number[], onsetBeat: number, durationBeat: number, vel: number): AccompNote[] {
  return voicing.map((midi) => ({ midi, onsetBeat, durationBeat, velocity: vel }));
}

export function buildAccompaniment(progression: readonly SandboxChord[], style: SandboxStyle, seed: number): Accompaniment {
  const rng: SeededRng = makeRng((seed ^ 0x51ed270b) >>> 0);
  const comp: AccompNote[] = [];
  const bass: AccompNote[] = [];
  const jit = (base: number): number => base + (rng.next() - 0.5) * 0.06; // 微力度抖动

  for (let i = 0; i < progression.length; i++) {
    const ch = progression[i];
    const v = triadVoicing(ch);
    const root = bassRoot(ch);
    const fifth = root + 7;
    const start = ch.startBeat;
    const nextRoot = bassRoot(progression[Math.min(i + 1, progression.length - 1)]);

    switch (style) {
      case 'pop':
        comp.push(...compChord(v, start, 1.8, jit(0.5)), ...compChord(v, start + 2, 1.8, jit(0.42)));
        bass.push({ midi: root, onsetBeat: start, durationBeat: 1.5, velocity: jit(0.66) });
        bass.push({ midi: fifth, onsetBeat: start + 2, durationBeat: 1.5, velocity: jit(0.58) });
        break;
      case 'lofi':
        comp.push(...compChord(v, start + 0.08, 3.6, jit(0.4))); // 略靠后 + 长延音
        bass.push({ midi: root, onsetBeat: start, durationBeat: 3.6, velocity: jit(0.6) });
        break;
      case 'rnb':
        comp.push(...compChord(v, start, 0.9, jit(0.48)), ...compChord(v, start + 1.5, 0.6, jit(0.4)), ...compChord(v, start + 2.5, 0.9, jit(0.44)));
        bass.push({ midi: root, onsetBeat: start, durationBeat: 1.2, velocity: jit(0.66) });
        bass.push({ midi: root + 12, onsetBeat: start + 2.5, durationBeat: 0.8, velocity: jit(0.5) });
        break;
      case 'jazz': {
        comp.push(...compChord(v, start, 0.7, jit(0.46)), ...compChord(v, start + 1.5, 1.2, jit(0.42))); // Charleston
        const third = root + mod(ch.tonePcs[1] - ch.rootPc, 12); // 用本和弦真实三/五度(大小调正确)
        const fifthB = root + mod(ch.tonePcs[2] - ch.rootPc, 12);
        const approach = nextRoot - 1;                            // 半音趋近下一根(jazz 正统 chromatic approach)
        const walk = [root, third, fifthB, approach];
        for (let b = 0; b < 4; b++) bass.push({ midi: walk[b], onsetBeat: start + b, durationBeat: 0.95, velocity: jit(0.6) });
        break;
      }
    }
  }
  return { comp, bass, compProgram: COMP_PROGRAM[style], bassProgram: BASS_PROGRAM[style] };
}
