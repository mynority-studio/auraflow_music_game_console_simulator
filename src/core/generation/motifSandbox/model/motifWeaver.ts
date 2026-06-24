// ============================================================
// motifSandbox · model · Motif Weaver(Impro-Visor ThemeWeaver 复现办法,2026-06-15 重写)
// ------------------------------------------------------------
// 不再"复制第一轮"(用户:重复性太高/太密/没续写)。改用 Impro-Visor 的【陈述 + 发展】结构:
//   ① 16 小节曲式切成若干【theme-interval 槽】(槽长 = motif 小节数)。
//   ② 每槽掷骰(probTheme):陈述主题 vs 发展/连接 —— 主题在结构锚点【再现】(head/return/recap),
//      锚点之间【发展】(diatonic 移位=模进 / 倒影 / 逆行 / 片段 / 扩张 / 小节线位移),
//      连接槽【每小节一长音】= 稀疏留白透气(降密度)。
//   ③ 发展/连接落新和弦 → 和声适配(强拍/长音吸到和弦音,RectifyPitches 后处理)。
//   ④ 连接平滑(connectSections + 作曲原则:级进为主、跳进≤小六度、音域带、末音解决到主和弦)。
//   ⑤ 确定性(seeded rng)、非 jazz 全 diatonic。主题【可辨】但不再是逐拍复制。
// 参考:ThemeWeaver.myGenerateSolo / adjustTheme / connectSections / RectifyPitchesCommand。
// ============================================================

import type { MotifNote, MotifOccurrence, MotifWeaverInput, MotifWeaverResult, QuotePlan, ScaleMode, UserMotif } from './types';
import { analyzeAndNormalize } from './motifAnalysis';
import { defaultSandboxForm } from './types';
import {
  identity, fitRange, transposeDiatonicMotif, invertAroundMidi, retrogradePitchOnly,
  rhythmDivide, augmentMotif, fragmentMotif, displaceMotif,
} from './motifTransform';
import { snapMidiToScale, isInScale, transposeDiatonic } from './scale';
import { buildProgression } from './motifHarmony';
import { analyzeUserMelodicBrick } from './melodicBrickAnalyzer';
import { inferHarmonyIntent } from './melodicBrickHarmonyIntent';
import { selectProgressionForMotif } from './motifProgressionSelector';
import { realizeToSandboxChords, buildMotifRoadmap } from './motifRoadmap';
import { buildMelodicSlotPlanFromRoadMap } from './melodicSlotPlanner';
import type { SelectedMotifProgression, UserMelodicBrick, MotifMelodicRoadmap, MelodicSlotPlan, MelodicSlot } from './melodicBrickTypes';
import { chordAtBeat, nearestChordTone, isChordTone, effectiveTonePcs, type SandboxChord } from './chords';
import { auditMotifWeave } from './jazzinessAudit';
import { sanitizeMotifLeadNotes } from './leadSanitizer';
import { buildPitchContractContext, rectifyToPitchContract, type PitchContractContext } from './pitchContract';
import { makeRng, type SeededRng } from './rng';

const BAR = 4;
const LEAD_LOW = 60, LEAD_HIGH = 84;
const MAX_LEAP = 8;     // 小六度;> 此值八度收拢(作曲原则:级进为主、跳进≤小六度)
const ONSET_GRID = 0.25; // 1/16 拍 —— 输出 onset 吸到此网格 → 与伴奏稳稳对拍(divide 装饰音不再落网格外)
const PHRASE_BARS = 4;              // 和弦进行乐句长度(= buildProgression 乐句);motif 陈述【相位锁定】到每个乐句头 = 排比
const ANSWER_CONNECT_CHANCE = 0.35; // 应答区里偶尔用连接留白(透气);首个实例恒为发展

// ============================================================
// 发展手法(diatonic-safe;Impro-Visor adjustTheme 的轻量复现)
// ============================================================
type DevOp =
  | { t: 'transpose'; steps: number }   // diatonic 移位 = 模进(sequence)
  | { t: 'invert' }                     // 倒影(围绕首音)
  | { t: 'retro' }                      // 逆行(只逆 pitch)
  | { t: 'divide' }                     // 长音裂解(加花)
  | { t: 'fragment'; keep: number }     // 片段化(只取前段 → 留白,降密度)
  | { t: 'augment'; factor: number }    // 节奏扩张(拉长,降密度)
  | { t: 'displace'; beats: number };   // 小节线位移(切分/错位)


const PRIMARIES: { ops: DevOp[]; label: string }[] = [
  { ops: [{ t: 'transpose', steps: 2 }], label: 'transpose+2' },  // 上行三度模进
  { ops: [{ t: 'transpose', steps: 1 }], label: 'transpose+1' },  // 上行二度模进
  { ops: [{ t: 'transpose', steps: -2 }], label: 'transpose-2' }, // 下行三度模进
  { ops: [{ t: 'transpose', steps: -1 }], label: 'transpose-1' }, // 下行二度模进
  { ops: [{ t: 'invert' }], label: 'invert' },
  { ops: [{ t: 'retro' }], label: 'retro' },
];
// 主手法权重:移位(模进)多,倒影/逆行少。
const PRIMARY_BAG = [0, 0, 1, 1, 2, 3, 4, 5];
const RHYTHM_OPS: { op: DevOp; tag: string }[] = [
  { op: { t: 'divide' }, tag: '+div' },
  { op: { t: 'fragment', keep: 0.5 }, tag: '+frag' },
  { op: { t: 'augment', factor: 2 }, tag: '+aug' },
  { op: { t: 'displace', beats: 1 }, tag: '+shift' },
];

/** 抽一个发展手法(主手法 + 概率叠一个节奏手法),尽量不与上一发展槽同主手法。 */
function pickDevOps(rng: SeededRng, avoidLabel: string): { ops: DevOp[]; label: string } {
  let chosen = PRIMARIES[rng.pick(PRIMARY_BAG)];
  for (let tries = 0; chosen.label === avoidLabel && tries < 4; tries++) chosen = PRIMARIES[rng.pick(PRIMARY_BAG)];
  const ops = [...chosen.ops];
  let label = chosen.label;
  if (rng.chance(0.5)) { const r = rng.pick(RHYTHM_OPS); ops.push(r.op); label += r.tag; }
  return { ops, label };
}

/** 相位锁定的【原样陈述】:把 base 原样落 atBeat(不 octave-align → 每个和弦进行乐句的同一相对位置
 *  出现【完全相同】的 motif = 排比/anaphora)。head/restate/recap 都走它。 */
function placeQuoteVerbatim(base: readonly MotifNote[], atBeat: number, span: number, slotIndex: number): MotifNote[] {
  const out: MotifNote[] = [];
  for (const n of base) {
    if (n.onsetBeat >= span - 1e-6) continue;
    out.push({ ...n, onsetBeat: atBeat + n.onsetBeat, durationBeat: Math.min(n.durationBeat, span - n.onsetBeat), occurrenceKind: 'quote', slotIndex });
  }
  return out;
}

// ============================================================
// 槽落子
// ============================================================
function applyOps(base: readonly MotifNote[], ops: readonly DevOp[], keyPc: number, mode: ScaleMode): MotifNote[] {
  let notes = base.map((n) => ({ ...n }));
  for (const op of ops) {
    switch (op.t) {
      case 'transpose': notes = transposeDiatonicMotif(notes, op.steps, keyPc, mode); break;
      case 'invert': notes = invertAroundMidi(notes, notes[0]?.midi ?? 72, keyPc, mode); break;
      case 'retro': notes = retrogradePitchOnly(notes); break;
      case 'divide': notes = rhythmDivide(notes, keyPc, mode); break;
      case 'fragment': notes = fragmentMotif(notes, op.keep); break;
      case 'augment': notes = augmentMotif(notes, op.factor); break;
      case 'displace': notes = displaceMotif(notes, op.beats); break;
    }
  }
  return notes;
}

/** 把整槽统一八度对齐:首音就近 context(上一音),整体再回拉进音域带(保内部音程 = 主题可辨)。 */
function octaveAlign(notes: MotifNote[], targetMidi: number, bandLo: number, bandHi: number): MotifNote[] {
  if (!notes.length) return notes;
  let shift = 0, bestD = Math.abs(notes[0].midi - targetMidi);
  for (const cand of [-24, -12, 12, 24]) { const d = Math.abs(notes[0].midi + cand - targetMidi); if (d < bestD) { bestD = d; shift = cand; } }
  let lo = Math.min(...notes.map((n) => n.midi)) + shift;
  let hi = Math.max(...notes.map((n) => n.midi)) + shift;
  while (hi > bandHi && lo - 12 >= bandLo) { shift -= 12; lo -= 12; hi -= 12; }
  while (lo < bandLo && hi + 12 <= bandHi) { shift += 12; lo += 12; hi += 12; }
  return shift === 0 ? notes : notes.map((n) => ({ ...n, midi: n.midi + shift }));
}

/** 陈述槽(state=原样 quote / develop=变形):落 atBeat,按槽长裁剪,八度对齐到 context。 */
function placeStatement(base: readonly MotifNote[], ops: readonly DevOp[], atBeat: number, slotBeats: number, slotIndex: number, kind: 'quote' | 'develop', prevMidi: number, bandLo: number, bandHi: number, keyPc: number, mode: ScaleMode): MotifNote[] {
  let v = applyOps(base, ops, keyPc, mode);
  v = octaveAlign(v, prevMidi, bandLo, bandHi);
  const out: MotifNote[] = [];
  for (const n of v) {
    if (n.onsetBeat >= slotBeats - 1e-6) continue;
    out.push({ ...n, onsetBeat: atBeat + n.onsetBeat, durationBeat: Math.min(n.durationBeat, slotBeats - n.onsetBeat), occurrenceKind: kind, slotIndex });
  }
  return out;
}

/** 连接槽:每小节一个【就近和弦音长音】(半拍留白)= 稀疏透气,接住前音、引向下一陈述。 */
function placeConnect(atBeat: number, slotBeats: number, slotIndex: number, progression: readonly SandboxChord[], fromMidi: number): MotifNote[] {
  const out: MotifNote[] = [];
  const bars = Math.max(1, Math.round(slotBeats / BAR));
  let prev = fromMidi;
  for (let b = 0; b < bars; b++) {
    const at = atBeat + b * BAR;
    if (at >= atBeat + slotBeats - 1e-6) break;
    const ch = chordAtBeat(progression, at) ?? progression[0];
    const midi = nearestChordTone(prev, ch);
    out.push({ midi, onsetBeat: at, durationBeat: 2.5, velocity: 0.58, scaleDegree: 0, octave: 0, accent: 0.45, occurrenceKind: 'connect', slotIndex });
    prev = midi;
  }
  return out;
}

/** 和声适配(Impro-Visor RectifyPitches 后处理):强拍/长音的非和弦音吸到就近和弦音;不碰 quote。
 *  ★ blues contract Phase 4:布鲁斯输入走【合同感知 rectify】(结构音→stable∪color、弱音留 scale/approach,
 *  蓝调音由 seasoned 和弦容纳);非布鲁斯保持旧逻辑(directive §10:非布鲁斯不放松,字节不变)。 */
function adaptToHarmony(notes: MotifNote[], progression: readonly SandboxChord[], pitchCtx?: PitchContractContext): void {
  if (pitchCtx?.isBluesInput) { rectifyToPitchContract(notes, pitchCtx, { preserveQuote: true }); return; }
  for (const n of notes) {
    const ch = chordAtBeat(progression, n.onsetBeat);
    if (!ch) continue;
    const onBeat = Math.abs(n.onsetBeat - Math.round(n.onsetBeat)) < 1e-6;
    if ((onBeat || n.durationBeat >= 1) && !isChordTone(n.midi, ch)) n.midi = nearestChordTone(n.midi, ch);
  }
}

// ============================================================
// Phase 5:slot-plan 驱动渲染(renderMelodicSlot)—— weaver 从"自己排乐句"变成"填 RoadMap 派生的 slot"
// ============================================================
const LEAD_BAND = (base: readonly MotifNote[]): { lo: number; hi: number } => {
  const refLow = Math.min(...base.map((n) => n.midi));
  const refHigh = Math.max(...base.map((n) => n.midi));
  return { lo: Math.max(LEAD_LOW - 1, refLow - 1), hi: Math.min(LEAD_HIGH + 2, refHigh + 4) };
};
const hashId = (s: string): number => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** cadence slot 且 motif 比 slot 长 → 取 motif【结构尾片段】(末 span 拍),re-anchor 到 slot(§8)。 */
function placeMotifTail(base: readonly MotifNote[], atBeat: number, span: number, motifBeats: number, slotIndex: number): MotifNote[] {
  const from = motifBeats - span;
  const out: MotifNote[] = [];
  for (const n of base) {
    if (n.onsetBeat < from - 1e-6) continue;
    const off = n.onsetBeat - from;
    out.push({ ...n, onsetBeat: atBeat + off, durationBeat: Math.min(n.durationBeat, span - off), occurrenceKind: 'quote', slotIndex });
  }
  return out;
}

/** 和弦音升序序列(从 ≥ floor 的最低和弦音起,取 count 个,不越 ceil)。 */
function arpUp(ch: SandboxChord, floor: number, count: number, ceil: number): number[] {
  const pcs = effectiveTonePcs(ch);
  const inChord = (m: number): boolean => pcs.includes(((m % 12) + 12) % 12);
  const out: number[] = [];
  let m = Math.max(36, Math.round(floor));
  while (!inChord(m) && m < ceil) m++;
  for (let i = 0; i < count && m <= ceil; i++) { out.push(m); let n = m + 1; while (!inChord(n) && n <= ceil) n++; m = n; }
  return out.length ? out : [nearestChordTone(floor, ch)];
}

/** generatedOnly 槽:按 requiredFunction 生成【不同音乐行为】(directive §8)——
 *  opening=和弦音升序琶音(建立调性)· approach=级进趋近下个和弦根· cadence/resolution=下行解决到主和弦音·
 *  continuation/answer/fill=连接长音。全部跟和声(和弦音/调内),末由 smoothAndResolve 收平滑。 */
function generateForFunction(slot: MelodicSlot, at: number, span: number, idx: number, progression: readonly SandboxChord[], prevMidi: number, bandLo: number, bandHi: number, keyPc: number, mode: ScaleMode): MotifNote[] {
  const fn = slot.requiredFunction;
  const ch = chordAtBeat(progression, at) ?? progression[0];
  // ★ str = structuralToneScore:级进趋近/导音是【弱经过音】(低 str)→ 合同按弱经过判、comp/bass 不锚它;
  //   落点(和弦音)给高 str = 结构音。无 str(opening 琶音和弦音)→ 退 onBeat/长音判(本就是和弦音)。
  const mk = (midi: number, on: number, dur: number, acc: number, str?: number): MotifNote => ({ midi, onsetBeat: on, durationBeat: dur, velocity: 0.56, scaleDegree: 0, octave: 0, accent: acc, structuralToneScore: str, occurrenceKind: 'connect', slotIndex: idx });
  const within = (ns: MotifNote[]): MotifNote[] => ns.filter((n) => n.onsetBeat < at + span - 1e-6);

  if (fn === 'opening') {
    const n = Math.max(2, Math.min(4, Math.round(span)));
    const arp = arpUp(ch, Math.max(bandLo, prevMidi - 5), n, bandHi);
    return within(arp.map((m, i) => mk(m, at + i, i === arp.length - 1 ? Math.min(2, span - i) : 0.9, i === 0 ? 0.6 : 0.45)));
  }
  if (fn === 'approach') {
    const nextCh = chordAtBeat(progression, at + span + 0.01) ?? ch;
    const target = nearestChordTone(prevMidi, nextCh);
    const start = Math.max(at, at + span - 2);
    return within([mk(snapMidiToScale(target - 2, keyPc, mode), start, 0.9, 0.45, 0.25), mk(snapMidiToScale(target - 1, keyPc, mode), start + 1, 0.9, 0.5, 0.25)]); // 级进趋近(导音式,弱经过)
  }
  if (fn === 'cadence' || fn === 'resolution') {
    const land = nearestChordTone(prevMidi, ch); // 解决到当拍和弦音(末音长;本就是和弦音 → 不标 str,保 accompaniment 旧行为)
    return within([mk(snapMidiToScale(land + 2, keyPc, mode), at, 0.9, 0.45, 0.25), mk(snapMidiToScale(land + 1, keyPc, mode), at + 1, 0.9, 0.45, 0.25), mk(land, at + 2, Math.max(1, span - 2), 0.58)]);
  }
  return placeConnect(at, span, idx, progression, prevMidi); // continuation / answer / fill
}

// ============================================================
// ★ 排比微变化(用户 2026-06-22 → 06-23 收紧):A B A B —— 第 1/3/5… 遍 quote 原样陈述;第 2/4/6… 遍加【微变化】。
//   ★ 只动【尾部(后半部分)】、共 2 处:① 改尾部一处音(当前和弦 ∩ 音阶【正交集】里 ≠ 原音、就近)
//   ② 加尾部一处音(后半空拍插经过音 / 加倍尾部长音)。改太多就听不出是用户弹奏。seed 固定 → B 维持一致。
// ============================================================

/** 和弦 ∩ 音阶【正交集】里离 cur 最近、且 ≠ cur 的音(改尾/结构音用)。无解 → null。 */
function pickOrthogonalDifferent(cur: number, chord: SandboxChord, keyPc: number, mode: ScaleMode, lo: number, hi: number): number | null {
  const pcs = effectiveTonePcs(chord).filter((pc) => isInScale(60 + pc, keyPc, mode)); // 和弦音 ∩ 音阶
  if (!pcs.length) return null;
  let best: number | null = null, bestD = Infinity;
  for (let m = Math.max(0, lo); m <= Math.min(127, hi); m++) {
    if (m === cur || !pcs.includes(((m % 12) + 12) % 12)) continue;
    const d = Math.abs(m - cur);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

/** 两音 a→b 之间的【音阶就近经过音】(放宽到音阶,可非和弦音)。跨度够 → 取中间音阶音;否则取 a 朝 b 的邻音。 */
function passingScaleTone(a: number, b: number, keyPc: number, mode: ScaleMode): number {
  if (Math.abs(a - b) >= 3) return snapMidiToScale(Math.round((a + b) / 2), keyPc, mode);
  const dir = b >= a ? 1 : -1;
  const step = transposeDiatonic(a, dir, keyPc, mode);
  return step !== a ? step : snapMidiToScale(a + dir, keyPc, mode);
}

/** 排比第 2/4/… 遍 quote 的【微变化】(2026-06-23 用户:只动尾部,1 处改音 + 1 处加音 —— 改太多就听不出是
 *  用户弹奏)。★ 都在【后半部分(尾部)】:① 改尾部一处音(和弦∩音阶正交,≠原,不动首音)② 加尾部一处音
 *  (后半空拍插经过音 / 加倍尾部长音)。seeded(主 seed 固定 → B 维持一致);第一遍(偶数次)不调此函数。 */
function varyMotifQuote(quote: readonly MotifNote[], progression: readonly SandboxChord[], keyPc: number, mode: ScaleMode, seed: number, lo: number, hi: number): MotifNote[] {
  const out = quote.map((n) => ({ ...n }));
  if (out.length < 2) return out;
  const rng = makeRng((seed ^ 0x5ec0ded1) >>> 0);
  // 后半部分(尾部)= onset ≥ 范围中点;不动首音(idx≥1,保陈述识别)
  const minOn = Math.min(...out.map((n) => n.onsetBeat));
  const maxEnd = Math.max(...out.map((n) => n.onsetBeat + n.durationBeat));
  const mid = minOn + (maxEnd - minOn) / 2;
  const tail = out.map((_, i) => i).filter((i) => i >= 1 && out[i].onsetBeat >= mid - 1e-6);
  if (!tail.length) return out; // 极短 motif 无后半音 → 不变(罕见)

  // ① 改尾部【一处】音(和弦∩音阶正交,≠原):末尾往前找第一个能换的
  for (let k = tail.length - 1; k >= 0; k--) {
    const idx = tail[k];
    const chord = chordAtBeat(progression, out[idx].onsetBeat) ?? progression[0];
    const alt = pickOrthogonalDifferent(out[idx].midi, chord, keyPc, mode, lo, hi);
    if (alt != null) { out[idx] = { ...out[idx], midi: alt }; break; }
  }

  // ② 加尾部【一处】音:后半空拍 ≥0.5 拍 → 插经过音;否则加倍后半一个 ≥0.5 拍的音。seed 定先试哪种(留点变化)。
  const tryPassing = (): boolean => {
    for (let k = 0; k < tail.length - 1; k++) {
      const i = tail[k], j = tail[k + 1];
      const gap = out[j].onsetBeat - (out[i].onsetBeat + out[i].durationBeat);
      if (gap >= 0.5 - 1e-6) {
        const at = Math.round((out[i].onsetBeat + out[i].durationBeat) / ONSET_GRID) * ONSET_GRID;
        out.push({ ...out[i], midi: passingScaleTone(out[i].midi, out[j].midi, keyPc, mode), onsetBeat: at, durationBeat: Math.min(0.25, gap), velocity: Math.max(0.3, out[i].velocity * 0.85), occurrenceKind: 'quote' });
        return true;
      }
    }
    return false;
  };
  const tryDouble = (): boolean => {
    for (let k = tail.length - 1; k >= 0; k--) {
      const idx = tail[k];
      if (out[idx].durationBeat >= 0.5) {
        const half = out[idx].durationBeat / 2;
        const at2 = Math.round((out[idx].onsetBeat + half) / ONSET_GRID) * ONSET_GRID;
        if (at2 > out[idx].onsetBeat + 1e-6) { out.push({ ...out[idx], onsetBeat: at2, durationBeat: half, velocity: Math.max(0.3, out[idx].velocity * 0.9) }); out[idx] = { ...out[idx], durationBeat: half }; return true; }
      }
    }
    return false;
  };
  if (rng.next() < 0.55) { if (!tryPassing()) tryDouble(); } else { if (!tryDouble()) tryPassing(); }

  return out.sort((a, b) => a.onsetBeat - b.onsetBeat || b.midi - a.midi);
}

/** 渲染单个旋律 slot(directive §8)。返回音符 + 发展标签(供 occurrence/审计统计发展手法多样性)。
 *  mustQuote=原样(过长且 cadence 取尾) · mustDevelop=变形 · mayReference=节奏轮廓片段 · generatedOnly=按功能生成。
 *  ★ quoteOccurrence:mustQuote 的第几遍(0-based);奇数遍(第 2/4/…)加微变化(A B A B 排比)。 */
export function renderMelodicSlot(args: {
  slot: MelodicSlot;
  userMotif: UserMotif;
  userBrick: UserMelodicBrick;
  progression: readonly SandboxChord[];
  previousNotes: readonly MotifNote[];
  seed: number;
  keyPc: number;
  mode: ScaleMode;
  avoidLabel?: string;
  quoteBeats?: number; // 排比一致长度(子动机);默认整段 motif。quote 裁到 min(quoteBeats, slot span)
  quoteOccurrence?: number; // mustQuote 的第几遍(0-based);奇数遍加微变化(A B A B)
  pitchCtx?: PitchContractContext; // ★ blues contract Phase 4:布鲁斯输入下合同感知 rectify
}): { notes: MotifNote[]; label: string } {
  const { slot, userMotif, progression, previousNotes, keyPc, mode, pitchCtx } = args;
  const base = fitRange(identity(userMotif.notes), LEAD_LOW, LEAD_HIGH);
  if (!base.length) return { notes: [], label: 'empty' };
  const { lo: bandLo, hi: bandHi } = LEAD_BAND(base);
  const motifBeats = Math.max(...base.map((n) => n.onsetBeat + n.durationBeat));
  const quoteLen = Math.min(args.quoteBeats ?? motifBeats, motifBeats); // 排比单元长度(子动机)
  const prevMidi = previousNotes.length ? previousNotes[previousNotes.length - 1].midi : base[0].midi;
  const rng = makeRng((args.seed ^ hashId(slot.id)) >>> 0);
  const at = slot.startBeat, span = slot.durationBeats, idx = Math.round(at / BAR);

  switch (slot.userMotifPolicy) {
    case 'mustQuote': {
      // cadence slot 且子动机比 slot 长 → 取结构尾片段(填满 slot,不留死寂)。
      if (slot.requiredFunction === 'cadence' && quoteLen > span + 1e-6) return { notes: placeMotifTail(base, at, span, quoteLen, idx), label: 'quote:tail' };
      // 否则:曲首/再现【原样陈述子动机】+ 槽内剩余空间【继续发展】填充(陈述后不留大段死寂)。
      const qLen = Math.min(quoteLen, span);
      const q0 = placeQuoteVerbatim(base, at, qLen, idx);
      // ★ A B A B(用户 2026-06-22):偶数遍原样;奇数遍(第 2/4/…)加微变化(≤3 音,seeded,可辨认)
      const odd = ((args.quoteOccurrence ?? 0) % 2) === 1;
      const q = odd ? varyMotifQuote(q0, progression, keyPc, mode, args.seed, bandLo, bandHi) : q0;
      const tailSpan = span - qLen;
      let tail: MotifNote[] = [];
      if (tailSpan >= BAR - 1e-6) {
        const last = q.length ? q[q.length - 1].midi : prevMidi;
        tail = fillAnswer(base, at + qLen, tailSpan, quoteLen, progression, rng, '', last, bandLo, bandHi, keyPc, mode, idx, pitchCtx).notes;
      }
      return { notes: [...q, ...tail], label: odd ? 'quote:vary' : 'quote' };
    }
    case 'mustDevelop': {
      // 填满整个 slot(模进/倒影/逆行 + 偶尔连接留白),避免长 brick 留大段空拍。
      const r = fillAnswer(base, at, span, quoteLen, progression, rng, args.avoidLabel ?? '', prevMidi, bandLo, bandHi, keyPc, mode, idx, pitchCtx);
      return { notes: r.notes, label: r.label || 'develop' };
    }
    case 'mayReference': {
      // 轻引用:片段化开头 + 填满剩余(节奏/轮廓延续,不留死寂)。
      const frag = placeStatement(base, [{ t: 'fragment', keep: 0.5 }], at, Math.min(quoteLen, span), idx, 'develop', prevMidi, bandLo, bandHi, keyPc, mode);
      adaptToHarmony(frag, progression, pitchCtx);
      const used = Math.min(quoteLen, span);
      let tail: MotifNote[] = [];
      if (span - used >= BAR - 1e-6) {
        const last = frag.length ? frag[frag.length - 1].midi : prevMidi;
        tail = fillAnswer(base, at + used, span - used, quoteLen, progression, rng, '', last, bandLo, bandHi, keyPc, mode, idx, pitchCtx).notes;
      }
      return { notes: [...frag, ...tail], label: 'ref:frag' };
    }
    case 'generatedOnly':
    default:
      return { notes: generateForFunction(slot, at, span, idx, progression, prevMidi, bandLo, bandHi, keyPc, mode), label: `gen:${slot.requiredFunction}` }; // 按 requiredFunction 生成不同音乐行为(seasoned 和弦 effectiveTonePcs 已含蓝调色)
  }
}

/** 应答区(乐句里 motif 之后那段):铺【developed motif 序列】(模进/倒影… → 续写),偶尔连接留白(透气)。
 *  首个实例恒为发展(保证每乐句都有发展),其余按概率 develop/connect。 */
function fillAnswer(base: readonly MotifNote[], startBeat: number, span: number, motifBeats: number, progression: readonly SandboxChord[], rng: SeededRng, avoidLabel: string, fromMidi: number, bandLo: number, bandHi: number, keyPc: number, mode: ScaleMode, slotIndex: number, pitchCtx?: PitchContractContext): { notes: MotifNote[]; label: string; lastMidi: number; avoid: string } {
  const out: MotifNote[] = [];
  const labels: string[] = [];
  let cursor = startBeat, prev = fromMidi, avoid = avoidLabel, k = 0;
  while (cursor < startBeat + span - 1e-6 && k < 8) {
    const instSpan = Math.min(motifBeats, startBeat + span - cursor);
    if (k > 0 && instSpan >= BAR - 1e-6 && rng.chance(ANSWER_CONNECT_CHANCE)) {
      const c = placeConnect(cursor, instSpan, slotIndex, progression, prev);
      out.push(...c); labels.push('connect');
      if (c.length) prev = c[c.length - 1].midi;
    } else {
      const { ops, label } = pickDevOps(rng, avoid); avoid = label;
      const notes = placeStatement(base, ops, cursor, instSpan, slotIndex, 'develop', prev, bandLo, bandHi, keyPc, mode);
      adaptToHarmony(notes, progression, pitchCtx);
      out.push(...notes); labels.push(label);
      if (notes.length) prev = notes[notes.length - 1].midi;
    }
    cursor += motifBeats; k++;
  }
  return { notes: out, label: labels.join('+') || 'connect', lastMidi: prev, avoid };
}

// ============================================================
// 连接平滑(级进为主、跳进≤小六度、音域带、末音解决)
// ============================================================
/** 把 m 折叠到 anchor 的 ≤ 小六度内(优先八度收拢,再吸进音域带,兜底拉到四度内)。 */
function foldToward(m: number, anchor: number, bandLo: number, bandHi: number, keyPc: number, mode: ScaleMode): number {
  while (m - anchor > MAX_LEAP && m - 12 >= bandLo) m -= 12;
  while (anchor - m > MAX_LEAP && m + 12 <= bandHi) m += 12;
  while (m > bandHi && m - 12 >= bandLo) m -= 12;
  while (m < bandLo && m + 12 <= bandHi) m += 12;
  if (Math.abs(m - anchor) > MAX_LEAP) m = snapMidiToScale(anchor + (m > anchor ? 5 : -5), keyPc, mode); // 还大跳 → 拉到四度内(diatonic)
  return m;
}

/** 双向夹紧:取同时 ≤ 小六度于【前音 a】与【后音 b】的 diatonic 音,离 cur 最近(进入 quote 锚点用)。 */
function reconcile(cur: number, a: number, b: number, keyPc: number, mode: ScaleMode): number {
  const lo = Math.ceil(Math.max(a, b) - MAX_LEAP);
  const hi = Math.floor(Math.min(a, b) + MAX_LEAP);
  let best = cur, bestD = Infinity;
  for (let m = lo; m <= hi; m++) {
    if (!isInScale(m, keyPc, mode)) continue;
    const d = Math.abs(m - cur);
    if (d < bestD) { bestD = d; best = m; }
  }
  return bestD === Infinity ? snapMidiToScale(Math.round((a + b) / 2), keyPc, mode) : best; // 窗空(两锚 >2×小六度,band 保证不发生)→ 中点
}

/** 末音解决到主和弦:落就近和弦音;若与前音成大跳则改落【离前音最近】的和弦音(保平滑)。 */
function resolveNote(cur: number, prev: number, ch: SandboxChord): number {
  const cand = nearestChordTone(cur, ch);
  return Math.abs(cand - prev) <= MAX_LEAP ? cand : nearestChordTone(prev, ch);
}

function smoothAndResolve(lead: MotifNote[], bandLo: number, bandHi: number, keyPc: number, mode: ScaleMode, progression: readonly SandboxChord[]): MotifNote[] {
  const s = [...lead].sort((a, b) => a.onsetBeat - b.onsetBeat);
  // 前向:非 quote 音折叠到 ≤ 小六度(quote = 固定锚点,不动)。
  for (let i = 1; i < s.length; i++) {
    if (s[i].occurrenceKind === 'quote') continue;
    s[i].midi = foldToward(s[i].midi, s[i - 1].midi, bandLo, bandHi, keyPc, mode);
  }
  // 进入 quote 的【前一个非 quote 音】双向夹紧(同时顾及其前音 + quote 首音,避免单向夹紧反弹出大跳)。
  for (let i = 1; i < s.length; i++) {
    if (s[i].occurrenceKind !== 'quote') continue;
    const p = s[i - 1];
    if (p.occurrenceKind === 'quote') continue;
    p.midi = reconcile(p.midi, i >= 2 ? s[i - 2].midi : s[i].midi, s[i].midi, keyPc, mode);
  }
  // 末音解决到主和弦(曲式闭合,保平滑)—— ★ 不动 quote 音(保原样陈述完整,曲尾正好是 quote 时不破坏)。
  if (s.length && s[s.length - 1].occurrenceKind !== 'quote') {
    const last = s[s.length - 1];
    const ch = chordAtBeat(progression, last.onsetBeat) ?? progression[progression.length - 1];
    last.midi = resolveNote(last.midi, s.length >= 2 ? s[s.length - 2].midi : last.midi, ch);
  }
  return s;
}

// ============================================================
// 主入口
// ============================================================
export function generateMotifWeave(input: MotifWeaverInput): MotifWeaverResult {
  const { keyPc, mode } = input;
  // hidden-grid 已分析好的 motif 直接用;否则走 free 路径分析(向后兼容)
  const motif = input.motif ?? analyzeAndNormalize(input.capturedNotes, keyPc, mode, input.bpm, input.seed, input.inputTonality).motif;
  // ★ 输入音阶(blues contract Phase 1):input 优先,否则取 motif 自带(hidden-grid 预分析时写入)。
  const inputTonality = input.inputTonality ?? motif.inputTonality;
  const quotePlan: QuotePlan = input.quotePlan ?? 'phraseHeads'; // 默认排比(每乐句头原样)
  const rng = makeRng((input.seed ^ 0x9e3779b9) >>> 0);

  // ★ 曲长来自 form context(默认 16 bar)—— 不再是 weaver 内的隐藏常量(directive Phase 1)。
  const form = input.form ?? defaultSandboxForm();
  const targetBars = Math.max(1, Math.round(form.totalBars));
  const targetBeats = targetBars * BAR;

  const motifBars = Math.max(1, Math.min(PHRASE_BARS, Math.round(motif.lengthBeats / BAR)));
  // §4:quote 单元 = 排比陈述长度。motif 满 4 小节会吃光乐句(应答区=0,退化成 4 段死复制)→
  //   缩到前 2 小节【子动机】,保证每个和弦循环【既有原样再现、又有续写】。≤2 小节 motif 整段 quote。
  const quoteBars = motifBars >= PHRASE_BARS ? 2 : motifBars;
  const motifBeats = quoteBars * BAR;            // 陈述/quote 长度(相位锁定到乐句头)
  const phraseBeats = PHRASE_BARS * BAR;         // 一个和弦进行乐句 = 16 拍
  const answerBeats = phraseBeats - motifBeats;  // 乐句里 quote 之后的应答区 —— 恒 > 0(留发展空间)
  const numPhrases = Math.max(1, Math.round(targetBeats / phraseBeats));
  // ★ 和声:旋律 brick 驱动【从 newEngine 进行模板库选模板】(替换逐 bar 贪心 buildProgression)。
  //   选不出(模板库空等)→ 兜底回老 buildProgression。只读知识层,不碰生产链。
  const brick: UserMelodicBrick = analyzeUserMelodicBrick(motif, motifBeats);
  let selected: SelectedMotifProgression | null = null;
  let roadmap: MotifMelodicRoadmap | null = null;
  let harmonySource: 'template' | 'fallback' = 'fallback';
  let harmonyError: string | undefined;
  let progression: SandboxChord[];
  try {
    selected = selectProgressionForMotif({ brick, intent: inferHarmonyIntent(brick), style: input.style, mode, keyPc, seed: input.seed, targetBars, sectionRole: form.sections[0]?.role ?? 'verse' });
    // ★ blues contract Phase 3:布鲁斯输入 → realize 时做有界调味(dom7 + 容纳结构蓝音);两调用同套 opts → 一致。
    const realizeOpts = { inputTonality, userBrick: brick, seed: input.seed };
    progression = realizeToSandboxChords(selected.slots, keyPc, mode, realizeOpts);
    roadmap = buildMotifRoadmap(selected, keyPc, mode, targetBars, realizeOpts);
    harmonySource = 'template';
  } catch (err) {
    progression = buildProgression(motif, keyPc, mode, targetBars); // 兜底(不静默:harmonySource=fallback + error 暴露给 UI)
    harmonyError = err instanceof Error ? err.message : String(err);
  }

  // ★ Phase 4:RoadMap brick slots → 旋律 slot 计划(motif 按功能落位 + 结构性复现)。
  let melodicSlotPlan: MelodicSlotPlan | undefined;
  if (roadmap) melodicSlotPlan = buildMelodicSlotPlanFromRoadMap({ form, roadmapBricks: roadmap.brickSlots, userBrick: brick, seed: input.seed });

  // ★ blues contract Phase 4:从【最终 progression】建每和弦音高合同 → develop/generated 音 rectify 用。
  //   非布鲁斯输入 isBluesInput=false → adaptToHarmony 走旧逻辑(字节不变)。
  const pitchCtx = buildPitchContractContext({ progression, keyPc, mode, inputTonality });

  // base = 原样 motif 落 lead 音区;音域带 ≈ 主题音域 + 头尾余量(控制总音域)。
  const base = fitRange(identity(motif.notes), LEAD_LOW, LEAD_HIGH);
  const refLow = Math.min(...base.map((n) => n.midi));
  const refHigh = Math.max(...base.map((n) => n.midi));
  const bandLo = Math.max(LEAD_LOW - 1, refLow - 1);
  const bandHi = Math.min(LEAD_HIGH + 2, refHigh + 4);

  const lead: MotifNote[] = [];
  const occurrences: MotifOccurrence[] = [];
  const arc: string[] = [];

  if (melodicSlotPlan && melodicSlotPlan.slots.length) {
    // ★ Phase 5:slot-plan 驱动 —— 遍历 RoadMap 派生的旋律 slot,逐 slot 填充(motif 按功能落位)。
    let avoidLabel = '';
    let quoteOcc = 0; // ★ mustQuote 第几遍(A B A B:偶数原样/奇数微变化)
    for (const slot of melodicSlotPlan.slots) {
      const isQuote = slot.userMotifPolicy === 'mustQuote';
      const { notes, label } = renderMelodicSlot({ slot, userMotif: motif, userBrick: brick, progression, previousNotes: lead, seed: input.seed, keyPc, mode, avoidLabel, quoteBeats: motifBeats, quoteOccurrence: isQuote ? quoteOcc : 0, pitchCtx });
      if (isQuote) quoteOcc++;
      if (!notes.length) continue;
      if (slot.userMotifPolicy === 'mustDevelop') avoidLabel = label; // 发展手法尽量不连同
      const kind: MotifOccurrence['kind'] = slot.userMotifPolicy === 'mustQuote' ? 'quote' : slot.userMotifPolicy === 'generatedOnly' ? 'connect' : 'develop';
      lead.push(...notes);
      occurrences.push({ motifId: motif.id, startBeat: slot.startBeat, slotIndex: Math.round(slot.startBeat / BAR), kind, label, chordRoman: (chordAtBeat(progression, slot.startBeat) ?? progression[0]).roman });
      arc.push(label);
    }
  } else {
    // —— Fallback:旧【乐句循环】(无 slot plan / 和声兜底时)——
    let prevLastMidi = base[0].midi;
    let avoidLabel = '';
    const verseHeads = new Set([0, Math.floor(numPhrases / 2)]); // verse1/verse2 头(verseHeadsOnly 用)
    for (let p = 0; p < numPhrases; p++) {
      const phraseStart = p * phraseBeats;
      if (phraseStart >= targetBeats - 1e-6) break;
      const span = Math.min(motifBeats, targetBeats - phraseStart);
      const verbatim = quotePlan === 'phraseHeads' || verseHeads.has(p);
      let stmt: MotifNote[];
      let stmtKind: MotifOccurrence['kind'];
      let stmtLabel: string;
      if (verbatim) {
        stmt = placeQuoteVerbatim(base, phraseStart, span, p);
        stmtKind = 'quote';
        stmtLabel = p === 0 ? 'head' : verseHeads.has(p) ? 'verse2' : p === numPhrases - 1 ? 'recap' : 'restate';
      } else {
        const dev = pickDevOps(rng, avoidLabel); avoidLabel = dev.label;
        stmt = placeStatement(base, dev.ops, phraseStart, span, p, 'develop', prevLastMidi, bandLo, bandHi, keyPc, mode);
        adaptToHarmony(stmt, progression, pitchCtx);
        stmtKind = 'develop';
        stmtLabel = `head:${dev.label}`;
      }
      if (stmt.length) {
        lead.push(...stmt);
        occurrences.push({ motifId: motif.id, startBeat: phraseStart, slotIndex: p, kind: stmtKind, label: stmtLabel, chordRoman: (chordAtBeat(progression, phraseStart) ?? progression[0]).roman });
        arc.push(stmtLabel);
        prevLastMidi = stmt[stmt.length - 1].midi;
      }
      const ansStart = phraseStart + motifBeats;
      if (answerBeats > 0 && ansStart < targetBeats - 1e-6) {
        const ans = fillAnswer(base, ansStart, Math.min(answerBeats, targetBeats - ansStart), motifBeats, progression, rng, avoidLabel, prevLastMidi, bandLo, bandHi, keyPc, mode, p, pitchCtx);
        if (ans.notes.length) {
          lead.push(...ans.notes);
          const hasDev = ans.notes.some((n) => n.occurrenceKind === 'develop');
          occurrences.push({ motifId: motif.id, startBeat: ansStart, slotIndex: p, kind: hasDev ? 'develop' : 'connect', label: ans.label, chordRoman: (chordAtBeat(progression, ansStart) ?? progression[0]).roman });
          arc.push(ans.label);
          prevLastMidi = ans.lastMidi;
          avoidLabel = ans.avoid;
        }
      }
    }
  }

  const snappedLead = smoothAndResolve(lead, bandLo, bandHi, keyPc, mode, progression)
    .map((n) => ({ ...n, onsetBeat: Math.min(Math.round(n.onsetBeat / ONSET_GRID) * ONSET_GRID, targetBeats - ONSET_GRID) })) // onset 吸 1/16 网格 = 稳稳对拍
    .sort((a, b) => a.onsetBeat - b.onsetBeat)
    .filter((n) => n.durationBeat > 0);
  // ★ blues contract Phase 4 末端安全闸:在【onset 吸网格后】rectify(结构状态按最终落点重判 —— smoothAndResolve 的
  //   leap-fold 与网格吸附都可能把音挪到非和弦 scale 落点)。保 quote;确保生成/发展结构音落在合同 stable∪color。
  if (pitchCtx.isBluesInput) rectifyToPitchContract(snappedLead, pitchCtx, { preserveQuote: true });
  // ★ 单声部安全闸(directive Phase 3,2026-06-19):吸 1/16 后前 slot 尾音可能被推到下一 slot 起点 → 同 onset+同
  //   pitch 双音 / 同 pitch overlap → 短音 noteOff 提前关掉长音。合并(quote 优先,不吞用户 motif 音)+ 消解 overlap。
  const finalLead = sanitizeMotifLeadNotes(snappedLead);
  const audit = auditMotifWeave(finalLead, motif, occurrences, keyPc, mode, { totalBars: targetBars, quoteBeats: motifBeats, progression });
  const progressionBeats = progression.reduce((n, c) => n + c.durationBeats, 0);
  return { motif, progression, occurrences, lead: finalLead, playbackBpm: motif.bpm, totalBars: targetBars, progressionBeats, motifBars, quoteBars, numSlots: numPhrases, arc, audit, brick, selectedProgression: selected, roadmap, harmonySource, harmonyError, melodicSlotPlan };
}
