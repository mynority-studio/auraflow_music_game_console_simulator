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
import { renderTextureChordHits } from './textureRenderer';
import type { TextureSchedule } from './textureSchedule';
import type { ChordSpan, HarmonicFunction, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { SectionRole } from '../arranger/ArrangementPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

export interface AccompContext {
  style?: string;
  anchorBeats?: Set<number>;      // 主 hook 锚点拍位(active 段在此瘦身让位)
  activeSectionIds?: Set<string>; // active 织体段
  voicingSaferSpans?: Set<string>; // 撞音阶梯 rung1:这些 span 强制瘦身 3+7 shell
  compProgram?: number;            // ★ comp 实际乐器 GM program:钢琴家族 → 宽排列,否则通用 voiceComp
  sectionRoleById?: Record<string, SectionRole>; // 段落功能 → 钢琴 spread mode 选择(pickSpreadMode)
  voicingRng?: SpreadPicker;       // spread mode 选择用的确定性子流('accompaniment')
  textureSchedule?: TextureSchedule; // ★ 中央下发的 spanId→textureCase(bass/comp/drum 共享)
}

const SECTION_FN: Record<SectionRole, SpreadSectionFunction> = {
  intro: 'INTRO', verse: 'VERSE', chorus: 'CHORUS', bridge: 'BRIDGE', outro: 'OUTRO',
};

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
  const inActive = (sid: string) => !ctx.activeSectionIds || ctx.activeSectionIds.has(sid);

  let totalBeats = 0;
  for (const span of plan.chordTimeline) {
    totalBeats = Math.max(totalBeats, span.startBeat + span.durationBeats);
  }

  // ★ comp 乐器按【类型 + 音域】分流(见 feedback):键盘族(钢琴/电钢/Celesta)→ 宽排列且 voice 宽和弦色彩;
  //   其它乐器 → 通用 voiceComp。超出该乐器音域的色彩音 → 丢弃(交给旋律承载)。
  const useKeyboard = isKeyboardFamily(ctx.compProgram);
  const compRange = instrumentInfo(ctx.compProgram ?? 0).range;
  const inRange = (m: number): boolean => m >= compRange[0] && m <= compRange[1];
  const includeRootInComp = !/jazz/i.test(style); // jazz:rootless(bass 兜 root),其它含 root

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
      voicedBySpan[span.id] = wide.attackMidi.filter(inRange); // 超域色彩 → 交旋律
      // 让位/瘦身 = close 紧排核心(colorLevel 0,让色彩给旋律),仍是真实和弦音
      const shellWide = buildWidePianoVoicing({ rootPc: span.rootPc, chordType, bassMidi, options: { ...wideOpts, colorLevel: 0, spreadMode: 'close' }, prev: prevWide, rolePcs });
      shellBySpan[span.id] = shellWide.attackMidi.filter(inRange);
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
      const full = (spaced.length && Math.min(...spaced) >= 48 ? spaced : close).filter(inRange);
      voicedBySpan[span.id] = full;
      const shellClose = placeVoicingMidi(assembleVoicing(voiceType, span.rootPc, COMP_SHELL), prev, bassMidi, voiceType, span.rootPc);
      shellBySpan[span.id] = shellClose.filter(inRange);
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

      const yieldHere = !!ctx.anchorBeats?.has(span.startBeat) && !!ctx.activeSectionIds?.has(span.sectionId);
      const thin = yieldHere || !!ctx.voicingSaferSpans?.has(span.id);
      const voiced = thin ? shellBySpan[span.id] : voicedBySpan[span.id];
      if (!voiced || voiced.length === 0) continue;

      const base = span.startBeat as number;
      for (const h of renderTextureChordHits(tc, voiced, span.durationBeats as number)) {
        const startTick = timebase.beatToTick(beats(base + h.tRel));
        const durationTicks = timebase.beatToTick(beats(h.dur));
        // ★ texture 源 velocity(0.3-0.48)为源 mix 调,偏软;newEngine bass/lead 在 80-90 →
        //   抬进可听的伴奏层(gain+floor 保留 texture 内部相对强弱/accent,只整体提亮)。
        const vel = Math.max(1, Math.min(112, Math.round((h.vel * 0.9 + 0.24) * 127)));
        for (const m of h.midis) compNotes.push({ pitch: midi(m), startTick, durationTicks, velocity: vel });
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

      const startTick = timebase.beatToTick(beats(beat));
      const durationTicks = timebase.beatToTick(beats(hit.dur));
      for (const m of voiced) {
        compNotes.push({ pitch: midi(m), startTick, durationTicks, velocity: hit.vel });
      }
    }
  }

  return [{ role: 'comp', notes: compNotes }];
}
