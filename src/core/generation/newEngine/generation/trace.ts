// ============================================================
// newEngine · generation · traceGeneration(观测层)
// ------------------------------------------------------------
// 走遍每个节点层级,把各 stage 实际产出汇成可读流程日志。
// 不污染纯引擎(不在纯函数里 console.log);单独走查 → 同样的逐层可见性。
// 单次 render pass(Slice 1 恒 pass;Controller 重跑只在 error 时触发,另见 GenerationController)。
// ============================================================

import { beats, createRandomContext, createTimebase } from '../foundation';
import { buildBandSpec, type GenerationRequest } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { compPattern } from '../knowledge/grooves';
import { pickGrammarName } from '../knowledge/grammarLibrary';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import type { RomanChord } from '../harmony/HarmonicPlan';
import { runPrepass } from '../render/motifAnchorPrepass';
import { renderSongFull } from '../render/renderCoordinator';
import type { MusicalIR } from '../ir/MusicalIR';
import type { AuditReport } from '../ir/AuditReport';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
function romanLabel(r: RomanChord): string {
  const acc = r.accidental === 'b' ? 'b' : r.accidental === '#' ? '#' : '';
  const sec = r.secondaryTarget ? `/${ROMAN[r.secondaryTarget.degree]}` : '';
  return `${acc}${ROMAN[r.degree]}${r.quality === 'maj' ? '' : r.quality}${sec}`;
}

export interface GenerationTrace {
  lines: string[];
  ir: MusicalIR;
  audit: AuditReport;
  bpm: number;
}

export function traceGeneration(request: GenerationRequest): GenerationTrace {
  const lines: string[] = [];
  const log = (s: string) => lines.push(s);
  const seedRng = createRandomContext(request.seed);

  log(`■ REQUEST    seed=${request.seed}  style=${request.styleHint}  mood=${request.mood}  dur=${request.targetDuration}s`);

  // —— BAND ——
  const band = buildBandSpec(request);
  log(`■ BAND       ${band.tonalityKind} · key=${band.key} ${band.mode} · style=${band.style}  (accompDensity=${band.styleProfile.accompDensity} melodyFreedom=${band.styleProfile.melodyFreedom})`);

  // —— ARRANGER ——
  const arrangement = buildArrangementPlan(band, { rng: seedRng });
  const formShape = arrangement.sections.map((s) => s.role).join('-'); // seed 选型曲式骨架
  const totalBars = arrangement.sections.reduce((n, s) => n + s.bars, 0);
  log(`■ ARRANGER   ${arrangement.tempoBpm}bpm ${arrangement.meter.numerator}/${arrangement.meter.denominator} ${arrangement.feel.kind} · 曲式=${formShape}(${arrangement.sections.length}段/${totalBars}小节,seed 选) · 高潮=${arrangement.climaxMap.map((c) => c.sectionId).join(',') || '-'}`);
  log(`   段落: ${arrangement.sections.map((s) => `${s.id}[${s.bars}b${s.repeatGroup ? '·' + s.repeatGroup : ''}·${s.hookPolicy}]`).join('  ')}`);
  log(`   乐句 ${arrangement.phrases.length} · 动机绑定 ${arrangement.motifBindings.length}(同 motifId 跨段=排比)`);

  // —— INSTRUMENTAL ——
  const instrumentation = buildInstrumentationPlan(band, arrangement);
  log(`■ INSTRUMENT 织体: ${Object.entries(instrumentation.textureBySection).map(([s, t]) => `${s}=${t}`).join(' ')}`);
  const mainHooks = instrumentation.melodyReservationPlan.hookAnchorSlots.filter((h) => h.anchorRequired);
  log(`   主 hook 让位锚点: ${mainHooks.map((h) => `${h.phraseId}@拍${h.beatSlot}`).join(' ') || '-'}`);

  // —— HARMONY ——
  const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, seedRng);
  log(`■ HARMONY    ${harmonic.chordTimeline.length} 和弦(级数 rng 选+调内解析,段尾 V7-I 终止)${Object.keys(harmonic.borrowedChordMap).length ? ` · 借和弦 iv×${Object.keys(harmonic.borrowedChordMap).length}` : ''}`);
  const seenSec = new Set<string>();
  for (const span of harmonic.chordTimeline) {
    if (seenSec.has(span.sectionId)) continue;
    seenSec.add(span.sectionId);
    const inSec = harmonic.chordTimeline.filter((c) => c.sectionId === span.sectionId);
    log(`   ${span.sectionId}: ${inSec.map((c) => romanLabel(c.roman)).join(' ')}`);
  }
  // 真 chord-scale 采样:首和弦 + 任一离调和弦(副属/借)的调式音阶(含离调音)
  const PCN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const scaleLabel = (id: string) => harmonic.chordScaleMap[id].map((p) => PCN[p]).join(' ');
  const first = harmonic.chordTimeline[0];
  log(`   chord-scale ${romanLabel(first.roman)} = [${scaleLabel(first.id)}](真调式音阶,取代 stable∪acceptable)`);
  const chromId = harmonic.chordTimeline.find((c) => c.roman.secondaryTarget || harmonic.borrowedChordMap[c.id]);
  if (chromId) log(`   chord-scale ${romanLabel(chromId.roman)} = [${scaleLabel(chromId.id)}](离调:根音 ${chromId.roman.secondaryTarget ? 'Mixolydian' : 'Dorian'})`);

  // —— PREPASS ——
  const timebase = createTimebase({
    meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator },
    tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }],
  });
  const { anchorPlan, motifStore } = runPrepass(band, arrangement, harmonic, seedRng);
  log(`■ PREPASS    动机 ${Object.keys(motifStore.motifs).length} 个(种子驱动形状):`);
  for (const [id, m] of Object.entries(motifStore.motifs)) {
    log(`   ${id}: 节奏[${m.rhythmCell.durations.join(',')}] 音级[${m.noteSlots.map((s) => s.scaleDegree).join(',')}] 源=${m.source} grammar=${pickGrammarName(id)}`);
  }
  for (const e of anchorPlan.entries) {
    if (e.commonSafeToneScope === 'global' || e.downgradeReason) {
      log(`   ${e.phraseId}: scope=${e.commonSafeToneScope} 安全音[${e.commonSafeToneSet.join(',')}] 强度 ${e.requestedRestatementStrength}→${e.effectiveRestatementStrength}${e.downgradeReason ? ' (' + e.downgradeReason + ')' : ''}`);
    }
  }

  // —— RENDER + AUDIT ——
  const { ir, audit } = renderSongFull(band, arrangement, harmonic, instrumentation, timebase, seedRng);
  log(`■ RENDER     ${ir.tracks.map((t) => `${t.role}=${t.notes.length}`).join('  ')}`);
  log(`   织体分流: active 段=comp / floating 段(pad/sustained)=pad 长音铺底`);
  log(`   comp 织体: ${band.style}(${compPattern(band.style).length} hits/bar,有律动/切分)`);
  log(`   bass 行进: ${band.style}(jazz=walking / pop=根-五 / lofi=根音持续)`);
  log(`   drum: ${band.style} groove + 段落转折 fill + 力度人性化`);
  log(`   melody: hook 句=grammar 变体发展 / connector·cadence 句=GuideTone 导音线(贴 3/7,authentic 落 3 音);句尾呼吸 + 音区随能量抬升(高潮冲峰)`);
  log(`   dynamics: 全轨力度随段落能量缩放(chorus 强 / intro 弱 / 高潮峰)`);
  log(`   feel: ${arrangement.feel.kind}(swingRatio ${arrangement.feel.swingRatio}${Math.abs(arrangement.feel.swingRatio - 0.5) < 1e-6 ? ' 直' : ' → offbeat 摆动'})`);
  log(`   humanize: 力度 metric accent(强拍重/反拍软,鼓除外)+ 微随机 + 微时序抖动(±~${Math.max(2, Math.round(480 * 0.015))} tick,审计后施加=网格下层)`);
  log(`■ AUDITOR    ${audit.findings.length === 0 ? 'PASS ✓(全链无 avoid 暴露)' : audit.findings.length + ' findings'}`);
  if (audit.findings.length > 0) {
    const f = audit.findings[0];
    log(`   纠错环: finding@${f.location.trackRole}#${f.location.startTick} → 精确返回点(lead→该 binding candidateSwap 切候选 / 伴奏→voicingSafer),非盲推 rng`);
  }
  const bars = Math.round(ir.durationTicks / (480 * beatsPerBarOf(arrangement.meter)));
  log(`■ 总长       ${bars} 小节 @ ${arrangement.tempoBpm}bpm`);

  return { lines, ir, audit, bpm: arrangement.tempoBpm };
}
