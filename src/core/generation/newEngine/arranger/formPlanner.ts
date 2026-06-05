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
type StyleKey = 'pop' | 'rnb' | 'lofi' | 'jazz';

// Pop:story → build → hook → 终段 hook 线性推进(完整版 + 紧凑版,供 seed 多样)。
const POP_FULL: Section[] = [
  { id: 'intro', role: 'intro', harmonyRole: 'intro', functionTag: 'setup', bars: 2, hookPolicy: 'none' },
  { id: 'verse1', role: 'verse', harmonyRole: 'verse', functionTag: 'story', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
  { id: 'build1', role: 'bridge', harmonyRole: 'bridge', functionTag: 'build', bars: 4, repeatGroup: 'BLD', hookPolicy: 'none', linkOut: 'dominantLift' },
  { id: 'chorus1', role: 'chorus', harmonyRole: 'chorus', functionTag: 'hook', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
  { id: 'verse2', role: 'verse', harmonyRole: 'verse', functionTag: 'story', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
  { id: 'build2', role: 'bridge', harmonyRole: 'bridge', functionTag: 'build', bars: 4, repeatGroup: 'BLD', hookPolicy: 'none', linkOut: 'dominantLift' },
  { id: 'chorus2', role: 'chorus', harmonyRole: 'chorus', functionTag: 'hook', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
  { id: 'bridge', role: 'bridge', harmonyRole: 'bridge', functionTag: 'breakdown', bars: 8, hookPolicy: 'none', linkOut: 'stopOnDominant' },
  { id: 'finalChorus', role: 'chorus', harmonyRole: 'chorus', functionTag: 'hook', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
  { id: 'outro', role: 'outro', harmonyRole: 'ending', functionTag: 'outro', bars: 2, hookPolicy: 'none' },
];
const POP_COMPACT: Section[] = [
  { id: 'intro', role: 'intro', harmonyRole: 'intro', functionTag: 'setup', bars: 2, hookPolicy: 'none' },
  { id: 'verse1', role: 'verse', harmonyRole: 'verse', functionTag: 'story', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
  { id: 'build1', role: 'bridge', harmonyRole: 'bridge', functionTag: 'build', bars: 4, repeatGroup: 'BLD', hookPolicy: 'none', linkOut: 'dominantLift' },
  { id: 'chorus1', role: 'chorus', harmonyRole: 'chorus', functionTag: 'hook', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
  { id: 'verse2', role: 'verse', harmonyRole: 'verse', functionTag: 'story', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
  { id: 'chorus2', role: 'chorus', harmonyRole: 'chorus', functionTag: 'hook', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
  { id: 'outro', role: 'outro', harmonyRole: 'ending', functionTag: 'outro', bars: 2, hookPolicy: 'none' },
];

// RNB:vamp 起势 → preHook 准备 → hook(call-response) → breakdown 真抽离。
const RNB_FORM: Section[] = [
  { id: 'introVamp', role: 'intro', harmonyRole: 'intro', functionTag: 'setup', bars: 4, repeatGroup: 'VAMP', hookPolicy: 'light' },
  { id: 'verse1', role: 'verse', harmonyRole: 'verse', functionTag: 'story', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
  { id: 'preHook1', role: 'bridge', harmonyRole: 'bridge', functionTag: 'build', bars: 4, repeatGroup: 'PRE', hookPolicy: 'none', linkOut: 'dominantLift' },
  { id: 'hook1', role: 'chorus', harmonyRole: 'chorus', functionTag: 'hook', bars: 8, repeatGroup: 'H', hookPolicy: 'call-response' },
  { id: 'verse2', role: 'verse', harmonyRole: 'verse', functionTag: 'story', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
  { id: 'preHook2', role: 'bridge', harmonyRole: 'bridge', functionTag: 'build', bars: 4, repeatGroup: 'PRE', hookPolicy: 'none', linkOut: 'dominantLift' },
  { id: 'hook2', role: 'chorus', harmonyRole: 'chorus', functionTag: 'hook', bars: 8, repeatGroup: 'H', hookPolicy: 'call-response' },
  { id: 'breakdown', role: 'bridge', harmonyRole: 'bridge', functionTag: 'breakdown', bars: 8, hookPolicy: 'none', linkOut: 'stopOnDominant' },
  { id: 'finalHook', role: 'chorus', harmonyRole: 'chorus', functionTag: 'hook', bars: 8, repeatGroup: 'H', hookPolicy: 'call-response' },
  { id: 'outroVamp', role: 'outro', harmonyRole: 'ending', functionTag: 'outro', bars: 4, repeatGroup: 'VAMP', hookPolicy: 'light' },
];

// Lofi:短 loop 的 mute/filter/return,不套 chorus(harmonyRole=loop → KB loop prototype)。无 chorus role。
const LOFI_FORM: Section[] = [
  { id: 'loopIntro', role: 'intro', harmonyRole: 'loop', functionTag: 'setup', bars: 4, hookPolicy: 'none' },
  { id: 'loopA', role: 'verse', harmonyRole: 'loop', functionTag: 'loop', bars: 8, repeatGroup: 'L', hookPolicy: 'light' },
  { id: 'loopA2', role: 'verse', harmonyRole: 'loop', functionTag: 'loop', bars: 8, repeatGroup: 'L', hookPolicy: 'light' },
  { id: 'filterBreak', role: 'bridge', harmonyRole: 'loop', functionTag: 'breakdown', bars: 4, hookPolicy: 'none' },
  { id: 'loopOpen', role: 'verse', harmonyRole: 'loop', functionTag: 'loop', bars: 8, repeatGroup: 'L', hookPolicy: 'light' },
  { id: 'loopReturn', role: 'verse', harmonyRole: 'loop', functionTag: 'loop', bars: 8, repeatGroup: 'L', hookPolicy: 'light' },
  { id: 'outroFade', role: 'outro', harmonyRole: 'ending', functionTag: 'outro', bars: 4, hookPolicy: 'none' },
];

// Jazz:AABA head + bridge + solo + head-out(高潮 = solo late / head-out,不套 pop chorus 爆发)。
const JAZZ_FORM: Section[] = [
  { id: 'intro', role: 'intro', harmonyRole: 'intro', functionTag: 'setup', bars: 4, hookPolicy: 'none' },
  { id: 'headA', role: 'verse', harmonyRole: 'verse', functionTag: 'head', bars: 8, repeatGroup: 'A', hookPolicy: 'light' },
  { id: 'headA2', role: 'verse', harmonyRole: 'verse', functionTag: 'head', bars: 8, repeatGroup: 'A', hookPolicy: 'light' },
  { id: 'bridgeB', role: 'bridge', harmonyRole: 'bridge', functionTag: 'build', bars: 8, repeatGroup: 'B', hookPolicy: 'none' },
  { id: 'headA3', role: 'verse', harmonyRole: 'verse', functionTag: 'head', bars: 8, repeatGroup: 'A', hookPolicy: 'light' },
  { id: 'solo', role: 'bridge', harmonyRole: 'bridge', functionTag: 'solo', bars: 16, hookPolicy: 'none' },
  { id: 'headOut', role: 'chorus', harmonyRole: 'chorus', functionTag: 'headOut', bars: 8, repeatGroup: 'A', hookPolicy: 'light' },
  { id: 'tag', role: 'outro', harmonyRole: 'ending', functionTag: 'tag', bars: 4, hookPolicy: 'none' },
];

const STYLE_FORMS: Record<StyleKey, Section[][]> = {
  pop: [POP_FULL, POP_COMPACT],
  rnb: [RNB_FORM],
  lofi: [LOFI_FORM],
  jazz: [JAZZ_FORM],
};

export interface FormOptions {
  rng?: Rng; // 有 → seed 选模板 + 段落长度变化
  template?: FormTemplate; // 显式指定(测试/固定)→ 走通用模板(向后兼容)
  style?: string; // 有 + rng → 走风格曲式池(无 rng 仍回退 legacy verse-chorus)
}

/**
 * 选曲式:
 *   1) 显式 template → 通用模板(测试/固定,向后兼容);
 *   2) 有 rng + 已知 style → 风格曲式池(seed 选型);
 *   3) 有 rng 无 style → 通用池 + intro/outro 长度变化;
 *   4) 无 rng → 固定 verse-chorus(向后兼容默认)。
 */
export function planForm(opts: FormOptions = {}): Section[] {
  if (opts.template) return TEMPLATES[opts.template].map((s) => ({ ...s }));

  const styleKey = opts.style?.toLowerCase() as StyleKey | undefined;
  if (opts.rng && styleKey && STYLE_FORMS[styleKey]) {
    const pool = STYLE_FORMS[styleKey];
    return opts.rng.pick(pool).map((s) => ({ ...s }));
  }

  const chosen = opts.rng ? opts.rng.pick(FORM_POOL) : 'verse-chorus';
  const sections = TEMPLATES[chosen].map((s) => ({ ...s }));
  if (opts.rng) {
    // 段落长度变化:intro/outro bars ∈ {2,4}(确定性自 rng;verse/chorus 保持 8 → repeatGroup 等长排比)
    const introBars = opts.rng.pick([2, 4]);
    const outroBars = opts.rng.pick([2, 4]);
    for (const s of sections) {
      if (s.role === 'intro') s.bars = introBars;
      else if (s.role === 'outro') s.bars = outroBars;
    }
  }
  return sections;
}
