// ============================================================
// newEngine · render · MgLeadRenderer(MG strict 移植 Loop 7 — coordinator swap)
// ------------------------------------------------------------
// 生产 lead:把【我们的 HarmonicPlan】喂 MG 旋律全链(decision B:MG 旋律喂我们和弦),
// 产出单轨 lead TrackIR。外层 renderCoordinator 的多轨层(mix/ducking/density 弧)原样包住
// (decision 1:多轨保我们的)。lead 内部用 MG enriched 语法 + 单轨手感(StyleRenderer)+ shapeMelodyHarmony
// (decision C:塑形全量接收 MG)。确定性:seed 取自 RandomContext 'melody' 子流。
//
// ⚠️ repeatGroup:MG 链按【整曲】单次 RNG 扫描生成 → verse2(同和弦)旋律 ≠ verse1
//   (不再守 newEngine 旧的 verse1≡verse2 记忆点不变量)。这是 MG-faithful 行为;
//   多轨伴奏仍守 repeatGroup。若要 lead 也重复一致,是后续增强(按 repeatGroup 分组重放)。
// ============================================================

import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { BandSpec } from '../band/BandSpec';
import type { Timebase } from '../foundation';
import { midi, beats } from '../foundation';
import type { TrackIR, NoteIR } from '../ir/MusicalIR';
import { connectFastLeadNoteIR, fastLeadLegatoOptionsForStyle } from './leadArticulation';

import { harmonicPlanToMgChordDefs } from './mgChordDefAdapter';
import { buildChordPart } from './mgChordPart';
import { parseRoadMap } from './mgRoadMapParser';
import { expandGrammarForRoadMap } from './mgGrammarRuntime';
import { scheduleBrickExpansions } from './mgTokenScheduler';
import { scheduleAcgCycleCadencePhrases } from './mgAcgCycleScheduler';
import { fallbackTokensForBrick } from './mgAdvisor';
import { realizeTokens } from './mgMelodyRealizer';
import { buildGuideTonePlan } from './mgGuideTonePlanner';
import { renderStyleFeel, feelForStyle, feelFromGrooveContract, type ImprovisorStyleFeel } from './mgStyleRenderer';
import { shapeMelodyHarmony } from './mgMelodyShaper';
import {
  ENRICHED_GRAMMAR, POP_ENRICHED_GRAMMAR, LOFI_ENRICHED_GRAMMAR, RNB_ENRICHED_GRAMMAR,
} from '../knowledge/melodyStyleGrammarProfiles';
import { makeSeededRng } from './mgRng';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
type MgStyle = 'POP' | 'JAZZ' | 'BLUES' | 'RNB' | 'LOFI' | 'ACG';

/** band.style(任意大小写)→ MG StyleName。未知 → JAZZ(base enriched,无专属 paradigm)。 */
function toMgStyle(style: string): MgStyle {
  const s = style.toUpperCase();
  return (s === 'POP' || s === 'LOFI' || s === 'RNB' || s === 'JAZZ' || s === 'BLUES' || s === 'ACG') ? s : 'JAZZ';
}

function grammarForStyle(s: MgStyle) {
  // ★ MG 升级 Phase 2c:ACG 复用 LOFI 旋律 grammar(忠实源 improvisorFunctionalGrammarForStyle('ACG')→LOFI)
  //   —— 软、尊重约束、偏简单乐句形(无 bebop 跑动),贴电影钢琴 cantabile。
  return s === 'LOFI' || s === 'ACG' ? LOFI_ENRICHED_GRAMMAR
    : s === 'POP' ? POP_ENRICHED_GRAMMAR
    : s === 'RNB' ? RNB_ENRICHED_GRAMMAR
    : ENRICHED_GRAMMAR;
}

/** 生产 lead:HarmonicPlan → MG 全链 → lead TrackIR。
 *  ★ Loop 1(2026-06-09,strict parity):MG seed = 【song seed 直通】(makeSeededRng(songSeed)),
 *    不再经 RandomContext 的 melody 子流 int() 派生 → 与 MG oracle 同 seed 同旋律(事件级可比)。
 *    newEngine 其它模块(伴奏/人性化/器配)仍用 RandomContext 子流。 */
export function renderMgMelody(
  plan: HarmonicPlan,
  band: BandSpec,
  timebase: Timebase,
  songSeed: number,
  leadProgram?: number, // ★ 2026-06-10:器配生效 lead program(单一真源);缺省回退 band.roleProgram(测试/向后兼容)
  grooveContract?: { style: string; melodySwingRatio: number; articulation: ImprovisorStyleFeel['articulation']; accentPattern: readonly number[] }, // ★ MG 升级 1c:lead swing 真源(仅 ACG 走;非 ACG 门控回退 feelForStyle → 零洗牌)
): TrackIR {
  const program = leadProgram ?? band.roleProgram.lead;
  const chords = harmonicPlanToMgChordDefs(plan);
  if (chords.length === 0) return { role: 'lead', notes: [], program };

  const seed = songSeed; // MG seed = song seed 直通(strict parity)
  const style = toMgStyle(band.style);
  const songKeyPc = ((band.key as number) % 12 + 12) % 12;
  const musicKey = NOTE_NAMES[songKeyPc];
  // 模式名:modal regime 用具体教会调式(首字母大写);否则 major→Ionian / minor→Aeolian。
  const cap = (m: string) => m.charAt(0).toUpperCase() + m.slice(1);
  const musicMode = band.modalModeName ? cap(band.modalModeName) : (band.mode === 'minor' ? 'Aeolian' : 'Ionian');
  const tonalCharacter: 'tonal' | 'modal' = band.tonalityKind === 'modal' ? 'modal' : 'tonal';
  const meter: [number, number] = [timebase.meter.numerator, timebase.meter.denominator];

  // ── MG 链(镜像 generateImprovisorMelody stage 1-5 + 生产 shapeMelodyHarmony)──
  const mgRng = makeSeededRng(seed);
  const part = buildChordPart(chords, meter);
  const roadMap = parseRoadMap({ part, songKeyPc });
  const perBrick = expandGrammarForRoadMap(grammarForStyle(style), roadMap.bricks, mgRng);
  for (let i = 0; i < perBrick.length; i++) {
    if (perBrick[i].tokens.length === 0) perBrick[i].tokens = fallbackTokensForBrick(perBrick[i].brick);
  }
  // ★ MG full-parity G4:ACG 走 cycle-cadence 调度(一条长句铺满和声 cycle,钢琴呼吸),非 brick-by-brick lick chain。
  const scheduled = style === 'ACG' ? scheduleAcgCycleCadencePhrases(perBrick, part) : scheduleBrickExpansions(perBrick);
  const guideTonePlan = buildGuideTonePlan({ chordPart: part });
  let melody = realizeTokens({
    scheduledTokens: scheduled,
    chordPart: part,
    rng: mgRng,
    guideTonePlan,
    preserveSlopeGrammar: style === 'LOFI' || style === 'ACG', // ★ Phase 2c:ACG 保留作者旋律斜率(忠实源,乐句内不乱跳)
  });
  // ★ 旋律 timing owner = MG StyleRenderer(单一所有权,Loop A 校正):lead 在此用 MG style feel 的 swing
  //   (jazz/blues 0.67 摆动;pop/rnb/lofi 0.5 直)。renderCoordinator 末尾的 applySwing【跳过 lead】(swing.ts:22),
  //   所以不会双重摆动 —— lead 的 swing 由这里独占,伴奏(comp/bass/drum)的 swing 由 arranger feel + 全局 applySwing 负责。
  //   ⚠️ 不要把这里压成 0.5:applySwing 既跳过 lead,压直会让 jazz lead 变直而伴奏仍摆 → lead/groove 错位(2026-06-08 实测教训)。
  //   ★ protectFastRuns(2026-06-19):jazz/blues 连续 16 分 run 内的 .5 不被当八分反拍摆动(防 .5→.67 挤压 micro-IOI)。
  // ★ MG 升级 1c:lead feel 真源 = GrooveContract.melodySwingRatio —— 但【仅 ACG】走 contract(新 pool);
  //   非 ACG 门控回退 feelForStyle(style)= 现状,保证零洗牌(jazz 16分 run/走A 预摆/legato/双摆测试不漂)。
  const leadFeel = grooveContract && grooveContract.style === 'ACG' ? feelFromGrooveContract(grooveContract) : feelForStyle(style);
  melody = renderStyleFeel({ events: melody, feel: leadFeel, rng: mgRng, protectFastRuns: style === 'JAZZ' || style === 'BLUES' });
  // shapeMelodyHarmony(decision C 全量接收;per-style,镜像 musicEngine 4109-4117)。
  const applyLofi = style === 'LOFI';
  melody = shapeMelodyHarmony(style, melody, chords, musicKey, musicMode, tonalCharacter, applyLofi);

  // ── MgNoteEvent[](beat)→ NoteIR[](tick)──
  const notes: NoteIR[] = melody
    .filter((e) => e.part === 'melody' && e.duration > 0)
    .map((e) => ({
      pitch: midi(Math.max(0, Math.min(127, Math.round(e.noteNumber)))),
      startTick: timebase.beatToTick(beats(e.time)),
      durationTicks: timebase.beatToTick(beats(Math.max(0.01, e.duration))),
      velocity: Math.max(1, Math.min(127, Math.round(e.velocity))),
    }))
    .sort((a, b) => (a.startTick as number) - (b.startTick as number) || (a.pitch as number) - (b.pitch as number));

  // ★ Loop 3(Option A strict parity,2026-06-09):撤掉旧"末音 snap 落主音"——lead = MG 真源,音高/时序/力度
  //   一律不被 newEngine 后处理改写。收尾的"回主音"是【和声】回 T(harmony.ensureAuthenticEnding 的 V7→I),
  //   不是旋律;旋律的解决/落音交回 MG shapeMelodyHarmony(applyMelodicResolutionParadigm 等,读 effectiveFunc)。

  // ★ 快速 lead 连音 legato(jazz/blues;CODEX directive 2026-06-18):swing 后把快速线条的音连到下一起音,
  //   消除 0.85 articulation 重开的"机关枪"断点。只改 durationTicks,不动 pitch/start/数量;非 jazz 风格 enabled=false 零改动。
  const legatoNotes = connectFastLeadNoteIR(notes, fastLeadLegatoOptionsForStyle(style, timebase.ppq));
  return { role: 'lead', notes: legatoNotes, program };
}
