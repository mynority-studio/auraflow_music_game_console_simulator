// ============================================================
// motifSandbox · model · 旋律-进行打分(directive §9)
// ------------------------------------------------------------
// scoreProgressionAgainstMelodicBrick:把 brick 的结构音/头尾/cadence 与候选模板对齐打分。
//   重罚退化进行(I-I-I-I / V-I-I-I / I-V-I-I)。
// ============================================================

import type { ProgressionSlot, ProtoSectionRole } from '../../newEngine/knowledge/progressions';
import { chordTypeIntervals, normalizeChordType } from '../../newEngine/knowledge/chords';
import { makeRng } from './rng';
import type { UserMelodicBrick, MotifHarmonyIntent, ProgressionScoreBreakdown } from './melodicBrickTypes';
import type { ProgressionCandidate } from './progressionCandidateProvider';

const MODE_MISMATCH = 0.5; // opposite-mode 模板的先验降权(scored fallback:同调式好模板在时它赢不了)
/** prototypeId × seed → [0,1) 确定性小抖动(diversityBonus:跨 seed 保持多模板可达,不盖过真实贴合)。 */
function diversityJitter(protoId: string, seed: number): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < protoId.length; i++) { h ^= protoId.charCodeAt(i); h = Math.imul(h, 16777619); }
  return makeRng((h ^ (seed >>> 0)) >>> 0).next();
}

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
  opts: { sectionRole?: ProtoSectionRole; seed?: number } = {},
): { total: number; breakdown: ProgressionScoreBreakdown } {
  const slots = candidate.fittedSlots;
  const proto = candidate.prototype;
  const sectionRole = opts.sectionRole ?? 'verse';
  const seed = opts.seed ?? 0;

  // 先验:模板自带权重;opposite-mode(反调回退)扣固定项 → 同调式好模板在时它赢不了(scored fallback)。
  const templatePrior = (proto.weight ?? 1) * 0.4 - (candidate.modeMatch ? 0 : MODE_MISMATCH);

  // 结构音支撑:motif 在【乐句头锚点】循环再现 → 在所有锚点判贴合(各循环和弦不同,只看第一处会
  //   在后续乐句撞和弦)。结构音在越多锚点是和弦音 → 越贴合。
  //   §6:brick.structuralTones 已过滤(只含 >= MIN 的骨干音)→ 经过音天然不参与支撑/strongNonChord。
  //   ★ 锚点从【候选 prototype 自身循环周期】派生(模板每 lengthBars 小节重复一次和声 → motif 在这些
  //     周期头再现),不再硬编 16(directive §12:无固定 0/16/32/48)。
  const totalBeats = slots.reduce((s, sl) => s + (sl.beats ?? 4), 0);
  const cycleBeats = Math.max(4, (proto.lengthBars ?? 4) * 4); // 模板循环周期
  const ANCHORS: number[] = [];
  for (let a = 0; a < totalBeats - 1e-6; a += cycleBeats) ANCHORS.push(a);
  let structuralToneSupport = 0, strongNonChord = 0;
  for (const t of brick.structuralTones) {
    if (t.onsetBeat >= brick.quoteBeats - 1e-6) continue;
    let ct = 0, n = 0;
    for (const a of ANCHORS) {
      if (a + t.onsetBeat >= totalBeats - 1e-6) continue;
      n++;
      if (slotRealPcs(slotAtBeat(slots, a + t.onsetBeat), keyPc).includes(mod12(t.midi))) ct++;
    }
    const frac = n ? ct / n : 0; // 在几个锚点处是和弦音(0..1)
    structuralToneSupport += t.weight * (frac * 1.25 - 0.25); // 全锚点和弦音 → +1·w;全非 → −0.25·w
    if (frac < 0.5 && t.weight >= 0.6) strongNonChord += t.weight * (1 - frac); // 多数锚点撞和弦
  }

  // head/tail 现在恒为【结构音骨架】首尾(melodicBrickAnalyzer P1)→ 不会是经过音;再按结构权重降权
  //   (低结构分 head/tail 影响小,高结构分主导)。
  const headFit = brick.head && slotRealPcs(slotAtBeat(slots, 0), keyPc).includes(mod12(brick.head.midi))
    ? 0.5 * Math.max(0.3, brick.head.weight) : 0;

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

  // 乐句循环:prototype 长度整除【总曲长(bar)】→ 干净循环铺满(动态曲长,不再硬编 16)
  const totalBars = Math.max(1, Math.round(totalBeats / 4));
  const phraseCycleFit = totalBars % Math.max(1, proto.lengthBars) === 0 ? 0.2 : 0;

  // 段落角色:命中 form 段落角色 → 软奖励(reward but not exclude;不命中=0,从不踢出模板)。
  const sectionRoleFit = proto.sectionRoles.includes(sectionRole) ? 0.25 : 0;
  // 多样性:seed 相关小抖动 → 跨 seed 不同 valid 模板都可达,但盖不过真实音乐贴合(幅度 ≤0.06)。
  const diversityBonus = diversityJitter(proto.id, seed) * 0.06;

  const degeneratePenalty = intent.avoidDegenerateProgressions.includes(cycleRomanKey(slots)) ? 2.0 : 0;
  const strongNonChordPenalty = strongNonChord * 0.5;

  const breakdown: ProgressionScoreBreakdown = { templatePrior, structuralToneSupport, headFit, tailFit, cadenceFit, functionArcFit, sectionRoleFit, diversityBonus, phraseCycleFit, degeneratePenalty, strongNonChordPenalty };
  const total = templatePrior + structuralToneSupport + headFit + tailFit + cadenceFit + functionArcFit + sectionRoleFit + diversityBonus + phraseCycleFit - degeneratePenalty - strongNonChordPenalty;
  return { total, breakdown };
}
