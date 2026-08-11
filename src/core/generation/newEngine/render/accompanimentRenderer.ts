// ============================================================
// newEngine · render · CompingRenderer(comp 织体)
// ------------------------------------------------------------
// 架构定稿 Part 8.2 / 3.6 / 铁律5,16:comp 按 per-style comping 节奏型落 hit(有律动/切分),
// 用真 voicing(jazz rootless / spread,顶音 voice-leading)取代 48+pc 簇。
// 让位:active 段在主 hook 锚点拍把该和弦 comp 瘦身成 3+7 shell;floating 段交给 pad。
// ============================================================

import { beats, midi, mod12, type Timebase } from '../foundation';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { compPattern } from '../knowledge/grooves';
import { assembleVoicing, applyArrangement, STYLE_SHELL, STYLE_FULL, STYLE_BLUES, type VoicingStylePreference } from '../knowledge/voicingStyles';
import { placeVoicingMidi } from '../knowledge/voicingPlacement';
import { chordToneIntervals, chordTypeIntervals, isKnownChordType, type ChordQuality } from '../knowledge/chords';
import { resolveBassAnchorPc } from '../knowledge/basslineRules';
import { isKeyboardFamily, instrumentInfo } from '../knowledge/instruments';
import { buildWidePianoVoicing, pickSpreadMode, type SpreadCellRole, type SpreadMode, type SpreadPicker, type SpreadSectionFunction, type VoiceRole, type WidePianoVoicing } from '../knowledge/widePianoVoicings';
import { renderTextureChordHits, isAcgTextureCase, type TextureChordHit } from './textureRenderer';
import { lofiTextureClockBeat } from './textureClock';
import { textureBehavior } from '../knowledge/textureProfiles';
import type { TextureSchedule } from './textureSchedule';
import type { ChordSpan, HarmonicFunction, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { GrooveScorePlan, SectionRole } from '../arranger/ArrangementPlan';
import type { CompRoleRhythmPattern } from '../knowledge/roleRhythmPatterns';
import {
  revoiceAcgPianoScoreVoicing,
  type AcgPianoCompDirective,
  type AcgPianoScorePlan,
  type AcgPianoVoiceSelection,
} from '../arranger/acgPianoScorePlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import type { PadCompDecision } from './padCompPolicy';
import type { ArrangementFoundationOwner } from '../arranger/arrangementArchetypeContract';
import type { LofiFoundationPlan } from '../arranger/lofiFoundationPlanner';
import { planFoundationVoicing } from '../instrumental/foundationVoicingPlanner';

export interface AccompContext {
  style?: string;
  anchorBeats?: Set<number>;      // 主 hook 锚点拍位(active 段在此瘦身让位)
  activeSectionIds?: Set<string>; // active 织体段
  /** 低音地基归属是跨角色关系，必须由 Arranger 明示，不能由“Bass 缺席”猜测。 */
  foundationRoleBySection?: Readonly<Record<string, ArrangementFoundationOwner>>;
  voicingSaferSpans?: Set<string>; // 撞音阶梯 rung1:这些 span 强制瘦身 3+7 shell
  compProgram?: number;            // ★ comp 实际乐器 GM program:钢琴家族 → 宽排列,否则通用 voiceComp
  /** Arranger/Instrumentation 锁定的职责音区；独奏钢琴 Comp 可下探 G2，而非通用 C3 地板。 */
  compRegister?: { lowMidi: number; highMidi: number };
  sectionRoleById?: Record<string, SectionRole>; // 段落功能 → 钢琴 spread mode 选择(pickSpreadMode)
  voicingRng?: SpreadPicker;       // spread mode 选择用的确定性子流('accompaniment')
  textureSchedule?: TextureSchedule; // ★ 中央下发的 spanId→textureCase(bass/comp/drum 共享)
  melodyFloorMidi?: number;        // ★ comp ceiling(通常 registerByRole.comp.high+1):comp 顶须 < 此 → 给 lead 留空间
  // —— pad-comp 分工(pad-aware thinning,仅在 pad-active span 生效,保 GM 手感)——
  padCompDecisionBySection?: Record<string, PadCompDecision>; // 每段 pad↔comp 决策
  padOccupiedPitchesBySpan?: Record<string, number[]>;        // pad 各 span 已占绝对 MIDI(comp 让 pad)
  needsDownbeatCompAnchorBySection?: Record<string, boolean>; // ★ Loop I.3:no-pad comp 支撑段 → late texture 补下拍 anchor
  /** ACG 专用前置总谱：texture/中部手区/roll 在出 NoteIR 前已决定。 */
  pianoScorePlan?: AcgPianoScorePlan;
  /** Arranger-materialized role cells. They own Comp attacks for their sections. */
  grooveScorePlan?: Readonly<GrooveScorePlan>;
  /** LOFI only: upstream voicing family shared by every Comp instrument. */
  lofiVoicingIntent?: Readonly<LofiFoundationPlan['voicingIntent']>;
  /** Optional score-level broken-chord touch; renderer consumes rather than selects it. */
  compPerformanceIntent?: Readonly<LofiFoundationPlan['compIntent']>;
  /** Sections whose selected concrete voice has a documented CC64 PedalPlan. */
  compPedalActiveSectionIds?: ReadonlySet<string>;
  /** P2 motif 跨轨投射:motif 乐句后的呼吸小节 → comp 用 motif 节奏 cell 应答(POP/RNB;P2.1 池轮换+力度微变)。 */
  motifEchoByAbsoluteBar?: ReadonlyMap<number, { accentBeats: readonly number[]; durations: readonly number[]; velocity?: number }>;
}

/**
 * comp 让位旋律(voicing-around-melody):任何 ≥ ceiling 的声部【转位下折】八度到 ceiling 之下
 *   (完整度优先,保住和弦音);下折越界(< floor)或与已有音重复 → 【减法】丢弃。
 *   ceiling 之下的核心声部原样保留 → comp 始终坐在旋律保留区下方。确定性、纯函数。
 */
export function yieldUnderMelody(midis: number[], ceiling: number, floor: number): number[] {
  const out: number[] = [];
  for (const m of [...midis].sort((a, b) => a - b)) {
    if (m < ceiling) { out.push(m); continue; } // 核心声部:留
    let f = m;
    while (f >= ceiling) f -= 12;               // 转位:下折到 ceiling 之下
    if (f >= floor && !out.includes(f)) out.push(f); // 接受转位;否则减法(跳过该声部)
  }
  return out.sort((a, b) => a - b);
}

/**
 * 柱式和弦【复音衰减】(equal-power):同 tick N 个声部齐响,瞬时幅度 ~ Σ → 6-7 音密块会撞顶爆音。
 *   按 √(2/N)(2 音为基准)衰减 per-note velocity → 密块总能量拉回双音水平,而单/双音(及 arp/roll 的 N1 hit)不动。
 *   这是 render 层【触键动态】(钢琴家弹密集和弦每音本就更轻),非通道音量(CC7)调整。确定性、纯函数。
 */
export function polyVelocity(baseVel: number, n: number): number {
  if (n <= 2) return baseVel;
  return Math.max(1, Math.round(baseVel * Math.sqrt(2 / n)));
}

/**
 * comp 入袋(pocketize):texture 的小 lay-back(0.05/0.15 拍)在独奏钢琴里是性格,但在紧实节奏组旁 = 飘、对拍不齐。
 *   把音头朝最近的【8 分格】拉 strength(保留相对律动);|偏移| > window(明显切分/swing 位)不动。
 *   → comp 坐回与 bass/drum 同一拍格的口袋里。确定性、纯函数(beat→beat)。
 */
export function pocketizeBeat(beatPos: number, strength = 0.6, window = 0.18): number {
  const EIGHTH = 0.5;
  const q = Math.round(beatPos / EIGHTH) * EIGHTH; // 最近 8 分格
  const d = beatPos - q;
  if (Math.abs(d) > window) return beatPos;        // 明显切分 → 保留
  // ★ 强拍位锁紧(2026-06-09 修「重音对拍/复调错拍」):落在整拍(强拍)的 comp 必须与 bass/drum 同拍锁死
  //   (否则 comp 系统性晚 0.02-0.05 拍 = 与重音错拍/flam);offbeat 仍按风格 strength 保 groove pocket。
  const isStrong = Math.abs(q - Math.round(q)) < 1e-6;
  const s = isStrong ? Math.max(strength, 0.85) : strength;
  return q + d * (1 - s);
}

function selectAcgScoreVoices(midis: readonly number[], selection: AcgPianoVoiceSelection, maxVoices: number): number[] {
  const source = [...new Set(midis)].sort((a, b) => a - b).slice(0, Math.max(1, maxVoices));
  if (source.length === 0) return [];
  const one = (index: number) => [source[Math.max(0, Math.min(source.length - 1, index))]!];
  if (selection === 'all') return source;
  if (selection === 'low') return one(0);
  if (selection === 'inner-low') return one(Math.min(1, source.length - 1));
  if (selection === 'inner-high') return one(Math.max(0, source.length - 2));
  if (selection === 'high') return one(source.length - 1);
  if (selection === 'lower-dyad') return source.slice(0, Math.min(2, source.length));
  return source.slice(Math.max(0, source.length - 2));
}

/**
 * Score executor for ACG comp. The score already owns event timing, direction,
 * silence and attack; this function only selects legal voices from the supplied
 * chord voicing and turns an explicitly requested roll into individual hits.
 */
export function realizeAcgPianoScoreCompEvents(
  directive: AcgPianoCompDirective,
  voiced: readonly number[],
  nextVoiced: readonly number[] | undefined,
  spanDuration: number,
): TextureChordHit[] {
  const hits: TextureChordHit[] = [];
  for (const event of directive.events) {
    const source = event.harmonicTarget === 'next' && nextVoiced && nextVoiced.length > 0 ? nextVoiced : voiced;
    const selected = selectAcgScoreVoices(source, event.voices, directive.maxVoices);
    if (selected.length === 0 || event.atBeat >= spanDuration - 0.02) continue;
    const duration = Math.max(0.08, Math.min(event.durationBeats, spanDuration - event.atBeat - 0.02));
    if (event.attack === 'simultaneous' || selected.length <= 1) {
      hits.push({ tRel: event.atBeat, dur: duration, midis: selected, vel: event.velocity });
      continue;
    }
    const ordered = [...selected].sort((a, b) => a - b);
    if (event.attack === 'roll-down') ordered.reverse();
    // `rollStepBeats` is the arranger-authored maximum distance between
    // adjacent voices. Dense voicings must not multiply that step into a
    // separate late accent: keep the complete hand spread inside the
    // Arranger's score limit while preserving direction and event onset.
    const spreadLimit = Math.max(0, directive.rollSpreadLimitBeats ?? 0.15);
    const rollStep = Math.min(
      Math.max(0, directive.rollStepBeats),
      spreadLimit / Math.max(1, ordered.length - 1),
    );
    ordered.forEach((midi, index) => {
      const voiceDelay = index * rollStep;
      const tRel = event.atBeat + voiceDelay;
      const remaining = spanDuration - tRel - 0.02;
      if (remaining <= 0.08) return;
      hits.push({
        tRel,
        dur: Math.max(0.08, Math.min(duration - voiceDelay, remaining)),
        midis: [midi],
        vel: Math.max(0.05, event.velocity - index * 0.014),
      });
    });
  }
  return hits.sort((a, b) => a.tRel - b.tRel || a.midis[0]! - b.midis[0]!);
}

/**
 * Realize the LOFI foundation's broken- and block-chord touch before NoteIR.
 *
 * A texture supplies the attack grid; this score realizer supplies the hands.
 * Arps get a held lower guide plus an overlapping upper wave. Block/chop
 * textures keep their attacks, connect only the lower guide, and let upper
 * voices breathe. A documented piano may use CC64; other keys express the
 * same connection in written note lengths.
 */
export function realizeCompPerformance(
  textureCase: string,
  rawHits: readonly TextureChordHit[],
  voicedRaw: readonly number[],
  spanDurationBeats: number,
  intent: Readonly<LofiFoundationPlan['compIntent']> | undefined,
  pedalActive = false,
): TextureChordHit[] {
  if (!intent || intent.brokenChordTechnique !== 'anchored-finger-legato') return [...rawHits];
  const behavior = textureBehavior(textureCase);
  const voiced = [...new Set(voicedRaw)].sort((a, b) => a - b);
  if (voiced.length === 0 || rawHits.length === 0) return [...rawHits];
  const release = Math.max(0.04, Math.min(0.2, intent.harmonicReleaseBeats));
  const documentedDamper = pedalActive && intent.damperPolicy === 'when-documented';
  const fingerLegatoFallback = !documentedDamper
    && intent.unsupportedDamperFallback === 'finger-legato';
  const overlap = !fingerLegatoFallback
    ? Math.min(0.04, intent.fingerOverlapBeats)
    : Math.max(0.04, Math.min(0.24, intent.fingerOverlapBeats));
  const ordered = [...rawHits].sort((a, b) => a.tRel - b.tRel || a.midis[0]! - b.midis[0]!);

  // Block/chop/sustain attacks remain sparse, but the lower guide finger
  // carries the phrase between them. Upper voices keep a style-dependent
  // release, so this does not turn every chop into a pad.
  const connectedChordFamily = behavior
    && ['block', 'answer', 'chop', 'sustain', 'wash'].includes(behavior.family);
  if (connectedChordFamily) {
    const gateRatio = intent.chordGateRatioByContinuity[behavior.continuity];
    const performed: TextureChordHit[] = [];
    for (let index = 0; index < ordered.length; index++) {
      const hit = ordered[index]!;
      const next = ordered.slice(index + 1).find((candidate) => candidate.tRel > hit.tRel + 1e-6);
      const boundaryLimit = Math.max(0.08, spanDurationBeats - hit.tRel - release);
      const ioi = next ? Math.max(0.08, next.tRel - hit.tRel) : boundaryLimit;
      const upperLimit = next ? Math.max(0.08, ioi - 0.02) : boundaryLimit;
      const upperDuration = Math.min(
        boundaryLimit,
        upperLimit,
        Math.max(hit.dur, ioi * gateRatio),
      );
      const pitches = [...new Set(hit.midis)].sort((a, b) => a - b);
      if (pitches.length <= 1) {
        const nextPitch = next?.midis.slice().sort((a, b) => a - b)[0];
        const connected = nextPitch === pitches[0] ? ioi : ioi + overlap;
        performed.push({
          ...hit,
          midis: pitches,
          dur: Math.min(boundaryLimit, Math.max(upperDuration, connected)),
        });
        continue;
      }
      const guidePitch = pitches[0]!;
      const upper = pitches.slice(1);
      const nextGuide = next?.midis.slice().sort((a, b) => a - b)[0];
      const guideDuration = next
        ? (nextGuide === guidePitch ? ioi : ioi + overlap)
        : boundaryLimit;
      performed.push(
        { ...hit, midis: upper, dur: upperDuration },
        {
          ...hit,
          midis: [guidePitch],
          dur: Math.min(boundaryLimit, Math.max(hit.dur, guideDuration)),
          vel: Math.max(0.05, hit.vel * 0.84),
        },
      );
    }
    // A long one-shot/wash can span several bars or a repeat-group boundary.
    // The written anchored-finger technique therefore re-articulates only the
    // lower guide at its declared interval. This prevents an 8-beat chord from
    // becoming silence when phrase projection closes the original key-down at
    // a bar boundary, while the upper chord still remains a single breath.
    if (intent.anchorRetriggerBeats > 0) {
      const guidePitch = voiced[0]!;
      for (
        let atBeat = intent.anchorRetriggerBeats;
        atBeat < spanDurationBeats - release;
        atBeat += intent.anchorRetriggerBeats
      ) {
        const alreadyAttacked = ordered.some((hit) =>
          Math.abs(hit.tRel - atBeat) <= 0.08
          && hit.midis.includes(guidePitch));
        if (alreadyAttacked) continue;
        for (const hit of performed) {
          if (hit.midis.length === 1
            && hit.midis[0] === guidePitch
            && hit.tRel < atBeat
            && hit.tRel + hit.dur > atBeat) {
            hit.dur = Math.max(0.08, atBeat - hit.tRel);
          }
        }
        performed.push({
          tRel: atBeat,
          dur: Math.min(
            intent.anchorRetriggerBeats,
            spanDurationBeats - atBeat - release,
          ),
          midis: [guidePitch],
          vel: Math.max(0.12, Math.min(0.46, ordered[0]!.vel * 0.78)),
        });
      }
    }
    return performed.sort((a, b) => a.tRel - b.tRel || a.midis[0]! - b.midis[0]!);
  }

  if (behavior?.family !== 'arp' || rawHits.length < 2 || rawHits.some((hit) => hit.midis.length !== 1)) {
    return [...rawHits];
  }
  // Melody/register protection can leave only one legal chord pitch. Keep
  // that pitch as a connected monophonic line instead of skipping the
  // performance contract; never invent an extension or octave to fill space.
  const rightHand = voiced.length > 1 ? voiced.slice(1) : voiced;
  const waveIndex = (index: number): number => {
    if (rightHand.length === 1) return 0;
    if (rightHand.length === 2) return index % 2;
    return [0, 1, rightHand.length - 1, 1][index % 4]!;
  };
  const performed: TextureChordHit[] = ordered.map((hit, index) => {
    const next = ordered[index + 1];
    const boundaryLimit = Math.max(0.01, spanDurationBeats - hit.tRel - release);
    const ioi = next ? Math.max(0.08, next.tRel - hit.tRel) : boundaryLimit;
    const pitch = rightHand[waveIndex(index)]!;
    const nextPitch = next ? rightHand[waveIndex(index + 1)]! : undefined;
    const connected = nextPitch === pitch
      // A two-note shell has only one right-hand key. Without a documented
      // damper, human legato repeats release that key exactly at the next
      // attack; subtracting the harmonic release here created a 0.1-beat hole
      // on every eighth note. Do not overlap identical MIDI pitches, but do
      // keep them gapless. Pedalled voices may retain the shorter key-down.
      ? (fingerLegatoFallback ? ioi : Math.max(0.08, ioi - release))
      : ioi + overlap;
    return {
      ...hit,
      dur: Math.min(boundaryLimit, Math.max(hit.dur, connected)),
      midis: [pitch],
      vel: Math.max(0.05, hit.vel * (index % 4 === 0 ? 0.94 : 0.88)),
    };
  });

  if (voiced.length > 1) {
    const anchorPitch = voiced[0]!;
    for (let atBeat = 0; atBeat < spanDurationBeats - release; atBeat += intent.anchorRetriggerBeats) {
      const remaining = spanDurationBeats - atBeat - release;
      if (remaining <= 0.08) break;
      const source = ordered.reduce((nearest, hit) =>
        Math.abs(hit.tRel - atBeat) < Math.abs(nearest.tRel - atBeat) ? hit : nearest, ordered[0]!);
      performed.push({
        tRel: atBeat,
        dur: Math.min(intent.anchorRetriggerBeats - release, remaining),
        midis: [anchorPitch],
        vel: Math.max(0.18, Math.min(0.5, source.vel * 0.86)),
      });
    }
  }
  return performed.sort((a, b) => a.tRel - b.tRel || a.midis[0]! - b.midis[0]!);
}

// ★ pocketize 强度【按风格】:pop/rnb 须紧实(以 POP 为主)→ 强收;lofi 的 dusty-behind / jazz 的 swung comping
//   是【genre 性格】不是 flaw → 轻收(几乎保留)。同样的 lay-back 在 pop 是毛病、在 lofi 是味道。
const POCKET_STRENGTH: Record<string, number> = { pop: 0.65, rnb: 0.6, jazz: 0.3, lofi: 0.2 };

const SECTION_FN: Record<SectionRole, SpreadSectionFunction> = {
  intro: 'INTRO', verse: 'VERSE', chorus: 'CHORUS', bridge: 'BRIDGE', outro: 'OUTRO',
};

const EMPTY_AVOID: ReadonlySet<number> = new Set(); // 无 pad 让位时复用(零分配,行为字节不变)

// 非键盘 comp 的 voicing 风格(参考 mg compingVoicingMode:jazz/rnb/lofi→rootless · blues→blues · pop→full)。
// ★ 遵守 comp 铁律(色彩 9/11/13 归旋律)→ addColorOnTriad 一律 false(comp 只留核心,不加 9)。
//   rootless = omit root(bass 兜 root);voice-leading/clash/placement/spacing 由 mg 引擎负责。
const COMP_ROOTLESS_CORE: VoicingStylePreference = { rootPolicy: 'omit', density: 4, addColorOnTriad: false };
const COMP_SHELL: VoicingStylePreference = { rootPolicy: 'omit', density: 2, addColorOnTriad: false }; // 让位:3+7 guide-tone
const COMP_ROOTED_CORE: VoicingStylePreference = { rootPolicy: 'include', density: 4, addColorOnTriad: false };
const VOICING_PREF: Record<string, VoicingStylePreference> = {
  jazz: COMP_ROOTLESS_CORE, blues: STYLE_BLUES, pop: STYLE_FULL, rnb: COMP_ROOTLESS_CORE, lofi: COMP_ROOTLESS_CORE,
};

// 把和弦【真实音】映射到 wide-voicing 角色。宽 chordType → 核心(含 sus4、修窄降级)+ 延伸色彩(9/11/13);
// 窄三和弦('maj'/'min')走 chordToneIntervals(避免 getChordRolePcs 幻觉七音 / chordTypeIntervals 误判 min)。
function chordTypeRolePcs(rootPc: number, chordType: string, narrowQ: ChordQuality): Partial<Record<VoiceRole, number>> {
  const out: Partial<Record<VoiceRole, number>> = {};
  const ivs = isKnownChordType(chordType) ? chordTypeIntervals(chordType) : chordToneIntervals(narrowQ);
  for (const iv of ivs) {
    const p = mod12(rootPc + iv);
    if (iv === 0) out.root = p;
    else if (iv === 3 || iv === 4 || iv === 5) out.third = p; // sus4(iv5)占结构 3 度位 = 无大三
    else if (iv === 6 || iv === 7 || iv === 8) out.fifth = p;
    else if (iv === 9) out.sixth = p;
    else if (iv === 10 || iv === 11) out.seventh = p;
    else if (iv === 14) out.ninth = p;        // 9
    else if (iv === 17) out.eleventh = p;      // 11
    else if (iv === 21) out.thirteenth = p;    // 13
    else if (iv === 13 || iv === 15 || iv === 18 || iv === 20) out.color = p; // b9/#9/#11/b13
  }
  return out;
}

// bass 区(36-47)的 root midi —— 仅供 wide voicing 的 sanitize/drop2 安全判据用。
function nominalBassMidi(rootPc: number): number {
  for (let m = 36; m <= 47; m++) if (mod12(m) === rootPc) return m;
  return 36 + rootPc;
}

function spanAtBeat(plan: HarmonicPlan, beat: number): ChordSpan | undefined {
  return plan.chordTimeline.find((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats);
}

export function renderAccompaniment(
  plan: HarmonicPlan,
  timebase: Timebase,
  ctx: AccompContext = {},
): TrackIR[] {
  const compNotes: NoteIR[] = [];
  const beatsPerBar = beatsPerBarOf(timebase.meter);
  const pattern = compPattern(ctx.style ?? 'default');
  const style = ctx.style ?? 'default';
  const styleKey = style.toLowerCase();
  const pocketStrength = POCKET_STRENGTH[style.toLowerCase()] ?? 0.45; // comp 柱式入袋强度(按风格)
  const isLofi = styleKey === 'lofi';                                  // ★ Loop I:LOFI 走中央 texture clock
  const tempoBpm = timebase.tempoMap[0]?.bpm ?? 78;                    // pocket ms→拍 换算用
  const inActive = (sid: string) => !ctx.activeSectionIds || ctx.activeSectionIds.has(sid);
  const compOwnsFoundation = (span: ChordSpan): boolean =>
    ctx.foundationRoleBySection?.[span.sectionId] === 'comp'
    && inActive(span.sectionId);
  const compRhythmBySection = Object.fromEntries(
    Object.values(ctx.grooveScorePlan?.bySection ?? {}).flatMap((sectionScore) => {
      const pattern = sectionScore.roleRhythmByRole?.comp;
      return pattern ? [[sectionScore.sectionId, pattern] as const] : [];
    }),
  ) as Record<string, Readonly<CompRoleRhythmPattern>>;
  const authoredCompSectionIds = new Set(Object.keys(compRhythmBySection));
  const grooveBarByAbsoluteBar = new Map(
    Object.values(ctx.grooveScorePlan?.bySection ?? {})
      .flatMap((sectionScore) => sectionScore.bars)
      .map((bar) => [bar.absoluteBar, bar] as const),
  );
  const lofiCompRoleAt = (absoluteBeat: number) =>
    grooveBarByAbsoluteBar.get(Math.max(0, Math.floor(absoluteBeat / beatsPerBar)))
      ?.lofiPhraseInteraction?.compRole;
  /**
   * The Arranger can write an answer bar even when the selected texture has
   * only a downbeat one-shot. Preserve the texture when it already supplies
   * a legal late hit; otherwise materialize the score's explicit middle-shell
   * answer before NoteIR. This is a score projection, never a final-track
   * hole-fill.
   */
  const withLofiAnswerFallback = (
    hits: readonly TextureChordHit[],
    spanStartBeat: number,
    spanDurationBeats: number,
    voiced: readonly number[],
  ): TextureChordHit[] => {
    if (!isLofi) return [...hits];
    const output = [...hits];
    const spanEndBeat = spanStartBeat + spanDurationBeats;
    const startBar = Math.max(0, Math.floor(spanStartBeat / beatsPerBar));
    const endBar = Math.max(startBar, Math.floor((spanEndBeat - 1e-4) / beatsPerBar));
    const shell = voiced.length > 3
      ? voiced.slice(1, 3)
      : voiced.length > 2 ? voiced.slice(1) : [...voiced];
    if (shell.length === 0) return output;
    for (let absoluteBar = startBar; absoluteBar <= endBar; absoluteBar++) {
      const interaction = grooveBarByAbsoluteBar.get(absoluteBar)?.lofiPhraseInteraction;
      if (interaction?.compRole !== 'answer') continue;
      const entryInBar = interaction.compAnswerEntryBeat ?? Math.min(2, beatsPerBar - 0.5);
      const targetBeat = absoluteBar * beatsPerBar + entryInBar;
      if (targetBeat < spanStartBeat - 1e-4 || targetBeat >= spanEndBeat - 1e-4) continue;
      const alreadyAnswered = output.some((hit) => {
        const hitBeat = spanStartBeat + hit.tRel;
        const hitBar = Math.floor(hitBeat / beatsPerBar);
        const phase = ((hitBeat % beatsPerBar) + beatsPerBar) % beatsPerBar;
        return hitBar === absoluteBar && phase >= entryInBar - 0.08;
      });
      if (alreadyAnswered) continue;
      const remaining = spanEndBeat - targetBeat;
      if (remaining <= 0.08) continue;
      output.push({
        tRel: targetBeat - spanStartBeat,
        dur: Math.max(0.08, Math.min(0.72, remaining - 0.02)),
        midis: shell,
        vel: 0.42,
      });
    }
    return output.sort((left, right) => left.tRel - right.tRel || left.midis[0]! - right.midis[0]!);
  };
  /** P2:motif 回声 —— 镜像 withLofiAnswerFallback 的"score projection"语义,
   *  在回声小节的空拍位补 motif 头部节奏 cell 的和弦 shell 击点(已有击点 ±0.2 内不叠)。 */
  const withMotifEchoHits = (
    hits: readonly TextureChordHit[],
    spanStartBeat: number,
    spanDurationBeats: number,
    voiced: readonly number[],
  ): TextureChordHit[] => {
    const echoMap = ctx.motifEchoByAbsoluteBar;
    if (!echoMap || echoMap.size === 0) return [...hits];
    const output = [...hits];
    const spanEndBeat = spanStartBeat + spanDurationBeats;
    const shell = voiced.length > 3 ? voiced.slice(1, 3) : voiced.length > 2 ? voiced.slice(1) : [...voiced];
    if (shell.length === 0) return output;
    const startBar = Math.max(0, Math.floor(spanStartBeat / beatsPerBar));
    const endBar = Math.max(startBar, Math.floor((spanEndBeat - 1e-4) / beatsPerBar));
    for (let absoluteBar = startBar; absoluteBar <= endBar; absoluteBar++) {
      const echo = echoMap.get(absoluteBar);
      if (!echo) continue;
      echo.accentBeats.forEach((phase, index) => {
        const targetBeat = absoluteBar * beatsPerBar + phase;
        if (targetBeat < spanStartBeat - 1e-4 || targetBeat >= spanEndBeat - 0.08) return;
        if (output.some((hit) => Math.abs(spanStartBeat + hit.tRel - targetBeat) <= 0.2)) return;
        const remaining = spanEndBeat - targetBeat;
        output.push({
          tRel: targetBeat - spanStartBeat,
          dur: Math.max(0.08, Math.min(echo.durations[index] ?? 0.5, remaining - 0.02)),
          midis: shell,
          vel: echo.velocity ?? 0.5, // 应答清晰但不过前景;力度按小节微变(P2.1 去机械感)
        });
      });
    }
    return output.sort((left, right) => left.tRel - right.tRel || left.midis[0]! - right.midis[0]!);
  };
  const keepLofiCompAttack = (
    absoluteBeat: number,
    spanStartBeat: number,
    voiceAction: 'foundation' | 'texture',
  ): boolean => {
    if (!isLofi || voiceAction === 'foundation') return true;
    const role = lofiCompRoleAt(absoluteBeat);
    const phase = ((absoluteBeat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    if (role === 'support') {
      // During Lead speech, retain only a light harmonic shell at the chord
      // entrance or the half-bar anchor; the running upper texture yields.
      return Math.abs(absoluteBeat - spanStartBeat) <= 0.08
        || Math.abs(phase - 2) <= 0.08
        || Math.abs(phase - 0.5) <= 0.1
        || Math.abs(phase - 2.5) <= 0.1
        || Math.abs(phase) <= 0.08;
    }
    if (role === 'answer') {
      // Keep the quiet lower-hand downbeat as harmonic continuity, then let
      // the audible upper-shell answer enter in the back half of the Lead
      // rest. The reply remains late without creating a four-beat void.
      return Math.abs(absoluteBeat - spanStartBeat) <= 0.08
        || Math.abs(phase) <= 0.08
        || phase >= 1.5 - 0.08;
    }
    return true;
  };

  // ★ pad-comp 分工:pad active(且 avoidExactPitchOverlap)的 span,comp 让 pad —— 丢掉与 pad 同绝对
  //   MIDI 的音(消"齐奏 unison" mud 主因)+ 按 compDurationScale 缩时值。仅此最轻干预 → GM/texture/
  //   pocketize/polyVelocity 全保留(scale 缺省 1 = 字节不变);无 pad / silent 段一律不动。确定性。
  const padAvoidFor = (span: ChordSpan): { avoid: ReadonlySet<number>; durScale: number } => {
    const dec = ctx.padCompDecisionBySection?.[span.sectionId];
    const occ = ctx.padOccupiedPitchesBySpan?.[span.id];
    if (!dec || !dec.avoidExactPitchOverlap || !occ || occ.length === 0) {
      return { avoid: EMPTY_AVOID, durScale: 1 };
    }
    return { avoid: new Set(occ), durScale: dec.compDurationScale ?? 1 };
  };

  let totalBeats = 0;
  for (const span of plan.chordTimeline) {
    totalBeats = Math.max(totalBeats, span.startBeat + span.durationBeats);
  }

  // ★ comp 乐器按【类型 + 音域】分流(见 feedback):键盘族(钢琴/电钢/Celesta)→ 宽排列且 voice 宽和弦色彩;
  //   其它乐器 → 通用 voiceComp。超出该乐器音域的色彩音 → 丢弃(交给旋律承载)。
  const useKeyboard = isKeyboardFamily(ctx.compProgram);
  const instrumentCompRange = instrumentInfo(ctx.compProgram ?? 0).range;
  const compRange: readonly [number, number] = ctx.compRegister
    ? [ctx.compRegister.lowMidi, ctx.compRegister.highMidi]
    : instrumentCompRange;
  const inRange = (m: number): boolean => m >= compRange[0] && m <= compRange[1];
  // ★ 非键盘 comp(吉他/弦/木琴,音域窄):超域声部【八度折入】音域而非丢弃 —— 丢弃会掏空 span 造成
  //   comp-continuity 空洞(键盘 21-108 几乎不触发,窄音域乐器才暴露)。折入后去重升序,保和声完整。
  const foldToRange = (ms: number[]): number[] => {
    const out = ms.map((m) => { let x = m; while (x < compRange[0]) x += 12; while (x > compRange[1]) x -= 12; return x; });
    return [...new Set(out)].sort((a, b) => a - b);
  };
  // ★ 让位旋律:comp 顶须 < 旋律保留区地板(契约 comp[48,67]/lead[67,84] 的边界)。
  //   越界声部转位下折(完整度优先)/ 折不下去再减法。floor 不低于 comp 区底(不折进 bass)。无 floor 信号 → 跳过(向后兼容)。
  const compFloor = Math.max(compRange[0], ctx.compRegister ? ctx.compRegister.lowMidi : 48);
  const clampUnder = (ms: number[]): number[] =>
    ctx.melodyFloorMidi === undefined ? ms : yieldUnderMelody(ms, ctx.melodyFloorMidi, compFloor);
  const foundationPcFor = (span: ChordSpan): number => {
    const authoredBassPc = (span as ChordSpan & { bassPc?: number }).bassPc;
    if (typeof authoredBassPc === 'number') return mod12(authoredBassPc);
    const intervals = [...chordTypeIntervals(span.chordType ?? span.quality)];
    return resolveBassAnchorPc(
      span.bassRole,
      span.rootPc as number,
      intervals,
      span.bassPedalPc as number | undefined,
    );
  };
  const foundationMidiFor = (span: ChordSpan): number => {
    const pc = foundationPcFor(span);
    const requestedCeiling = ctx.melodyFloorMidi === undefined
      ? 60
      : Math.max(compFloor, ctx.melodyFloorMidi - 1);
    const ceiling = Math.min(compRange[1], requestedCeiling);
    for (let m = compFloor; m <= ceiling; m++) if (mod12(m) === pc) return m;
    for (let m = compFloor; m <= compRange[1]; m++) if (mod12(m) === pc) return m;
    return compFloor;
  };
  const withFoundationAnchor = (span: ChordSpan, ms: number[]): number[] => {
    if (!compOwnsFoundation(span)) return ms;
    const anchor = foundationMidiFor(span);
    // foundation pitch 必须真正在最低声部；低于 authored bassPc/slash/root 的旧
    // rootless 声部会颠倒低音语义，因此上移职责留给其它声部、这里直接让出。
    return [...new Set([anchor, ...ms.filter((m) => m >= anchor)])].sort((a, b) => a - b);
  };

  // spread mode 选择信号:和声功能 + cell 角色(进度四分位)+ 段落功能 + 乐句尾
  const timeline = plan.chordTimeline;
  const funcBySpan: Record<string, HarmonicFunction> = {};
  timeline.forEach((s, i) => { funcBySpan[s.id] = plan.chordFunctionTimeline[i]; });
  const N = timeline.length;
  const cellRoleAt = (i: number): SpreadCellRole =>
    i < N / 4 ? 'establish' : i < N / 2 ? 'develop' : i < (N * 3) / 4 ? 'lift' : 'cadence';
  const lastOfSection = (i: number): boolean => timeline[i + 1]?.sectionId !== timeline[i].sectionId;
  const pickPianoSpread = (i: number, span: ChordSpan): SpreadMode => {
    if (!ctx.voicingRng || !ctx.sectionRoleById) return 'wide';
    return pickSpreadMode({
      func: funcBySpan[span.id] ?? 'T',
      cellRole: cellRoleAt(i),
      sectionFunction: SECTION_FN[ctx.sectionRoleById[span.sectionId] ?? 'verse'] ?? 'VERSE',
      isPhraseEnd: lastOfSection(i),
      isLast: i === N - 1,
      random: ctx.voicingRng,
    });
  };

  // 预算 per-span voicing(全声部 voice-leading 链)+ 让位 shell voicing
  const voicedBySpan: Record<string, number[]> = {};
  const shellBySpan: Record<string, number[]> = {};
  // ★ ACG comp-air §2.5(2026-06-28 fidelity directive,按 B 反 round1):【未钳】宽 voicing(不 yieldUnderMelody
  //   坐到 lead 地板下)→ 保高位色音 air,仅 ACG 织体消费(MG 久石让钢琴=高位软色音 halo,听得见靠 register/mix 分离)。
  const airVoicedBySpan: Record<string, number[]> = {};
  let prevTop: number | undefined;
  let prevVoicing: number[] | undefined; // 上一组完整 voicing → 全声部贴最近(声部进行)
  let prevWide: WidePianoVoicing | undefined; // 钢琴宽排列的前一组锚点(共同音保留)
  for (let idx = 0; idx < timeline.length; idx++) {
    const span = timeline[idx];
    if (!inActive(span.sectionId)) continue;
    // comp = 内层骨干/导音(中声部);上层色彩音 9/13 是旋律的领地,有旋律时让渡给旋律,comp 不加色
    //   (折成 2 音会与 root/3 产生声学摩擦 —— 见 feedback;色彩走旋律/宽和弦,不走 comp)
    if (isLofi && ctx.lofiVoicingIntent) {
      const chordType = span.chordType ?? span.quality;
      const bassMidi = nominalBassMidi(span.rootPc);
      const intendedLow = Math.max(compRange[0], ctx.lofiVoicingIntent.register[0]);
      const intendedHigh = Math.min(
        compRange[1],
        ctx.lofiVoicingIntent.register[1],
        ctx.melodyFloorMidi === undefined ? Number.POSITIVE_INFINITY : ctx.melodyFloorMidi - 1,
      );
      const range = [intendedLow, Math.max(intendedLow, intendedHigh)] as const;
      const full = planFoundationVoicing({
        rootPc: span.rootPc,
        chordType,
        bassMidi,
        previous: prevVoicing ?? [],
        intent: ctx.lofiVoicingIntent,
        includeRoot: compOwnsFoundation(span),
        register: range,
      });
      const shell = planFoundationVoicing({
        rootPc: span.rootPc,
        chordType,
        bassMidi,
        previous: prevVoicing ?? [],
        intent: { ...ctx.lofiVoicingIntent, family: 'rootless-guide', maxVoicesWithBass: 2 },
        includeRoot: compOwnsFoundation(span),
        register: range,
        maxVoices: 2,
      });
      voicedBySpan[span.id] = withFoundationAnchor(span, full);
      airVoicedBySpan[span.id] = full;
      shellBySpan[span.id] = withFoundationAnchor(span, shell);
      if (full.length) {
        prevTop = full[full.length - 1];
        prevVoicing = full;
      }
    } else if (useKeyboard) {
      // ★ 键盘:voice 宽和弦【核心 + 显式色彩】(9/13 来自 chordType);色彩走 inner_high/upper(compound 高位,
      //   避开 pc-2 中低区摩擦)。无延伸的和弦 colorLevel 0。spread 随段落/功能/乐句位置变化。
      const chordType = span.chordType ?? span.quality;
      const rolePcs = chordTypeRolePcs(span.rootPc, chordType, span.quality);
      const hasColor = rolePcs.ninth !== undefined || rolePcs.eleventh !== undefined || rolePcs.thirteenth !== undefined || rolePcs.color !== undefined;
      const colorLevel = (hasColor ? 2 : 0) as 0 | 2;
      const bassMidi = nominalBassMidi(span.rootPc);
      const wideOpts = { includeRootInComp: styleKey !== 'jazz' || compOwnsFoundation(span), colorLevel, style };
      const spreadMode = pickPianoSpread(idx, span);
      const wide = buildWidePianoVoicing({ rootPc: span.rootPc, chordType, bassMidi, options: { ...wideOpts, spreadMode }, prev: prevWide, rolePcs });
      voicedBySpan[span.id] = withFoundationAnchor(span, clampUnder(wide.attackMidi.filter(inRange))); // Bass 缺席 → Comp 显式接地
      airVoicedBySpan[span.id] = wide.attackMidi.filter(inRange); // ★ §2.5:未钳(保 >67 高位色音)→ ACG 织体用
      // 让位/瘦身 = close 紧排核心(colorLevel 0,让色彩给旋律),仍是真实和弦音
      const shellWide = buildWidePianoVoicing({ rootPc: span.rootPc, chordType, bassMidi, options: { ...wideOpts, colorLevel: 0, spreadMode: 'close' }, prev: prevWide, rolePcs });
      shellBySpan[span.id] = withFoundationAnchor(span, clampUnder(shellWide.attackMidi.filter(inRange)));
      prevWide = wide;
    } else {
      // ★ 非键盘 comp:走 melodygenerative voicing 管线 — genre→preset → assembleVoicing(抽象 pc)
      //   → placeVoicingMidi(声部进行贴上一组) → applyArrangement(spacing)。复活 §7 voicingStyles/placement。
      //   voiceType = 窄核心品质(1-3-5-7),色彩 9/11/13 不进 comp(归旋律,铁律)。
      const voiceType = span.quality;
      const pref = compOwnsFoundation(span) ? COMP_ROOTED_CORE : (VOICING_PREF[styleKey] ?? STYLE_SHELL);
      const bassMidi = nominalBassMidi(span.rootPc);
      const prev = prevVoicing ?? [];
      const close = placeVoicingMidi(assembleVoicing(voiceType, span.rootPc, pref), prev, bassMidi, voiceType, span.rootPc);
      // 属功能 drop2 拉开 spacing,但仅当不跌出 comp 区(否则 close)→ 不与 bass 抢低区
      const spaced = funcBySpan[span.id] === 'D' ? applyArrangement(close, 'drop2', bassMidi) : close;
      const full = foldToRange(spaced.length && Math.min(...spaced) >= 48 ? spaced : close); // 超域折入(非丢弃)→ 不掏空
      // ★ 2026-06-10:非键盘 comp(吉他等窄音域)空轨兜底 —— clampUnder/fold 后若 <2 音,用【真实和弦音】
      //   root+3rd+5th(按 span.quality,小三和弦给小三度,绝不凭空塞大三度=avoid 音)折入 comp 区,不掏空。
      const guard = (v: number[]): number[] => v.length >= 2 ? v
        : foldToRange(chordToneIntervals(span.quality).slice(0, 3).map((iv) => 48 + ((span.rootPc + iv) % 12)));
      voicedBySpan[span.id] = withFoundationAnchor(span, guard(clampUnder(full))); // Bass 缺席 → Comp 显式接地
      airVoicedBySpan[span.id] = voicedBySpan[span.id]; // 非键盘(ACG 不走此支)→ air = 钳后值(ACG comp 恒键盘)
      const shellPref = compOwnsFoundation(span) ? COMP_ROOTED_CORE : COMP_SHELL;
      const shellClose = placeVoicingMidi(assembleVoicing(voiceType, span.rootPc, shellPref), prev, bassMidi, voiceType, span.rootPc);
      shellBySpan[span.id] = withFoundationAnchor(span, guard(clampUnder(foldToRange(shellClose))));
      if (full.length) { prevTop = full[full.length - 1]; prevVoicing = full; }
    }
  }

  // When the arranger assigns the harmonic foundation to Comp, guarantee an
  // audible root/slash anchor even when a texture begins after the downbeat.
  const ensureFoundationAttacks = (): void => {
    for (const span of timeline) {
      // A materialized role pattern already specifies every foundation attack.
      // A generic span-start repair here would destroy its syncopation.
      if (authoredCompSectionIds.has(span.sectionId)) continue;
      if (!compOwnsFoundation(span)) continue;
      const anchorPc = foundationPcFor(span);
      const anchorTick = timebase.beatToTick(beats(span.startBeat as number)) as number;
      const toleranceTicks = Math.round(timebase.ppq * 0.15);
      const hasAnchor = compNotes.some((note) =>
        Math.abs((note.startTick as number) - anchorTick) <= toleranceTicks
        && mod12(note.pitch as number) === anchorPc);
      if (hasAnchor) continue;
      const durationBeats = Math.max(0.12, Math.min(0.9, span.durationBeats as number));
      compNotes.push({
        pitch: midi(foundationMidiFor(span)),
        startTick: timebase.beatToTick(beats(span.startBeat as number)),
        durationTicks: timebase.beatToTick(beats(durationBeats)),
        velocity: 66,
      });
    }
    compNotes.sort((a, b) =>
      (a.startTick as number) - (b.startTick as number)
      || (a.pitch as number) - (b.pitch as number));
  };

  /**
   * Execute Arranger-authored Comp cells on the one global song-bar clock.
   * `absoluteBar` is deliberately used instead of resetting phase at a role or
   * section's first note; resetting each track is the pickup-shift bug exposed
   * by the supplied MIDI.
   */
  const renderAuthoredCompRhythm = (): void => {
    for (const sectionScore of Object.values(ctx.grooveScorePlan?.bySection ?? {})) {
      const rhythm = sectionScore.roleRhythmByRole?.comp;
      if (!rhythm || !inActive(sectionScore.sectionId)) continue;
      for (const bar of sectionScore.bars) {
        const barStart = bar.absoluteBar * beatsPerBar;
        for (const cell of rhythm.cells) {
          const onset = barStart + cell.phaseBeats;
          const span = spanAtBeat(plan, onset);
          if (!span || span.sectionId !== sectionScore.sectionId) continue;
          if (!keepLofiCompAttack(
            onset,
            span.startBeat as number,
            cell.voiceAction === 'foundation' ? 'foundation' : 'texture',
          )) continue;
          const available = Math.max(0.08, (span.startBeat as number) + (span.durationBeats as number) - onset - 0.02);
          const duration = Math.max(0.08, Math.min(cell.durationBeats, available));
          const padAvoid = padAvoidFor(span).avoid;
          if (cell.voiceAction === 'foundation') {
            const foundation = foundationMidiFor(span);
            if (!padAvoid.has(foundation)) {
              compNotes.push({
                pitch: midi(foundation),
                startTick: timebase.beatToTick(beats(onset)),
                durationTicks: timebase.beatToTick(beats(duration)),
                velocity: Math.max(1, Math.min(127, Math.round(cell.velocity))),
              });
            }
            continue;
          }

          // Chord responses occupy the middle voice. The low foundation is a
          // separate authored hit, so do not duplicate it inside a dense block.
          const rawVoiced = voicedBySpan[span.id] ?? [];
          const middleFloor = Math.max(50, compRange[0]);
          let voiced = rawVoiced.filter((value) => value >= middleFloor);
          if (voiced.length === 0) voiced = rawVoiced;
          if (voiced.length > 3) voiced = voiced.slice(voiced.length - 3);
          const attackVelocity = polyVelocity(
            Math.max(1, Math.min(127, Math.round(cell.velocity))),
            voiced.length,
          );
          for (const [voiceIndex, value] of voiced.entries()) {
            if (padAvoid.has(value)) continue;
            const voiceDurationBeats = cell.voiceDurationBeats?.[voiceIndex] ?? cell.durationBeats;
            const voiceDuration = Math.max(0.08, Math.min(voiceDurationBeats, available));
            compNotes.push({
              pitch: midi(value),
              startTick: timebase.beatToTick(beats(onset)),
              durationTicks: timebase.beatToTick(beats(voiceDuration)),
              velocity: attackVelocity,
            });
          }
        }
      }
    }
  };

  renderAuthoredCompRhythm();

  // ★ rich texture 渲染:消费中央下发的 textureSchedule(bass/comp/drum 共享同一 textureCase →
  //   同一时钟对拍/复调)。voicing 仍是上面那套真 voicing,只【节奏/articulation】走 texture。
  //   schedule 内无该 span(BLUES/default 或 floating 段)→ 落下面 compPattern 老路。
  if (ctx.textureSchedule && Object.keys(ctx.textureSchedule).length > 0) {
    for (let timelineIndex = 0; timelineIndex < timeline.length; timelineIndex++) {
      const span = timeline[timelineIndex]!;
      if (authoredCompSectionIds.has(span.sectionId)) continue;
      const tc = ctx.textureSchedule[span.id];
      if (!tc) continue;

      // ★ ACG comp-air §2.5(2026-06-28 fidelity directive,按 B 反 round1):ACG 钢琴织体用【未钳】air voicing
      //   (保高位色音)+ 不 thin(高 air 越 lead 区是有意空间=MG 久石让的空气感);+ 传真和弦 acgCtx →
      //   textureRenderer 算【真上方色音】(非从已钳 voicing 顶取)。audibility 靠 register/mix 分离(soft air halo)
      //   非大音量(directive §0/§2.5:别用 velocity/reverb 掩盖结构;结构=高位软色 + 真色音)。非 ACG 织体不变。
      const acg = isAcgTextureCase(tc);
      const scoreSpan = acg ? ctx.pianoScorePlan?.spanById[span.id] : undefined;
      const yieldHere = !!ctx.anchorBeats?.has(span.startBeat) && !!ctx.activeSectionIds?.has(span.sectionId);
      const thin = !acg && (yieldHere || !!ctx.voicingSaferSpans?.has(span.id));
      const acgVoicing = airVoicedBySpan[span.id] ?? voicedBySpan[span.id];
      const voiced = acg
        ? (scoreSpan ? revoiceAcgPianoScoreVoicing(acgVoicing ?? [], scoreSpan.comp) : acgVoicing)
        : (thin ? shellBySpan[span.id] : voicedBySpan[span.id]);
      if (!voiced || voiced.length === 0) continue;
      // ★ §2.5:ACG 给 textureRenderer 真和弦语境 → 真上方色音(非从已钳 voicing 顶部取)。
      const acgCtx = acg ? {
        rootPc: span.rootPc as number,
        chordType: (span.chordType ?? span.quality) as string,
        compFloorMidi: scoreSpan?.comp.floorMidi,
        compCeilingMidi: scoreSpan?.comp.ceilingMidi,
      } : undefined;

      const scoreOwnsAcgEvents = acg && !!scoreSpan;
      const padPolicy = padAvoidFor(span);
      // ACG PianoScorePlan is already the complete hand score. Pad avoidance
      // and duration thinning are useful generic texture policies, but would
      // silently delete/shorten authored piano events after the arranger has
      // committed them. Keep them for non-score paths only.
      const padAvoid = scoreOwnsAcgEvents ? EMPTY_AVOID : padPolicy.avoid;
      const compPerformanceFamily = textureBehavior(tc)?.family;
      const compPerformanceOwnsRelease = !!ctx.compPerformanceIntent
        && !!compPerformanceFamily
        && ['arp', 'block', 'answer', 'chop', 'sustain', 'wash'].includes(compPerformanceFamily);
      // An upstream finger/gate score owns key release for LOFI arps and
      // connected chord attacks.
      // Pad may still remove exact unisons, but shortening the surviving notes
      // here would undo the written connection. Sparse/block textures retain
      // the existing Pad-driven duration scale.
      const durScale = scoreOwnsAcgEvents || compPerformanceOwnsRelease
        ? 1
        : padPolicy.durScale;
      const base = span.startBeat as number;
      const nextSpan = timeline[timelineIndex + 1];
      const nextScore = nextSpan && acg ? ctx.pianoScorePlan?.spanById[nextSpan.id] : undefined;
      const nextAcgVoicing = nextSpan ? (airVoicedBySpan[nextSpan.id] ?? voicedBySpan[nextSpan.id]) : undefined;
      const nextVoiced = nextScore && nextAcgVoicing
        ? revoiceAcgPianoScoreVoicing(nextAcgVoicing, nextScore.comp)
        : undefined;
      // ACG events are a complete phrase score.  Texture cases remain material
      // labels for the rest of the arrangement (for example drums/reporting),
      // but no longer get to invent comp rhythm, direction or rests here.
      const rawHits = acg && scoreSpan
        ? realizeAcgPianoScoreCompEvents(
          scoreSpan.comp,
          voiced,
          nextVoiced,
          span.durationBeats as number,
        )
        : renderTextureChordHits(tc, voiced, span.durationBeats as number, acgCtx);
      // Decide the call/response attack mask before finger-legato is
      // compiled. The performance realizer can then connect the surviving
      // keys; deleting attacks afterwards would leave audible holes.
      const interactionHits = isLofi
        ? rawHits.filter((hit) =>
          keepLofiCompAttack(base + hit.tRel, base, 'texture'))
        : rawHits;
      const scoreOwnedInteractionHits = withMotifEchoHits(
        withLofiAnswerFallback(
          interactionHits,
          base,
          span.durationBeats as number,
          voiced,
        ),
        base,
        span.durationBeats as number,
        voiced,
      );
      const scoreHits = realizeCompPerformance(
        tc,
        scoreOwnedInteractionHits,
        voiced,
        span.durationBeats as number,
        ctx.compPerformanceIntent,
        ctx.compPedalActiveSectionIds?.has(span.sectionId) ?? false,
      );
      const lastScoreAttack = Math.max(-Infinity, ...scoreHits.map((hit) => hit.tRel));
      const lofiBlockAttack = isLofi
        && !!compPerformanceFamily
        && ['block', 'answer', 'chop', 'sustain', 'wash'].includes(compPerformanceFamily);
      for (const h of scoreHits) {
        // ★ 入袋:仅【柱式块(h.midis≥2)】收 lay-back 与节奏组对拍;arp/roll(单音 hit)是有意 stagger,不动。
        //   ★ Loop I:LOFI 柱式块走【中央 texture clock】(16 分格吸附 + 毫秒 pocket,取代 0.2 强度 pocketize)
        //     → dusty chop 0.58→0.50+毫秒,与 bass/drum 同时钟;非 LOFI 仍按风格 pocketize。
        const abs = base + h.tRel;
        const harmonicEnd = base + (span.durationBeats as number);
        if (isLofi && abs >= harmonicEnd - 0.01) continue;
        let onset = acg
          ? abs
          : h.midis.length >= 2 || lofiBlockAttack
            ? (isLofi ? lofiTextureClockBeat(abs, beatsPerBar, tempoBpm, 'chord', 'establish', `${tc}|${span.id}`) : pocketizeBeat(abs, pocketStrength))
            : abs;
        // ★ 强拍位硬锁(2026-06-09 修「重音对拍/复调错拍」):comp【柱式块】落在整拍 ±0.06 拍内 → 锁到整拍,
        //   与 bass/drum 同拍咬合(消系统性晚 0.02-0.05=flam/错拍);offbeat(0.5/1.5…)与 arp/roll 单音不锁,保 groove。
        if (!acg && (h.midis.length >= 2 || lofiBlockAttack)) { const ni = Math.round(onset); if (Math.abs(onset - ni) < 0.06) onset = ni; }
        const startTick = timebase.beatToTick(beats(onset));
        // ★ texture 源 velocity(0.3-0.48)为源 mix 调,偏软;newEngine bass/lead 在 80-90 →
        //   抬进可听的伴奏层(gain+floor 保留 texture 内部相对强弱/accent,只整体提亮)。floor 再抬一档。
        // ★ §2.5 + 大小声平衡(2026-06-28 用户:ACG comp「一轨很小声」)。保 air voicing/真色音(directive B 结构),
        //   但 velocity 从过软(B floor≈40)抬到【可听又仍软于 generic】的中档(floor≈50/顶≈80);audibility 主靠
        //   gmMixProfile 的 ACG comp CC7 抬(98)+ lead 减压(77),非纯靠 velocity → soft-but-present 久石让钢琴。
        const vel = acg
          ? Math.max(1, Math.min(96, Math.round((h.vel * 0.82 + 0.38) * 127)))
          : Math.max(1, Math.min(120, Math.round((h.vel * 0.92 + 0.42) * 127))); // body 抬一档(均衡:comp 原太低)
        const polyVel = polyVelocity(vel, h.midis.length); // 柱式块(N≥3)复音衰减;arp/roll 的 N1 hit 不动
        for (const m of h.midis) {
          if (padAvoid.has(m)) continue; // ★ pad 让位:丢与 pad 同绝对 MIDI 的音(消 unison mud)
          let performedDuration = h.dur * durScale;
          if (isLofi && nextSpan) {
            const nextType = nextSpan.chordType ?? String(nextSpan.quality);
            const nextAllowed = new Set<number>([
              ...chordTypeIntervals(nextType).map((interval) =>
                mod12((nextSpan.rootPc as number) + interval) as number),
              ...(plan.stableToneMap[nextSpan.id] ?? []).map(Number),
              ...(plan.colorToneMap[nextSpan.id] ?? []).map(Number),
            ]);
            const admittedByNext = nextAllowed.has(mod12(m) as number);
            const commonToneBoundary = compPerformanceOwnsRelease
              && !ctx.compPedalActiveSectionIds?.has(span.sectionId)
              && ctx.compPerformanceIntent?.unsupportedDamperFallback === 'finger-legato'
              && Math.abs(h.tRel - lastScoreAttack) <= 1e-6;
            // The final lower/upper common tone can physically stay under the
            // hand until the next texture enters. Other voices still release,
            // so this bridges silence without smearing the old whole chord.
            if (commonToneBoundary
                && admittedByNext
                && ctx.textureSchedule) {
              const nextTexture = ctx.textureSchedule[nextSpan.id];
              const nextEntry = nextTexture
                ? textureBehavior(nextTexture)?.firstOnsetBeat ?? 0
                : 0;
              const bridge = Math.min(
                ctx.compPerformanceIntent?.commonToneBridgeMaxBeats ?? 0,
                Math.max(0, nextEntry),
              );
              performedDuration = Math.max(performedDuration, harmonicEnd + bridge - onset);
            }
            if (onset + performedDuration > harmonicEnd && !admittedByNext) {
              performedDuration = Math.max(0.08, harmonicEnd - onset - 0.02);
            }
          }
          const durationTicks = timebase.beatToTick(beats(performedDuration));
          compNotes.push({ pitch: midi(m), startTick, durationTicks, velocity: polyVel });
        }
      }
      // ★ Loop I.3:no-pad + comp 是唯一和声支撑,且 texture 首击太晚(firstOnsetBeat>0.08,如 wash 0.25)→
      //   在 structural 下拍补一个【轻、短】guide-tone shell anchor(不让 late wash 当唯一 comp 下拍锚)。
      // ★ §3.5:ACG 稀疏/wash/planing 织体【不】注入 downbeat guide shell —— 缺的下拍 shell 往往就是织体本身(bass/pedal 已托底)。
      if (!acg && ctx.needsDownbeatCompAnchorBySection?.[span.sectionId] && (textureBehavior(tc)?.firstOnsetBeat ?? 0) > 0.08) {
        const anchorShell = shellBySpan[span.id] ?? voiced;
        const anchorTick = timebase.beatToTick(beats(span.startBeat as number));
        const anchorDur = timebase.beatToTick(beats(0.5));
        for (const m of anchorShell) {
          if (padAvoid.has(m)) continue;
          compNotes.push({ pitch: midi(m), startTick: anchorTick, durationTicks: anchorDur, velocity: 44 }); // 轻于主 comp
        }
      }
    }
    ensureFoundationAttacks();
    return [{ role: 'comp', notes: compNotes }];
  }

  const bars = Math.ceil(totalBeats / beatsPerBar);
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * beatsPerBar;
    for (const hit of pattern) {
      const beat = barStart + hit.beat;
      if (beat >= totalBeats) continue;
      const span = spanAtBeat(plan, beat);
      if (!span || !inActive(span.sectionId)) continue;
      if (authoredCompSectionIds.has(span.sectionId)) continue;
      if (!keepLofiCompAttack(beat, span.startBeat as number, 'texture')) continue;
      const yieldHere = !!ctx.anchorBeats?.has(span.startBeat) && !!ctx.activeSectionIds?.has(span.sectionId);
      const thin = yieldHere || !!ctx.voicingSaferSpans?.has(span.id); // 让位 或 撞音阶梯瘦身
      const voiced = thin ? shellBySpan[span.id] : voicedBySpan[span.id];

      const { avoid: padAvoid, durScale } = padAvoidFor(span); // pad-active span 才非空
      const startTick = timebase.beatToTick(beats(beat));
      const durationTicks = timebase.beatToTick(beats(hit.dur * durScale));
      const polyVel = polyVelocity(hit.vel, voiced.length); // 柱式块复音衰减(不爆顶)
      for (const m of voiced) {
        if (padAvoid.has(m)) continue; // ★ pad 让位:丢与 pad 同绝对 MIDI 的音
        compNotes.push({ pitch: midi(m), startTick, durationTicks, velocity: polyVel });
      }
    }
    // P2 motif 回声(legacy compPattern 路;texture 路在 span 循环内做):
    // 回声小节按 motif 头部 cell 补 shell 击点,已有击点 ±0.2 内不叠。
    const echo = ctx.motifEchoByAbsoluteBar?.get(bar);
    if (echo) {
      const existing = compNotes
        .map((n) => (n.startTick as number) / timebase.ppq)
        .filter((b) => b >= barStart && b < barStart + beatsPerBar);
      echo.accentBeats.forEach((phase, index) => {
        const beat = barStart + phase;
        if (beat >= totalBeats) return;
        const span = spanAtBeat(plan, beat);
        if (!span || !inActive(span.sectionId) || authoredCompSectionIds.has(span.sectionId)) return;
        if (existing.some((b) => Math.abs(b - beat) <= 0.2)) return;
        const shell = shellBySpan[span.id] ?? voicedBySpan[span.id];
        const durationTicks = timebase.beatToTick(beats(echo.durations[index] ?? 0.5));
        const startTick = timebase.beatToTick(beats(beat));
        for (const m of shell) compNotes.push({ pitch: midi(m), startTick, durationTicks, velocity: Math.round((echo.velocity ?? 0.5) * 116) });
      });
    }
  }

  ensureFoundationAttacks();
  return [{ role: 'comp', notes: compNotes }];
}
