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

import type { MotifNote, MotifOccurrence, MotifWeaverInput, MotifWeaverResult, ScaleMode, UserMotif } from './types';
import { analyzeAndNormalize } from './motifAnalysis';
import {
  identity, fitRange, transposeDiatonicMotif, invertAroundMidi, retrogradePitchOnly,
  rhythmDivide, augmentMotif, fragmentMotif, displaceMotif,
} from './motifTransform';
import { snapMidiToScale, isInScale } from './scale';
import { buildProgression } from './motifHarmony';
import { chordAtBeat, nearestChordTone, isChordTone, type SandboxChord } from './chords';
import { auditMotifWeave } from './jazzinessAudit';
import { makeRng, type SeededRng } from './rng';

const TARGET_BARS = 16;
const BAR = 4;
const TARGET_BEATS = TARGET_BARS * BAR; // 64
const LEAD_LOW = 60, LEAD_HIGH = 84;
const MAX_LEAP = 8;     // 小六度;> 此值八度收拢(作曲原则:级进为主、跳进≤小六度)
const PROB_THEME = 0.6; // Impro-Visor probTheme:每槽陈述 vs 发展/连接

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

interface SlotPlan { role: 'state' | 'develop' | 'connect'; ops: DevOp[]; label: string; }

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

/** 规划 16 小节【发展弧】(确定性):head 起、结构锚点 return/recap 再现主题,其余掷骰发展/连接。 */
function planSlots(numSlots: number, rng: SeededRng): SlotPlan[] {
  const plans: SlotPlan[] = [];
  const recap = numSlots - 1;
  const midReturn = numSlots >= 6 ? Math.floor(numSlots / 2) : -1; // 中段主题再现(够长才放,且不与 recap 相邻)
  let prevDevLabel = '';
  for (let s = 0; s < numSlots; s++) {
    if (s === 0) { plans.push({ role: 'state', ops: [], label: 'head' }); continue; }
    if (s === recap) { plans.push({ role: 'state', ops: [], label: 'recap' }); continue; }
    if (s === midReturn && midReturn !== recap - 1) { plans.push({ role: 'state', ops: [], label: 'return' }); continue; }
    if (rng.chance(PROB_THEME)) {
      const { ops, label } = pickDevOps(rng, prevDevLabel);
      prevDevLabel = label;
      plans.push({ role: 'develop', ops, label });
    } else {
      plans.push({ role: 'connect', ops: [], label: 'connect' });
    }
  }
  // 兜底:整曲至少 2 种不同发展手法(锁"真有发展,不是复制")。
  const variants = new Set(plans.filter((p) => p.role === 'develop').map((p) => p.label));
  for (let s = 1; s < numSlots && variants.size < 2; s++) {
    if (plans[s].role === 'state') continue;
    for (const prim of PRIMARIES) {
      if (!variants.has(prim.label)) { plans[s] = { role: 'develop', ops: [...prim.ops], label: prim.label }; variants.add(prim.label); break; }
    }
  }
  return plans;
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

/** 和声适配(Impro-Visor RectifyPitches 后处理):强拍/长音的非和弦音吸到就近和弦音;不碰 quote。 */
function adaptToHarmony(notes: MotifNote[], progression: readonly SandboxChord[]): void {
  for (const n of notes) {
    const ch = chordAtBeat(progression, n.onsetBeat);
    if (!ch) continue;
    const onBeat = Math.abs(n.onsetBeat - Math.round(n.onsetBeat)) < 1e-6;
    if ((onBeat || n.durationBeat >= 1) && !isChordTone(n.midi, ch)) n.midi = nearestChordTone(n.midi, ch);
  }
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
  // 末音解决到主和弦(曲式闭合,保平滑)。
  if (s.length) {
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
  const { motif } = analyzeAndNormalize(input.capturedNotes, keyPc, mode, input.bpm, input.seed, input.inputTonality);
  const rng = makeRng((input.seed ^ 0x9e3779b9) >>> 0);

  const slotBars = Math.max(1, Math.min(TARGET_BARS, Math.round(motif.lengthBeats / BAR)));
  const slotBeats = slotBars * BAR;
  const numSlots = Math.max(2, Math.ceil(TARGET_BARS / slotBars));
  const progression = buildProgression(motif, keyPc, mode, TARGET_BARS);

  // base = 原样 motif 落 lead 音区(发展从它出发);音域带 ≈ 主题音域 + 头尾余量(控制总音域)。
  const base = fitRange(identity(motif.notes), LEAD_LOW, LEAD_HIGH);
  const refLow = Math.min(...base.map((n) => n.midi));
  const refHigh = Math.max(...base.map((n) => n.midi));
  const bandLo = Math.max(LEAD_LOW - 1, refLow - 1);
  const bandHi = Math.min(LEAD_HIGH + 2, refHigh + 4);

  const plans = planSlots(numSlots, rng);
  const lead: MotifNote[] = [];
  const occurrences: MotifOccurrence[] = [];
  const arc: string[] = [];
  let prevLastMidi = base[0].midi;

  for (let s = 0; s < numSlots; s++) {
    const plan = plans[s];
    const atBeat = s * slotBeats;
    if (atBeat >= TARGET_BEATS - 1e-6) break;
    const span = Math.min(slotBeats, TARGET_BEATS - atBeat);
    const ch0 = chordAtBeat(progression, atBeat) ?? progression[0];
    let notes: MotifNote[];
    let kind: MotifOccurrence['kind'];
    if (plan.role === 'connect') {
      notes = placeConnect(atBeat, span, s, progression, prevLastMidi);
      kind = 'connect';
    } else {
      const isState = plan.role === 'state';
      notes = placeStatement(base, plan.ops, atBeat, span, s, isState ? 'quote' : 'develop', prevLastMidi, bandLo, bandHi, keyPc, mode);
      if (!isState) adaptToHarmony(notes, progression);
      kind = isState ? 'quote' : 'develop';
    }
    if (notes.length) {
      lead.push(...notes);
      occurrences.push({ motifId: motif.id, startBeat: atBeat, slotIndex: s, kind, label: plan.label, chordRoman: ch0.roman });
      arc.push(plan.label);
      prevLastMidi = notes[notes.length - 1].midi;
    }
  }

  const finalLead = smoothAndResolve(lead, bandLo, bandHi, keyPc, mode, progression)
    .sort((a, b) => a.onsetBeat - b.onsetBeat)
    .filter((n) => n.durationBeat > 0);
  const audit = auditMotifWeave(finalLead, motif, occurrences, keyPc, mode, { totalBars: TARGET_BARS });
  return { motif, progression, occurrences, lead: finalLead, totalBars: TARGET_BARS, slotBars, numSlots, arc, audit };
}
