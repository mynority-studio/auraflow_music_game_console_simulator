// ============================================================
// newEngine · render · MgChordDefAdapter(MG strict 移植 Loop 2 + Loop 7 扩展)
// ------------------------------------------------------------
// 生产输入桥(无 MG 等价物 —— 把我们的 HarmonicPlan 接到 MG 旋律引擎的接缝)。
// 把 newEngine 的 ChordSpan[] 投影成 MG-equivalent 和弦(buildChordPart + shapeMelodyHarmony 共用)。
// Option B:我们保留自己的和声引擎,MG 旋律引擎喂【我们的】HarmonicPlan;此 adapter 即喂入口。
// 纯函数,无 RNG,确定性。Loop 7 扩展:补 roman/borrowedSource/mustResolve/notesMidi(shaper 读)。
// ============================================================

import { mod12 } from '../foundation';
import type { HarmonicPlan, ChordSpan, RomanChord } from '../harmony/HarmonicPlan';
import { chordTypeIntervals, chordToneIntervals, isKnownChordType, type ChordQuality } from '../knowledge/chords';
import type { MgChordDef } from './mgChordPart';
import type { ShaperChord } from './mgMelodyShaper';

/** 生产和弦 = buildChordPart(MgChordDef)∩ shapeMelodyHarmony(ShaperChord)所需全字段。 */
export type ProductionChord = MgChordDef & ShaperChord;

// pc → 升号拼写(parser 只读 rootMidi%12,name 仅供下游显示/调试)。
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROMAN_NUM = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
// 度数 → TSD 功能(shaper.effectiveFunc 读 18 次,驱动功能/解决 paradigm)。属类(mustResolve)恒 D。
const DEGREE_FUNCTION: Record<number, 'T' | 'S' | 'D'> = { 1: 'T', 3: 'T', 6: 'T', 2: 'S', 4: 'S', 5: 'D', 7: 'D' };

/** 和弦【真实音】半音 interval(从根):宽 chordType 优先(含 9/11/13),否则窄 quality。取代 stableTones 凑数。 */
function realChordToneIntervals(chordType: string, quality: ChordQuality): readonly number[] {
  return isKnownChordType(chordType) ? chordTypeIntervals(chordType) : chordToneIntervals(quality);
}

/**
 * ★ Gap A(2026-06-09):borrowedFrom 不再用【裸 roman】凑(那会让 mgLocalScaleResolver 的调式启发式
 *   拿不到调式名 → Dorian/Mixolydian/Phrygian 借用退化成默认 Aeolian)。改为把【真实调式意图】编进标签:
 *   - 有 forcedScale(显式调式)→ "<scale> <roman>"(如 "Dorian IV";与 resolver forcedScale 分支一致)。
 *   - 无 forcedScale 的 modal_interchange/backdoor → "parallel minor <roman>"(平行小调借用意图 → Aeolian)。
 *   - 副属类(secondary_dominant/secondary_ii_v)→ roman 足够(resolver 走 borrowedSource/tonicization 分支)。
 *   非借用 → null。这样 resolver 能看到原始借用/调式来源标签,而不是被 roman 文本覆盖。
 */
function deriveBorrowedFrom(span: ChordSpan): string | null {
  if (!span.borrowedSource) return null;
  const roman = romanToString(span.roman);
  if (span.forcedScale) return `${span.forcedScale} ${roman}`;
  if (span.borrowedSource === 'modal_interchange' || span.borrowedSource === 'backdoor_dominant') return `parallel minor ${roman}`;
  return roman;
}

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

/** 把单个 ChordSpan 投影成生产和弦(Loop 2:全字段忠实还原,喂满 MG 旋律链)。
 *  - type = 宽 chordType 优先回退窄 quality;notes/notesMidi = 真实和弦音(含 9/11/13),不再用 stableTones 凑数
 *  - bassMidi = pedal 用 bassPedalPc / 转位 3rd·5th·7th 用对应和弦音 / 否则根位(slash 真实 bass)
 *  - effectiveFunc = 度数 TSD(mustResolve→D);borrowedFrom/borrowedSource/mustResolve/localTonalCenterPc/forcedScale 不丢
 *  - chordSymbol = root+type(下游显示/双音判定) */
export function chordSpanToMgChordDef(span: ChordSpan): ProductionChord {
  const rootPc = mod12(span.rootPc) as number;
  const type = span.chordType ?? span.quality;
  const tones = realChordToneIntervals(type, span.quality);
  // bass:pedal / 转位 / 根位
  let bassPc = rootPc;
  if (span.bassRole === 'pedal' && span.bassPedalPc != null) bassPc = mod12(span.bassPedalPc) as number;
  else if (span.bassRole === '3rd') bassPc = mod12(rootPc + (tones[1] ?? 4)) as number;
  else if (span.bassRole === '5th') bassPc = mod12(rootPc + (tones[2] ?? 7)) as number;
  else if (span.bassRole === '7th') bassPc = mod12(rootPc + (tones[3] ?? 10)) as number;
  const notesMidi = tones.map((iv) => 60 + (mod12(rootPc + iv) as number));
  const notes = tones.map((iv) => SHARP_NAMES[mod12(rootPc + iv) as number]);
  const effectiveFunc: 'T' | 'S' | 'D' = span.mustResolve ? 'D' : (DEGREE_FUNCTION[span.roman.degree] ?? 'T');
  const isLocal = span.localTonalCenterPc !== undefined; // 离调区:analysisKeyPc/localRoman 才有意义
  return {
    root: SHARP_NAMES[rootPc],
    rootMidi: 48 + rootPc,
    type,
    bass: SHARP_NAMES[bassPc],
    bassMidi: 48 + bassPc,
    duration: span.durationBeats,
    roman: romanToString(span.roman),
    effectiveFunc,
    mustResolve: span.mustResolve,
    borrowedSource: span.borrowedSource,
    borrowedFrom: deriveBorrowedFrom(span), // ★ Gap A:真实调式/借用来源标签,非裸 roman
    localTonalCenterPc: span.localTonalCenterPc,
    forcedScale: span.forcedScale,
    tonicizationPlacement: span.tonicizationPlacement as string | undefined,
    analysisKeyPc: isLocal ? (span.localTonalCenterPc as number) : undefined,
    localRoman: isLocal ? romanToString(span.roman) : undefined,
    notesMidi,
    notes,
    chordSymbol: `${SHARP_NAMES[rootPc]}${type === 'maj' ? '' : type}`,
  };
}

/** HarmonicPlan → MG-equivalent 生产和弦[]。按 chordTimeline 顺序投影(全字段,不再依赖 stableToneMap)。 */
export function harmonicPlanToMgChordDefs(plan: HarmonicPlan): ProductionChord[] {
  return plan.chordTimeline.map((span) => chordSpanToMgChordDef(span as ChordSpan));
}
