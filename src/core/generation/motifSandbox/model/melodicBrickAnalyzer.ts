// ============================================================
// motifSandbox · model · Melodic Brick 分析器(directive §7)
// ------------------------------------------------------------
// analyzeUserMelodicBrick(motif):纯函数。提结构音(长音/强拍/结构分/力度加权)→ 判 head/tail/
//   cadence motion → 概率分类功能(开句/趋近/终止/解决/起势/答句/经过/邻音/琶音/模进)。保留 evidence。
// ============================================================

import type { UserMotif } from './types';
import { metricalWeight } from '../capture/hiddenGridClock';
import {
  STRUCTURAL_TONE_MIN,
  type UserMelodicBrick, type StructuralMelodyTone, type CadenceMotion, type CadencePattern,
  type UserMelodicBrickFunction, type UserMelodicBrickFunctionScore,
} from './melodicBrickTypes';

const STABLE = new Set([1, 3, 5]);
const TENSION = new Set([2, 4, 7]);
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const beatInBar = (b: number): number => ((b % 4) + 4) % 4;

/** §7.1 结构权重:0.35 结构分 + 0.25 时值 + 0.20 节拍权重 + 0.20 力度。 */
function toneWeight(n: UserMotif['notes'][number]): number {
  const sts = n.structuralToneScore ?? n.accent;
  return clamp01(0.35 * sts + 0.25 * Math.min(1, n.durationBeat) + 0.20 * metricalWeight(beatInBar(n.onsetBeat)) + 0.20 * n.velocity);
}

function roleOf(i: number, last: number, n: UserMotif['notes'][number], midis: number[]): StructuralMelodyTone['role'] {
  if (i === 0) return 'head';
  if (i === last) return 'tail';
  const prev = midis[i - 1], next = midis[i + 1];
  if (prev !== undefined && next !== undefined) {
    if (n.midi > prev && n.midi >= next) return 'peak';
    if (n.midi < prev && n.midi <= next) return 'valley';
  }
  if (n.durationBeat >= 1) return 'long';
  if (Math.abs(n.onsetBeat - Math.round(n.onsetBeat)) < 1e-6) return 'strongBeat';
  return 'long';
}

function cadenceMotionOf(notes: UserMotif['notes']): CadenceMotion | null {
  if (notes.length < 2) return null;
  const a = notes[notes.length - 2].scaleDegree, b = notes[notes.length - 1].scaleDegree;
  const interval = Math.abs(notes[notes.length - 1].midi - notes[notes.length - 2].midi);
  let pattern: CadencePattern = 'none';
  if (a === 2 && b === 1) pattern = '2-1';
  else if (a === 7 && b === 1) pattern = '7-1';
  else if (a === 4 && b === 3) pattern = '4-3';
  else if (a === 5 && b === 1) pattern = '5-1';
  else if (a === 6 && b === 5) pattern = '6-5';
  else if (STABLE.has(b)) pattern = interval <= 2 ? 'stepToStable' : 'leapToStable';
  const strength = pattern === 'none' ? 0.2
    : pattern === '5-1' || pattern === '2-1' || pattern === '7-1' ? 0.9
      : pattern === '4-3' ? 0.7 : pattern === '6-5' ? 0.55 : 0.45;
  return { fromDegree: a, toDegree: b, pattern, strength };
}

function isArpeggio(degs: number[]): boolean {
  if (degs.length < 3) return false;
  const inTriad = degs.filter((d) => STABLE.has(d)).length;
  return inTriad / degs.length >= 0.75;
}
function isSequence(contour: number[]): boolean {
  if (contour.length < 4) return false;
  const h = Math.floor(contour.length / 2);
  for (let i = 0; i < h; i++) if (contour[i] !== contour[i + h]) return false;
  return true;
}

function scoreFunctions(tones: StructuralMelodyTone[], head: StructuralMelodyTone | null, tail: StructuralMelodyTone | null, cad: CadenceMotion | null, contour: number[]): UserMelodicBrickFunctionScore[] {
  const acc = new Map<UserMelodicBrickFunction, { c: number; ev: string[] }>();
  const add = (fn: UserMelodicBrickFunction, c: number, ev: string): void => {
    const e = acc.get(fn) ?? { c: 0, ev: [] }; e.c += c; e.ev.push(ev); acc.set(fn, e);
  };
  const tailDeg = tail?.scaleDegree ?? 1, tailW = tail?.weight ?? 0;
  const headDeg = head?.scaleDegree ?? 1;

  if (STABLE.has(tailDeg)) {
    add('cadence', 0.40 * tailW + 0.20, `尾音落稳定音 ${tailDeg}(权重 ${tailW.toFixed(2)})`);
    add('resolution', 0.35 * tailW + 0.15, `尾音解决到 ${tailDeg}`);
  } else if (TENSION.has(tailDeg)) {
    add('opening', 0.30 * tailW + 0.20, `尾音落开放音 ${tailDeg} → 句未收`);
    add('launcher', 0.25 * tailW + 0.15, `尾音张力音 ${tailDeg} → 起势`);
    add('approach', 0.20 * tailW + 0.10, `尾音 ${tailDeg} 趋近未达`);
  } else {
    add('cadence', 0.18, `尾音软稳定 ${tailDeg}`);
    add('answer', 0.15, `尾音 6 ≈ 半收`);
  }

  if (cad) {
    const s = cad.strength;
    switch (cad.pattern) {
      case '2-1': add('cadence', 0.50 * s, '2→1 终止式'); add('resolution', 0.30 * s, '2→1 解决'); break;
      case '5-1': add('cadence', 0.60 * s, '5→1 强终止'); add('resolution', 0.30 * s, '5→1 解决'); break;
      case '7-1': add('approach', 0.55 * s, '7→1 导音趋近'); add('resolution', 0.45 * s, '7→1 解决'); break;
      case '4-3': add('approach', 0.50 * s, '4→3 趋近'); add('resolution', 0.40 * s, '4→3 解决'); break;
      case '6-5': add('approach', 0.28 * s, '6→5'); add('cadence', 0.20 * s, '6→5'); break;
      case 'stepToStable': add('resolution', 0.25 * s, '级进入稳定'); break;
      case 'leapToStable': add('arpeggio', 0.20 * s, '跳进入稳定'); break;
      default: break;
    }
  }

  const firstDir = contour.find((c) => c !== 0) ?? 0;
  if (STABLE.has(headDeg) && firstDir > 0) add('opening', 0.40, `首音稳定 ${headDeg} + 上行 → 开句`);
  if (STABLE.has(headDeg) && firstDir < 0) add('answer', 0.22, `首音稳定 ${headDeg} + 下行 → 答句`);

  if (isArpeggio(tones.map((t) => t.scaleDegree))) add('arpeggio', 0.45, '轮廓多落 1/3/5 → 琶音');
  if (isSequence(contour)) add('sequence', 0.40, '前后半轮廓相同 → 模进');

  const entries: UserMelodicBrickFunctionScore[] = [...acc.entries()].map(([fn, v]) => ({ function: fn, confidence: clamp01(v.c), evidence: v.ev }));
  entries.sort((a, b) => b.confidence - a.confidence);
  if (entries.length === 0) entries.push({ function: 'ambiguous', confidence: 1, evidence: ['无明显结构特征'] });
  return entries;
}

/** UserMotif → UserMelodicBrick(纯函数,确定性)。quoteBeats 可选(长 motif 的子动机长度)。
 *  ★ 头/尾/cadence/轮廓按【quote 单元】(实际复现的子动机)算,而非完整 motif —— 否则长 motif
 *  的功能判断错位(用 4 小节末尾,但循环出现的是前 2 小节)。lengthBeats 仍记完整 motif 长度。 */
export function analyzeUserMelodicBrick(motif: UserMotif, quoteBeats?: number): UserMelodicBrick {
  const qBeats = quoteBeats ?? motif.lengthBeats;
  const allSorted = [...motif.notes].sort((a, b) => a.onsetBeat - b.onsetBeat);
  const quoteNotes = allSorted.filter((n) => n.onsetBeat < qBeats - 1e-6);
  const notes = quoteNotes.length >= 2 ? quoteNotes : allSorted; // 防御:quote 太短退回全 motif
  const midis = notes.map((n) => n.midi);
  const last = notes.length - 1;
  // §5:两层 —— allTones = 全部音(轮廓/节奏/调试);structuralTones = 骨干结构音(>= MIN,主导和声)。
  const allTones: StructuralMelodyTone[] = notes.map((n, i) => ({
    midi: n.midi, scaleDegree: n.scaleDegree, onsetBeat: n.onsetBeat, durationBeat: n.durationBeat,
    weight: toneWeight(n), role: roleOf(i, last, n, midis),
  }));
  const isStructural = (n: UserMotif['notes'][number]): boolean => (n.structuralToneScore ?? n.accent) >= STRUCTURAL_TONE_MIN;
  let structuralTones = allTones.filter((_, i) => isStructural(notes[i]));
  // 兜底:结构音太少 → 至少保留 head + tail,再按 toneWeight 补到 2(避免 cadence/head/tail 逻辑失效)。
  if (structuralTones.length < 2 && allTones.length) {
    const keep = new Set<StructuralMelodyTone>([allTones[0], allTones[allTones.length - 1]]);
    for (const t of [...allTones].sort((a, b) => b.weight - a.weight)) { if (keep.size >= 2) break; keep.add(t); }
    structuralTones = allTones.filter((t) => keep.has(t)); // 保持 onset 顺序
  }
  const head = allTones[0] ?? null;                       // 真实旋律首音(始终保留为结构候选)
  const tail = allTones[allTones.length - 1] ?? null;     // 真实旋律尾音
  const cadenceMotion = cadenceMotionOf(notes);
  const contour: number[] = [];
  for (let i = 1; i < notes.length; i++) contour.push(Math.sign(notes[i].midi - notes[i - 1].midi));
  // 功能分类看【旋律形状】用 allTones(轮廓/琶音身份不因结构过滤而变);和声贴合在 scorer 里只看 structuralTones。
  const functions = scoreFunctions(allTones, head, tail, cadenceMotion, contour);

  return {
    id: `brick-${motif.id}`,
    sourceMotifId: motif.id,
    keyPc: motif.keyPc, mode: motif.mode,
    lengthBeats: motif.lengthBeats,
    lengthBars: Math.max(1, Math.round(motif.lengthBeats / 4)),
    quoteBeats: qBeats,
    head, tail, allTones, structuralTones,
    contour, rhythmSignature: notes.map((n) => n.durationBeat),
    cadenceMotion,
    functions, primaryFunction: functions[0].function,
    evidence: functions[0].evidence,
  };
}
