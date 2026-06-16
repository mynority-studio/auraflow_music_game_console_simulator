// ============================================================
// motifSandbox · model · 旋律-进行打分(directive §9)
// ------------------------------------------------------------
// scoreProgressionAgainstMelodicBrick:把 brick 的结构音/头尾/cadence 与候选模板对齐打分。
//   重罚退化进行(I-I-I-I / V-I-I-I / I-V-I-I)。
// ============================================================

import type { ProgressionSlot } from '../../newEngine/knowledge/progressions';
import { chordTypeIntervals, normalizeChordType } from '../../newEngine/knowledge/chords';
import type { UserMelodicBrick, MotifHarmonyIntent, ProgressionScoreBreakdown } from './melodicBrickTypes';
import type { ProgressionCandidate } from './progressionCandidateProvider';

const mod12 = (n: number): number => ((n % 12) + 12) % 12;
const deg17 = (d: number): number => ((d - 1) % 7 + 7) % 7 + 1;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

function slotAtBeat(slots: readonly ProgressionSlot[], beat: number): ProgressionSlot {
  let acc = 0;
  for (const s of slots) { const b = s.beats ?? 4; if (beat >= acc - 1e-6 && beat < acc + b - 1e-6) return s; acc += b; }
  return slots[slots.length - 1];
}
/** ★ slot 的【真实和弦音】pc(rootOffset + type;含七/九/borrowed/secondary)—— 旋律贴合度按真和弦判,
 *  而非 scaleDegree 调内三和弦(否则 I 与 rootOffset=1 的假和弦得分相同 = 区分不出)。 */
function slotRealPcs(slot: ProgressionSlot, keyPc: number): number[] {
  const rootPc = mod12(keyPc + slot.rootOffset);
  return [...new Set(chordTypeIntervals(normalizeChordType(slot.type) ?? 'maj').map((iv) => mod12(rootPc + iv)))];
}
/** 前 4 小节(一个和弦循环)的 roman-per-bar key,用于退化检测。 */
function cycleRomanKey(slots: readonly ProgressionSlot[]): string {
  const out: string[] = [];
  for (let bar = 0; bar < 4; bar++) out.push(ROMAN[(deg17(slotAtBeat(slots, bar * 4).scaleDegree)) - 1]);
  return out.join('-');
}

export function scoreProgressionAgainstMelodicBrick(
  brick: UserMelodicBrick, intent: MotifHarmonyIntent, candidate: ProgressionCandidate, keyPc: number,
): { total: number; breakdown: ProgressionScoreBreakdown } {
  const slots = candidate.fittedSlots;
  const proto = candidate.prototype;

  const templatePrior = (proto.weight ?? 1) * 0.4;

  // 结构音支撑:motif 锚在 0/16/32/48 → 在【所有锚点】判贴合(8/16-bar 模板各循环和弦不同,
  //   只看第一处会在 bar 5/9/13 撞和弦)。结构音在越多锚点是和弦音 → 越贴合。
  const ANCHORS = [0, 16, 32, 48];
  let structuralToneSupport = 0, strongNonChord = 0;
  for (const t of brick.structuralTones) {
    if (t.onsetBeat >= brick.quoteBeats - 1e-6) continue;
    let ct = 0, n = 0;
    for (const a of ANCHORS) {
      if (a + t.onsetBeat >= 64 - 1e-6) continue;
      n++;
      if (slotRealPcs(slotAtBeat(slots, a + t.onsetBeat), keyPc).includes(mod12(t.midi))) ct++;
    }
    const frac = n ? ct / n : 0; // 在几个锚点处是和弦音(0..1)
    structuralToneSupport += t.weight * (frac * 1.25 - 0.25); // 全锚点和弦音 → +1·w;全非 → −0.25·w
    if (frac < 0.5 && t.weight >= 0.6) strongNonChord += t.weight * (1 - frac); // 多数锚点撞和弦
  }

  const headFit = brick.head && slotRealPcs(slotAtBeat(slots, 0), keyPc).includes(mod12(brick.head.midi)) ? 0.5 : 0;

  let tailFit = 0;
  if (brick.tail) {
    const tb = Math.min(brick.tail.onsetBeat, brick.quoteBeats - 0.01);
    tailFit = (slotRealPcs(slotAtBeat(slots, tb), keyPc).includes(mod12(brick.tail.midi)) ? 0.5 : -0.2) * Math.max(0.3, brick.tail.weight);
  }

  // cadence 适配:候选 cadence vs intent 偏好
  const cad = proto.cadence ?? 'loop';
  let cadenceFit = intent.preferTemplateCadence.includes(cad) ? 0.6 : 0;
  if (intent.cadenceNeed === 'strong' && cad === 'soft_authentic') cadenceFit += 0.4;
  if (intent.cadenceNeed === 'none' && (cad === 'open' || cad === 'loop')) cadenceFit += 0.3;
  if (intent.cadenceNeed === 'strong' && (cad === 'open' || cad === 'loop')) cadenceFit -= 0.35; // 要强收却给开放

  // 功能弧:进行含 S 和 D(不全 T)。多数 slot 无 effectiveFunc → 从级数推(1/3/6=T,2/4=S,5/7=D)。
  const slotFunc = (s: ProgressionSlot): 'T' | 'S' | 'D' => {
    if (s.effectiveFunc) return s.effectiveFunc;
    const d = deg17(s.scaleDegree);
    return d === 5 || d === 7 ? 'D' : d === 2 || d === 4 ? 'S' : 'T';
  };
  const funcs = new Set(slots.map(slotFunc));
  const functionArcFit = (funcs.has('S') ? 0.25 : 0) + (funcs.has('D') ? 0.35 : 0);

  // 乐句循环:lengthBars 整除 16 → 干净 4/8/16 循环
  const phraseCycleFit = 16 % Math.max(1, proto.lengthBars) === 0 ? 0.2 : 0;

  const degeneratePenalty = intent.avoidDegenerateProgressions.includes(cycleRomanKey(slots)) ? 2.0 : 0;
  const strongNonChordPenalty = strongNonChord * 0.5;

  const breakdown: ProgressionScoreBreakdown = { templatePrior, structuralToneSupport, headFit, tailFit, cadenceFit, functionArcFit, phraseCycleFit, degeneratePenalty, strongNonChordPenalty };
  const total = templatePrior + structuralToneSupport + headFit + tailFit + cadenceFit + functionArcFit + phraseCycleFit - degeneratePenalty - strongNonChordPenalty;
  return { total, breakdown };
}
