// ============================================================
// newEngine · render · MgChordDefAdapter(MG strict 移植 Loop 2 + Loop 7 扩展)
// ------------------------------------------------------------
// 生产输入桥(无 MG 等价物 —— 把我们的 HarmonicPlan 接到 MG 旋律引擎的接缝)。
// 把 newEngine 的 ChordSpan[] 投影成 MG-equivalent 和弦(buildChordPart + shapeMelodyHarmony 共用)。
// Option B:我们保留自己的和声引擎,MG 旋律引擎喂【我们的】HarmonicPlan;此 adapter 即喂入口。
// 纯函数,无 RNG,确定性。Loop 7 扩展:补 roman/borrowedSource/mustResolve/notesMidi(shaper 读)。
// ============================================================

import type { HarmonicPlan, ChordSpan, RomanChord } from '../harmony/HarmonicPlan';
import type { MgChordDef } from './mgChordPart';
import type { ShaperChord } from './mgMelodyShaper';

/** 生产和弦 = buildChordPart(MgChordDef)∩ shapeMelodyHarmony(ShaperChord)所需全字段。 */
export type ProductionChord = MgChordDef & ShaperChord;

// pc → 升号拼写(parser 只读 rootMidi%12,name 仅供下游显示/调试)。
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROMAN_NUM = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** RomanChord(结构化)→ roman 字符串(shaper getHarmonicFunction / lofi paradigm 读)。
 *  Option B:这是【我们的】roman,只需功能正确(V/IV/ii 等大小写),非 bit-match MG。 */
function romanToString(rc: RomanChord): string {
  const acc = rc.accidental === 'b' ? 'b' : rc.accidental === 'bb' ? 'bb' : rc.accidental === '#' ? '#' : rc.accidental === 'x' ? 'x' : '';
  // 大小写按品质:小三/半减/减 → 小写;大/属 → 大写。
  const q = String(rc.quality);
  const isLower = q === 'min' || q.startsWith('m');
  let num = ROMAN_NUM[rc.degree] ?? 'I';
  if (isLower) num = num.toLowerCase();
  let s = acc + num;
  if (rc.secondaryTarget) s += '/' + romanToString(rc.secondaryTarget);
  return s;
}

/** 把单个 ChordSpan 投影成生产和弦。
 *  - rootMidi = 48 + rootPc;type = 宽 chordType 优先回退窄 quality
 *  - bassMidi = pedal 用 bassPedalPc,否则根位(转位真实 bass 由 render bass 轨处理)
 *  - roman/mustResolve/borrowedSource:shaper 的功能/离调判定读(BorrowedSource 值与 MG 一致)
 *  - notesMidi:从 stableTones(pcs)给和弦音 MIDI(shaper thinSlashBassMelodyDoubles 取 %12);空=安全跳过
 *  - effectiveFunc 留 undefined → shaper 从 roman 派生 */
export function chordSpanToMgChordDef(span: ChordSpan, stableTones: readonly number[] = []): ProductionChord {
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
    roman: romanToString(span.roman),
    mustResolve: span.mustResolve,
    borrowedSource: span.borrowedSource,
    localTonalCenterPc: span.localTonalCenterPc,
    forcedScale: span.forcedScale,
    notesMidi: stableTones.map((pc) => 60 + (((pc % 12) + 12) % 12)),
  };
}

/** HarmonicPlan → MG-equivalent 生产和弦[]。按 chordTimeline 顺序投影;notesMidi 取 stableToneMap。 */
export function harmonicPlanToMgChordDefs(plan: HarmonicPlan): ProductionChord[] {
  return plan.chordTimeline.map((span) =>
    chordSpanToMgChordDef(span as ChordSpan, plan.stableToneMap[span.id] ?? []),
  );
}
