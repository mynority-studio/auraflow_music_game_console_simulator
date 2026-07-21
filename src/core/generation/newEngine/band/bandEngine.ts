// ============================================================
// newEngine · band · BandEngine
// ------------------------------------------------------------
// 架构定稿 Part 4 / 3 表:GenerationRequest → BandSpec。
// Slice 1 tonal:从 styleHint 取 styleProfile,key/mode 可由 request 指定(默认 C 大调)。
// 当前为确定性映射,无随机选择(rng 在做风格内随机选项时再接入)。
// ============================================================

import { createRandomContext, pc, type PitchClass } from '../foundation';
import { MAJOR_SCALE, NATURAL_MINOR } from '../knowledge/scales';
import { modalScale, type ChurchMode } from '../knowledge/modes';
import { pickBandInstrumentation, type LineupConstraint } from '../knowledge/instruments';
import type { BandSpec, Mode, StyleProfile, TonalityKind } from './BandSpec';
import type { JazzArrangementArchetypeId } from '../arranger/jazzArchetypePlanner';

// seed 派生音乐身份的可调参数(都从 'band' 子流取,key/mode 未显式指定才生效)
const MINOR_PROBABILITY = 0.3;                       // 未指定 mode 时落小调的概率
// ACG PIANOSONG 的抒情电影钢琴语汇以小调为默认重心，但不锁死：仍保留
// 少量大调种子，供明亮段落和跨曲多样性使用。显式 request.mode 始终优先。
const STYLE_MINOR_PROBABILITY: Partial<Record<string, number>> = {
  acg: 0.64,
};
const MODAL_MODE_POOL: ChurchMode[] = ['dorian', 'mixolydian', 'aeolian', 'lydian', 'phrygian']; // modal 调式池

export interface GenerationRequest {
  seed: number;
  styleHint: string;
  mood: string;
  targetDuration: number; // 秒
  key?: PitchClass;
  mode?: Mode;
  tonalityKind?: TonalityKind; // 可显式请求 modal(否则由 styleHint 推断)
  modalMode?: ChurchMode;      // modal 时指定教会调式(默认 dorian)
  allowModulation?: boolean;   // 可选:开启段落转调(默认 false)
  bandConstraint?: LineupConstraint; // ★ Band Selection「参与乐手/职能」推导的 lineup/家族约束(音色仍 rng 选)
  /** Internal audition/test override. Ordinary product Jazz still selects the approved 4/4 baseline. */
  jazzArchetypeId?: JazzArrangementArchetypeId;
}

// ★ Q+N macro 风格:POP / JAZZ / LOFI / RNB / ACG(modal 是正交 regime,非 genre)。
const STYLE_PROFILES: Record<string, StyleProfile> = {
  lofi: { accompDensity: 0.4, padDensity: 0.6, melodyFreedom: 0.5, tensionCarrier: 'voicing', colorBudget: 0.4, beatStrictness: 0.4 },
  jazz: { accompDensity: 0.7, padDensity: 0.1, melodyFreedom: 0.8, tensionCarrier: 'both', colorBudget: 0.8, beatStrictness: 0.5 }, // ★ jazz 基本无 pad(0.1 < PAD_OFF 0.12 → pad 全静默)
  pop: { accompDensity: 0.6, padDensity: 0.4, melodyFreedom: 0.4, tensionCarrier: 'melody', colorBudget: 0.3, beatStrictness: 0.8 },
  // RNB / neo-soul:色彩丰富(colorBudget 高,接近 jazz)+ 中等密度 + 双 tension carrier + pocket 律动
  rnb: { accompDensity: 0.6, padDensity: 0.4, melodyFreedom: 0.6, tensionCarrier: 'both', colorBudget: 0.6, beatStrictness: 0.6 },
  // modal:和声静态(低 colorBudget=不加功能离调)+ 旋律自由跑音阶(高 melodyFreedom)
  modal: { accompDensity: 0.45, padDensity: 0.6, melodyFreedom: 0.85, tensionCarrier: 'melody', colorBudget: 0.2, beatStrictness: 0.5 },
  // ★ ACG PIANOSONG:纯钢琴三职责（低根 / 中部琶音 / 顶声部）。高 colorBudget 供 add9、调式与
  //   终止色彩使用；实际编制不启用 pad，cantabile top voice 以中等 melodyFreedom 和轻 rubato 呈现。
  acg: { accompDensity: 0.5, padDensity: 0.55, melodyFreedom: 0.6, tensionCarrier: 'both', colorBudget: 0.75, beatStrictness: 0.55 },
  default: { accompDensity: 0.5, padDensity: 0.4, melodyFreedom: 0.5, tensionCarrier: 'both', colorBudget: 0.4, beatStrictness: 0.6 },
};

function minorProbabilityForStyle(style: string): number {
  return STYLE_MINOR_PROBABILITY[style] ?? MINOR_PROBABILITY;
}

export function buildBandSpec(req: GenerationRequest): BandSpec {
  const style = Object.prototype.hasOwnProperty.call(STYLE_PROFILES, req.styleHint)
    ? req.styleHint
    : 'default';
  const tonalityKind: TonalityKind = req.tonalityKind ?? (style === 'modal' ? 'modal' : 'tonal');

  // ★ seed 派生音乐身份(确定性,独立 'band' 子流):key 缺省 → 12 调随 seed;mode 缺省 → 偶尔小调。
  //   显式 req.key/req.mode 永远优先(测试/指定调用不受扰)。
  const brng = createRandomContext(req.seed).substream('band');
  const key = req.key ?? pc(brng.int(12));
  const mode: Mode = req.mode ?? (brng.next() < minorProbabilityForStyle(style) ? 'minor' : 'major');

  // ★ 乐器要素:独立 'instrumental' 子流(不扰 key/mode)→ 编制(2–5 件)+ 每件 GM program。
  // ★ 2026-06-10(gm128_chain_orchestration):此处 roleProgram 仅为 **provisional 候选**(seed 多样性来源)。
  //   【最终生效】GM 选择由器配层链式协同拥有(orchestrateRolePrograms,见 instrumentalPlanner);
  //   render 一律读 instrumentation.roleProgram,不把 band.roleProgram 当最终发声 program。
  const { lineup, roleProgram, autoFilledRoles } = pickBandInstrumentation(style, createRandomContext(req.seed).substream('instrumental'), req.bandConstraint);

  if (tonalityKind === 'modal') {
    // modal 调式也随 seed(未显式指定)→ 同 styleHint 不同 seed 出不同调式色彩
    const modalModeName: ChurchMode = req.modalMode ?? MODAL_MODE_POOL[brng.int(MODAL_MODE_POOL.length)];
    return {
      style,
      styleProfile: STYLE_PROFILES[style],
      tonalityKind,
      key,
      mode,
      primaryScale: modalScale(key, modalModeName),
      modalModeName,
      allowModulation: false, // modal 静态 vamp 不转调
      instrumentPool: lineup,
      roleProgram,
      autoFilledRoles,
      familyByRole: req.bandConstraint?.familyByRole,
    };
  }

  // tonal:primaryScale = 调内音阶(身份提示;实际逐和弦看 chordScaleMap)
  const diat = mode === 'minor' ? NATURAL_MINOR : MAJOR_SCALE;
  return {
    style,
    styleProfile: STYLE_PROFILES[style],
    tonalityKind,
    key,
    mode,
    primaryScale: diat.map((iv) => pc((key + iv) % 12)),
    allowModulation: req.allowModulation ?? false,
    instrumentPool: lineup,
    roleProgram,
    autoFilledRoles,
    familyByRole: req.bandConstraint?.familyByRole,
  };
}

/** Arranger 已选定 archetype 后对全局调式语境做一次一致化；不改变 key/编制/style。 */
export function withBandMode(band: BandSpec, mode: Mode): BandSpec {
  if (band.mode === mode && band.tonalityKind === 'tonal') return band;
  const intervals = mode === 'minor' ? NATURAL_MINOR : MAJOR_SCALE;
  return {
    ...band,
    tonalityKind: 'tonal',
    mode,
    primaryScale: intervals.map((interval) => pc(((band.key as number) + interval) % 12)),
    modalModeName: undefined,
  };
}
