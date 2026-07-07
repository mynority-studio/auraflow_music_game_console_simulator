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
import { isKeyboardFamily, instrumentInfo } from '../knowledge/instruments';
import { buildWidePianoVoicing, pickSpreadMode, type SpreadCellRole, type SpreadMode, type SpreadPicker, type SpreadSectionFunction, type VoiceRole, type WidePianoVoicing } from '../knowledge/widePianoVoicings';
import { renderTextureChordHits, isAcgTextureCase } from './textureRenderer';
import { lofiTextureClockBeat } from './textureClock';
import { textureBehavior } from '../knowledge/textureProfiles';
import type { TextureSchedule } from './textureSchedule';
import type { ChordSpan, HarmonicFunction, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { SectionRole } from '../arranger/ArrangementPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import type { PadCompDecision } from './padCompPolicy';

export interface AccompContext {
  style?: string;
  anchorBeats?: Set<number>;      // 主 hook 锚点拍位(active 段在此瘦身让位)
  activeSectionIds?: Set<string>; // active 织体段
  voicingSaferSpans?: Set<string>; // 撞音阶梯 rung1:这些 span 强制瘦身 3+7 shell
  compProgram?: number;            // ★ comp 实际乐器 GM program:钢琴家族 → 宽排列,否则通用 voiceComp
  sectionRoleById?: Record<string, SectionRole>; // 段落功能 → 钢琴 spread mode 选择(pickSpreadMode)
  voicingRng?: SpreadPicker;       // spread mode 选择用的确定性子流('accompaniment')
  textureSchedule?: TextureSchedule; // ★ 中央下发的 spanId→textureCase(bass/comp/drum 共享)
  melodyFloorMidi?: number;        // ★ comp ceiling(通常 registerByRole.comp.high+1):comp 顶须 < 此 → 给 lead 留空间
  // —— pad-comp 分工(pad-aware thinning,仅在 pad-active span 生效,保 GM 手感)——
  padCompDecisionBySection?: Record<string, PadCompDecision>; // 每段 pad↔comp 决策
  padOccupiedPitchesBySpan?: Record<string, number[]>;        // pad 各 span 已占绝对 MIDI(comp 让 pad)
  needsDownbeatCompAnchorBySection?: Record<string, boolean>; // ★ Loop I.3:no-pad comp 支撑段 → late texture 补下拍 anchor
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
  const pocketStrength = POCKET_STRENGTH[style.toLowerCase()] ?? 0.45; // comp 柱式入袋强度(按风格)
  const isLofi = style.toLowerCase() === 'lofi';                       // ★ Loop I:LOFI 走中央 texture clock
  const tempoBpm = timebase.tempoMap[0]?.bpm ?? 78;                    // pocket ms→拍 换算用
  const inActive = (sid: string) => !ctx.activeSectionIds || ctx.activeSectionIds.has(sid);

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
  const compRange = instrumentInfo(ctx.compProgram ?? 0).range;
  const inRange = (m: number): boolean => m >= compRange[0] && m <= compRange[1];
  // ★ 非键盘 comp(吉他/弦/木琴,音域窄):超域声部【八度折入】音域而非丢弃 —— 丢弃会掏空 span 造成
  //   comp-continuity 空洞(键盘 21-108 几乎不触发,窄音域乐器才暴露)。折入后去重升序,保和声完整。
  const foldToRange = (ms: number[]): number[] => {
    const out = ms.map((m) => { let x = m; while (x < compRange[0]) x += 12; while (x > compRange[1]) x -= 12; return x; });
    return [...new Set(out)].sort((a, b) => a - b);
  };
  const includeRootInComp = !/jazz/i.test(style); // jazz:rootless(bass 兜 root),其它含 root
  // ★ 让位旋律:comp 顶须 < 旋律保留区地板(契约 comp[48,67]/lead[67,84] 的边界)。
  //   越界声部转位下折(完整度优先)/ 折不下去再减法。floor 不低于 comp 区底(不折进 bass)。无 floor 信号 → 跳过(向后兼容)。
  const compFloor = Math.max(compRange[0], 48);
  const clampUnder = (ms: number[]): number[] =>
    ctx.melodyFloorMidi === undefined ? ms : yieldUnderMelody(ms, ctx.melodyFloorMidi, compFloor);

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
    if (useKeyboard) {
      // ★ 键盘:voice 宽和弦【核心 + 显式色彩】(9/13 来自 chordType);色彩走 inner_high/upper(compound 高位,
      //   避开 pc-2 中低区摩擦)。无延伸的和弦 colorLevel 0。spread 随段落/功能/乐句位置变化。
      const chordType = span.chordType ?? span.quality;
      const rolePcs = chordTypeRolePcs(span.rootPc, chordType, span.quality);
      const hasColor = rolePcs.ninth !== undefined || rolePcs.eleventh !== undefined || rolePcs.thirteenth !== undefined || rolePcs.color !== undefined;
      const colorLevel = (hasColor ? 2 : 0) as 0 | 2;
      const bassMidi = nominalBassMidi(span.rootPc);
      const wideOpts = { includeRootInComp, colorLevel, style };
      const spreadMode = pickPianoSpread(idx, span);
      const wide = buildWidePianoVoicing({ rootPc: span.rootPc, chordType, bassMidi, options: { ...wideOpts, spreadMode }, prev: prevWide, rolePcs });
      voicedBySpan[span.id] = clampUnder(wide.attackMidi.filter(inRange)); // 超域色彩 → 交旋律;顶 ≥ 旋律地板 → 转位/减法让位
      airVoicedBySpan[span.id] = wide.attackMidi.filter(inRange); // ★ §2.5:未钳(保 >67 高位色音)→ ACG 织体用
      // 让位/瘦身 = close 紧排核心(colorLevel 0,让色彩给旋律),仍是真实和弦音
      const shellWide = buildWidePianoVoicing({ rootPc: span.rootPc, chordType, bassMidi, options: { ...wideOpts, colorLevel: 0, spreadMode: 'close' }, prev: prevWide, rolePcs });
      shellBySpan[span.id] = clampUnder(shellWide.attackMidi.filter(inRange));
      prevWide = wide;
    } else {
      // ★ 非键盘 comp:走 melodygenerative voicing 管线 — genre→preset → assembleVoicing(抽象 pc)
      //   → placeVoicingMidi(声部进行贴上一组) → applyArrangement(spacing)。复活 §7 voicingStyles/placement。
      //   voiceType = 窄核心品质(1-3-5-7),色彩 9/11/13 不进 comp(归旋律,铁律)。
      const voiceType = span.quality;
      const pref = VOICING_PREF[style.toLowerCase()] ?? STYLE_SHELL;
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
      voicedBySpan[span.id] = guard(clampUnder(full)); // 顶 ≥ 旋律地板 → 转位/减法让位;空 → 兜底三和弦
      airVoicedBySpan[span.id] = voicedBySpan[span.id]; // 非键盘(ACG 不走此支)→ air = 钳后值(ACG comp 恒键盘)
      const shellClose = placeVoicingMidi(assembleVoicing(voiceType, span.rootPc, COMP_SHELL), prev, bassMidi, voiceType, span.rootPc);
      shellBySpan[span.id] = guard(clampUnder(foldToRange(shellClose)));
      if (full.length) { prevTop = full[full.length - 1]; prevVoicing = full; }
    }
  }

  // ★ rich texture 渲染:消费中央下发的 textureSchedule(bass/comp/drum 共享同一 textureCase →
  //   同一时钟对拍/复调)。voicing 仍是上面那套真 voicing,只【节奏/articulation】走 texture。
  //   schedule 内无该 span(BLUES/default 或 floating 段)→ 落下面 compPattern 老路。
  if (ctx.textureSchedule && Object.keys(ctx.textureSchedule).length > 0) {
    for (const span of timeline) {
      const tc = ctx.textureSchedule[span.id];
      if (!tc) continue;

      // ★ ACG comp-air §2.5(2026-06-28 fidelity directive,按 B 反 round1):ACG 钢琴织体用【未钳】air voicing
      //   (保高位色音)+ 不 thin(高 air 越 lead 区是有意空间=MG 久石让的空气感);+ 传真和弦 acgCtx →
      //   textureRenderer 算【真上方色音】(非从已钳 voicing 顶取)。audibility 靠 register/mix 分离(soft air halo)
      //   非大音量(directive §0/§2.5:别用 velocity/reverb 掩盖结构;结构=高位软色 + 真色音)。非 ACG 织体不变。
      const acg = isAcgTextureCase(tc);
      const yieldHere = !!ctx.anchorBeats?.has(span.startBeat) && !!ctx.activeSectionIds?.has(span.sectionId);
      const thin = !acg && (yieldHere || !!ctx.voicingSaferSpans?.has(span.id));
      const voiced = acg ? (airVoicedBySpan[span.id] ?? voicedBySpan[span.id]) : (thin ? shellBySpan[span.id] : voicedBySpan[span.id]);
      if (!voiced || voiced.length === 0) continue;
      // ★ §2.5:ACG 给 textureRenderer 真和弦语境 → 真上方色音(非从已钳 voicing 顶部取)。
      const acgCtx = acg ? { rootPc: span.rootPc as number, chordType: (span.chordType ?? span.quality) as string } : undefined;

      const { avoid: padAvoid, durScale } = padAvoidFor(span); // pad-active span 才非空,否则零干预
      const base = span.startBeat as number;
      for (const h of renderTextureChordHits(tc, voiced, span.durationBeats as number, acgCtx)) {
        // ★ 入袋:仅【柱式块(h.midis≥2)】收 lay-back 与节奏组对拍;arp/roll(单音 hit)是有意 stagger,不动。
        //   ★ Loop I:LOFI 柱式块走【中央 texture clock】(16 分格吸附 + 毫秒 pocket,取代 0.2 强度 pocketize)
        //     → dusty chop 0.58→0.50+毫秒,与 bass/drum 同时钟;非 LOFI 仍按风格 pocketize。
        const abs = base + h.tRel;
        let onset = h.midis.length >= 2
          ? (isLofi ? lofiTextureClockBeat(abs, beatsPerBar, tempoBpm, 'chord', 'establish', `${tc}|${span.id}`) : pocketizeBeat(abs, pocketStrength))
          : abs;
        // ★ 强拍位硬锁(2026-06-09 修「重音对拍/复调错拍」):comp【柱式块】落在整拍 ±0.06 拍内 → 锁到整拍,
        //   与 bass/drum 同拍咬合(消系统性晚 0.02-0.05=flam/错拍);offbeat(0.5/1.5…)与 arp/roll 单音不锁,保 groove。
        if (h.midis.length >= 2) { const ni = Math.round(onset); if (Math.abs(onset - ni) < 0.06) onset = ni; }
        const startTick = timebase.beatToTick(beats(onset));
        const durationTicks = timebase.beatToTick(beats(h.dur * durScale)); // pad active → 略缩(缺省 1=不变)
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
  }

  return [{ role: 'comp', notes: compNotes }];
}
