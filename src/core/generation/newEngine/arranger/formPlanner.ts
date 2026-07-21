// ============================================================
// newEngine · arranger · FormPlanner
// ------------------------------------------------------------
// 架构定稿 Part 3.2 / 5:sections / repeats / hook placement。
// 多曲式模板池 + seed 选型 + 段落长度变化(不同 seed → 不同曲式)。
// 同功能段落共享 repeatGroup(verse↔verse, chorus↔chorus)→ 下游让 motif 跨段复现(记忆点)。
// 不变量:每个模板 ≥1 chorus(高潮锚点)+ verse/chorus 保 repeatGroup 排比。
// 无 rng → 固定 verse-chorus(向后兼容 + 显式测试)。
// ============================================================

import type { Rng } from '../foundation';
import type { Section } from './ArrangementPlan';
import {
  acgPianoArrangementProfileForId,
  resolveAcgPianoArrangementProfile,
  type AcgPianoArrangementProfile,
  type AcgPianoArrangementProfileId,
} from './acgPianoArrangementProfiles';

export type FormTemplate = 'verse-chorus' | 'verse-chorus-bridge' | 'double-verse' | 'compact';

const TEMPLATES: Record<FormTemplate, Section[]> = {
  // 标准 verse-chorus(基线)
  'verse-chorus': [
    { id: 'intro', role: 'intro', bars: 4, hookPolicy: 'none' },
    { id: 'verse1', role: 'verse', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
    { id: 'chorus1', role: 'chorus', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
    { id: 'verse2', role: 'verse', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
    { id: 'chorus2', role: 'chorus', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
    { id: 'outro', role: 'outro', bars: 4, hookPolicy: 'none' },
  ],
  // 带 bridge:终段前插桥段 + 复唱 chorus(经典流行)
  'verse-chorus-bridge': [
    { id: 'intro', role: 'intro', bars: 4, hookPolicy: 'none' },
    { id: 'verse1', role: 'verse', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
    { id: 'chorus1', role: 'chorus', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
    { id: 'verse2', role: 'verse', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
    { id: 'chorus2', role: 'chorus', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
    { id: 'bridge', role: 'bridge', bars: 8, hookPolicy: 'none' },
    { id: 'chorus3', role: 'chorus', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
    { id: 'outro', role: 'outro', bars: 4, hookPolicy: 'none' },
  ],
  // 双主歌叙事:首副歌前铺两段 verse
  'double-verse': [
    { id: 'intro', role: 'intro', bars: 4, hookPolicy: 'none' },
    { id: 'verse1', role: 'verse', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
    { id: 'verse2', role: 'verse', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
    { id: 'chorus1', role: 'chorus', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
    { id: 'verse3', role: 'verse', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
    { id: 'chorus2', role: 'chorus', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
    { id: 'outro', role: 'outro', bars: 4, hookPolicy: 'none' },
  ],
  // 紧凑:无 intro/outro,直入正歌副歌
  'compact': [
    { id: 'verse1', role: 'verse', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
    { id: 'chorus1', role: 'chorus', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
    { id: 'verse2', role: 'verse', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
    { id: 'chorus2', role: 'chorus', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
  ],
};

const FORM_POOL: readonly FormTemplate[] = ['verse-chorus', 'verse-chorus-bridge', 'double-verse', 'compact'];

// ============================================================
// ★ 风格曲式池(CODEX V4.2 吸纳,分层加,不动管道):每风格一组 form,
//   role 保 legacy 五类(render/texture/trace 投影),另带 harmonyRole(选 prototype)+ functionTag(能量/hook)。
//   ⚠️ repeatGroup 只组【同 bars 同功能】段落(引擎按 group 复用 prototype,混 bars 会错配);
//      混 bars 的相邻段不组(各自 prototype / degree-picker)。
// ============================================================
// ★ 程序化曲式装配(用户:arranger 层 per-seed 拼接,intro 可有可无、verse 1-2 段、风格化、≤5 段、~60bar、记忆点)。
//   规则化随机(确定性 rng 子流);content 段(verse/chorus/loop/head)按预算定 bars(8-16,4-bar 乐句对齐)→ 总 ~目标。
//   记忆点:verse/loop/head 连续×{1,2} 同 repeatGroup;保证 verse 或 chorus 之一 ×2;末 verse linkOut=dominantLift 推进副歌。
const PROCEDURAL_STYLES = new Set(['pop', 'rnb', 'lofi', 'jazz', 'acg']);
const TARGET_BARS = 60; // 用户:~60 bar 的结构化清晰音乐

const TARGET_BAR_BOUNDS: Record<string, readonly [number, number]> = {
  pop: [12, 120],
  rnb: [12, 120],
  lofi: [8, 68],
  jazz: [12, 144],
  acg: [12, 84],
};

/** 请求秒数换算出的浮点小节预算 → 风格安全区间内的 4-bar 乐句网格。 */
function normalizeTargetBars(style: string, targetBars: number): number {
  const [lo, hi] = TARGET_BAR_BOUNDS[style] ?? [12, 96];
  return Math.max(lo, Math.min(hi, Math.round(targetBars / 4) * 4));
}

/** content 段长 = 预算均摊到各段，并保持 4-bar 乐句对齐。 */
const sizeContent = (budget: number, count: number, minBars = 8, maxBars = 16): number =>
  Math.max(minBars, Math.min(maxBars, Math.round(budget / Math.max(1, count) / 4) * 4));

/** 可选 intro 仍保留 seed 偏好作平局裁决，但时长请求下选择更贴近预算的一侧。 */
function fitOptionalIntro(
  preferred: boolean,
  targetBars: number,
  introBars: number,
  fixedBars: number,
  contentCount: number,
  minContentBars: number,
  maxContentBars: number,
): boolean {
  const total = (include: boolean): number => {
    const edges = fixedBars + (include ? introBars : 0);
    return edges + contentCount * sizeContent(targetBars - edges, contentCount, minContentBars, maxContentBars);
  };
  const withoutError = Math.abs(total(false) - targetBars);
  const withError = Math.abs(total(true) - targetBars);
  if (withError === withoutError) return preferred;
  return withError < withoutError;
}

// Pop / RNB:双 verse/chorus 走 V1-C1-V2-C2；单 chorus 保持 verse×-chorus。进入 chorus 的 verse 负责 dominantLift。
function assemblePopRnb(rnb: boolean, rng: Rng, requestedBars?: number): Section[] {
  const targetBars = requestedBars ?? TARGET_BARS;
  const durationAware = requestedBars !== undefined;
  let hasIntro = rng.next() < (rnb ? 0.7 : 0.55);
  rng.next(); // ★ 占位:旧 hasOutro 掷点,保 rng 流对齐(各 seed 的 verse/chorus 决策不变);outro 现必有,结果弃用。
  // ★ 收尾段【必有】(修戛然而止):outro 不再可选/不被砍 → 保证能量回落 + 终止式回归(harmonyRole 'ending')。
  let verses = rng.pick([1, 2, 2]);   // 偏 2(记忆点)
  let choruses = rng.pick([1, 2, 2]);
  if (verses === 1 && choruses === 1) choruses = 2; // 保证 ≥1 处 ×2(记忆点)
  if (durationAware && targetBars <= 16) {
    hasIntro = false;
    verses = 1;
    choruses = 1;
  } else if (durationAware && targetBars <= 40) {
    while (verses + choruses > 3 && verses > 1) verses--;
    while (verses + choruses > 3 && choruses > 1) choruses--;
    if (targetBars < 24) hasIntro = false;
  } else if (durationAware && targetBars >= 64) {
    while (verses + choruses < 4) choruses++;
  }
  // ≤6(放宽:intro + verse×2 + chorus×2 + outro = 标准流行曲式,不砍 intro 也不砍 outro)。
  const over = () => Math.max(0, (hasIntro ? 1 : 0) + verses + choruses + 1 - 6); // outro 固定占 1 槽
  if (over() && hasIntro) hasIntro = false;          // 仍超(content 太多)→ 先砍 intro(收尾比开场重要)
  while (over() && choruses > 1) choruses--;
  while (over() && verses > 1) verses--;

  if (durationAware) hasIntro = fitOptionalIntro(hasIntro, targetBars, 4, 4, verses + choruses, 4, 28);
  const introBars = hasIntro ? (durationAware ? 4 : (rnb ? 4 : 2)) : 0;
  const outroBars = 4; // 4 小节收尾乐句(够走 V-I 终止 + 能量回落)
  const per = sizeContent(
    targetBars - introBars - outroBars,
    verses + choruses,
    durationAware ? 4 : 8,
    durationAware ? 28 : 16,
  );

  const out: Section[] = [];
  if (hasIntro) out.push({ id: rnb ? 'introVamp' : 'intro', role: 'intro', harmonyRole: 'intro', functionTag: 'setup', bars: introBars, hookPolicy: rnb ? 'light' : 'none' });
  const verseSections: Section[] = [];
  for (let i = 1; i <= verses; i++) {
    verseSections.push({ id: `verse${i}`, role: 'verse', harmonyRole: 'verse', functionTag: 'story', bars: per, repeatGroup: 'V', hookPolicy: 'light' });
  }
  const chorusSections: Section[] = [];
  for (let i = 1; i <= choruses; i++) {
    chorusSections.push({ id: rnb ? `hook${i}` : `chorus${i}`, role: 'chorus', harmonyRole: 'chorus', functionTag: 'hook', bars: per, repeatGroup: rnb ? 'H' : 'C', hookPolicy: rnb ? 'call-response' : 'main' });
  }
  const body = verses === 2 && choruses === 2
    ? [verseSections[0], chorusSections[0], verseSections[1], chorusSections[1]]
    : [...verseSections, ...chorusSections];
  for (let i = 0; i < body.length; i++) {
    const section = body[i];
    const next = body[i + 1];
    out.push(section.functionTag === 'story' && next?.functionTag === 'hook'
      ? { ...section, linkOut: 'dominantLift' }
      : section);
  }
  out.push({ id: rnb ? 'outroVamp' : 'outro', role: 'outro', harmonyRole: 'ending', functionTag: 'outro', bars: outroBars, hookPolicy: rnb ? 'light' : 'none' });
  return out;
}

// Lofi:[loopIntro?] - loop×{2,3}(连续记忆点)- [outroFade?]。不套 chorus(全 harmonyRole=loop)。
function assembleLofi(rng: Rng, requestedBars?: number): Section[] {
  const targetBars = requestedBars ?? TARGET_BARS;
  const durationAware = requestedBars !== undefined;
  let hasIntro = rng.next() < 0.6;
  rng.next(); // ★ 占位:旧 hasOutro 掷点,保 rng 流对齐;outroFade 现必有,结果弃用。
  // ★ outroFade 必有(修戛然而止):lofi 也要回落收尾(harmonyRole 'ending' → 终止 + 能量落)。
  let loops = rng.pick([2, 2, 3]);
  if (durationAware && targetBars <= 12) {
    hasIntro = false;
    loops = 1;
  } else if (durationAware && targetBars < 32) {
    hasIntro = false;
    loops = 2;
  } else if (durationAware && targetBars >= 48) {
    loops = 3;
  }
  const over = () => Math.max(0, (hasIntro ? 1 : 0) + loops + 1 - 6); // ≤6;outro 固定占 1 槽
  if (over() && hasIntro) hasIntro = false;
  while (over() && loops > 2) loops--;
  if (durationAware) hasIntro = fitOptionalIntro(hasIntro, targetBars, 4, 4, loops, 4, 20);
  const introBars = hasIntro ? 4 : 0;
  const outroBars = 4;
  const per = sizeContent(targetBars - introBars - outroBars, loops, durationAware ? 4 : 8, durationAware ? 20 : 16);
  const out: Section[] = [];
  if (hasIntro) out.push({ id: 'loopIntro', role: 'intro', harmonyRole: 'loop', functionTag: 'setup', bars: introBars, hookPolicy: 'none' });
  for (let i = 1; i <= loops; i++) out.push({ id: `loop${i}`, role: 'verse', harmonyRole: 'loop', functionTag: 'loop', bars: per, repeatGroup: 'L', hookPolicy: 'light' });
  out.push({ id: 'outroFade', role: 'outro', harmonyRole: 'ending', functionTag: 'outro', bars: outroBars, hookPolicy: 'none' });
  return out;
}

// Jazz 4/4:head 陈述/复现 → 可选 solo → head-out → tag。Bass/Comp/Lead 加 drum rhythm section。
function assembleJazzFourFour(rng: Rng, requestedBars?: number): Section[] {
  const targetBars = requestedBars ?? TARGET_BARS;
  const durationAware = requestedBars !== undefined;
  let hasIntro = rng.next() < 0.6;
  let hasSolo = rng.next() < 0.7;
  if (durationAware && targetBars < 28) hasIntro = false;
  if (durationAware && targetBars < 48) hasSolo = false;
  if (durationAware && targetBars >= 64) hasSolo = true;
  let sectionCount = (hasIntro ? 1 : 0) + 2 + (hasSolo ? 1 : 0) + 1 + 1;
  if (sectionCount > 6 && hasIntro) { hasIntro = false; sectionCount--; }
  if (sectionCount > 6 && hasSolo) { hasSolo = false; sectionCount--; }
  const soloBars = hasSolo ? (durationAware && targetBars >= 112 ? 32 : 16) : 0;
  const tagBars = 4;
  const shortCue = durationAware && targetBars <= 16;
  const headCount = shortCue ? 2 : 3;
  if (durationAware) hasIntro = fitOptionalIntro(hasIntro, targetBars, 4, soloBars + tagBars, headCount, 4, 48);
  const introBars = hasIntro ? 4 : 0;
  const per = sizeContent(
    targetBars - introBars - soloBars - tagBars,
    headCount,
    durationAware ? 4 : 8,
    durationAware ? 48 : 16,
  );
  const out: Section[] = [];
  if (hasIntro) out.push({ id: 'intro', role: 'intro', harmonyRole: 'intro', functionTag: 'setup', bars: introBars, hookPolicy: 'none' });
  out.push({ id: 'headA', role: 'verse', harmonyRole: 'verse', functionTag: 'head', bars: per, repeatGroup: 'A', hookPolicy: 'light' });
  if (!shortCue) out.push({ id: 'headA2', role: 'verse', harmonyRole: 'verse', functionTag: 'head', bars: per, repeatGroup: 'A', hookPolicy: 'light' });
  if (hasSolo) out.push({ id: 'solo', role: 'bridge', harmonyRole: 'bridge', functionTag: 'solo', bars: soloBars, hookPolicy: 'none' });
  out.push({ id: 'headOut', role: 'chorus', harmonyRole: 'chorus', functionTag: 'headOut', bars: per, repeatGroup: 'A', hookPolicy: 'light' });
  out.push({ id: 'tag', role: 'outro', harmonyRole: 'ending', functionTag: 'tag', bars: tagBars, hookPolicy: 'none' });
  return out;
}

/**
 * Reference-quartet audition form.  Its five phrase templates are indivisible:
 * duration requests select this complete 33-bar score rather than slicing a
 * head/coda rhythm brick.  At the evidence tempo this is about 59 seconds.
 * The older solo-piano handoff keeps its independent form above.
 */
function assembleJazzFiveFourReferenceQuartet(): Section[] {
  return [
    { id: 'pickup', role: 'intro', harmonyRole: 'loop', functionTag: 'setup', bars: 1, hookPolicy: 'none' },
    { id: 'headA', role: 'verse', harmonyRole: 'verse', functionTag: 'head', bars: 8, repeatGroup: 'A', hookPolicy: 'light' },
    { id: 'headB', role: 'bridge', harmonyRole: 'bridge', functionTag: 'solo', bars: 8, repeatGroup: 'B', hookPolicy: 'light' },
    { id: 'headOut', role: 'chorus', harmonyRole: 'chorus', functionTag: 'headOut', bars: 8, repeatGroup: 'A', hookPolicy: 'light' },
    { id: 'coda', role: 'outro', harmonyRole: 'ending', functionTag: 'tag', bars: 8, hookPolicy: 'none' },
  ];
}

// ACG PIANOSONG 是短篇钢琴 cue，不是流行歌的 verse/chorus 循环。每次选择一条
// 隐藏总谱 profile：都保留 A/A′/return 的可辨识主题，但开场、发展位置和 coda
// 不是同一条固定模板。profile 只在 Arranger 内使用，不增加 UI 风格。
function acgIntro(id: string, bars: number): Section {
  return { id, role: 'intro', harmonyRole: 'intro', functionTag: 'setup', bars, hookPolicy: 'none' };
}

function acgThemeA(bars: number): Section {
  return { id: 'themeA', role: 'verse', harmonyRole: 'verse', functionTag: 'head', bars, repeatGroup: 'A', hookPolicy: 'light' };
}

function acgThemeA2(bars: number, linkOut: Section['linkOut'] = 'dominantLift'): Section {
  return { id: 'themeA2', role: 'verse', harmonyRole: 'verse', functionTag: 'head', bars, repeatGroup: 'A', hookPolicy: 'light', linkOut };
}

function acgThemeReturn(bars: number): Section {
  return { id: 'themeReturn', role: 'chorus', harmonyRole: 'chorus', functionTag: 'headOut', bars, repeatGroup: 'A', hookPolicy: 'light' };
}

function acgLift(id: string, bars: number): Section {
  return { id, role: 'bridge', harmonyRole: 'bridge', functionTag: 'build', bars, hookPolicy: 'none' };
}

function acgBreath(id: string, bars: number): Section {
  return { id, role: 'bridge', harmonyRole: 'bridge', functionTag: 'breakdown', bars, hookPolicy: 'none' };
}

function acgCoda(id: string, bars: number): Section {
  return { id, role: 'outro', harmonyRole: 'ending', functionTag: 'tag', bars, hookPolicy: 'none' };
}

interface AcgThemeAllocation {
  themeBars: number;
  /** Grows one profile-owned transition so target duration is met without breaking A/A′ parity. */
  transitionExtensionBars: number;
}

/**
 * Three A-group sections must stay equal for motif replay. The profile-owned
 * transition absorbs the 4/8-bar remainder, which keeps duration fitting from
 * silently forcing every cue back into the same 36-bar layout.
 */
function allocateAcgThemeBars(requestedBars: number | undefined, fixedBars: number): AcgThemeAllocation {
  if (requestedBars === undefined) return { themeBars: 8, transitionExtensionBars: 0 };
  const availableForThemes = Math.max(12, requestedBars - fixedBars);
  const themeBars = Math.max(4, Math.min(24, Math.floor(availableForThemes / 12) * 4));
  return {
    themeBars,
    transitionExtensionBars: Math.max(0, requestedBars - fixedBars - themeBars * 3),
  };
}

/** The shortest cue intentionally retains the prior compact fallback. */
function assembleShortAcgPianoCue(requestedBars: number): Section[] {
  const out: Section[] = [];
  if (requestedBars >= 16) out.push(acgIntro('pianoIntro', 4));
  out.push(acgThemeA(4));
  out.push(acgThemeReturn(4));
  out.push(acgCoda('pianoCoda', 4));
  return out;
}

/**
 * Around one minute at ACG tempo there is only room for three 8-bar theme
 * statements plus a 4-bar ending. Keep that musical minimum intact; a single
 * profile-owned transition may occupy the remaining four bars instead of
 * shrinking the theme to an unusable one-phrase fragment.
 */
function assembleMediumAcgPianoCue(profile: AcgPianoArrangementProfile, requestedBars: number): Section[] {
  const transitionBars = Math.max(0, requestedBars - 28);
  const codaId = profile.codaStrategy === 'echo-tag'
    ? 'pianoEchoCoda'
    : profile.codaStrategy === 'sigh-tag'
      ? 'pianoSighCoda'
      : profile.codaStrategy === 'frame-arrival'
        ? 'pianoFrameCoda'
        : profile.codaStrategy === 'descending-release'
          ? 'pianoReleaseCoda'
          : 'pianoCoda';
  switch (profile.formShape) {
    case 'motif-first':
      return [
        acgThemeA(8),
        acgThemeA2(8),
        ...(transitionBars > 0 ? [acgLift('pianoMotifTurn', transitionBars)] : []),
        acgThemeReturn(8),
        acgCoda(codaId, 4),
      ];
    case 'dialogue-breath':
      return [
        acgThemeA(8),
        ...(transitionBars > 0 ? [acgBreath('pianoBreath', transitionBars)] : []),
        acgThemeA2(8),
        acgThemeReturn(8),
        acgCoda(codaId, 4),
      ];
    case 'wide-cinema':
      return [
        ...(transitionBars > 0 ? [acgIntro('pianoWidePrelude', transitionBars)] : []),
        acgThemeA(8),
        acgThemeA2(8),
        acgThemeReturn(8),
        acgCoda(codaId, 4),
      ];
    case 'descending-memory':
      return [
        acgThemeA(8),
        acgThemeA2(8, 'minorIvHold'),
        ...(transitionBars > 0 ? [acgBreath('pianoReflection', transitionBars)] : []),
        acgThemeReturn(8),
        acgCoda(codaId, 4),
      ];
    case 'ripple-journey':
      return [
        ...(transitionBars > 0 ? [acgIntro('pianoIntro', transitionBars)] : []),
        acgThemeA(8),
        acgThemeA2(8),
        acgThemeReturn(8),
        acgCoda(codaId, 4),
      ];
  }
}

function assembleMotifFirstAcg(profile: AcgPianoArrangementProfile, requestedBars?: number): Section[] {
  const { themeBars, transitionExtensionBars } = allocateAcgThemeBars(requestedBars, 8);
  return [
    acgThemeA(themeBars),
    acgThemeA2(themeBars),
    acgLift('pianoMotifTurn', 4 + transitionExtensionBars),
    acgThemeReturn(themeBars),
    acgCoda(profile.codaStrategy === 'echo-tag' ? 'pianoEchoCoda' : 'pianoCoda', 4),
  ];
}

function assembleDialogueBreathAcg(profile: AcgPianoArrangementProfile, requestedBars?: number): Section[] {
  const compact = requestedBars !== undefined && requestedBars < 24;
  const fixedBars = compact ? 8 : 12;
  const { themeBars, transitionExtensionBars } = allocateAcgThemeBars(requestedBars, fixedBars);
  if (compact) {
    return [
      acgIntro('pianoCallIntro', 4 + transitionExtensionBars),
      acgThemeA(themeBars),
      acgThemeA2(themeBars),
      acgThemeReturn(themeBars),
      acgCoda(profile.codaStrategy === 'sigh-tag' ? 'pianoSighCoda' : 'pianoCoda', 4),
    ];
  }
  return [
    acgIntro('pianoCallIntro', 4),
    acgThemeA(themeBars),
    acgBreath('pianoBreath', 4 + transitionExtensionBars),
    acgThemeA2(themeBars),
    acgThemeReturn(themeBars),
    acgCoda(profile.codaStrategy === 'sigh-tag' ? 'pianoSighCoda' : 'pianoCoda', 4),
  ];
}

function assembleRippleJourneyAcg(profile: AcgPianoArrangementProfile, requestedBars?: number): Section[] {
  const compact = requestedBars !== undefined && requestedBars < 24;
  const fixedBars = compact ? 8 : 12;
  const { themeBars, transitionExtensionBars } = allocateAcgThemeBars(requestedBars, fixedBars);
  if (compact) {
    return [
      acgIntro('pianoIntro', 4 + transitionExtensionBars),
      acgThemeA(themeBars),
      acgThemeA2(themeBars),
      acgThemeReturn(themeBars),
      acgCoda('pianoCoda', 4),
    ];
  }
  return [
    acgIntro('pianoIntro', 4),
    acgThemeA(themeBars),
    acgThemeA2(themeBars),
    acgLift('pianoLift', 4 + transitionExtensionBars),
    acgThemeReturn(themeBars),
    acgCoda(profile.codaStrategy === 'pedal-dissolve' ? 'pianoCoda' : 'pianoReleaseCoda', 4),
  ];
}

function assembleWideCinemaAcg(profile: AcgPianoArrangementProfile, requestedBars?: number): Section[] {
  const compact = requestedBars !== undefined && requestedBars < 32;
  const fixedBars = compact ? 8 : 20;
  const { themeBars, transitionExtensionBars } = allocateAcgThemeBars(requestedBars, fixedBars);
  if (compact) {
    return [
      acgIntro('pianoWidePrelude', 4 + transitionExtensionBars),
      acgThemeA(themeBars),
      acgThemeA2(themeBars),
      acgThemeReturn(themeBars),
      acgCoda(profile.codaStrategy === 'frame-arrival' ? 'pianoFrameCoda' : 'pianoCoda', 4),
    ];
  }
  return [
    acgIntro('pianoWidePrelude', 8 + transitionExtensionBars),
    acgThemeA(themeBars),
    acgThemeA2(themeBars),
    acgLift('pianoWideLift', 8),
    acgThemeReturn(themeBars),
    acgCoda(profile.codaStrategy === 'frame-arrival' ? 'pianoFrameCoda' : 'pianoCoda', 4),
  ];
}

function assembleDescendingMemoryAcg(profile: AcgPianoArrangementProfile, requestedBars?: number): Section[] {
  const compact = requestedBars !== undefined && requestedBars < 28;
  const fixedBars = compact ? 12 : 16;
  const { themeBars, transitionExtensionBars } = allocateAcgThemeBars(requestedBars, fixedBars);
  if (compact) {
    return [
      acgIntro('pianoFallingIntro', 4),
      acgThemeA(themeBars),
      acgThemeA2(themeBars, 'minorIvHold'),
      acgBreath('pianoReflection', 4 + transitionExtensionBars),
      acgThemeReturn(themeBars),
      acgCoda(profile.codaStrategy === 'descending-release' ? 'pianoReleaseCoda' : 'pianoCoda', 4),
    ];
  }
  return [
    acgIntro('pianoFallingIntro', 4),
    acgThemeA(themeBars),
    acgThemeA2(themeBars, 'minorIvHold'),
    acgBreath('pianoReflection', 4 + transitionExtensionBars),
    acgLift('pianoLift', 4),
    acgThemeReturn(themeBars),
    acgCoda(profile.codaStrategy === 'descending-release' ? 'pianoReleaseCoda' : 'pianoCoda', 4),
  ];
}

function assembleAcgPianoSong(profile: AcgPianoArrangementProfile, requestedBars?: number): Section[] {
  if (requestedBars !== undefined && requestedBars <= 16) return assembleShortAcgPianoCue(requestedBars);
  if (requestedBars !== undefined && requestedBars >= 28 && requestedBars <= 32) {
    return assembleMediumAcgPianoCue(profile, requestedBars);
  }
  switch (profile.formShape) {
    case 'motif-first': return assembleMotifFirstAcg(profile, requestedBars);
    case 'dialogue-breath': return assembleDialogueBreathAcg(profile, requestedBars);
    case 'wide-cinema': return assembleWideCinemaAcg(profile, requestedBars);
    case 'descending-memory': return assembleDescendingMemoryAcg(profile, requestedBars);
    case 'ripple-journey': return assembleRippleJourneyAcg(profile, requestedBars);
  }
}

/** 程序化装配:按风格 per-seed 拼接 ≤5 段曲式(确定性)。 */
export function assembleForm(
  style: string,
  rng: Rng,
  targetBars?: number,
  acgPianoArrangementProfileId?: AcgPianoArrangementProfileId,
  jazzFormBlueprintId?: string,
): Section[] {
  const s = style.toLowerCase();
  const normalized = targetBars !== undefined && Number.isFinite(targetBars) && targetBars > 0
    ? normalizeTargetBars(s, targetBars)
    : undefined;
  if (s === 'acg') {
    const profile = acgPianoArrangementProfileId
      ? acgPianoArrangementProfileForId(acgPianoArrangementProfileId)
      : resolveAcgPianoArrangementProfile(rng);
    return assembleAcgPianoSong(profile, normalized);
  }
  if (s === 'lofi') return assembleLofi(rng, normalized);
  if (s === 'jazz'
      && jazzFormBlueprintId === 'jazz.reference-quartet-5-4.pickup-head-headout-coda.v1') {
    return assembleJazzFiveFourReferenceQuartet();
  }
  if (s === 'jazz') return assembleJazzFourFour(rng, normalized);
  return assemblePopRnb(s === 'rnb', rng, normalized);
}

export interface FormOptions {
  rng?: Rng; // 有 → seed 选模板 + 段落长度变化
  template?: FormTemplate; // 显式指定(测试/固定)→ 走通用模板(向后兼容)
  style?: string; // 有 + rng → 走风格曲式池(无 rng 仍回退 legacy verse-chorus)
  targetBars?: number; // actual tempo/meter 已换算的小节预算；procedural form 内再做风格钳位/4-bar 对齐
  /** ACG only: Arranger 已选的隐藏钢琴总谱 profile；不是 UI style。 */
  acgPianoArrangementProfileId?: AcgPianoArrangementProfileId;
  /** Jazz only: selected by the archetype before form planning. */
  jazzFormBlueprintId?: string;
}

/**
 * 选曲式:
 *   1) 显式 template → 通用模板(测试/固定,向后兼容);
 *   2) 有 rng + 已知 style → 风格曲式池(seed 选型);
 *   3) 有 rng 无 style → 通用池 + intro/outro 长度变化;
 *   4) 无 rng → 固定 verse-chorus(向后兼容默认)。
 */
export function planForm(opts: FormOptions = {}): Section[] {
  let sections: Section[];
  const styleKey = opts.style?.toLowerCase();
  if (opts.template) {
    sections = TEMPLATES[opts.template].map((s) => ({ ...s }));
  } else if (opts.rng && styleKey && PROCEDURAL_STYLES.has(styleKey)) {
    sections = assembleForm(
      styleKey,
      opts.rng,
      opts.targetBars,
      opts.acgPianoArrangementProfileId,
      opts.jazzFormBlueprintId,
    ); // ★ 程序化拼接(取代写死模板池)
  } else {
    const chosen = opts.rng ? opts.rng.pick(FORM_POOL) : 'verse-chorus';
    sections = TEMPLATES[chosen].map((s) => ({ ...s }));
    if (opts.rng) {
      // 段落长度变化:intro/outro bars ∈ {2,4}(确定性自 rng;verse/chorus 保持 8 → repeatGroup 等长排比)
      const introBars = opts.rng.pick([2, 4]);
      const outroBars = opts.rng.pick([2, 4]);
      for (const s of sections) {
        if (s.role === 'intro') s.bars = introBars;
        else if (s.role === 'outro') s.bars = outroBars;
      }
    }
  }

  // ★ 统一保证收尾段(修戛然而止,覆盖所有路径:procedural 已有=no-op / legacy 缺 ending / compact 无 outro /
  //   modal·default·blues 走 legacy / 显式 template)。末段是 outro → 补 harmonyRole 'ending';否则追加 outro。
  const last = sections[sections.length - 1];
  if (last && last.role === 'outro') {
    last.harmonyRole = 'ending'; // 终止式回归;能量回落由 role 'outro'(ROLE_ENERGY 0.30)给,不动 functionTag(保 legacy 全 lineup 回退)
  } else {
    sections.push({ id: 'outro', role: 'outro', harmonyRole: 'ending', functionTag: 'outro', bars: 4, hookPolicy: 'none' });
  }
  return sections;
}
