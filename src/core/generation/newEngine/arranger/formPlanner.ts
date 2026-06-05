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
// ★ 程序化曲式装配(用户:arranger 层 per-seed 拼接,intro 可有可无、verse 1-2 段、风格化、≤5 段、~60bar、记忆点)。
//   规则化随机(确定性 rng 子流);content 段(verse/chorus/loop/head)按预算定 bars(8-16,4-bar 乐句对齐)→ 总 ~目标。
//   记忆点:verse/loop/head 连续×{1,2} 同 repeatGroup;保证 verse 或 chorus 之一 ×2;末 verse linkOut=dominantLift 推进副歌。
const PROCEDURAL_STYLES = new Set(['pop', 'rnb', 'lofi', 'jazz']);
const TARGET_BARS = 60; // 用户:~60 bar 的结构化清晰音乐
/** content 段长 = 预算均摊到各段,4-bar 乐句对齐,夹 [8,16](保证 ≤5 段也能凑 ~目标小节)。 */
const sizeContent = (budget: number, count: number): number =>
  Math.max(8, Math.min(16, Math.round(budget / Math.max(1, count) / 4) * 4));

// Pop / RNB:[intro?] - verse×{1,2} - 副歌×{1,2} - [outro?]。verse×2 同 'V' 记忆点;末 verse 推进副歌。
function assemblePopRnb(rnb: boolean, rng: Rng): Section[] {
  let hasIntro = rng.next() < (rnb ? 0.7 : 0.55);
  let hasOutro = rng.next() < (rnb ? 0.55 : 0.4);
  let verses = rng.pick([1, 2, 2]);   // 偏 2(记忆点)
  let choruses = rng.pick([1, 2, 2]);
  if (verses === 1 && choruses === 1) choruses = 2; // 保证 ≥1 处 ×2(记忆点)
  const over = () => Math.max(0, (hasIntro ? 1 : 0) + verses + choruses + (hasOutro ? 1 : 0) - 5);
  if (over() && hasOutro) hasOutro = false;          // ≤5:先砍 outro
  if (over() && hasIntro) hasIntro = false;          // 再砍 intro(保 verse×2 / chorus)
  while (over() && choruses > 1) choruses--;
  while (over() && verses > 1) verses--;

  const introBars = hasIntro ? (rnb ? 4 : 2) : 0;
  const outroBars = hasOutro ? (rnb ? 4 : 2) : 0;
  const per = sizeContent(TARGET_BARS - introBars - outroBars, verses + choruses);

  const out: Section[] = [];
  if (hasIntro) out.push({ id: rnb ? 'introVamp' : 'intro', role: 'intro', harmonyRole: 'intro', functionTag: 'setup', bars: introBars, hookPolicy: rnb ? 'light' : 'none' });
  for (let i = 1; i <= verses; i++) {
    out.push({ id: `verse${i}`, role: 'verse', harmonyRole: 'verse', functionTag: 'story', bars: per, repeatGroup: 'V', hookPolicy: 'light', linkOut: i === verses ? 'dominantLift' : undefined });
  }
  for (let i = 1; i <= choruses; i++) {
    out.push({ id: rnb ? `hook${i}` : `chorus${i}`, role: 'chorus', harmonyRole: 'chorus', functionTag: 'hook', bars: per, repeatGroup: rnb ? 'H' : 'C', hookPolicy: rnb ? 'call-response' : 'main' });
  }
  if (hasOutro) out.push({ id: rnb ? 'outroVamp' : 'outro', role: 'outro', harmonyRole: 'ending', functionTag: 'outro', bars: outroBars, hookPolicy: rnb ? 'light' : 'none' });
  return out;
}

// Lofi:[loopIntro?] - loop×{2,3}(连续记忆点)- [outroFade?]。不套 chorus(全 harmonyRole=loop)。
function assembleLofi(rng: Rng): Section[] {
  let hasIntro = rng.next() < 0.6;
  let hasOutro = rng.next() < 0.6;
  let loops = rng.pick([2, 2, 3]);
  const over = () => Math.max(0, (hasIntro ? 1 : 0) + loops + (hasOutro ? 1 : 0) - 5);
  if (over() && hasOutro) hasOutro = false;
  if (over() && hasIntro) hasIntro = false;
  while (over() && loops > 2) loops--;
  const introBars = hasIntro ? 4 : 0;
  const outroBars = hasOutro ? 4 : 0;
  const per = sizeContent(TARGET_BARS - introBars - outroBars, loops);
  const out: Section[] = [];
  if (hasIntro) out.push({ id: 'loopIntro', role: 'intro', harmonyRole: 'loop', functionTag: 'setup', bars: introBars, hookPolicy: 'none' });
  for (let i = 1; i <= loops; i++) out.push({ id: `loop${i}`, role: 'verse', harmonyRole: 'loop', functionTag: 'loop', bars: per, repeatGroup: 'L', hookPolicy: 'light' });
  if (hasOutro) out.push({ id: 'outroFade', role: 'outro', harmonyRole: 'ending', functionTag: 'outro', bars: outroBars, hookPolicy: 'none' });
  return out;
}

// Jazz:[intro?] - head×2(连续记忆点)- [solo?] - head-out。head/headOut 同 'A'。
function assembleJazz(rng: Rng): Section[] {
  let hasIntro = rng.next() < 0.6;
  let hasSolo = rng.next() < 0.7;
  let n = (hasIntro ? 1 : 0) + 2 + (hasSolo ? 1 : 0) + 1; // intro? + head×2 + solo? + headOut
  if (n > 5 && hasIntro) { hasIntro = false; n--; }
  if (n > 5 && hasSolo) { hasSolo = false; n--; }
  const introBars = hasIntro ? 4 : 0;
  const soloBars = hasSolo ? 16 : 0;
  const per = sizeContent(TARGET_BARS - introBars - soloBars, 3); // head×2 + headOut
  const out: Section[] = [];
  if (hasIntro) out.push({ id: 'intro', role: 'intro', harmonyRole: 'intro', functionTag: 'setup', bars: introBars, hookPolicy: 'none' });
  out.push({ id: 'headA', role: 'verse', harmonyRole: 'verse', functionTag: 'head', bars: per, repeatGroup: 'A', hookPolicy: 'light' });
  out.push({ id: 'headA2', role: 'verse', harmonyRole: 'verse', functionTag: 'head', bars: per, repeatGroup: 'A', hookPolicy: 'light' });
  if (hasSolo) out.push({ id: 'solo', role: 'bridge', harmonyRole: 'bridge', functionTag: 'solo', bars: soloBars, hookPolicy: 'none' });
  out.push({ id: 'headOut', role: 'chorus', harmonyRole: 'chorus', functionTag: 'headOut', bars: per, repeatGroup: 'A', hookPolicy: 'light' });
  return out;
}

/** 程序化装配:按风格 per-seed 拼接 ≤5 段曲式(确定性)。 */
export function assembleForm(style: string, rng: Rng): Section[] {
  const s = style.toLowerCase();
  if (s === 'lofi') return assembleLofi(rng);
  if (s === 'jazz') return assembleJazz(rng);
  return assemblePopRnb(s === 'rnb', rng);
}

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

  const styleKey = opts.style?.toLowerCase();
  if (opts.rng && styleKey && PROCEDURAL_STYLES.has(styleKey)) {
    return assembleForm(styleKey, opts.rng); // ★ 程序化拼接(取代写死模板池)
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
