// ============================================================
// newEngine · render · PadCompPolicy(pad↔comp 分工决策)
// ------------------------------------------------------------
// docs/pad_comp_interaction_directive.md 核心:pad 是 sustain / air / 慢声部层。
//   默认按【当前和弦】写 chord-bed，并靠共同音与小步移动连接；guide-tone 只保留为显式特效，
//   不再把 3rd+7th 两音壳当通用 Pad 模板。comp 保持 GM 手感并避让精确同音
//   (铁律:lead > bass > comp > pad)。
//
// 编曲制作依据(网络研究):
//   · 3rd + 7th 是“两声部伴奏”场景的 guide-tone 解，不是所有 Pad 的默认写法。
//   · Pad 独自承担和声时写 3-4 个当前和弦音；与 bass/comp 共存时可省 root、保留较薄上层和弦。
//   · 连续和弦优先留共同音，其余声部尽量同音/级进/不超过三度，避免机械平行三度。
//   · pad 是最先减声部 / 变暗 / 休息的层 → 同频段竞争是 mud 主因,靠"减内容"而非 EQ 解决。
//   · 张力/色彩音放 mid-soft 区,thin + soft 让 pad 与 comp 像"弦乐垫 + 钢琴"共存而非打架。
//
// 第一期落地 mode:silent / drone / guide-tone / full-support;
//   交互:comp-only / pad-only / pad-under-comp / breath-space。
//   【缓】inner-line(需跨 span voice-leading 状态)/ cluster-mist / gated-pad(需 pad 律动)。
// 纯函数、确定性(只读 style × section × density × 在场标志);不动 IR 契约。
// ============================================================

import type { LofiPadFamily } from '../knowledge/lofiFoundationArchetypes';

export type PadMode =
  | 'silent'
  | 'drone'
  | 'guide-tone'
  | 'chord-bed'
  | 'inner-line'      // 第一期未发出(保留类型)
  | 'cluster-mist'    // 第一期未发出
  | 'gated-pad'       // 第一期未发出
  | 'full-support';

export type PadCompInteractionMode =
  | 'comp-only'
  | 'pad-only'
  | 'pad-under-comp'
  | 'comp-answer-over-pad' // 第一期未发出(comp 在非 active 段静默,无 answer 路径)
  | 'gated-pad-drives'     // 第一期未发出
  | 'breath-space';

export interface PadCompContext {
  style: string;
  sectionId: string;
  sectionRole: string;     // intro | verse | chorus | bridge | outro
  padDensity: number;      // styleProfile.padDensity(0..1)
  padActive: boolean;      // pad 在编制 + activeRolesBySection 在场
  compActive: boolean;     // comp 在该段在场(activeSectionIds + activeRolesBySection)
  bassActive: boolean;     // bass 在场 → pad 省 root
  leadReservedLow: number; // melodyReservationPlan.reservedRegister.lowMidi
  leadReservedHigh: number;
  compTextureCase?: string;
  /** LOFI only: Pad family was already selected by the song FoundationPlan. */
  lofiPadFamily?: LofiPadFamily;
}

export interface PadCompDecision {
  padMode: PadMode;
  interactionMode: PadCompInteractionMode;
  padMaxVoices: number;            // pad 最多几个声部(silent=0)
  compMaxVoices?: number;          // pad active 时给 comp 的建议声部上限(第一期仅记录)
  compDurationScale?: number;      // comp 时值缩放(第一期=1,不动 GM)
  compAllowPedal: boolean;         // 是否允许 comp CC64 pedal(第一期恒 true)
  padOmitRoot: boolean;
  padOmitFifth: boolean;
  avoidExactPitchOverlap: boolean; // comp 避开与 pad 同绝对 MIDI
}

// pad 几乎不存在的密度阈值(此下视作 comp-only / pad silent)。
const PAD_OFF_DENSITY = 0.12;
// pad-only 段:低密度 → 严格共同音 drone,否则 full-support(3-4 音承担完整和声)。
const PAD_ONLY_DRONE_DENSITY = 0.3;
// gated-pad(节奏化 pad shimmer)只在高 padDensity 的现代 pop chorus lift 触发(否则太忙)。
const GATED_PAD_DENSITY = 0.65;
const RHYTHMIC_STYLES = ['pop', 'edm', 'electropop', 'electronic', 'synthpop'];
const NEOSOUL_STYLES = ['rnb', 'neosoul', 'neo-soul', 'soul'];

/**
 * 决策 pad↔comp 分工(确定性,第一期核心 mode)。
 *   priority:lead > bass > comp > pad。pad 是最先变薄/休息的层。
 */
export function decidePadComp(ctx: PadCompContext): PadCompDecision {
  const style = ctx.style.toLowerCase();
  const omitRoot = ctx.bassActive; // bass 兜 root → pad 省 root(无 bass 时可含,但不低不响,第一期仍省以求安全)

  // —— pad 不在场 / 密度过低 → comp-only,pad 静默 ——
  if (!ctx.padActive || ctx.padDensity < PAD_OFF_DENSITY) {
    return silent('comp-only', omitRoot);
  }

  if (style === 'lofi' && ctx.lofiPadFamily) {
    if (ctx.lofiPadFamily === 'none') return silent('comp-only', omitRoot);
    if (!ctx.compActive) {
      return {
        padMode: 'full-support',
        interactionMode: 'pad-only',
        padMaxVoices: 3,
        compAllowPedal: true,
        padOmitRoot: omitRoot,
        padOmitFifth: false,
        avoidExactPitchOverlap: false,
      };
    }
    const base = {
      compMaxVoices: 3,
      compDurationScale: 1,
      compAllowPedal: true,
      avoidExactPitchOverlap: true,
      padOmitRoot: omitRoot,
    } as const;
    if (ctx.lofiPadFamily === 'common-tone') {
      return {
        ...base,
        padMode: 'drone',
        interactionMode: 'pad-under-comp',
        padMaxVoices: 1,
        padOmitFifth: false,
      };
    }
    if (ctx.lofiPadFamily === 'guide-bed') {
      return {
        ...base,
        padMode: 'guide-tone',
        interactionMode: 'pad-under-comp',
        padMaxVoices: 2,
        padOmitFifth: true,
      };
    }
    return {
      ...base,
      padMode: 'chord-bed',
      interactionMode: 'pad-under-comp',
      padMaxVoices: 2,
      padOmitFifth: true,
    };
  }

  // —— comp 不在场(intro / breakdown / outro / floating)→ pad-only,pad 承担和声 ——
  if (!ctx.compActive) {
    if (ctx.padDensity < PAD_ONLY_DRONE_DENSITY) {
      return {
        padMode: 'drone', interactionMode: 'pad-only', padMaxVoices: 1,
        compAllowPedal: true, padOmitRoot: omitRoot, padOmitFifth: false, avoidExactPitchOverlap: false,
      };
    }
    return {
      padMode: 'full-support', interactionMode: 'pad-only', padMaxVoices: omitRoot ? 3 : 4,
      compAllowPedal: true, padOmitRoot: omitRoot, padOmitFifth: false, avoidExactPitchOverlap: false,
    };
  }

  // —— comp 在场(打架高发区)→ 按风格让 pad 退到 thin 层 ——
  const base = { compMaxVoices: 3, compDurationScale: 1, compAllowPedal: true, avoidExactPitchOverlap: true, padOmitRoot: omitRoot } as const;
  // JAZZ:combo 语境,pad 休息(comp + bass + lead 撑场)。
  if (style === 'jazz' || style === 'blues') {
    return silent('comp-only', omitRoot);
  }
  // Legacy LOFI fixtures without a FoundationPlan retain the old fallback.
  if (style === 'lofi') {
    if (ctx.sectionRole === 'verse') {
      return { ...base, padMode: 'cluster-mist', interactionMode: 'pad-under-comp', padMaxVoices: 2, padOmitFifth: true };
    }
    return { ...base, padMode: 'drone', interactionMode: 'pad-under-comp', padMaxVoices: 1, padOmitFifth: false };
  }
  // 现代 pop chorus lift + 高 padDensity → 当前和弦的 gated-pad shimmer。
  if (RHYTHMIC_STYLES.includes(style) && ctx.sectionRole === 'chorus' && ctx.padDensity >= GATED_PAD_DENSITY) {
    return { ...base, padMode: 'gated-pad', interactionMode: 'gated-pad-drives', padMaxVoices: 3, padOmitFifth: false };
  }
  // R&B / Neo-Soul 的 chorus/bridge → inner-line(慢内声部半音线条,neo-soul 高级感)。
  if (NEOSOUL_STYLES.includes(style) && (ctx.sectionRole === 'chorus' || ctx.sectionRole === 'bridge')) {
    return { ...base, padMode: 'inner-line', interactionMode: 'pad-under-comp', padMaxVoices: 2, padOmitFifth: true };
  }
  // verse:留白(breath-space)→ 单共同音 drone,给人声/旋律空间(verse 1 音 ↔ chorus 2 音 密度弧)。
  if (ctx.sectionRole === 'verse') {
    return { ...base, padMode: 'drone', interactionMode: 'breath-space', padMaxVoices: 1, padOmitFifth: false };
  }
  // 其它(chorus / bridge / intro 等有 comp 的段)→ 当前和弦的薄 chord-bed。
  // bass 已给 root 时采用 3/7/5 上层三声部；无 bass 时七和弦取 root/3/7、三和弦取 root/3/5。
  return { ...base, padMode: 'chord-bed', interactionMode: 'pad-under-comp', padMaxVoices: 3, padOmitFifth: false };
}

function silent(interactionMode: PadCompInteractionMode, omitRoot: boolean): PadCompDecision {
  return {
    padMode: 'silent', interactionMode, padMaxVoices: 0,
    compAllowPedal: true, padOmitRoot: omitRoot, padOmitFifth: true, avoidExactPitchOverlap: false,
  };
}
