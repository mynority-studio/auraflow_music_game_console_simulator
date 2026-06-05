// ============================================================
// newEngine · render · PadCompPolicy(pad↔comp 分工决策)
// ------------------------------------------------------------
// docs/pad_comp_interaction_directive.md 第一期核心:pad 不是第二条和弦轨,而是
//   sustain / air / 慢声部层。pad 与 comp 同时 active 时进入 pad-aware mode →
//   pad 退成 1-2 音 guide-tone / drone、省 root(bass 有)、通常省 5th、避同绝对音高;
//   comp 保持 GM 手感只避让(铁律:lead > bass > comp > pad)。
//
// 编曲制作依据(网络研究):
//   · guide tone = 3rd + 7th 承载和声身份;5th 常省(不改变和声);root 归 bass。
//   · pad 是最先减声部 / 变暗 / 休息的层 → 同频段竞争是 mud 主因,靠"减内容"而非 EQ 解决。
//   · 张力/色彩音放 mid-soft 区,thin + soft 让 pad 与 comp 像"弦乐垫 + 钢琴"共存而非打架。
//
// 第一期落地 mode:silent / drone / guide-tone / full-support;
//   交互:comp-only / pad-only / pad-under-comp / breath-space。
//   【缓】inner-line(需跨 span voice-leading 状态)/ cluster-mist / gated-pad(需 pad 律动)。
// 纯函数、确定性(只读 style × section × density × 在场标志);不动 IR 契约。
// ============================================================

export type PadMode =
  | 'silent'
  | 'drone'
  | 'guide-tone'
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
// pad-only 段:低密度 → drone(单音),否则 full-support(2-3 音承担更多和声身份)。
const PAD_ONLY_DRONE_DENSITY = 0.3;

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

  // —— comp 不在场(intro / breakdown / outro / floating)→ pad-only,pad 承担和声 ——
  if (!ctx.compActive) {
    if (ctx.padDensity < PAD_ONLY_DRONE_DENSITY) {
      return {
        padMode: 'drone', interactionMode: 'pad-only', padMaxVoices: 1,
        compAllowPedal: true, padOmitRoot: omitRoot, padOmitFifth: false, avoidExactPitchOverlap: false,
      };
    }
    return {
      padMode: 'full-support', interactionMode: 'pad-only', padMaxVoices: 3,
      compAllowPedal: true, padOmitRoot: omitRoot, padOmitFifth: false, avoidExactPitchOverlap: false,
    };
  }

  // —— comp 在场(打架高发区)→ 按风格让 pad 退到 thin 层 ——
  // JAZZ:combo 语境,pad 休息(comp + bass + lead 撑场)。
  if (style === 'jazz' || style === 'blues') {
    return silent('comp-only', omitRoot);
  }
  // LOFI:warm drone — 单共同音长铺,最安全、几乎不打架。
  if (style === 'lofi') {
    return {
      padMode: 'drone', interactionMode: 'pad-under-comp', padMaxVoices: 1,
      compMaxVoices: 3, compDurationScale: 1, compAllowPedal: true,
      padOmitRoot: omitRoot, padOmitFifth: false, avoidExactPitchOverlap: true,
    };
  }
  // POP / RNB / default 的 verse:留白(breath-space)→ 单共同音 drone,给人声/旋律空间。
  //   verse(1 音 drone)↔ chorus(2 音 guide-tone)形成段落密度弧对比。
  if (ctx.sectionRole === 'verse') {
    return {
      padMode: 'drone', interactionMode: 'breath-space', padMaxVoices: 1,
      compMaxVoices: 3, compDurationScale: 1, compAllowPedal: true,
      padOmitRoot: omitRoot, padOmitFifth: false, avoidExactPitchOverlap: true,
    };
  }
  // 其它(chorus / bridge / intro 等有 comp 的段)→ guide-tone:1-2 音 3rd/7th,省 root + 5th。
  return {
    padMode: 'guide-tone', interactionMode: 'pad-under-comp', padMaxVoices: 2,
    compMaxVoices: 3, compDurationScale: 1, compAllowPedal: true,
    padOmitRoot: omitRoot, padOmitFifth: true, avoidExactPitchOverlap: true,
  };
}

function silent(interactionMode: PadCompInteractionMode, omitRoot: boolean): PadCompDecision {
  return {
    padMode: 'silent', interactionMode, padMaxVoices: 0,
    compAllowPedal: true, padOmitRoot: omitRoot, padOmitFifth: true, avoidExactPitchOverlap: false,
  };
}
