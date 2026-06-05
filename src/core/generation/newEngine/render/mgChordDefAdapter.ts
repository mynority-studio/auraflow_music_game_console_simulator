// ============================================================
// newEngine · render · MgChordDefAdapter(MG strict 移植 Loop 2)
// ------------------------------------------------------------
// 生产输入桥(无 MG 等价物 —— 这是把我们的 HarmonicPlan 接到 MG 旋律引擎的接缝)。
// 把 newEngine 的 ChordSpan[] 投影成 MG-equivalent MgChordDef[](mgChordPart.buildChordPart 的输入)。
// Option B:我们保留自己的和声引擎,MG 旋律引擎喂【我们的】HarmonicPlan;此 adapter 即喂入口。
// 纯函数,无 RNG,确定性。RoadMap parity 不验证此 adapter(那用 MG fixture 直喂);
// 此 adapter 只保证我们 HarmonicPlan 能产出良构 MgChordDef[]。
// ============================================================

import type { HarmonicPlan, ChordSpan } from '../harmony/HarmonicPlan';
import type { MgChordDef } from './mgChordPart';

// pc → 升号拼写(parser 只读 rootMidi%12,name 仅供下游显示/调试)。
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** 把单个 ChordSpan 投影成 MgChordDef。
 *  - rootMidi = 48 + rootPc(八度 3 锚;parser 只取 %12)
 *  - type     = 宽 chordType 优先(Loop 3+ vocab 查它),回退窄 quality
 *  - bassMidi = pedal 用 bassPedalPc,否则 = 根位(转位真实 bass 由 render bass 轨独立处理;
 *               MgChordDef.bass 仅 MG 旋律 bass-anchor 用,Loop 7 接;此处保根位足够)
 *  - localTonalCenterPc / forcedScale 直传(离调链 + chord-scale override) */
export function chordSpanToMgChordDef(span: ChordSpan): MgChordDef {
  const rootPc = ((span.rootPc % 12) + 12) % 12;
  const bassPc =
    span.bassRole === 'pedal' && span.bassPedalPc != null
      ? ((span.bassPedalPc % 12) + 12) % 12
      : rootPc;
  return {
    root: SHARP_NAMES[rootPc],
    rootMidi: 48 + rootPc,
    type: span.chordType ?? span.quality,
    bassMidi: 48 + bassPc,
    duration: span.durationBeats,
    localTonalCenterPc: span.localTonalCenterPc,
    forcedScale: span.forcedScale,
  };
}

/** HarmonicPlan → MG-equivalent ChordDef[]。按 chordTimeline 顺序投影。 */
export function harmonicPlanToMgChordDefs(plan: HarmonicPlan): MgChordDef[] {
  return plan.chordTimeline.map((span) => chordSpanToMgChordDef(span as ChordSpan));
}
