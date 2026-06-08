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
  rng.next(); // ★ 占位:旧 hasOutro 掷点,保 rng 流对齐(各 seed 的 verse/chorus 决策不变);outro 现必有,结果弃用。
  // ★ 收尾段【必有】(修戛然而止):outro 不再可选/不被砍 → 保证能量回落 + 终止式回归(harmonyRole 'ending')。
  let verses = rng.pick([1, 2, 2]);   // 偏 2(记忆点)
  let choruses = rng.pick([1, 2, 2]);
  if (verses === 1 && choruses === 1) choruses = 2; // 保证 ≥1 处 ×2(记忆点)
  // ≤6(放宽:intro + verse×2 + chorus×2 + outro = 标准流行曲式,不砍 intro 也不砍 outro)。
  const over = () => Math.max(0, (hasIntro ? 1 : 0) + verses + choruses + 1 - 6); // outro 固定占 1 槽
  if (over() && hasIntro) hasIntro = false;          // 仍超(content 太多)→ 先砍 intro(收尾比开场重要)
  while (over() && choruses > 1) choruses--;
  while (over() && verses > 1) verses--;

  const introBars = hasIntro ? (rnb ? 4 : 2) : 0;
  const outroBars = 4; // 4 小节收尾乐句(够走 V-I 终止 + 能量回落)
  const per = sizeContent(TARGET_BARS - introBars - outroBars, verses + choruses);

  const out: Section[] = [];
  if (hasIntro) out.push({ id: rnb ? 'introVamp' : 'intro', role: 'intro', harmonyRole: 'intro', functionTag: 'setup', bars: introBars, hookPolicy: rnb ? 'light' : 'none' });
  for (let i = 1; i <= verses; i++) {
    out.push({ id: `verse${i}`, role: 'verse', harmonyRole: 'verse', functionTag: 'story', bars: per, repeatGroup: 'V', hookPolicy: 'light', linkOut: i === verses ? 'dominantLift' : undefined });
  }
  for (let i = 1; i <= choruses; i++) {
    out.push({ id: rnb ? `hook${i}` : `chorus${i}`, role: 'chorus', harmonyRole: 'chorus', functionTag: 'hook', bars: per, repeatGroup: rnb ? 'H' : 'C', hookPolicy: rnb ? 'call-response' : 'main' });
  }
  out.push({ id: rnb ? 'outroVamp' : 'outro', role: 'outro', harmonyRole: 'ending', functionTag: 'outro', bars: outroBars, hookPolicy: rnb ? 'light' : 'none' });
  return out;
}

// Lofi:[loopIntro?] - loop×{2,3}(连续记忆点)- [outroFade?]。不套 chorus(全 harmonyRole=loop)。
function assembleLofi(rng: Rng): Section[] {
  let hasIntro = rng.next() < 0.6;
  rng.next(); // ★ 占位:旧 hasOutro 掷点,保 rng 流对齐;outroFade 现必有,结果弃用。
  // ★ outroFade 必有(修戛然而止):lofi 也要回落收尾(harmonyRole 'ending' → 终止 + 能量落)。
  let loops = rng.pick([2, 2, 3]);
  const over = () => Math.max(0, (hasIntro ? 1 : 0) + loops + 1 - 6); // ≤6;outro 固定占 1 槽
  if (over() && hasIntro) hasIntro = false;
  while (over() && loops > 2) loops--;
  const introBars = hasIntro ? 4 : 0;
  const outroBars = 4;
  const per = sizeContent(TARGET_BARS - introBars - outroBars, loops);
  const out: Section[] = [];
  if (hasIntro) out.push({ id: 'loopIntro', role: 'intro', harmonyRole: 'loop', functionTag: 'setup', bars: introBars, hookPolicy: 'none' });
  for (let i = 1; i <= loops; i++) out.push({ id: `loop${i}`, role: 'verse', harmonyRole: 'loop', functionTag: 'loop', bars: per, repeatGroup: 'L', hookPolicy: 'light' });
  out.push({ id: 'outroFade', role: 'outro', harmonyRole: 'ending', functionTag: 'outro', bars: outroBars, hookPolicy: 'none' });
  return out;
}

// Jazz:[intro?] - head×2(连续记忆点)- [solo?] - head-out。head/headOut 同 'A'。
function assembleJazz(rng: Rng): Section[] {
  let hasIntro = rng.next() < 0.6;
  let hasSolo = rng.next() < 0.7;
  // ★ 收尾 tag【必有】(修戛然而止):headOut(recap 回归头部)后接一段终止 tag(harmonyRole 'ending' → V-I 落家 + 能量回落)。
  //   固定 head×2 + headOut + tag = 4;intro?/solo? 砍到 ≤5(solo 优先于 intro 保留)。
  let n = (hasIntro ? 1 : 0) + 2 + (hasSolo ? 1 : 0) + 1 + 1; // intro? + head×2 + solo? + headOut + tag
  if (n > 6 && hasIntro) { hasIntro = false; n--; } // ≤6
  if (n > 6 && hasSolo) { hasSolo = false; n--; }
  const introBars = hasIntro ? 4 : 0;
  const soloBars = hasSolo ? 16 : 0;
  const tagBars = 4;
  const per = sizeContent(TARGET_BARS - introBars - soloBars - tagBars, 3); // head×2 + headOut
  const out: Section[] = [];
  if (hasIntro) out.push({ id: 'intro', role: 'intro', harmonyRole: 'intro', functionTag: 'setup', bars: introBars, hookPolicy: 'none' });
  out.push({ id: 'headA', role: 'verse', harmonyRole: 'verse', functionTag: 'head', bars: per, repeatGroup: 'A', hookPolicy: 'light' });
  out.push({ id: 'headA2', role: 'verse', harmonyRole: 'verse', functionTag: 'head', bars: per, repeatGroup: 'A', hookPolicy: 'light' });
  if (hasSolo) out.push({ id: 'solo', role: 'bridge', harmonyRole: 'bridge', functionTag: 'solo', bars: soloBars, hookPolicy: 'none' });
  out.push({ id: 'headOut', role: 'chorus', harmonyRole: 'chorus', functionTag: 'headOut', bars: per, repeatGroup: 'A', hookPolicy: 'light' });
  out.push({ id: 'tag', role: 'outro', harmonyRole: 'ending', functionTag: 'tag', bars: tagBars, hookPolicy: 'none' });
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
  let sections: Section[];
  const styleKey = opts.style?.toLowerCase();
  if (opts.template) {
    sections = TEMPLATES[opts.template].map((s) => ({ ...s }));
  } else if (opts.rng && styleKey && PROCEDURAL_STYLES.has(styleKey)) {
    sections = assembleForm(styleKey, opts.rng); // ★ 程序化拼接(取代写死模板池)
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
